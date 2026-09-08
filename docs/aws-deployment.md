# AWS deployment

The working demo is stack **karaokekonverter-dev** in **us-east-2**, with both sources and monitoring enabled. The owner reports successful conversions, completed monitoring deployment and both controlled notification emails. Follow [deployment automation](deployment-automation.md) for the new GitHub OIDC workflow. This page retains manual/operator deployment instructions.

After the first automated update, the stack retains its scoped CloudFormation service role. Pause automatic deployments and review that role's permissions before a manual infrastructure change; administrator access in your shell alone does not expand the role CloudFormation uses. See [recovery and infrastructure changes](deployment-recovery.md).

## Existing-stack updates

1. Review and commit the intended change. Keep a known-good commit/release for recovery.
2. Follow [the CloudShell build procedure](cloudshell-build.md), which uses Node.js 24 and temporary build storage. It runs checks before `sam deploy` updates the same stack.
3. Wait for CloudFormation completion. Existing Secrets Manager values, data and the confirmed SNS subscription are reused. Do not replace them as routine deployment steps.
4. If frontend files changed, publish `dist/` using the stack outputs below.
5. Verify the website, its health response and a small live conversion when provider code/runtime changed. [AWS acceptance](aws-acceptance.md) covers detailed behavior.

## Publish website changes

Run from the root of the same verified source revision used for deployment. Resolve the destination from stack outputs:

```bash
karaokeWebsiteBucket=$(aws cloudformation describe-stacks --stack-name karaokekonverter-dev --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='WebsiteBucket'].OutputValue | [0]" --output text --no-cli-pager)
karaokeDistributionId=$(aws cloudformation describe-stacks --stack-name karaokekonverter-dev --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue | [0]" --output text --no-cli-pager)
```

Check that both values are populated before uploading. Then publish and invalidate the changed frontend assets:

```bash
aws s3 sync dist/ "s3://$karaokeWebsiteBucket/" --region us-east-2
aws cloudfront create-invalidation --distribution-id "$karaokeDistributionId" --paths "/index.html" "/app.js" "/styles.css" "/"
```

The S3 bucket remains private; CloudFront serves the frontend and forwards `/api/*` requests to API Gateway. No website upload is needed for this repository-preparation-only change.

## Verify the release

Resolve the website output and check the public configuration endpoint:

```bash
karaokeWebsiteUrl=$(aws cloudformation describe-stacks --stack-name karaokekonverter-dev --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='WebsiteUrl'].OutputValue | [0]" --output text --no-cli-pager)
curl --fail --silent --show-error "$karaokeWebsiteUrl/api/health"
```

For the working baseline expect version `0.3.0`, `configured: true`, both `soundcloud` and `spotify` in `sources`, both readiness values true, `maxTracks: 20`, `authentication: access-code` and `output: temporary-playback-link`. This checks configuration, not live provider reachability or key validity.

Run `python3 scripts/monitoring.py status` for dashboard/alarm configuration. The [monitoring runbook](monitoring.md) describes filter verification, a real availability probe and the controlled notification test. Do not repeat email tests on every source-only commit.

## First installation in another account

Prepare authorized deployment access, budget alerts, Node.js 24 and appropriate quotas using [account preparation](aws-account-preparation.md). Review the template before creating billable resources. Deploy a new stack with SAM, then use its `ConfigurationSecretArn` output to configure **YOUTUBE_API_KEY** while retaining the generated **APP_ACCESS_CODE** and browser source mode. Keep secret values in the AWS console/Secrets Manager.

Publish the website to that stack's output bucket and confirm the owner's email subscription to its SNS topic. Complete acceptance for both sources from the new AWS environment. Provider access from one computer or account does not establish access from another.

## Recovery

CloudFormation rolls back many failed infrastructure updates unless rollback is disabled; an application's runtime failure after a successful update requires investigation and a deliberate recovery action. Build and deploy the verified prior commit, publish its matching website assets if needed, then verify health and live behavior. Automated rollback and release aliases are not implemented in this baseline.

Historical update guides for [0.2.3](aws-update-v0.2.3.md), [0.2.4](aws-update-v0.2.4.md) and [0.3.0](aws-update-v0.3.0.md) describe those changes. Restoring a pre-monitoring template can remove monitoring resources; it is not a code-only rollback. Retained tables/buckets and SAM artifacts also need separate review during deliberate retirement. See [operations](runbook.md).

References: [SAM deployment](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html), [S3 sync](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html), [CloudFront invalidation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html).
