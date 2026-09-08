# Apply the application release correction

I use the deployed 0.3.0 application as the working baseline while completing deployment automation. The [latest failed run](https://github.com/Chris-57/karaokekonverter/actions/runs/34258887801) verified its website files and Spotify/SoundCloud configuration, then stopped before executing an application change. A failed preparation step does not require rebuilding the working stack.

## Use the existing application

Open [KaraokeKonverter](https://d2j5ofy3dzbrbx.cloudfront.net), enter the existing private access code and submit a small known working playlist. Repeat with the other source. Those conversions test actual source extraction and YouTube search; the automated baseline check tests website/configuration readiness.

For a read-only configuration check from CloudShell:

```bash
curl -fsS https://d2j5ofy3dzbrbx.cloudfront.net/api/health
```

Expect version `0.3.0`, `configured: true`, both `soundcloud` and `spotify` in `sources`, both entries in `sourceReady` true, and `maxTracks: 20`. This command works from a new shell and does not require the old installation directory.

## Install the correction

1. Set the repository Actions variable **AWS_DEPLOY_ENABLED** to **false** while applying the files. This pauses new deployment jobs; an already executing CloudFormation update must finish.
2. Extract `karaokekonverter-application-release-fix.zip` outside the Git checkout. Copy its **contents** into the existing repository folder containing `package.json`. Merge its `scripts`, `tests`, `infra` and `docs` folders and replace the included files. Do not commit an extra archive or wrapper folder. For example, the new module belongs at `scripts/application_release.py`.
3. In that repository's VS Code PowerShell terminal, run:

```powershell
git status --short
git add -- scripts tests infra docs README.md CHANGELOG.md
npm.cmd run check:public
```

4. If the check passes, review the staged changes in VS Code or GitHub Desktop, commit them as `Preserve deployed infrastructure during application releases`, then push. Python tests and template/build checks run in GitHub CI; local AWS tooling is not needed to apply this update.
5. Wait for the new commit's **CI → Validate and build** job to turn green. A skipped **Deploy AWS** while the variable is false is expected.
6. Set **AWS_DEPLOY_ENABLED** to **true**. Open **Actions → Deploy AWS → Run workflow**, select **main**, choose **deploy**, and leave **release_id** empty. Start a new workflow on this commit; rerunning an older failed run uses its older checkout.
7. A successful run ends with **Verified release** and a website link. Open the app and test one Spotify playlist and one SoundCloud playlist. Record the run URL and results in [deployment acceptance](evidence/deployment-acceptance.md).

This correction uses the existing delivery roles and bucket. It does not require another bootstrap operation or an administrator permission grant. The runtime source, dependency locks, secret configuration and SAM infrastructure source remain at the working 0.3.0 baseline.

## What changed

The deployment script now reads the deployed **Processed** CloudFormation template, replaces only the API, worker and availability Lambda code locations, and keeps the deployed resources and stack tags. It still rejects IAM, secret, resource replacement and other infrastructure changes. A checked source hash prevents future edits to `infra/template.yaml` from being silently ignored by an application release.

Local validation passed 52 Python tests, including both deploy and restore orchestration with controlled AWS responses. The full 56-resource SAM-expanded template was checked for preservation of every field except the three Lambda `Code` values, and its release variant passed lint. The two real AWS CLI download cases require the GitHub runner; they were not executed locally because AWS CLI v2 was unavailable. These results do not substitute for the first successful live deployment of this correction.

If another run fails, read its first error and stage in the summary. Before execution, continue using the existing app if it passes the live smoke tests. After execution starts, inspect CloudFormation before retrying. Use [recovery](deployment-recovery.md) if the deployed application actually needs restoration.
