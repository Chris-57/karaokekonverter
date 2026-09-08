"""Deploy or restore a verified private release of the existing AWS application."""
import copy
import json
import os
import re
import subprocess
import sys
import urllib.parse

from scripts.delivery_common import (ASSETS, Aws, DeliveryError, ROOT, check_changes,
    code_objects, digest, encode, get_stack, inventory, invalidate, outputs,
    processed_template, release_id, stable_stack, summary, verify_website,
    verify_with_retries, wait_change_set, wait_stack_update)
from scripts.delivery_event import current_main, validate_context
from scripts.application_release import build_application_template, check_source_contract


def version_at(aws, bucket, key, version=None):
    request = {"Bucket": bucket, "Key": key}
    if version:
        request["VersionId"] = version
    result = aws.call("s3api", "head-object", request)
    found = result.get("VersionId")
    if not isinstance(found, str) or found == "null":
        raise DeliveryError("Release artifacts must have S3 version IDs.")
    return found


def snapshot_code(aws, template, bucket, identifier):
    frozen = copy.deepcopy(template)
    for logical, old_bucket, key, version in code_objects(frozen):
        if old_bucket != bucket or not key.startswith("releases/"):
            source = urllib.parse.quote(old_bucket + "/" + key, safe="/")
            if version:
                source += "?versionId=" + urllib.parse.quote(version, safe="")
            key = f"releases/{identifier}/lambda/{logical}.zip"
            result = aws.call("s3api", "copy-object", {
                "Bucket": bucket, "Key": key, "CopySource": source, "ServerSideEncryption": "AES256"})
            version = result.get("VersionId")
        version = version_at(aws, bucket, key, version)
        frozen["Resources"][logical]["Properties"]["Code"] = {
            "S3Bucket": bucket, "S3Key": key, "S3ObjectVersion": version}
    return frozen


def freeze_package(aws, template, bucket, identifier):
    """Pin every SAM/Lambda archive to an object version, including shared code."""
    frozen = copy.deepcopy(template)
    found = set()
    versions = {}
    prefix = f"releases/{identifier}/lambda/"
    for logical, resource in frozen.get("Resources", {}).items():
        kind, props = resource.get("Type"), resource.get("Properties", {})
        if kind not in {"AWS::Serverless::Function", "AWS::Lambda::Function"}:
            continue
        found.add(logical)
        if kind == "AWS::Serverless::Function":
            code = props.get("CodeUri", frozen.get("Globals", {}).get("Function", {}).get("CodeUri"))
            if isinstance(code, str):
                parsed = urllib.parse.urlsplit(code)
                code = {"Bucket": parsed.netloc, "Key": urllib.parse.unquote(parsed.path.lstrip("/"))} if parsed.scheme == "s3" else {}
            location, key = (code or {}).get("Bucket"), (code or {}).get("Key")
        else:
            code = props.get("Code", {})
            location, key = code.get("S3Bucket"), code.get("S3Key")
        if location != bucket or not isinstance(key, str) or not key.startswith(prefix):
            raise DeliveryError(f"{logical}: packaged code must be inside this release's artifact prefix.")
        if key not in versions:
            versions[key] = version_at(aws, bucket, key)
        if kind == "AWS::Serverless::Function":
            props["CodeUri"] = {"Bucket": bucket, "Key": key, "Version": versions[key]}
        else:
            props["Code"] = {"S3Bucket": bucket, "S3Key": key, "S3ObjectVersion": versions[key]}
    if found != {"ApiFunction", "WorkerFunction", "AvailabilityFunction"}:
        raise DeliveryError("Packaged template must contain the three existing application functions.")
    # Individual functions now have explicit packaged code; no local inherited path is retained.
    frozen.get("Globals", {}).get("Function", {}).pop("CodeUri", None)
    return frozen


def save_release(aws, bucket, identifier, template, assets, metadata):
    release_id(identifier)
    prefix = f"releases/{identifier}/"
    content = encode(template)
    manifest = {"schema": 1, **metadata, "releaseId": identifier,
                "template": {"key": prefix + "template.json", "sha256": digest(content)}, "assets": {}}
    aws.put_blob(bucket, prefix + "template.json", content, create_only=True)
    if set(assets) != set(ASSETS):
        raise DeliveryError("A release must contain exactly the three website assets.")
    for name, body in assets.items():
        key = prefix + "site/" + name
        aws.put_blob(bucket, key, body, ASSETS[name], create_only=True)
        manifest["assets"][name] = {"key": key, "sha256": digest(body)}
    aws.put_blob(bucket, prefix + "manifest.json", encode(manifest), create_only=True)
    return manifest


def mark_verified(aws, bucket, manifest, kind):
    if kind not in {"deployed", "observed-baseline"}:
        raise DeliveryError("Unsupported verification evidence.")
    marker = {"schema": 1, "verification": kind, "manifestSha256": digest(encode(manifest))}
    aws.put_blob(bucket, f"releases/{manifest['releaseId']}/verified.json", encode(marker), create_only=True)


def validate_saved_archives(aws, template, bucket):
    locations, functions = set(), set()
    for logical, resource in template.get("Resources", {}).items():
        kind, props = resource.get("Type"), resource.get("Properties", {})
        if kind == "AWS::Lambda::Function":
            code = props.get("Code", {})
            location, key, version = code.get("S3Bucket"), code.get("S3Key"), code.get("S3ObjectVersion")
        elif kind == "AWS::Serverless::Function":
            code = props.get("CodeUri", {})
            if not isinstance(code, dict):
                raise DeliveryError("Saved SAM code must include an explicit S3 object version.")
            location, key, version = code.get("Bucket"), code.get("Key"), code.get("Version")
        else:
            continue
        if (location != bucket or not isinstance(key, str) or not key.startswith("releases/")
                or not isinstance(version, str) or not version or version == "null"):
            raise DeliveryError("Saved Lambda archives must be versioned objects in the private release bucket.")
        functions.add(logical)
        locations.add((key, version))
    if functions != {"ApiFunction", "WorkerFunction", "AvailabilityFunction"}:
        raise DeliveryError("Saved release does not contain the expected three functions.")
    for key, version in sorted(locations):
        if version_at(aws, bucket, key, version) != version:
            raise DeliveryError("A saved Lambda archive version is unavailable.")


def load_release(aws, bucket, identifier, stack_id, account, region):
    release_id(identifier)
    prefix = f"releases/{identifier}/"
    manifest = json.loads(aws.get_blob(bucket, prefix + "manifest.json"))
    marker = json.loads(aws.get_blob(bucket, prefix + "verified.json"))
    if (manifest.get("schema") != 1 or manifest.get("releaseId") != identifier
            or manifest.get("stackId") != stack_id or manifest.get("account") != account
            or manifest.get("region") != region or not isinstance(manifest.get("applicationVersion"), str)
            or not manifest["applicationVersion"] or marker.get("schema") != 1
            or marker.get("verification") not in {"deployed", "observed-baseline"}
            or marker.get("manifestSha256") != digest(encode(manifest))):
        raise DeliveryError("Release identity or verification record does not match this application.")
    if set(manifest.get("assets", {})) != set(ASSETS):
        raise DeliveryError("Release asset manifest is incomplete.")

    def checked(record, expected_key):
        if record.get("key") != expected_key or not re.fullmatch(r"[0-9a-f]{64}", record.get("sha256", "")):
            raise DeliveryError("Release object path/checksum is invalid.")
        value = aws.get_blob(bucket, expected_key)
        if digest(value) != record["sha256"]:
            raise DeliveryError("A saved release object failed its checksum check.")
        return value

    template = json.loads(checked(manifest["template"], prefix + "template.json"))
    assets = {name: checked(manifest["assets"][name], prefix + "site/" + name) for name in ASSETS}
    validate_saved_archives(aws, template, bucket)
    return manifest, template, assets


def capture_baseline(aws, bucket, identifier, stack, region, account, template=None):
    current = outputs(stack)
    assets = {name: aws.get_blob(current["WebsiteBucket"], name) for name in ASSETS}
    observed_version = None
    try:
        observed = verify_website(current["WebsiteUrl"], None, {name: digest(body) for name, body in assets.items()})
        observed_version = observed["version"]
    except Exception:
        # A recovery attempt must still be possible when the current application is broken.
        summary("The current website did not pass baseline checks. Its snapshot will not be offered as a verified restore target.")
    template = snapshot_code(aws, template if template is not None else processed_template(aws, stack["StackName"]), bucket, identifier)
    manifest = save_release(aws, bucket, identifier, template, assets, {
        "stackId": stack["StackId"], "account": account, "region": region,
        "applicationVersion": observed_version, "commit": None, "kind": "captured-baseline"})
    if observed_version:
        mark_verified(aws, bucket, manifest, "observed-baseline")
        summary(f"Recovery snapshot: `{identifier}` (website hashes and both-source configuration checked).")
    else:
        summary(f"Unverified snapshot: `{identifier}`. Restore a previously verified release if needed.")
    return manifest


def all_changes(aws, stack_name, change_name, first):
    changes = list(first.get("Changes", []))
    token = first.get("NextToken")
    while token:
        page = aws.call("cloudformation", "describe-change-set", {
            "StackName": stack_name, "ChangeSetName": change_name, "NextToken": token})
        changes.extend(page.get("Changes", []))
        token = page.get("NextToken")
    return changes


def update_stack(aws, stack, resources, role_arn, bucket, manifest, still_current, before_execute=None):
    change_name = stack["StackName"] + "-delivery-" + manifest["releaseId"]
    template_url = f"https://{bucket}.s3.{aws.region}.amazonaws.com/" + manifest["template"]["key"]
    request = {"StackName": stack["StackName"], "ChangeSetName": change_name, "ChangeSetType": "UPDATE",
        "TemplateURL": template_url, "RoleARN": role_arn,
        "Capabilities": ["CAPABILITY_NAMED_IAM" if "CAPABILITY_NAMED_IAM" in stack.get("Capabilities", []) else "CAPABILITY_IAM"],
        "Tags": copy.deepcopy(stack.get("Tags", [])),
        "Description": "KaraokeKonverter release " + manifest["releaseId"],
        "ClientToken": manifest["releaseId"]}
    if stack.get("Parameters"):
        request["Parameters"] = [{"ParameterKey": item["ParameterKey"], "UsePreviousValue": True} for item in stack["Parameters"]]
    for key in ("NotificationARNs", "RollbackConfiguration"):
        if key in stack:
            request[key] = copy.deepcopy(stack[key])
    aws.call("cloudformation", "create-change-set", request)
    try:
        result = wait_change_set(aws, stack["StackName"], change_name)
        if result is not None:
            changes = all_changes(aws, stack["StackName"], change_name, result)
            print("Proposed resource changes: " + json.dumps([
                {key: change.get("ResourceChange", {}).get(key) for key in
                 ("LogicalResourceId", "ResourceType", "Action", "Replacement", "Scope")}
                for change in changes]), flush=True)
            check_changes(changes, resources, application_only=True)
        latest = get_stack(aws, stack["StackName"])
        stable_stack(latest)
        if latest.get("LastUpdatedTime", latest.get("CreationTime")) != stack.get("LastUpdatedTime", stack.get("CreationTime")):
            raise DeliveryError("The stack changed outside this run. Inspect it before deploying again.")
        if not still_current():
            raise DeliveryError("Main changed during preparation; the newer run should deploy.")
    except Exception:
        aws.call("cloudformation", "delete-change-set", {"StackName": stack["StackName"], "ChangeSetName": change_name})
        raise
    if result is None:
        aws.call("cloudformation", "delete-change-set", {"StackName": stack["StackName"], "ChangeSetName": change_name})
        summary("CloudFormation found no resource changes; website publication and verification will still run.")
        return
    summary(f"Executing `{change_name}`. CloudFormation events remain available if this runner disconnects.")
    if before_execute is not None:
        before_execute()
    aws.call("cloudformation", "execute-change-set", {"StackName": stack["StackName"],
        "ChangeSetName": change_name, "ClientRequestToken": "execute-" + manifest["releaseId"]})
    wait_stack_update(aws, stack["StackName"], stack.get("LastUpdatedTime", stack.get("CreationTime")))


def publish_and_verify(aws, bucket, stack_outputs, manifest, assets):
    # Fixed website filenames mean publication has a short mixed-version window.
    # Publish JS/CSS before HTML, then the release marker; never use sync --delete.
    for name in ("app.js", "styles.css", "index.html"):
        aws.put_blob(stack_outputs["WebsiteBucket"], name, assets[name], ASSETS[name])
    marker = {"releaseId": manifest["releaseId"], "commit": manifest.get("commit"),
              "version": manifest["applicationVersion"]}
    aws.put_blob(stack_outputs["WebsiteBucket"], "release.json", encode(marker))
    invalidate(aws, stack_outputs["DistributionId"], manifest["releaseId"])
    verify_with_retries(stack_outputs["WebsiteUrl"], manifest["applicationVersion"],
        {name: manifest["assets"][name]["sha256"] for name in ASSETS}, marker)
    # Never mark a release verified merely because CloudFormation completed.
    mark_verified(aws, bucket, manifest, "deployed")


def main(progress=None):
    progress = progress if progress is not None else {"phase": "preparation"}
    config, commit, mode, restore = validate_context()
    if current_main(config) != commit:
        summary("Skipped an obsolete main commit before requesting application changes.")
        return
    if mode == "deploy":
        check_source_contract()
    expected_account = os.environ.get("AWS_ACCOUNT_ID", "")
    if not re.fullmatch(r"[0-9]{12}", expected_account):
        raise DeliveryError("Set the AWS_ACCOUNT_ID repository variable.")
    identifier = release_id(f"run-{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}")
    snapshot_id = identifier.replace("run-", "snapshot-", 1)
    aws = Aws(config["region"])
    identity = aws.call("sts", "get-caller-identity")
    if identity["Account"] != expected_account or f":assumed-role/{config['stack']}-github-deploy/" not in identity["Arn"]:
        raise DeliveryError("The deployment session is not the expected GitHub role/account.")
    stack = get_stack(aws, config["stack"])
    stable_stack(stack)
    bootstrap = get_stack(aws, config["stack"] + "-delivery")
    stable_stack(bootstrap)
    settings = outputs(bootstrap)
    if settings.get("ApplicationStackId") != stack["StackId"]:
        raise DeliveryError("Delivery bootstrap refers to a different application stack.")
    bucket, role_arn = settings["ArtifactBucket"], settings["CloudFormationRoleArn"]
    if stack.get("RoleARN") not in (None, role_arn):
        raise DeliveryError("The stack already uses a different service role; review it before changing delegation.")
    resources = inventory(aws, config["stack"])
    live_template = processed_template(aws, config["stack"])
    metadata = {"stackId": stack["StackId"], "account": expected_account, "region": config["region"],
                "commit": commit, "kind": "deployment", "scope": "lambda-code-and-website"}
    if mode == "restore":
        previous, template, assets = load_release(aws, bucket, restore, stack["StackId"], expected_account, config["region"])
        metadata.update(applicationVersion=previous["applicationVersion"], commit=previous.get("commit"),
                        restoredFrom=restore, kind="restore")
    else:
        assets = {name: (ROOT / "dist" / name).read_bytes() for name in ASSETS}
        metadata["applicationVersion"] = json.loads((ROOT / "package.json").read_text())["version"]
        destination = ROOT / ".data/delivery/packaged.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["sam", "package", "--template-file", str(ROOT / ".aws-sam/build/template.yaml"),
            "--s3-bucket", bucket, "--s3-prefix", f"releases/{identifier}/lambda",
            "--output-template-file", str(destination), "--use-json", "--region", config["region"]], check=True)
        template = freeze_package(aws, json.loads(destination.read_text()), bucket, identifier)
    template = build_application_template(live_template, template)
    try:
        capture_baseline(aws, bucket, snapshot_id, stack, config["region"], expected_account, template=live_template)
    except Exception:
        if mode != "restore":
            raise
        # A missing current website object must not block restoration of a checked release.
        summary("Could not finish capturing the current deployment. Continuing with the previously verified restore target.")
    manifest = save_release(aws, bucket, identifier, template, assets, metadata)
    summary(f"Prepared application release `{identifier}` from commit `{metadata.get('commit') or 'captured baseline'}`. "
            "The template retains deployed infrastructure and replaces only the three Lambda code packages.")
    update_stack(aws, stack, resources, role_arn, bucket, manifest, lambda: current_main(config) == commit,
                 before_execute=lambda: progress.update(phase="stack-update"))
    current = get_stack(aws, config["stack"])
    stable_stack(current)
    progress["phase"] = "website-publication"
    publish_and_verify(aws, bucket, outputs(current), manifest, assets)
    progress["phase"] = "verified"
    summary(f"Verified release `{identifier}`: [open website]({outputs(current)['WebsiteUrl']}). "
            "Health, release marker and all three website hashes passed. Live Spotify/SoundCloud conversions remain a separate smoke test.")


def report_failure(error, progress):
    summary(f"Deployment stopped: {str(error)[:1800]}")
    if progress["phase"] == "preparation":
        summary("Stopped before requesting application changes. The running application was not updated by this run; "
                "release preparation may have saved private package artifacts and a recovery snapshot.")
    elif progress["phase"] == "stack-update":
        summary("A CloudFormation update was requested. Inspect its current status/events before retrying; "
                "it may continue after this runner stops.")
    else:
        summary("Website publication started. Check the live app and stack; if verification fails, "
                "use the documented restore action with a verified release or healthy baseline snapshot.")


if __name__ == "__main__":
    progress = {"phase": "preparation"}
    try:
        main(progress)
    except Exception as error:
        # No AWS secret values, application access codes or provider responses are read/logged here.
        report_failure(error, progress)
        sys.exit(1)
