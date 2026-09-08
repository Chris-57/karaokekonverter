"""Build application releases from the infrastructure already deployed in AWS."""
import copy
import json
import re

from scripts.delivery_common import DeliveryError, ROOT, digest

FUNCTIONS = {"ApiFunction", "WorkerFunction", "AvailabilityFunction"}


def check_source_contract(root=ROOT):
    """Do not silently ignore infrastructure edits in a code-and-website release."""
    contract = json.loads((root / "infra/application-release.json").read_text(encoding="utf-8"))
    if (contract.get("schema") != 1 or contract.get("scope") != "lambda-code-and-website"
            or contract.get("template") != "infra/template.yaml"
            or not re.fullmatch(r"[0-9a-f]{64}", contract.get("templateSha256", ""))):
        raise DeliveryError("Invalid application release contract.")
    # Universal newlines make the check consistent on Windows and Linux.
    actual = digest((root / contract["template"]).read_text(encoding="utf-8").encode("utf-8"))
    if actual != contract["templateSha256"]:
        raise DeliveryError("Infrastructure source changed. Apply and verify the operator infrastructure "
                            "update before refreshing infra/application-release.json.")
    return contract


def function_packages(template):
    packages = {}
    for logical, resource in template.get("Resources", {}).items():
        kind = resource.get("Type")
        if kind not in {"AWS::Lambda::Function", "AWS::Serverless::Function"}:
            continue
        props = resource.get("Properties", {})
        defaults = template.get("Globals", {}).get("Function", {}) if kind == "AWS::Serverless::Function" else {}
        if kind == "AWS::Serverless::Function":
            code = props.get("CodeUri", {})
            if not isinstance(code, dict):
                raise DeliveryError(f"{logical}: a versioned package is required.")
            code = {"S3Bucket": code.get("Bucket"), "S3Key": code.get("Key"),
                    "S3ObjectVersion": code.get("Version")}
        else:
            code = props.get("Code", {})
        if (not isinstance(code, dict)
                or any(not isinstance(code.get(key), str) or not code[key] or code[key] == "null"
                       for key in ("S3Bucket", "S3Key", "S3ObjectVersion"))):
            raise DeliveryError(f"{logical}: a versioned S3 package is required.")
        packages[logical] = {
            "code": {key: code[key] for key in ("S3Bucket", "S3Key", "S3ObjectVersion")},
            "Handler": props.get("Handler", defaults.get("Handler")),
            "Runtime": props.get("Runtime", defaults.get("Runtime")),
            "Architectures": props.get("Architectures", defaults.get("Architectures", ["x86_64"])),
        }
    if set(packages) != FUNCTIONS:
        raise DeliveryError("Application releases require exactly the API, worker and availability packages.")
    return packages


def build_application_template(current, packaged):
    """Retain every deployed resource property except the three Lambda Code values."""
    result = copy.deepcopy(current)
    # A processed SAM template normally omits Transform. Accommodate its SAM
    # declaration if retained, but never run a different macro during a release.
    transform = result.pop("Transform", None)
    if transform not in (None, "AWS::Serverless-2016-10-31", ["AWS::Serverless-2016-10-31"]):
        raise DeliveryError("Unsupported transform in the deployed template.")
    if "Globals" in result or any(resource.get("Type", "").startswith("AWS::Serverless::")
                                  for resource in result.get("Resources", {}).values()):
        raise DeliveryError("Application releases require the processed CloudFormation template.")
    live_functions = {name for name, resource in result.get("Resources", {}).items()
                      if resource.get("Type") == "AWS::Lambda::Function"}
    if live_functions != FUNCTIONS:
        raise DeliveryError("The deployed functions do not match the application release contract.")
    for name, package in function_packages(packaged).items():
        props = result["Resources"][name].get("Properties", {})
        if props.get("PackageType", "Zip") != "Zip":
            raise DeliveryError(f"{name}: only ZIP-based functions are supported.")
        for field in ("Handler", "Runtime", "Architectures"):
            live_value = props.get(field, ["x86_64"] if field == "Architectures" else None)
            if live_value is None or package[field] is None or live_value != package[field]:
                raise DeliveryError(f"{name}: {field} differs from deployed infrastructure; an operator update is required.")
        props["Code"] = package["code"]
    return result
