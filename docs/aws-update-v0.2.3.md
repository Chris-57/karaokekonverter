# Update the existing AWS deployment to 0.2.3

Historical release procedure. For current repository builds, use [AWS deployment](aws-deployment.md) and [temporary CloudShell builds](cloudshell-build.md).

This corrects a confirmed defect in the Lambda browser startup code. With the pinned Puppeteer 25.1.0 dependency, `defaultArgs()` returns a Promise. Passing that Promise to `launch()` reproduces `TypeError: options.filter is not a function`. The old SoundCloud catch block mislabeled this and other browser failures as a page timeout. Local browsing uses a different launch path.

The update awaits the arguments, separates startup failures from real timeouts, and logs the failed stage, allowlisted error type and elapsed time. It changes no dependencies or CloudFormation resources. It retains the 20-track limit. This remains the SoundCloud-only AWS baseline; enabling and testing Spotify in AWS is the next required feature.

## Upload and extract

Download `karaokekonverter-clean-v0.2.3.zip`. In your deployment user's Ohio CloudShell, choose **Actions → Upload file** and select that ZIP. From the home directory, run:

```bash
unzip -q "$HOME/karaokekonverter-clean-v0.2.3.zip" -d "$HOME/karaoke-aws-v0.2.3"
cd "$HOME/karaoke-aws-v0.2.3/karaokekonverter-clean"
node --version
npm pkg get name version
```

Check that you are inside the extracted project: package name `karaokekonverter-clean`, version `0.2.3`. If extraction fails or that directory is missing, resolve that error before continuing.

## Confirm the build runtime

The host build requires Node.js 24. A new CloudShell environment can revert to its preinstalled Node version. If `node --version` does not begin with `v24.`, use the same setup as the initial deployment:

```bash
sudo dnf install -y nodejs24 nodejs24-npm
sudo alternatives --set node /usr/bin/node-24
hash -r
node --version
```

Continue after Node reports `v24.x`. These are CloudShell build tools; the Lambda runtime is already declared in the template.

## Build and update the existing stack

From the 0.2.3 project folder, run:

```bash
if sam build --template-file infra/template.yaml
then
  sam deploy --template-file .aws-sam/build/template.yaml --stack-name karaokekonverter-dev --region us-east-2 --resolve-s3 --capabilities CAPABILITY_IAM --confirm-changeset
fi
```

This uses the existing stack name. Review the change set and confirm the code update. The source template is unchanged from 0.2.2: this release does not recreate CloudFront, change the bucket/table, or reset the secret. No frontend upload or invalidation is needed because `dist/` is unchanged.

CloudFormation should finish with `UPDATE_COMPLETE`. A CloudShell disconnect stops the terminal monitor but not the submitted stack update. Check from a new session with:

```bash
aws cloudformation describe-stacks --stack-name karaokekonverter-dev --region us-east-2 --query 'Stacks[0].{Status:StackStatus,Reason:StackStatusReason}' --output json --no-cli-pager
```

## Verify on AWS

Open your existing CloudFront website's `/api/health` address. Confirm `version` is `0.2.3`, `configured` is `true`, and `maxTracks` is `20`. The health check confirms configuration presence, not successful Google authentication or playlist reading.

Refresh the application, use the existing generated access code, and submit a new Chris1 conversion. The failed job from the old version remains failed; it is not automatically retried by this update. Record the new outcome, track count and match results. A successful live conversion has not yet been established by the local regression tests.

If it fails, retrieve the worker logs for the most recent attempt:

```bash
karaokeWorkerLog=$(aws cloudformation describe-stacks --stack-name karaokekonverter-dev --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='WorkerLogGroup'].OutputValue | [0]" --output text --no-cli-pager)
aws logs tail "$karaokeWorkerLog" --since 30m --format short --region us-east-2 --no-cli-pager
```

Look for `source_browser_failed`, `conversion_failed`, and Lambda's `REPORT` line. Unexpected browser failures now show a fixed stage (`launch`, `prepare`, `navigate`, `extract`) and error type. Handled provider failures retain their explicit codes, such as `SOURCE_BLOCKED` or `PLAYLIST_UNAVAILABLE`. Diagnostic entries omit raw exception text, page contents, source URLs and credentials.

References: [Puppeteer defaultArgs](https://pptr.dev/api/puppeteer.puppeteernode.defaultargs), [AWS SAM deploy](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html), [CloudWatch log retrieval](https://docs.aws.amazon.com/cli/latest/reference/logs/tail.html).
