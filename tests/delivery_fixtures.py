"""Synthetic AWS metadata; never a record of a live deployment."""
from scripts.delivery_common import load_config


def fixture():
    config, account = load_config(), "000000000000"
    name, region = config["stack"], config["region"]
    stack = {"StackName": name, "StackId": f"arn:aws:cloudformation:{region}:{account}:stack/{name}/test-id",
        "StackStatus": "UPDATE_COMPLETE", "LastUpdatedTime": "2026-09-08T00:00:00Z",
        "Outputs": [{"OutputKey": "WebsiteBucket", "OutputValue": "example-karaoke-website"},
                    {"OutputKey": "WebsiteUrl", "OutputValue": "https://example123.cloudfront.net"},
                    {"OutputKey": "DistributionId", "OutputValue": "EEXAMPLEDIST"}]}
    resources = {}

    def add(logical, kind, physical):
        resources[logical] = {"LogicalResourceId": logical, "ResourceType": "AWS::" + kind,
            "PhysicalResourceId": physical, "ResourceStatus": "CREATE_COMPLETE"}

    for logical in ("ApiFunction", "WorkerFunction", "AvailabilityFunction"):
        add(logical, "Lambda::Function", name + "-" + logical + "-example")
    for logical in ("ApiFunctionRole", "WorkerFunctionRole", "AvailabilityRole"):
        add(logical, "IAM::Role", name + "-" + logical + "-example")
    add("WebsiteBucket", "S3::Bucket", "example-karaoke-website")
    add("Website", "CloudFront::Distribution", "EEXAMPLEDIST")
    add("JobsTable", "DynamoDB::Table", name + "-JobsTable-example")
    add("AppConfig", "SecretsManager::Secret", f"arn:aws:secretsmanager:{region}:{account}:secret:example-config-abcdef")
    for logical, kind in (("OriginAccess", "OriginAccessControl"), ("AssetCachePolicy", "CachePolicy"),
        ("ApiCachePolicy", "CachePolicy"), ("ApiOriginRequestPolicy", "OriginRequestPolicy"), ("SecurityHeaders", "ResponseHeadersPolicy")):
        add(logical, "CloudFront::" + kind, "11111111-1111-1111-1111-111111111111")
    for logical in ("JobsQueue", "DeadLetterQueue"):
        add(logical, "SQS::Queue", f"https://sqs.{region}.amazonaws.com/{account}/{name}-{logical}-example")
    for logical in ("ApiLogs", "WorkerLogs", "AvailabilityLogs", "ApiAccessLogs"):
        add(logical, "Logs::LogGroup", "/karaokekonverter/" + name + "/" + logical)
    for logical in ("DeadLetterAlarm", "WorkerErrorsAlarm", "ApiErrorsAlarm", "ApiServerErrorsAlarm",
        "LambdaThrottlesAlarm", "QueueAgeAlarm", "DatabaseThrottlesAlarm", "OperationalFailuresAlarm",
        "AvailabilityAlarm", "MonitoringTestAlarm"):
        add(logical, "CloudWatch::Alarm", name + "-" + logical + "-example")
    add("MonitoringDashboard", "CloudWatch::Dashboard", name + "-operations")
    add("AvailabilitySchedule", "Events::Rule", name + "-AvailabilitySchedule-example")
    add("WorkerFunctionQueue", "Lambda::EventSourceMapping", "22222222-2222-2222-2222-222222222222")
    add("AlertTopic", "SNS::Topic", f"arn:aws:sns:{region}:{account}:{name}-AlertTopic-example")
    add("HttpApi", "ApiGatewayV2::Api", "exampleapi")
    template = {"AWSTemplateFormatVersion": "2010-09-09", "Resources": {
        logical: {"Type": "AWS::Lambda::Function", "Properties": {"Code": {
            "S3Bucket": "example-legacy-artifacts", "S3Key": "application/" + logical + ".zip"}}}
        for logical in ("ApiFunction", "WorkerFunction", "AvailabilityFunction")}}
    return config, account, stack, resources, template


def health():
    return {"service": "karaokekonverter", "version": "0.3.0", "configured": True,
        "maxTracks": 20, "sources": ["soundcloud", "spotify"],
        "sourceReady": {"soundcloud": True, "spotify": True}, "authentication": "access-code",
        "output": "temporary-playback-link"}


class FakeAws:
    region = "us-east-2"

    def __init__(self, responses=()):
        self.responses = iter(responses)
        self.calls = []
        self.blobs = {}

    def call(self, service, operation, payload=None, extra=()):
        self.calls.append((service, operation, payload, extra))
        result = next(self.responses)
        if isinstance(result, Exception):
            raise result
        return result

    def put_blob(self, bucket, key, data, content_type="application/json", create_only=False):
        if create_only and (bucket, key) in self.blobs:
            raise RuntimeError("Object already exists")
        self.blobs[bucket, key] = data

    def get_blob(self, bucket, key):
        return self.blobs[bucket, key]
