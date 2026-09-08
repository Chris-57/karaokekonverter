import copy
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from scripts import bootstrap_delivery as bootstrap
from scripts import delivery_common as common
from scripts import delivery_event as event
from scripts import deploy_aws as deploy
from tests.delivery_fixtures import FakeAws, fixture, health


class TrustAndPermissionsTests(unittest.TestCase):
    def setUp(self):
        self.config, self.account, self.stack, self.resources, self.template = fixture()
        self.generated = bootstrap.generate(*fixture())

    def test_exact_immutable_repository_and_branch_subject(self):
        role = self.generated["Resources"]["GitHubDeployRole"]["Properties"]
        statement = role["AssumeRolePolicyDocument"]["Statement"][0]
        self.assertEqual(statement["Action"], "sts:AssumeRoleWithWebIdentity")
        self.assertEqual(statement["Condition"], {"StringEquals": {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub":
                "repo:Chris-57@124647261/karaokekonverter@1361537293:ref:refs/heads/main"}})

    def test_no_iam_mutation_or_secret_value_access_in_delivery_policies(self):
        policies = [self.generated["Resources"]["GitHubDeployRole"]["Properties"]["Policies"][0]["PolicyDocument"]]
        policies += [r["Properties"]["PolicyDocument"] for r in self.generated["Resources"].values()
                     if r["Type"] == "AWS::IAM::ManagedPolicy"]
        for policy in policies:
            for statement in policy["Statement"]:
                for action in statement["Action"]:
                    self.assertNotEqual(action, "secretsmanager:GetSecretValue")
                    self.assertNotEqual(action, "secretsmanager:PutSecretValue")
                    if action.startswith("iam:"):
                        self.assertIn(action, {"iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies",
                            "iam:ListAttachedRolePolicies", "iam:PassRole"})
                    self.assertNotIn(action, {"lambda:CreateFunction", "dynamodb:DeleteTable", "sqs:PurgeQueue", "sns:Publish"})

    def test_changeset_is_existing_stack_scoped_and_requires_execution_role(self):
        statements = self.generated["Resources"]["GitHubDeployRole"]["Properties"]["Policies"][0]["PolicyDocument"]["Statement"]
        create = next(s for s in statements if "cloudformation:CreateChangeSet" in s["Action"])
        self.assertEqual(create["Resource"], self.stack["StackId"])
        self.assertEqual(create["Condition"]["StringEquals"]["cloudformation:RoleArn"],
                         "arn:aws:iam::000000000000:role/karaokekonverter-dev-cloudformation")
        execute = next(s for s in statements if "cloudformation:ExecuteChangeSet" in s["Action"])
        self.assertEqual(execute["Resource"], self.stack["StackId"])

    def test_artifact_bucket_is_private_versioned_and_retained(self):
        bucket = self.generated["Resources"]["ArtifactBucket"]
        self.assertEqual(bucket["DeletionPolicy"], "Retain")
        self.assertEqual(bucket["UpdateReplacePolicy"], "Retain")
        self.assertEqual(bucket["Properties"]["VersioningConfiguration"]["Status"], "Enabled")
        self.assertTrue(all(bucket["Properties"]["PublicAccessBlockConfiguration"].values()))
        rule = bucket["Properties"]["LifecycleConfiguration"]["Rules"][0]
        self.assertNotIn("ExpirationInDays", rule)

    def test_reuse_provider_does_not_create_a_duplicate(self):
        provider = "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com"
        generated = bootstrap.generate(*fixture(), provider=provider)
        self.assertNotIn("GitHubProvider", generated["Resources"])
        self.assertEqual(generated["Resources"]["GitHubDeployRole"]["Properties"]["AssumeRolePolicyDocument"]["Statement"][0]["Principal"]["Federated"], provider)

    def test_generator_rejects_wrong_account_or_missing_resource(self):
        with self.assertRaises(common.DeliveryError):
            bootstrap.generate(self.config, "111111111111", self.stack, self.resources, self.template)
        self.resources.pop("WorkerFunction")
        with self.assertRaises(common.DeliveryError):
            bootstrap.generate(self.config, self.account, self.stack, self.resources, self.template)

    def test_policies_fit_iam_quotas(self):
        for resource in self.generated["Resources"].values():
            if resource["Type"] == "AWS::IAM::ManagedPolicy":
                self.assertLess(len(common.encode(resource["Properties"]["PolicyDocument"])), 6144)
        self.assertLess(len(common.encode(self.generated)), 51200)


class EventTests(unittest.TestCase):
    def setUp(self):
        self.config = common.load_config()
        self.sha = "a" * 40
        self.environment = {"GITHUB_REPOSITORY": self.config["repository"],
            "GITHUB_REPOSITORY_ID": self.config["repositoryId"], "GITHUB_REPOSITORY_OWNER_ID": self.config["ownerId"],
            "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": self.sha}
        self.event = {"workflow_run": {"name": "CI", "path": ".github/workflows/ci.yml", "conclusion": "success",
            "event": "push", "head_branch": "main", "head_sha": self.sha,
            "head_repository": {"id": int(self.config["repositoryId"])}}}

    def test_successful_main_ci_is_selected(self):
        self.assertEqual(event.selected_commit("workflow_run", self.event, self.environment, self.config), (self.sha, "deploy", ""))

    def test_pr_failure_other_branch_and_fork_cannot_deploy(self):
        cases = [("event", "pull_request"), ("conclusion", "failure"), ("head_branch", "feature"),
                 ("head_repository", {"id": 1}), ("path", ".github/workflows/other.yml")]
        for key, value in cases:
            with self.subTest(key=key):
                bad = copy.deepcopy(self.event)
                bad["workflow_run"][key] = value
                with self.assertRaises(common.DeliveryError):
                    event.selected_commit("workflow_run", bad, self.environment, self.config)

    def test_wrong_repository_identity_or_ref_rejected(self):
        for key in ("GITHUB_REPOSITORY", "GITHUB_REPOSITORY_ID", "GITHUB_REPOSITORY_OWNER_ID", "GITHUB_REF"):
            with self.subTest(key=key), self.assertRaises(common.DeliveryError):
                event.selected_commit("workflow_run", self.event, {**self.environment, key: "wrong"}, self.config)

    def test_manual_restore_requires_valid_release_id(self):
        self.assertEqual(event.selected_commit("workflow_dispatch", {"inputs": {"action": "restore", "release_id": "run-123-1"}},
            self.environment, self.config), (self.sha, "restore", "run-123-1"))
        for value in ("../secrets", "run-123-1/evil", "$(bad)", "", "run-x-1"):
            with self.subTest(value=value), self.assertRaises(common.DeliveryError):
                event.selected_commit("workflow_dispatch", {"inputs": {"action": "restore", "release_id": value}},
                    self.environment, self.config)

    @patch("scripts.delivery_event.subprocess.run")
    def test_latest_main_is_obtained_without_persisted_credentials(self, run):
        run.return_value.stdout = "b" * 40 + "\trefs/heads/main\n"
        self.assertNotEqual(event.current_main(self.config), self.sha)
        self.assertNotIn("shell", run.call_args.kwargs)
        self.assertIn("https://github.com/Chris-57/karaokekonverter.git", run.call_args.args[0])


class ChangeSetTests(unittest.TestCase):
    def setUp(self):
        _, _, self.stack, self.resources, _ = fixture()
        self.change = {"ResourceChange": {"LogicalResourceId": "ApiFunction", "ResourceType": "AWS::Lambda::Function",
                                        "Action": "Modify", "Replacement": "False"}}

    def test_only_in_place_known_resource_updates_allowed(self):
        common.check_changes([self.change], self.resources)
        for field, value in (("Action", "Add"), ("Action", "Remove"), ("Action", "Import"),
            ("Replacement", "True"), ("Replacement", "Conditional"), ("LogicalResourceId", "OtherFunction")):
            changed = copy.deepcopy(self.change)
            changed["ResourceChange"][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(common.DeliveryError):
                common.check_changes([changed], self.resources)

    def test_iam_secret_and_saved_query_changes_rejected(self):
        for kind in ("AWS::IAM::Role", "AWS::SecretsManager::Secret", "AWS::Logs::QueryDefinition"):
            with self.subTest(kind=kind), self.assertRaises(common.DeliveryError):
                common.check_changes([{"ResourceChange": {"LogicalResourceId": "Sensitive", "ResourceType": kind,
                    "Action": "Modify", "Replacement": "False"}}], {"Sensitive": {"ResourceType": kind}})

    def test_paginated_changes_are_all_guarded(self):
        later = copy.deepcopy(self.change)
        later["ResourceChange"]["Action"] = "Remove"
        aws = FakeAws([{"Changes": [later]}])
        result = deploy.all_changes(aws, "app", "change", {"Changes": [self.change], "NextToken": "next"})
        self.assertEqual(len(result), 2)
        with self.assertRaises(common.DeliveryError):
            common.check_changes(result, self.resources)
        self.assertEqual(aws.calls[0][2]["NextToken"], "next")

    def test_wait_does_not_accept_old_complete_state(self):
        newer = {**self.stack, "LastUpdatedTime": "2026-09-08T01:00:00Z"}
        aws = FakeAws([{"Stacks": [self.stack]}, {"Stacks": [newer]}])
        result = common.wait_stack_update(aws, self.stack["StackName"], self.stack["LastUpdatedTime"], sleep=lambda _: None)
        self.assertEqual(result, newer)
        self.assertEqual(len(aws.calls), 2)

    def test_rollback_is_reported_as_failure(self):
        aws = FakeAws([{"Stacks": [{**self.stack, "StackStatus": "UPDATE_ROLLBACK_IN_PROGRESS"}]}])
        with self.assertRaises(common.DeliveryError):
            common.wait_stack_update(aws, self.stack["StackName"], self.stack["LastUpdatedTime"], sleep=lambda _: None)

    @patch("scripts.deploy_aws.wait_change_set", return_value=None)
    def test_empty_change_set_still_returns_to_website_publication(self, _):
        aws = FakeAws([{}, {"Stacks": [self.stack]}, {}])
        deploy.update_stack(aws, self.stack, self.resources, "role", "bucket", {
            "releaseId": "run-123-1", "template": {"key": "releases/run-123-1/template.json"}}, lambda: True)
        self.assertEqual([call[1] for call in aws.calls], ["create-change-set", "describe-stacks", "delete-change-set"])

    @patch("scripts.deploy_aws.wait_change_set", return_value={"Changes": []})
    def test_main_advancing_stops_before_changeset_execution(self, _):
        aws = FakeAws([{}, {"Stacks": [self.stack]}, {}])
        with self.assertRaises(common.DeliveryError):
            deploy.update_stack(aws, self.stack, self.resources, "role", "bucket", {
                "releaseId": "run-123-1", "template": {"key": "releases/run-123-1/template.json"}}, lambda: False)
        self.assertNotIn("execute-change-set", [call[1] for call in aws.calls])

    @patch("scripts.deploy_aws.wait_change_set")
    def test_disallowed_change_is_deleted_without_execution(self, wait):
        bad = copy.deepcopy(self.change)
        bad["ResourceChange"]["Replacement"] = "Conditional"
        wait.return_value = {"Changes": [bad]}
        aws = FakeAws([{}, {}])
        with self.assertRaises(common.DeliveryError):
            deploy.update_stack(aws, self.stack, self.resources, "role", "bucket", {
                "releaseId": "run-123-1", "template": {"key": "releases/run-123-1/template.json"}}, lambda: True)
        self.assertNotIn("execute-change-set", [call[1] for call in aws.calls])


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.config, self.account, self.stack, _, self.template = fixture()
        self.assets = {name: ("test " + name).encode() for name in common.ASSETS}
        self.aws, self.bucket, self.identifier = FakeAws(), "example-artifacts", "run-123-1"
        for logical, resource in self.template["Resources"].items():
            resource["Properties"]["Code"] = {"S3Bucket": self.bucket,
                "S3Key": f"releases/{self.identifier}/lambda/{logical}.zip", "S3ObjectVersion": "fixture-version"}
        self.manifest = deploy.save_release(self.aws, self.bucket, self.identifier, self.template, self.assets, {
            "stackId": self.stack["StackId"], "account": self.account, "region": self.config["region"],
            "applicationVersion": "0.3.0", "commit": "a" * 40})

    def load(self):
        return deploy.load_release(self.aws, self.bucket, self.identifier, self.stack["StackId"], self.account, self.config["region"])

    def test_verified_release_round_trips(self):
        deploy.mark_verified(self.aws, self.bucket, self.manifest, "deployed")
        self.aws.responses = iter([{"VersionId": "fixture-version"}] * 3)
        _, template, assets = self.load()
        self.assertEqual(template, self.template)
        self.assertEqual(assets, self.assets)

    def test_unverified_release_cannot_restore(self):
        with self.assertRaises(KeyError):
            self.load()

    def test_corrupt_asset_rejected_before_aws_mutations(self):
        deploy.mark_verified(self.aws, self.bucket, self.manifest, "deployed")
        self.aws.blobs[self.bucket, self.manifest["assets"]["app.js"]["key"]] = b"changed"
        with self.assertRaises(common.DeliveryError):
            self.load()
        self.assertEqual(self.aws.calls, [])

    def test_wrong_stack_or_manifest_path_rejected(self):
        deploy.mark_verified(self.aws, self.bucket, self.manifest, "deployed")
        with self.assertRaises(common.DeliveryError):
            deploy.load_release(self.aws, self.bucket, self.identifier, "other", self.account, self.config["region"])
        self.manifest["assets"]["app.js"]["key"] = "outside/evil"
        self.aws.blobs[self.bucket, f"releases/{self.identifier}/manifest.json"] = common.encode(self.manifest)
        self.aws.blobs.pop((self.bucket, f"releases/{self.identifier}/verified.json"))
        deploy.mark_verified(self.aws, self.bucket, self.manifest, "deployed")
        with self.assertRaises(common.DeliveryError):
            self.load()

    def test_snapshot_copies_legacy_archives_and_pins_versions(self):
        aws = FakeAws([{"VersionId": "copied"}, {"VersionId": "copied"}] * 3)
        frozen = deploy.snapshot_code(aws, fixture()[-1], self.bucket, "snapshot-123-1")
        for _, bucket, key, version in common.code_objects(frozen):
            self.assertEqual(bucket, self.bucket)
            self.assertTrue(key.startswith("releases/snapshot-123-1/lambda/"))
            self.assertEqual(version, "copied")
        self.assertEqual([call[1] for call in aws.calls].count("copy-object"), 3)

    def test_restore_rejects_missing_or_unversioned_lambda_archives(self):
        unversioned = copy.deepcopy(self.template)
        unversioned["Resources"]["ApiFunction"]["Properties"]["Code"].pop("S3ObjectVersion")
        with self.assertRaises(common.DeliveryError):
            deploy.validate_saved_archives(FakeAws(), unversioned, self.bucket)
        with self.assertRaises(common.DeliveryError):
            deploy.validate_saved_archives(FakeAws([common.DeliveryError("NoSuchVersion")]), self.template, self.bucket)

    def test_sam_package_archives_are_pinned_and_foreign_bucket_rejected(self):
        template = {"Globals": {"Function": {"CodeUri": "../"}}, "Resources": {
            logical: {"Type": "AWS::Serverless::Function", "Properties": {
                "CodeUri": "s3://example-artifacts/releases/run-123-1/lambda/shared"}}
            for logical in ("ApiFunction", "WorkerFunction", "AvailabilityFunction")}}
        aws = FakeAws([{"VersionId": "version1"}])
        frozen = deploy.freeze_package(aws, template, self.bucket, self.identifier)
        self.assertEqual(len(aws.calls), 1)
        self.assertNotIn("CodeUri", frozen["Globals"]["Function"])
        self.assertEqual(frozen["Resources"]["WorkerFunction"]["Properties"]["CodeUri"]["Version"], "version1")
        with self.assertRaises(common.DeliveryError):
            deploy.freeze_package(FakeAws(), template, "other-bucket", self.identifier)

    @patch("scripts.deploy_aws.invalidate")
    @patch("scripts.deploy_aws.verify_with_retries", side_effect=common.DeliveryError("health failed"))
    def test_failed_website_check_never_marks_a_release_verified(self, verify, invalidate):
        with self.assertRaises(common.DeliveryError):
            deploy.publish_and_verify(self.aws, self.bucket, common.outputs(self.stack), self.manifest, self.assets)
        self.assertNotIn((self.bucket, f"releases/{self.identifier}/verified.json"), self.aws.blobs)


class HealthAndTransportTests(unittest.TestCase):
    def test_health_requires_both_sources_access_code_and_twenty_track_cap(self):
        self.assertTrue(common.health_contract(health(), "0.3.0"))
        for key, value in (("sources", ["soundcloud"]), ("sourceReady", {"soundcloud": True, "spotify": False}),
            ("configured", False), ("maxTracks", 100), ("authentication", "none"), ("sources", [{}]), ("version", "other")):
            with self.subTest(key=key):
                self.assertFalse(common.health_contract({**health(), key: value}, "0.3.0"))

    def test_health_and_all_asset_hashes_must_match(self):
        bodies = {"/api/health": common.encode(health()), "/": b"html", "/app.js": b"js", "/styles.css": b"css"}
        hashes = {"index.html": common.digest(b"html"), "app.js": common.digest(b"js"), "styles.css": common.digest(b"css")}
        base = "https://example123.cloudfront.net"
        common.verify_website(base, "0.3.0", hashes, get=lambda url: bodies[url.removeprefix(base)])
        bodies["/app.js"] = b"old js"
        with self.assertRaises(common.DeliveryError):
            common.verify_website(base, "0.3.0", hashes, get=lambda url: bodies[url.removeprefix(base)])

    @patch("scripts.delivery_common.subprocess.run")
    def test_cli_uses_argument_array_and_never_a_shell(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, '{"ok":true}', '')
        payload = {"Key": "literal $(text) `text`"}
        self.assertEqual(common.Aws("us-east-2").call("s3api", "head-object", payload), {"ok": True})
        self.assertNotIn("shell", run.call_args.kwargs)
        self.assertIn(json.dumps(payload), run.call_args.args[0])

    def test_workflow_pins_actions_and_never_cancels_a_running_deployment(self):
        text = (common.ROOT / ".github/workflows/deploy.yml").read_text()
        import re
        refs = re.findall(r"uses: ([^\s]+)", text)
        self.assertTrue(refs)
        self.assertTrue(all(re.fullmatch(r"[^@]+@[0-9a-f]{40}", ref) for ref in refs))
        self.assertIn("cancel-in-progress: false", text)
        self.assertNotRegex(text, r"(?m)^\s+environment:")
        self.assertNotIn("pull_request_target:", text)
        self.assertNotIn("aws-secret-access-key:", text)


if __name__ == "__main__":
    unittest.main()
