# CloudFormation SAM transform permission correction

Prepared on 2026-09-08 after my [Deploy AWS run 34256306001](https://github.com/Chris-57/karaokekonverter/actions/runs/34256306001).

## Observed progress and failure

The run passed pre-deployment checks, obtained temporary AWS credentials, packaged the Lambda archives and saved the verified baseline `snapshot-34256306001-1`. It prepared `run-34256306001-1` but failed during change-set preparation. The denied principal was the `karaokekonverter-dev-cloudformation` service role, the action was `cloudformation:CreateChangeSet`, and the resource was the AWS-owned SAM transform in `us-east-2`.

CloudFormation uses the supplied service role's credentials. It expands a SAM template while preparing a change set. [AWS service-role documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html), [AWS SAM transform documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/transform-aws-serverless.html).

The helper did not execute that failed change set or publish website assets. The prepared new release is not a verified restore target. No restoration is indicated by this error.

## Correction

`scripts/bootstrap_delivery.py` now adds this statement to the policies attached to the existing CloudFormation service role:

```json
{
  "Effect": "Allow",
  "Action": ["cloudformation:CreateChangeSet"],
  "Resource": "arn:aws:cloudformation:us-east-2:aws:transform/Serverless-2016-10-31"
}
```

The `aws` account field in that ARN is literal: the transform is owned by AWS. This statement does not authorize an application stack update by itself. The existing GitHub role, current-main checks and change-set restrictions continue to control the update. The generated template comparison using identical synthetic discovery inputs showed exactly this one statement added to `ExecutionPolicy2`.

Pushing the generator change does not update the IAM policy already deployed in AWS. The administrator must reapply the existing delivery bootstrap once. That updates the separate `karaokekonverter-dev-delivery` stack.

## Apply in this order

1. In the repository, open **Settings → Secrets and variables → Actions → Variables**. Set `AWS_DEPLOY_ENABLED` to `false` while updating the bootstrap policy. A skipped Deploy AWS run during this pause is expected.
2. Open the extracted fix ZIP. Merge its `scripts`, `tests` and `docs` folders into the existing repository root containing `package.json`. Replace matching files and keep other existing files. The changed production file must be at `scripts/bootstrap_delivery.py`.
3. In the VS Code PowerShell terminal at the repository root, run:

   ```powershell
   git add -A
   npm.cmd run check:public
   ```

   After it passes, commit and push to main with a message such as `Allow the SAM transform in the CloudFormation delivery role`. Wait for that commit's CI run to pass.
4. Open AWS CloudShell as the project administrator. Update the checkout created for delivery setup, then run its corrected bootstrap:

   ```bash
   cd "$HOME/karaoke-delivery-setup" &&
   git pull --ff-only origin main &&
   python3 -m scripts.bootstrap_delivery --expected-account YOUR_12_DIGIT_ACCOUNT_ID --apply
   ```

   Replace `YOUR_12_DIGIT_ACCOUNT_ID` with the account used for the original bootstrap. The `&&` operators stop the sequence if changing directory or pulling fails. This checkout was previously cloned from `Chris-57/karaokekonverter` on main. Do not continue using an outdated checkout if the pull fails.
5. Wait for `Successfully created/updated stack - karaokekonverter-dev-delivery`. The existing account and deployment role variables remain valid.
6. Set `AWS_DEPLOY_ENABLED` back to `true`. Open **Actions → Deploy AWS → Run workflow**, select **main**, choose **action = deploy**, and leave **release_id** empty. Start a new run for the corrected source.
7. A completed deployment must report **Verified release**. Then check one known working Spotify playlist and one SoundCloud playlist and retain the successful run URL. A prepared release or a saved baseline alone does not establish deployment success.

## Validation and limits

- The new permission regression fails against the original generator and passes after the correction. It requires the permission on the CloudFormation service role, the exact regional AWS-owned SAM transform ARN and only the required CloudFormation action.
- Forty local Python tests passed, including the existing IAM quotas, trust, change-set guards and S3 transport regressions. The two real CLI tests remain skipped in this workspace because AWS CLI v2 is unavailable; GitHub requires them.
- The updated generated bootstrap passes SAM/cfn-lint validation with synthetic account and resource metadata. Its changed managed policy is 3,836 compact JSON bytes for that fixture, within the existing size gate.
- Source preparation does not exercise live AWS IAM authorization. I subsequently applied the bootstrap update; run 34258887801 reached the change-set guard beyond the previous SAM authorization error. See [current acceptance](deployment-acceptance.md). The earlier S3 fix and application source do not change in this correction.
