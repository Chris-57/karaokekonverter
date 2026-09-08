# AWS account preparation

For the existing demonstration, account setup is complete: I use a non-root deployment identity, retired the old root access key, configured MFA and a monthly budget, and deployed the stack in Ohio. This repository does not contain account credentials. New operators should adapt these steps to their own account.

## Access and region

Use your authorized role/session or IAM console identity and select **us-east-2 (Ohio)**. CloudShell uses that signed-in session. Verify identity with `aws sts get-caller-identity --query Arn --output text --no-cli-pager`; do not use root for routine deployment. No additional long-lived access key is required for the demonstrated CloudShell path.

Deployment permissions differ from Lambda runtime roles. The deployer needs to manage this stack's CloudFormation resources and pass the intended execution roles; the functions receive resource-scoped runtime permissions from the template. GitHub deployment trust will be configured separately through OIDC after repository publication. [AWS IAM guidance](https://docs.aws.amazon.com/IAM/latest/UserGuide/getting-started-account-iam.html).

## Budget and operating limits

I have configured an account-wide monthly $5 budget with $1 actual, $5 actual and $5 forecast alerts. This is a notification setup, not a cost prediction or spending cap. The monitoring footprint can exceed that amount before free allowances; review [monitoring costs](monitoring.md#costs-and-retention) and the current bill. Existing resources can also incur charges. Do not create a duplicate budget for the existing demo.

The account's observed Lambda concurrency limit was ten. The template has no function reserved concurrency and caps this queue's event-source concurrency at two. Other functions still share the account pool. Recheck quotas before changing this design. Both sources are enabled, with the agreed 20-track application cap.

## CloudShell build environment

CloudShell home storage is limited. Preserve source/commits in Git and build browser dependencies/artifacts in a temporary directory. A previous build exhausted the home directory; deleting CloudWatch logs would not free that space.

Select Node.js 24 when preparing a CloudShell environment:

```bash
sudo dnf install -y nodejs24 nodejs24-npm
sudo alternatives --set node /usr/bin/node-24
hash -r
node --version
```

CloudShell system packages and files outside the home directory can be recycled. The [CloudShell build guide](cloudshell-build.md) uses the committed repository and a fresh `/tmp` workspace. Publishing this repository does not require another AWS deployment.

References: [CloudShell storage](https://docs.aws.amazon.com/cloudshell/latest/userguide/limits.html), [Node.js on Amazon Linux 2023](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html), [Lambda reserved concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html), [SQS scaling](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html).
