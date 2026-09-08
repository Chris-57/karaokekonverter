"""Generate/apply a separate delivery stack using the operator's AWS CLI session."""
import argparse
import json
import re
import subprocess
import sys
import urllib.request

from scripts.delivery_common import (Aws, DeliveryError, ROOT, code_objects, encode,
    get_stack, inventory, load_config, oidc_subject, outputs, processed_template, stable_stack)


def allow(actions, resources, condition=None):
    value = {"Effect": "Allow", "Action": actions, "Resource": resources}
    if condition:
        value["Condition"] = condition
    return value


def document(statements):
    return {"Version": "2012-10-17", "Statement": statements}


def generate(config, account, stack, resources, template, provider=None, role_arns=None):
    """Pure template generator. AWS identifiers are supplied by read-only discovery."""
    if not re.fullmatch(r"[0-9]{12}", account):
        raise DeliveryError("Expected a twelve-digit AWS account ID.")
    region, name = config["region"], config["stack"]
    if stack["StackName"] != name or not stack["StackId"].startswith(
            f"arn:aws:cloudformation:{region}:{account}:stack/{name}/"):
        raise DeliveryError("Application stack identity does not match the requested account/region.")
    def physical(logical, kind):
        item = resources.get(logical, {})
        if item.get("ResourceType") != kind:
            raise DeliveryError(f"Missing expected {logical} ({kind}); review the stack first.")
        return item["PhysicalResourceId"]

    def arn(service, suffix, global_region=False):
        return f"arn:aws:{service}:{'' if global_region else region}:{account}:{suffix}"

    functions = [arn("lambda", "function:" + physical(x, "AWS::Lambda::Function"))
                 for x in ("ApiFunction", "WorkerFunction", "AvailabilityFunction")]
    roles = role_arns or [arn("iam", "role/" + physical(x, "AWS::IAM::Role"), True)
                         for x in ("ApiFunctionRole", "WorkerFunctionRole", "AvailabilityRole")]
    if len(roles) != 3 or any(not x.startswith(f"arn:aws:iam::{account}:role/") for x in roles):
        raise DeliveryError("Expected exactly the application's three execution roles.")
    website = physical("WebsiteBucket", "AWS::S3::Bucket")
    distribution = arn("cloudfront", "distribution/" + physical("Website", "AWS::CloudFront::Distribution"), True)
    cf_role = arn("iam", f"role/{name}-cloudformation", True)
    bootstrap_arn = arn("cloudformation", f"stack/{name}-delivery/*")
    artifact_bucket = {"Ref": "ArtifactBucket"}
    artifact_arn = {"Fn::GetAtt": ["ArtifactBucket", "Arn"]}
    artifact_objects = {"Fn::Sub": "${ArtifactBucket.Arn}/releases/*"}
    legacy = sorted({f"arn:aws:s3:::{bucket}/{key}" for _, bucket, key, _ in code_objects(template)})
    site_arn = f"arn:aws:s3:::{website}"
    site_objects = [site_arn + "/" + x for x in ("index.html", "app.js", "styles.css", "release.json")]
    region_only = {"StringEquals": {"aws:RequestedRegion": region}}

    github_statements = [
        allow(["cloudformation:CreateChangeSet"], stack["StackId"], {
              "StringEquals": {"cloudformation:RoleArn": cf_role},
              "StringLike": {"cloudformation:ChangeSetName": name + "-delivery-*",
                  "cloudformation:TemplateUrl": {"Fn::Sub": "https://${ArtifactBucket}.s3.${AWS::Region}.amazonaws.com/releases/*/template.json"}}}),
        allow(["cloudformation:DescribeStacks", "cloudformation:DescribeChangeSet",
               "cloudformation:DeleteChangeSet",
               "cloudformation:DescribeStackEvents", "cloudformation:ListStackResources",
               "cloudformation:GetTemplate"], stack["StackId"]),
        allow(["cloudformation:ExecuteChangeSet"], stack["StackId"],
              {"StringLike": {"cloudformation:ChangeSetName": name + "-delivery-*"}}),
        allow(["cloudformation:DescribeStacks"], bootstrap_arn),
        allow(["iam:PassRole"], cf_role,
              {"StringEquals": {"iam:PassedToService": "cloudformation.amazonaws.com"}}),
        allow(["s3:GetBucketLocation", "s3:ListBucket"], artifact_arn),
        allow(["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject",
               "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"], artifact_objects),
        allow(["s3:GetObject", "s3:GetObjectVersion"], legacy),
        allow(["s3:GetObject", "s3:PutObject"], site_objects),
        allow(["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"], distribution),
    ]

    # Resource handlers may read unchanged properties during an update. Permissions
    # cover existing resources, without allowing new roles, secret reads or job data.
    execution = [
        allow(["lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:GetPolicy",
               "lambda:ListTags", "lambda:ListVersionsByFunction", "lambda:GetFunctionCodeSigningConfig",
               "lambda:GetFunctionRecursionConfig", "lambda:GetRuntimeManagementConfig",
               "lambda:GetFunctionScalingConfig", "lambda:GetFunctionEventInvokeConfig",
               "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
               "lambda:TagResource", "lambda:UntagResource", "lambda:AddPermission",
               "lambda:RemovePermission", "lambda:PutFunctionEventInvokeConfig",
               "lambda:DeleteFunctionEventInvokeConfig", "lambda:PutRuntimeManagementConfig",
               "lambda:PutFunctionRecursionConfig"], functions),
        allow(["iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies"], roles),
        allow(["iam:PassRole"], roles, {"StringEquals": {"iam:PassedToService": "lambda.amazonaws.com"}}),
        allow(["s3:GetObject", "s3:GetObjectVersion"], [artifact_objects, *legacy]),
        allow(["s3:Get*", "s3:ListBucket", "s3:ListTagsForResource",
               "s3:PutEncryptionConfiguration", "s3:PutBucketPublicAccessBlock",
               "s3:PutBucketVersioning", "s3:PutBucketTagging", "s3:PutBucketPolicy"], site_arn),
        allow(["cloudfront:GetDistribution", "cloudfront:GetDistributionConfig",
               "cloudfront:UpdateDistribution", "cloudfront:ListTagsForResource",
               "cloudfront:TagResource", "cloudfront:UntagResource"], distribution),
        allow(["dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive",
               "dynamodb:DescribeContinuousBackups", "dynamodb:ListTagsOfResource",
               "dynamodb:UpdateTable", "dynamodb:UpdateTimeToLive", "dynamodb:UpdateContinuousBackups",
               "dynamodb:TagResource", "dynamodb:UntagResource"],
              arn("dynamodb", "table/" + physical("JobsTable", "AWS::DynamoDB::Table"))),
        allow(["secretsmanager:DescribeSecret", "secretsmanager:GetResourcePolicy",
               "secretsmanager:ListSecretVersionIds"], physical("AppConfig", "AWS::SecretsManager::Secret")),
    ]
    for logical, kind, suffix, operations in [
        ("OriginAccess", "OriginAccessControl", "origin-access-control", ["GetOriginAccessControl", "UpdateOriginAccessControl"]),
        ("AssetCachePolicy", "CachePolicy", "cache-policy", ["GetCachePolicy", "UpdateCachePolicy"]),
        ("ApiCachePolicy", "CachePolicy", "cache-policy", ["GetCachePolicy", "UpdateCachePolicy"]),
        ("ApiOriginRequestPolicy", "OriginRequestPolicy", "origin-request-policy", ["GetOriginRequestPolicy", "UpdateOriginRequestPolicy"]),
        ("SecurityHeaders", "ResponseHeadersPolicy", "response-headers-policy", ["GetResponseHeadersPolicy", "UpdateResponseHeadersPolicy"]),
    ]:
        execution.append(allow(["cloudfront:" + op for op in operations],
            arn("cloudfront", suffix + "/" + physical(logical, "AWS::CloudFront::" + kind), True)))

    queues, logs, alarms, rules, mappings = [], [], [], [], []
    for item in resources.values():
        kind, identifier = item["ResourceType"], item["PhysicalResourceId"]
        if kind == "AWS::SQS::Queue":
            queues.append(arn("sqs", identifier.rsplit("/", 1)[-1]))
        elif kind == "AWS::Logs::LogGroup":
            logs.extend([arn("logs", "log-group:" + identifier), arn("logs", "log-group:" + identifier + ":*")])
        elif kind == "AWS::CloudWatch::Alarm":
            alarms.append(arn("cloudwatch", "alarm:" + identifier))
        elif kind == "AWS::Events::Rule":
            rules.append(arn("events", "rule/" + identifier))
        elif kind == "AWS::Lambda::EventSourceMapping":
            mappings.append(arn("lambda", "event-source-mapping:" + identifier))
    for collection in (queues, logs, alarms, rules, mappings):
        if not collection:
            raise DeliveryError("Expected the existing queue/log/alarm/schedule/event-source resources.")
    execution += [
        allow(["sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ListQueueTags", "sqs:SetQueueAttributes",
               "sqs:TagQueue", "sqs:UntagQueue"], queues),
        allow(["logs:DescribeLogStreams", "logs:DescribeMetricFilters", "logs:ListTagsForResource",
               "logs:ListTagsLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy",
               "logs:PutMetricFilter", "logs:DeleteMetricFilter", "logs:TagResource", "logs:UntagResource"], logs),
        allow(["logs:DescribeLogGroups", "logs:DescribeQueryDefinitions"], "*", region_only),
        allow(["cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource", "cloudwatch:PutMetricAlarm",
               "cloudwatch:TagResource", "cloudwatch:UntagResource"], alarms),
        allow(["cloudwatch:GetDashboard", "cloudwatch:PutDashboard"],
              arn("cloudwatch", "dashboard/" + physical("MonitoringDashboard", "AWS::CloudWatch::Dashboard"), True)),
        allow(["events:DescribeRule", "events:ListTargetsByRule", "events:ListTagsForResource",
               "events:PutRule", "events:PutTargets", "events:RemoveTargets", "events:TagResource",
               "events:UntagResource"], rules),
        allow(["lambda:GetEventSourceMapping", "lambda:UpdateEventSourceMapping", "lambda:ListTags",
               "lambda:TagResource", "lambda:UntagResource"], mappings),
        allow(["sns:GetTopicAttributes", "sns:ListTagsForResource", "sns:SetTopicAttributes",
               "sns:TagResource", "sns:UntagResource"], physical("AlertTopic", "AWS::SNS::Topic")),
    ]
    api = f"arn:aws:apigateway:{region}::/apis/" + physical("HttpApi", "AWS::ApiGatewayV2::Api")
    execution.append(allow(["apigateway:GET", "apigateway:PATCH", "apigateway:PUT", "apigateway:POST",
                            "apigateway:DELETE"], [api, api + "/*"]))

    generated = {
        "AWSTemplateFormatVersion": "2010-09-09",
        "Description": "KaraokeKonverter existing-stack delivery; separate from application resources.",
        "Resources": {
            "ArtifactBucket": {
                "Type": "AWS::S3::Bucket", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain",
                "Properties": {
                    "BucketEncryption": {"ServerSideEncryptionConfiguration": [{"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]},
                    "PublicAccessBlockConfiguration": {"BlockPublicAcls": True, "BlockPublicPolicy": True,
                        "IgnorePublicAcls": True, "RestrictPublicBuckets": True},
                    "OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]},
                    "VersioningConfiguration": {"Status": "Enabled"},
                    "LifecycleConfiguration": {"Rules": [{"Id": "AbortUnfinishedUploads", "Status": "Enabled",
                        "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}}]},
                }},
            "ArtifactBucketPolicy": {"Type": "AWS::S3::BucketPolicy", "Properties": {
                "Bucket": artifact_bucket,
                "PolicyDocument": document([{"Effect": "Deny", "Principal": "*", "Action": "s3:*",
                    "Resource": [artifact_arn, {"Fn::Sub": "${ArtifactBucket.Arn}/*"}],
                    "Condition": {"Bool": {"aws:SecureTransport": "false"}}}])}},
            "CloudFormationRole": {"Type": "AWS::IAM::Role", "Properties": {
                "RoleName": name + "-cloudformation",
                "AssumeRolePolicyDocument": document([{"Effect": "Allow", "Principal": {
                    "Service": "cloudformation.amazonaws.com"}, "Action": "sts:AssumeRole"}])}},
        },
        "Outputs": {
            "ArtifactBucket": {"Value": artifact_bucket},
            "CloudFormationRoleArn": {"Value": {"Fn::GetAtt": ["CloudFormationRole", "Arn"]}},
            "GitHubDeployRoleArn": {"Value": {"Fn::GetAtt": ["GitHubDeployRole", "Arn"]}},
            "RepositorySubject": {"Value": oidc_subject(config)},
            "ApplicationStackId": {"Value": stack["StackId"]},
        },
    }
    if provider is None:
        generated["Resources"]["GitHubProvider"] = {"Type": "AWS::IAM::OIDCProvider",
            "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain",
            "Properties": {"Url": "https://token.actions.githubusercontent.com", "ClientIdList": ["sts.amazonaws.com"]}}
        provider = {"Ref": "GitHubProvider"}
    generated["Resources"]["GitHubDeployRole"] = {"Type": "AWS::IAM::Role", "Properties": {
        "RoleName": name + "-github-deploy", "MaxSessionDuration": 7200,
        "AssumeRolePolicyDocument": document([{"Effect": "Allow", "Principal": {"Federated": provider},
            "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": oidc_subject(config)}}}]),
        "Policies": [{"PolicyName": "ExistingApplicationDelivery", "PolicyDocument": document(github_statements)}],
    }}
    # Separate managed policies stay below IAM's per-policy and aggregate inline quotas.
    chunks = [[]]
    for statement in execution:
        if len(encode(document([*chunks[-1], statement]))) > 5400:
            chunks.append([])
        chunks[-1].append(statement)
    if len(chunks) > 8 or any(len(encode(document(c))) > 5400 for c in chunks):
        raise DeliveryError("Delivery policy scope exceeds its reviewed size budget.")
    for index, chunk in enumerate(chunks, 1):
        generated["Resources"][f"ExecutionPolicy{index}"] = {"Type": "AWS::IAM::ManagedPolicy", "Properties": {
            "Description": "Update existing application resources only; no role mutation or secret-value access.",
            "Roles": [{"Ref": "CloudFormationRole"}], "PolicyDocument": document(chunk)}}
    if len(encode(document(github_statements))) > 9000 or len(encode(generated)) > 51000:
        raise DeliveryError("Bootstrap template exceeds its reviewed size budget.")
    return generated


def discover_provider(aws, account, bootstrap_name):
    existing = aws.call("iam", "list-open-id-connect-providers")["OpenIDConnectProviderList"]
    target = f"arn:aws:iam::{account}:oidc-provider/token.actions.githubusercontent.com"
    if target not in [item["Arn"] for item in existing]:
        return None
    info = aws.call("iam", "get-open-id-connect-provider", {"OpenIDConnectProviderArn": target})
    if "sts.amazonaws.com" not in info.get("ClientIDList", []):
        raise DeliveryError("The existing GitHub provider lacks the STS audience; review it with the account owner.")
    # Keep a provider managed by our bootstrap in its template on subsequent runs.
    try:
        owned = inventory(aws, bootstrap_name)
    except DeliveryError as error:
        if "does not exist" not in str(error):
            raise
        owned = {}
    return None if owned.get("GitHubProvider", {}).get("PhysicalResourceId") == target else target


def verify_repository(config):
    request = urllib.request.Request("https://api.github.com/repos/" + config["repository"],
        headers={"User-Agent": "karaokekonverter-delivery-setup", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        value = json.load(response)
    if (value.get("full_name") != config["repository"] or str(value.get("id")) != config["repositoryId"]
            or str(value.get("owner", {}).get("id")) != config["ownerId"]
            or value.get("default_branch") != config["branch"] or value.get("private") is not False
            or value.get("created_at", "") < "2026-07-16"):
        raise DeliveryError("GitHub repository identity/subject assumptions changed; review the configuration.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-account", required=True)
    parser.add_argument("--apply", action="store_true", help="Create/update the separate delivery stack.")
    args = parser.parse_args(argv)
    config = load_config()
    aws = Aws(config["region"])
    identity = aws.call("sts", "get-caller-identity")
    if identity["Account"] != args.expected_account or identity["Arn"].endswith(":root"):
        raise DeliveryError("Use your project administrator session in the expected account.")
    verify_repository(config)
    stack = get_stack(aws, config["stack"])
    stable_stack(stack)
    resources = inventory(aws, config["stack"])
    roles = [aws.call("iam", "get-role", {"RoleName": resources[x]["PhysicalResourceId"]})["Role"]["Arn"]
             for x in ("ApiFunctionRole", "WorkerFunctionRole", "AvailabilityRole")]
    bootstrap_name = config["stack"] + "-delivery"
    result = generate(config, identity["Account"], stack, resources, processed_template(aws, config["stack"]),
        discover_provider(aws, identity["Account"], bootstrap_name), roles)
    destination = ROOT / ".data/delivery/bootstrap-template.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(encode(result))
    print(f"Prepared {destination.relative_to(ROOT)} for {bootstrap_name}.")
    print("Trust subject: " + oidc_subject(config))
    print("Application resources and secret values are not changed by this bootstrap.")
    if not args.apply:
        print("Review the generated template. Repeat with --apply to create the delivery resources.")
        return
    subprocess.run(["aws", "cloudformation", "deploy", "--template-file", str(destination),
        "--stack-name", bootstrap_name, "--region", config["region"], "--capabilities", "CAPABILITY_NAMED_IAM",
        "--no-fail-on-empty-changeset", "--no-cli-pager"], check=True)
    ready = get_stack(aws, bootstrap_name)
    stable_stack(ready)
    print("\nAdd these repository Actions VARIABLES (not secrets):")
    print("AWS_DEPLOY_ROLE_ARN=" + outputs(ready)["GitHubDeployRoleArn"])
    print("AWS_ACCOUNT_ID=" + identity["Account"])
    print("AWS_DEPLOY_ENABLED=true  (set this last)")
    print("Then run Actions > Deploy AWS > Run workflow on main, action=deploy.")


if __name__ == "__main__":
    try:
        main()
    except (DeliveryError, subprocess.SubprocessError, OSError, ValueError, KeyError) as error:
        print(f"Setup stopped: {error}", file=sys.stderr)
        sys.exit(1)
