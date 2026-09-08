# Update the existing AWS stack to 0.2.4

Historical release procedure. For current repository builds, use [AWS deployment](aws-deployment.md) and [temporary CloudShell builds](cloudshell-build.md).

Version 0.2.4 enables Spotify alongside SoundCloud in the AWS API and worker. It uses the existing access code, YouTube key, browser package, queue, table and website. Spotify reads public rendered metadata; there is no visitor Spotify login or Spotify developer credential to configure. The converter limit remains 20 songs.

The owner has reported a successful SoundCloud conversion after the 0.2.3 correction. This release has controlled integration and build checks; its first live AWS Spotify conversion is still an acceptance step. See [the cloud test checklist](aws-acceptance.md).

## 1. Upload and open this release

Sign in as the existing deployment user, open CloudShell in Ohio (`us-east-2`), and use **Actions → Upload file** to upload `karaokekonverter-clean-v0.2.4.zip`.

Copy only the commands, without terminal prompts such as `~ $` or `>`:

```bash
unzip -q "$HOME/karaokekonverter-clean-v0.2.4.zip" -d "$HOME/karaoke-aws-v0.2.4"
cd "$HOME/karaoke-aws-v0.2.4/karaokekonverter-clean"
node --version
npm pkg get name version
```

The package must be `karaokekonverter-clean` version `0.2.4`. If extraction or `cd` fails, fix that error before building. The ZIP contains an inner `karaokekonverter-clean` directory.

If this CloudShell session does not report Node `v24.x`, restore the build tools:

```bash
sudo dnf install -y nodejs24 nodejs24-npm
sudo alternatives --set node /usr/bin/node-24
hash -r
node --version
```

## 2. Build and update the same stack

Run from that inner project directory:

```bash
if sam build --template-file infra/template.yaml
then
  sam deploy --template-file .aws-sam/build/template.yaml --stack-name karaokekonverter-dev --region us-east-2 --resolve-s3 --capabilities CAPABILITY_IAM --confirm-changeset
fi
```

Review the change set for the existing `karaokekonverter-dev` stack and enter `y` to apply the code update. The template's resource definitions match 0.2.3; only its descriptive text changes. No resource replacement is expected. Existing secret values are preserved. The frontend files also match 0.2.3; their source switch reads the updated health response, so no S3 upload or CloudFront invalidation is needed for this update.

Wait for `UPDATE_COMPLETE`. If CloudShell disconnects after submitting the update, inspect the same stack from a fresh session:

```bash
aws cloudformation describe-stacks --stack-name karaokekonverter-dev --region us-east-2 --query 'Stacks[0].{Status:StackStatus,Reason:StackStatusReason}' --output json --no-cli-pager
```

`UPDATE_IN_PROGRESS` means the operation is still running. Inspect Events if a failure/rollback status appears; do not treat that as successful deployment. CloudFormation continues independently of the terminal session after submission.

## 3. Verify version and open the website

Find the existing website address from the stack outputs:

```bash
karaokeWebsiteUrl=$(aws cloudformation describe-stacks --stack-name karaokekonverter-dev --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='WebsiteUrl'].OutputValue | [0]" --output text --no-cli-pager)
curl --fail --silent --show-error "$karaokeWebsiteUrl/api/health"
```

For the already configured browser-mode installation, the expected fields are:

```json
{
  "service": "karaokekonverter",
  "version": "0.2.4",
  "configured": true,
  "maxTracks": 20,
  "sources": ["soundcloud", "spotify"],
  "sourceReady": { "soundcloud": true, "spotify": true },
  "authentication": "access-code",
  "output": "temporary-playback-link"
}
```

Health reports installed source support and configuration presence. It does not make live Google or Spotify requests. Open your existing CloudFront website, hard-refresh with **Ctrl+F5**, choose **Spotify**, and use your existing application access code. Submit a new conversion; an old failed job is not automatically retried by a code update.

Start with the previously tested six-song public Spotify playlist:

https://open.spotify.com/playlist/30NcvL51dhP4HKscAuzKY7

Then follow [aws-acceptance.md](aws-acceptance.md) for source order, limit, error, sharing and queue checks.

## 4. If a live conversion fails

Record the approximate time, source, displayed message and job ID if available. Retrieve the recent worker log entries:

```bash
karaokeWorkerLog=$(aws cloudformation describe-stacks --stack-name karaokekonverter-dev --region us-east-2 --query "Stacks[0].Outputs[?OutputKey=='WorkerLogGroup'].OutputValue | [0]" --output text --no-cli-pager)
aws logs tail "$karaokeWorkerLog" --since 30m --format short --region us-east-2 --no-cli-pager
```

Spotify logs `source_playlist_read` with the displayed/collected counts on a successful read. Failures log `source_browser_failed` with the stage (`launch`, `prepare`, `navigate`, `extract`), an allowlisted error type, counts and elapsed time. `conversion_failed` records the job ID and application error code. These diagnostic entries omit raw errors, page contents, playlist URLs and credentials.

`SOURCE_INCOMPLETE`, `SOURCE_BLOCKED` and `SOURCE_LOGIN_REQUIRED` are explicit failed reads, not successful conversions. A public playlist's local accessibility does not guarantee access from AWS. The reader uses normal browser navigation and stops when access requires verification or login.

## Roll back code if necessary

Keep the 0.2.3 ZIP as the previous owner-tested SoundCloud release. To return to that behavior, open its extracted project, build its template, and deploy to the same stack using the command above. Wait for `UPDATE_COMPLETE` and check health version `0.2.3`. Both Lambda code packages must be updated together. The current static frontend supports either health response. No stack deletion or editing stored job states is needed.

References: [AWS SAM deploy](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html), [CloudWatch log retrieval](https://docs.aws.amazon.com/cli/latest/reference/logs/tail.html).
