# Manual build in CloudShell

This is the manual operating path while GitHub deployment automation is being added. The existing 0.3.0 application is already deployed. Repository publication and CI setup do not require rerunning this procedure.

Use the authorized deployment identity in **us-east-2**. Check `node --version` and select Node.js 24 as described in [account preparation](aws-account-preparation.md). AWS CLI and SAM must be available.

After the public repository exists, clone it into a source directory, or update your existing clean clone through Git. For a first clone:

```bash
git clone https://github.com/Chris-57/karaokekonverter.git
cd karaokekonverter
```

Check `git status --short` and `git log -1 --oneline`. The build below uses the exact **HEAD commit**, so commit intended changes first. It excludes uncommitted settings and keeps dependency/build storage outside the one-GB CloudShell home directory.

```bash
(
set -euo pipefail
node -e 'if (process.versions.node.split(".")[0] !== "24") process.exit(1)'
python3 -c 'import shutil; free=shutil.disk_usage("/tmp").free; print(f"Temporary space: {free/2**30:.1f} GiB"); raise SystemExit("At least 2 GiB of temporary space is needed" if free < 2*2**30 else 0)'
karaokeBuildRoot=$(mktemp -d /tmp/karaoke-build.XXXXXX)
git archive HEAD | tar -xf - -C "$karaokeBuildRoot"
cd "$karaokeBuildRoot"
export npm_config_cache="$karaokeBuildRoot/npm-cache"
npm run check:public
npm ci
npm test
npm run check
python3 -m unittest discover -s tests -p 'test_*.py'
sam validate --lint --template-file infra/template.yaml --region us-east-2
sam build --template-file infra/template.yaml
node scripts/check-build.mjs
sam deploy --template-file .aws-sam/build/template.yaml --stack-name karaokekonverter-dev --region us-east-2 --resolve-s3 --capabilities CAPABILITY_IAM --confirm-changeset
)
```

Review the proposed change set before applying it. The command uses the **existing stack name**. Preserve the working secret, website, queues, table and SNS subscription unless the particular change requires otherwise. Do not launch a second deployment while the first is running.

Temporary files can disappear with the session; the committed source remains in Git. After a deployment is submitted, CloudFormation continues even if CloudShell disconnects. A fresh shell can check its status:

```bash
aws cloudformation describe-stacks --stack-name karaokekonverter-dev --region us-east-2 --query 'Stacks[0].{Status:StackStatus,Reason:StackStatusReason}' --output json --no-cli-pager
```

Wait for `UPDATE_COMPLETE` (or `CREATE_COMPLETE` on a first installation). Inspect Events if it fails or rolls back. Updating the stack is separate from publishing changed static files; use [AWS deployment](aws-deployment.md) for that step and the health checks. Do not rerun a build simply because a CloudFront deployment is still in progress.
