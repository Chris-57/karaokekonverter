"""Guard the SAM transform permission needed by the CloudFormation service role."""
import unittest

from scripts.bootstrap_delivery import generate
from tests.delivery_fixtures import fixture


class SamTransformPermissionsTests(unittest.TestCase):
    def test_service_role_can_process_only_the_region_specific_aws_sam_transform(self):
        generated = generate(*fixture())
        statements = [
            statement
            for resource in generated["Resources"].values()
            if resource["Type"] == "AWS::IAM::ManagedPolicy"
            and {"Ref": "CloudFormationRole"} in resource["Properties"].get("Roles", [])
            for statement in resource["Properties"]["PolicyDocument"]["Statement"]
            if any(action.startswith("cloudformation:") or action == "*"
                   for action in statement["Action"])
        ]
        # CloudFormation must invoke the AWS-owned SAM transform. This grant
        # must not become authority to create/execute arbitrary stack changes,
        # invoke other transforms or target a customer account's transform.
        self.assertEqual(statements, [{
            "Effect": "Allow",
            "Action": ["cloudformation:CreateChangeSet"],
            "Resource": "arn:aws:cloudformation:us-east-2:aws:transform/Serverless-2016-10-31",
        }])


if __name__ == "__main__":
    unittest.main()
