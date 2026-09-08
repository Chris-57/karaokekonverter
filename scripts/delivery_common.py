"""Shared deployment operations. Imports never contact AWS or music providers."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
STABLE_STATES = {"CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"}
ASSETS = {"index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8",
          "styles.css": "text/css; charset=utf-8"}
RELEASE_RE = re.compile(r"(?:run|snapshot)-[0-9]{1,20}-[0-9]{1,5}\Z")


class DeliveryError(RuntimeError):
    pass


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def load_config():
    value = json.loads((ROOT / "infra/delivery-config.json").read_text())
    if not re.fullmatch(r"[A-Za-z0-9-]+/[A-Za-z0-9_.-]+", value["repository"]):
        raise DeliveryError("Invalid repository configuration.")
    if not all(re.fullmatch(r"[1-9][0-9]*", value[k]) for k in ["repositoryId", "ownerId"]):
        raise DeliveryError("Repository identity must include numeric IDs.")
    if value["branch"] != "main" or value["region"] != "us-east-2":
        raise DeliveryError("This delivery setup targets main in us-east-2.")
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,30}", value["stack"]):
        raise DeliveryError("Unsupported stack name.")
    return value


def oidc_subject(config):
    owner, repo = config["repository"].split("/")
    return (f"repo:{owner}@{config['ownerId']}/{repo}@{config['repositoryId']}"
            f":ref:refs/heads/{config['branch']}")


def release_id(value):
    if not isinstance(value, str) or not RELEASE_RE.fullmatch(value):
        raise DeliveryError("Release ID must look like run-123456789-1 or snapshot-123456789-1.")
    return value


class Aws:
    """AWS CLI transport; uses the current CloudShell or OIDC session, never static keys."""
    def __init__(self, region):
        self.region = region

    def call(self, service, operation, payload=None, extra=()):
        command = ["aws", service, operation, "--region", self.region,
                   "--output", "json", "--no-cli-pager", "--no-paginate"]
        if payload:
            command += ["--cli-input-json", json.dumps(payload)]
        command += list(extra)
        result = subprocess.run(command, text=True, capture_output=True, timeout=180)
        if result.returncode:
            # This transport only calls metadata/deployment APIs; never secret-value APIs.
            raise DeliveryError(f"AWS {service} {operation} failed: {result.stderr.strip()[:1800]}")
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def pages(self, service, operation, payload, field):
        request = dict(payload)
        while True:
            result = self.call(service, operation, request)
            yield from result.get(field, [])
            token = result.get("NextToken")
            if not token:
                break
            request["NextToken"] = token

    def get_blob(self, bucket, key):
        with tempfile.TemporaryDirectory(prefix="karaoke-object-") as directory:
            path = Path(directory) / "object"
            # This streaming-output command does not support --cli-input-json.
            # Pass required options explicitly and keep its outfile positional.
            self.call("s3api", "get-object", extra=[
                "--bucket", bucket, "--key", key, str(path)])
            return path.read_bytes()

    def put_blob(self, bucket, key, data, content_type="application/json", create_only=False):
        with tempfile.TemporaryDirectory(prefix="karaoke-object-") as directory:
            path = Path(directory) / "object"
            path.write_bytes(data)
            payload = {"Bucket": bucket, "Key": key, "ContentType": content_type,
                       "ServerSideEncryption": "AES256", "CacheControl": "no-cache"}
            if create_only:
                payload["IfNoneMatch"] = "*"
            self.call("s3api", "put-object", payload, ["--body", str(path)])


def get_stack(aws, name):
    response = aws.call("cloudformation", "describe-stacks", {"StackName": name})
    stacks = response.get("Stacks", [])
    if len(stacks) != 1 or stacks[0]["StackName"] != name:
        raise DeliveryError("Could not resolve exactly the requested stack.")
    return stacks[0]


def stable_stack(stack):
    if stack["StackStatus"] not in STABLE_STATES:
        raise DeliveryError(f"Stack is {stack['StackStatus']}; inspect CloudFormation before deploying.")


def outputs(stack):
    return {item["OutputKey"]: item["OutputValue"] for item in stack.get("Outputs", [])}


def inventory(aws, stack):
    items = list(aws.pages("cloudformation", "list-stack-resources", {"StackName": stack},
                           "StackResourceSummaries"))
    return {item["LogicalResourceId"]: item for item in items
            if item.get("PhysicalResourceId") and item.get("ResourceStatus") != "DELETE_COMPLETE"}


def processed_template(aws, stack):
    value = aws.call("cloudformation", "get-template", {
        "StackName": stack, "TemplateStage": "Processed"})["TemplateBody"]
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise DeliveryError("Expected the SAM-transformed template as JSON.") from error
    if not isinstance(value, dict) or "Resources" not in value:
        raise DeliveryError("CloudFormation returned an unsupported template.")
    return value


def code_objects(template):
    """Find only literal S3 Lambda archives in the existing SAM-transformed stack."""
    result = []
    for logical_id, resource in template["Resources"].items():
        if resource.get("Type") != "AWS::Lambda::Function":
            continue
        code = resource.get("Properties", {}).get("Code", {})
        bucket, key = code.get("S3Bucket"), code.get("S3Key")
        if not isinstance(bucket, str) or not isinstance(key, str):
            raise DeliveryError(f"{logical_id}: only S3-packaged Lambda functions are supported.")
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket) or not key:
            raise DeliveryError("Invalid Lambda artifact location.")
        result.append((logical_id, bucket, key, code.get("S3ObjectVersion")))
    if {item[0] for item in result} != {"ApiFunction", "WorkerFunction", "AvailabilityFunction"}:
        raise DeliveryError("Expected the existing API, worker and availability functions.")
    return result


def check_changes(changes, resources):
    """Apply only in-place updates to known resources; never expand deployment privileges."""
    for change in changes:
        resource = change.get("ResourceChange", {})
        name, kind = resource.get("LogicalResourceId"), resource.get("ResourceType", "")
        if (name not in resources or resources[name]["ResourceType"] != kind
                or resource.get("Action") != "Modify" or resource.get("Replacement") != "False"):
            raise DeliveryError(f"{name}: resource additions, removals, imports and replacements need an operator update.")
        if kind.startswith(("AWS::IAM::", "AWS::SecretsManager::")) or kind == "AWS::Logs::QueryDefinition":
            raise DeliveryError(f"{name}: IAM, secret and saved-query changes need an operator update.")


def wait_change_set(aws, stack, name, timeout=300, sleep=time.sleep, clock=time.monotonic):
    deadline = clock() + timeout
    while clock() < deadline:
        result = aws.call("cloudformation", "describe-change-set", {"StackName": stack, "ChangeSetName": name})
        if result["Status"] == "CREATE_COMPLETE":
            return result
        if result["Status"] == "FAILED":
            reason = result.get("StatusReason", "")
            if "didn't contain changes" in reason or "No updates are to be performed" in reason:
                return None
            raise DeliveryError(f"Change set failed: {reason[:1200]}")
        sleep(5)
    raise DeliveryError("Change-set creation timed out; inspect CloudFormation before retrying.")


def wait_stack_update(aws, stack, previous_time, timeout=2700, sleep=time.sleep, clock=time.monotonic):
    deadline = clock() + timeout
    while clock() < deadline:
        current = get_stack(aws, stack)
        status = current["StackStatus"]
        print(f"CloudFormation: {status}", flush=True)
        changed = current.get("LastUpdatedTime", current.get("CreationTime")) != previous_time
        if status == "UPDATE_COMPLETE" and changed:
            return current
        if status.endswith("_FAILED") or "ROLLBACK" in status:
            raise DeliveryError(f"CloudFormation is {status}; inspect its events before retrying.")
        sleep(15)
    raise DeliveryError("Stack update still pending; CloudFormation can continue after this job ends.")


class SameHostRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        old, new = urllib.parse.urlsplit(request.full_url), urllib.parse.urlsplit(new_url)
        if new.scheme != "https" or new.netloc != old.netloc:
            raise DeliveryError("Unexpected redirect from the deployed website.")
        return super().redirect_request(request, fp, code, message, headers, new_url)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "karaokekonverter-delivery", "Cache-Control": "no-cache"})
    with urllib.request.build_opener(SameHostRedirect()).open(request, timeout=15) as response:
        body = response.read(2 * 1024 * 1024 + 1)
        if len(body) > 2 * 1024 * 1024:
            raise DeliveryError("Unexpectedly large health/website response.")
        return body


def health_contract(value, expected_version=None):
    return (isinstance(value, dict) and value.get("service") == "karaokekonverter"
            and isinstance(value.get("version"), str) and bool(value["version"])
            and (expected_version is None or value["version"] == expected_version)
            and value.get("configured") is True and value.get("maxTracks") == 20
            and isinstance(value.get("sources"), list)
            and all(isinstance(source, str) for source in value["sources"])
            and set(value["sources"]) == {"soundcloud", "spotify"}
            and isinstance(value.get("sourceReady"), dict)
            and all(value["sourceReady"].get(source) is True for source in ("soundcloud", "spotify"))
            and value.get("authentication") == "access-code"
            and value.get("output") == "temporary-playback-link")


def verify_website(url, expected_version, assets, marker=None, get=fetch):
    if not re.fullmatch(r"https://[a-z0-9]+\.cloudfront\.net", url):
        raise DeliveryError("Expected the stack's HTTPS CloudFront website.")
    value = json.loads(get(url + "/api/health"))
    if not health_contract(value, expected_version):
        raise DeliveryError("The deployed API health contract is not ready for both sources.")
    for name, expected_hash in assets.items():
        if name not in ASSETS:
            raise DeliveryError("Unsupported website asset.")
        if digest(get(url + ("/" if name == "index.html" else "/" + name))) != expected_hash:
            raise DeliveryError(f"CloudFront is not serving the expected {name}.")
    if marker is not None and json.loads(get(url + "/release.json")) != marker:
        raise DeliveryError("CloudFront is not serving the expected release marker.")
    return value


def verify_with_retries(*args, attempts=8, sleep=time.sleep, **kwargs):
    for attempt in range(attempts):
        try:
            return verify_website(*args, **kwargs)
        except Exception:
            if attempt == attempts - 1:
                raise DeliveryError("Post-deploy checks failed. Use the recorded snapshot/release to recover.") from None
            print("Waiting for the expected website and health response...", flush=True)
            sleep(15)


def invalidate(aws, distribution, token, timeout=1800, sleep=time.sleep, clock=time.monotonic):
    response = aws.call("cloudfront", "create-invalidation", {
        "DistributionId": distribution, "InvalidationBatch": {
            "CallerReference": token, "Paths": {"Quantity": 5,
                "Items": ["/", "/index.html", "/app.js", "/styles.css", "/release.json"]}}})
    identifier = response["Invalidation"]["Id"]
    deadline = clock() + timeout
    while clock() < deadline:
        result = aws.call("cloudfront", "get-invalidation", {"DistributionId": distribution, "Id": identifier})
        if result["Invalidation"]["Status"] == "Completed":
            return identifier
        print("CloudFront invalidation is propagating...", flush=True)
        sleep(15)
    raise DeliveryError("CloudFront invalidation is still pending; inspect it before repeating a deployment.")


def summary(message):
    print(message, flush=True)
    destination = os.environ.get("GITHUB_STEP_SUMMARY")
    if destination:
        with open(destination, "a", encoding="utf-8") as handle:
            handle.write(message + "\n\n")
