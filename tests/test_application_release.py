"""Application releases must not regenerate or edit deployed infrastructure."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from scripts import application_release as release
from scripts import delivery_common as common
from scripts import deploy_aws as deploy
from tests.delivery_fixtures import FakeAws, fixture


def templates():
    _, _, _, _, live = fixture()
    handlers = {"ApiFunction": "src/aws/api-handler.handler",
                "WorkerFunction": "src/aws/worker-handler.handler", "AvailabilityFunction": "handler.handler"}
    for name, resource in live["Resources"].items():
        resource["Properties"].update(Handler=handlers[name], Runtime="nodejs24.x",
            Architectures=["x86_64"], Role={"Fn::GetAtt": ["ApiFunctionRole", "Arn"]},
            Environment={"Variables": {"CONFIG_SECRET_ARN": {"Ref": "AppConfig"}}},
            Tags=[{"Key": "Project", "Value": "KaraokeKonverter"}])
    live["Resources"].update({
        "ApiFunctionRole": {"Type": "AWS::IAM::Role", "Properties": {"Policies": [{"PolicyName": "existing"}]}},
        "AppConfig": {"Type": "AWS::SecretsManager::Secret", "Properties": {"Name": "existing"}},
        "SavedQuery": {"Type": "AWS::Logs::QueryDefinition", "Properties": {"Name": "existing"}},
        "JobsTable": {"Type": "AWS::DynamoDB::Table", "DeletionPolicy": "Retain", "Properties": {"BillingMode": "PAY_PER_REQUEST"}},
    })
    live.update(Parameters={"Stage": {"Type": "String", "Default": "dev"}},
                Outputs={"ApiRole": {"Value": {"Ref": "ApiFunctionRole"}}},
                Conditions={"Enabled": {"Fn::Equals": [{"Ref": "Stage"}, "dev"]}},
                Metadata={"purpose": "preserve exactly"})
    packaged = {"Transform": "AWS::Serverless-2016-10-31",
        "Globals": {"Function": {"Runtime": "nodejs24.x", "Architectures": ["x86_64"]}}, "Resources": {}}
    for name in handlers:
        packaged["Resources"][name] = {"Type": "AWS::Serverless::Function", "Properties": {
            "Handler": handlers[name], "CodeUri": {"Bucket": "example-artifacts",
            "Key": f"releases/run-123-1/lambda/{name}.zip", "Version": "new-version"}}}
    # A fresh SAM source may express different role policies or other infrastructure.
    # Those values must never enter this application's CloudFormation update.
    packaged["Resources"]["ApiFunctionRole"] = {"Type": "AWS::IAM::Role", "Properties": {"Policies": [{"PolicyName": "different"}]}}
    return live, packaged


class ApplicationTemplateTests(unittest.TestCase):
    def test_only_three_code_values_change_and_inputs_are_untouched(self):
        live, packaged = templates()
        original_live, original_packaged = copy.deepcopy(live), copy.deepcopy(packaged)
        result = release.build_application_template(live, packaged)
        for name in release.FUNCTIONS:
            self.assertEqual(result["Resources"][name]["Properties"]["Code"]["S3ObjectVersion"], "new-version")
            result["Resources"][name]["Properties"]["Code"] = live["Resources"][name]["Properties"]["Code"]
        self.assertEqual(result, original_live)
        self.assertEqual(live, original_live)
        self.assertEqual(packaged, original_packaged)

    def test_restore_uses_saved_code_with_current_roles_and_configuration(self):
        live, packaged = templates()
        saved = release.build_application_template(live, packaged)
        live["Resources"]["ApiFunctionRole"]["Properties"]["Policies"] = [{"PolicyName": "current-operator-policy"}]
        live["Resources"]["ApiFunction"]["Properties"]["MemorySize"] = 512
        restored = release.build_application_template(live, saved)
        self.assertEqual(restored["Resources"]["ApiFunctionRole"], live["Resources"]["ApiFunctionRole"])
        self.assertEqual(restored["Resources"]["ApiFunction"]["Properties"]["MemorySize"], 512)
        self.assertEqual(restored["Resources"]["ApiFunction"]["Properties"]["Code"],
                         saved["Resources"]["ApiFunction"]["Properties"]["Code"])

    def test_runtime_handler_and_architecture_mismatches_stop_preparation(self):
        for field, value in (("Runtime", "nodejs22.x"), ("Handler", "other.handler"), ("Architectures", ["arm64"]),
                             ("PackageType", "Image")):
            live, packaged = templates()
            live["Resources"]["ApiFunction"]["Properties"][field] = value
            with self.subTest(field=field), self.assertRaises(common.DeliveryError):
                release.build_application_template(live, packaged)

    def test_unversioned_missing_or_extra_packages_are_rejected(self):
        for mode in ("unversioned", "missing", "extra"):
            live, packaged = templates()
            if mode == "unversioned":
                del packaged["Resources"]["ApiFunction"]["Properties"]["CodeUri"]["Version"]
            elif mode == "missing":
                del packaged["Resources"]["ApiFunction"]
            else:
                packaged["Resources"]["Unexpected"] = copy.deepcopy(packaged["Resources"]["ApiFunction"])
            with self.subTest(mode=mode), self.assertRaises(common.DeliveryError):
                release.build_application_template(live, packaged)

    def test_unprocessed_and_unexpected_macro_templates_are_rejected(self):
        live, packaged = templates()
        for current in (packaged, {**live, "Transform": "UnexpectedMacro"}, {**live, "Globals": {}}):
            with self.subTest(current=current.get("Transform")), self.assertRaises(common.DeliveryError):
                release.build_application_template(current, packaged)
        retained_sam = {**live, "Transform": "AWS::Serverless-2016-10-31"}
        self.assertNotIn("Transform", release.build_application_template(retained_sam, packaged))

    def test_checked_in_infrastructure_matches_release_contract(self):
        # This runs in CI before AWS credentials are requested.
        release.check_source_contract()

    def test_infrastructure_edits_fail_but_windows_line_endings_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "infra").mkdir()
            source = "Resources:\n  Example: value\n"
            contract = {"schema": 1, "scope": "lambda-code-and-website", "template": "infra/template.yaml",
                        "templateSha256": common.digest(source.encode())}
            (root / "infra/application-release.json").write_text(json.dumps(contract))
            path = root / "infra/template.yaml"
            path.write_bytes(source.replace("\n", "\r\n").encode())
            release.check_source_contract(root)
            path.write_text(source + "Changed: true\n")
            with self.assertRaisesRegex(common.DeliveryError, "Infrastructure source changed"):
                release.check_source_contract(root)


class ApplicationChangeSetTests(unittest.TestCase):
    def setUp(self):
        self.config, self.account, self.stack, self.resources, _ = fixture()
        self.stack.update(Tags=[{"Key": "Project", "Value": "KaraokeKonverter"}],
            Parameters=[{"ParameterKey": "Stage", "ParameterValue": "dev"}],
            Capabilities=["CAPABILITY_NAMED_IAM"], NotificationARNs=["arn:aws:sns:us-east-2:000000000000:example"],
            RollbackConfiguration={"RollbackTriggers": [], "MonitoringTimeInMinutes": 0})
        self.change = {"ResourceChange": {"LogicalResourceId": "ApiFunction", "ResourceType": "AWS::Lambda::Function",
            "Action": "Modify", "Replacement": "False", "Scope": ["Properties"],
            "Details": [{"Target": {"Attribute": "Properties", "Name": "Code", "RequiresRecreation": "Never"}}]}}
        self.manifest = {"releaseId": "run-123-1", "template": {"key": "releases/run-123-1/template.json"}}

    @patch("scripts.deploy_aws.summary")
    @patch("scripts.deploy_aws.wait_stack_update")
    @patch("scripts.deploy_aws.wait_change_set")
    def test_code_update_preserves_stack_tags_options_and_executes_once(self, wait, completion, _):
        wait.return_value = {"Changes": [self.change]}
        aws = FakeAws([{}, {"Stacks": [self.stack]}, {}])
        before = Mock()
        deploy.update_stack(aws, self.stack, self.resources, "role", "bucket", self.manifest, lambda: True, before)
        request = aws.calls[0][2]
        for key in ("Tags", "Capabilities", "NotificationARNs", "RollbackConfiguration"):
            self.assertEqual(request[key], self.stack[key])
        self.assertEqual(request["Parameters"], [{"ParameterKey": "Stage", "UsePreviousValue": True}])
        self.assertEqual([call[1] for call in aws.calls].count("execute-change-set"), 1)
        before.assert_called_once_with()
        completion.assert_called_once()

    @patch("scripts.deploy_aws.wait_change_set")
    def test_role_change_still_fails_without_execution(self, wait):
        change = copy.deepcopy(self.change)
        change["ResourceChange"].update(LogicalResourceId="ApiFunctionRole", ResourceType="AWS::IAM::Role")
        wait.return_value = {"Changes": [change]}
        aws, before = FakeAws([{}, {}]), Mock()
        with self.assertRaisesRegex(common.DeliveryError, "IAM, secret"):
            deploy.update_stack(aws, self.stack, self.resources, "role", "bucket", self.manifest, lambda: True, before)
        self.assertEqual([call[1] for call in aws.calls], ["create-change-set", "delete-change-set"])
        before.assert_not_called()

    def test_non_code_changes_rejected(self):
        common.check_changes([self.change], self.resources, application_only=True)
        for field, value in (("Environment", None), ("Tags", None), ("Handler", None)):
            change = copy.deepcopy(self.change)
            change["ResourceChange"]["Details"][0]["Target"]["Name"] = field
            with self.subTest(field=field), self.assertRaises(common.DeliveryError):
                common.check_changes([change], self.resources, application_only=True)
        change = copy.deepcopy(self.change)
        change["ResourceChange"].update(LogicalResourceId="JobsTable", ResourceType="AWS::DynamoDB::Table")
        with self.assertRaises(common.DeliveryError):
            common.check_changes([change], self.resources, application_only=True)

    @patch("scripts.deploy_aws.summary")
    def test_failure_summary_distinguishes_preparation_execution_and_publication(self, summary):
        for phase, expected in (("preparation", "was not updated"), ("stack-update", "may continue"),
                                ("website-publication", "Website publication started")):
            summary.reset_mock()
            deploy.report_failure(common.DeliveryError("example"), {"phase": phase})
            self.assertIn(expected, summary.call_args.args[0])

    def test_deploy_and_restore_entry_points_submit_preserved_template(self):
        live, packaged = templates()
        assets = {name: name.encode() for name in common.ASSETS}
        role = "arn:aws:iam::000000000000:role/karaokekonverter-dev-cloudformation"
        bootstrap_stack = {"StackName": self.stack["StackName"] + "-delivery", "StackStatus": "UPDATE_COMPLETE",
            "Outputs": [{"OutputKey": "ApplicationStackId", "OutputValue": self.stack["StackId"]},
                        {"OutputKey": "ArtifactBucket", "OutputValue": "example-artifacts"},
                        {"OutputKey": "CloudFormationRoleArn", "OutputValue": role}]}
        for mode in ("deploy", "restore"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "dist").mkdir()
                for name, content in assets.items():
                    (root / "dist" / name).write_bytes(content)
                (root / "package.json").write_text('{"version":"0.3.0"}')
                aws = FakeAws([{"Account": self.account, "Arn":
                    "arn:aws:sts::000000000000:assumed-role/karaokekonverter-dev-github-deploy/test"}]
                    + ([{"VersionId": "new-version"}] * 3 if mode == "deploy" else []) + [{}, {}])
                def package(*args, **kwargs):
                    (root / ".data/delivery/packaged.json").write_text(json.dumps(packaged))
                with patch.dict(os.environ, {"AWS_ACCOUNT_ID": self.account, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"}), \
                     patch.object(deploy, "ROOT", root), patch.object(deploy, "Aws", return_value=aws), \
                     patch.object(deploy, "validate_context", return_value=(self.config, "a" * 40, mode, "snapshot-122-1")), \
                     patch.object(deploy, "current_main", return_value="a" * 40), \
                     patch.object(deploy, "get_stack", side_effect=[self.stack, bootstrap_stack, self.stack, self.stack]), \
                     patch.object(deploy, "inventory", return_value=self.resources), \
                     patch.object(deploy, "processed_template", return_value=live), \
                     patch.object(deploy.subprocess, "run", side_effect=package), \
                     patch.object(deploy, "load_release", return_value=({"applicationVersion": "0.3.0"}, packaged, assets)), \
                     patch.object(deploy, "capture_baseline"), patch.object(deploy, "summary"), \
                     patch.object(deploy, "wait_change_set", return_value={"Changes": [self.change]}), \
                     patch.object(deploy, "wait_stack_update"), patch.object(deploy, "publish_and_verify") as publish:
                    progress = {"phase": "preparation"}
                    deploy.main(progress)
                submitted = json.loads(aws.blobs["example-artifacts", "releases/run-123-1/template.json"])
                for name in release.FUNCTIONS:
                    self.assertEqual(submitted["Resources"][name]["Properties"]["Code"]["S3ObjectVersion"], "new-version")
                    submitted["Resources"][name]["Properties"]["Code"] = live["Resources"][name]["Properties"]["Code"]
                self.assertEqual(submitted, live)
                self.assertEqual([call[1] for call in aws.calls].count("execute-change-set"), 1)
                self.assertEqual(aws.calls[-2][2]["Tags"], self.stack["Tags"])
                publish.assert_called_once()
                self.assertEqual(progress["phase"], "verified")
