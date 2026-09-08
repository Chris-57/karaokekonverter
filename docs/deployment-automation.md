# AWS deployment automation

This update prepares GitHub Actions to update the existing `karaokekonverter-dev` application in `us-east-2`. The owner has already supplied a passing CI result, a healthy application stack, both-source conversion results, and successful monitoring emails. **The new OIDC deployment and restore workflow still require their first live acceptance runs.** Local tests do not establish that AWS has accepted the new IAM policies.

## What is being connected

| Component | Responsibility |
| --- | --- |
| [CI](../.github/workflows/ci.yml) | Unprivileged tests, lint and Lambda build on pushes/PRs |
| [Deploy AWS](../.github/workflows/deploy.yml) | After a successful `main` push, build the selected commit, obtain temporary credentials, update the existing app, publish its website and verify it |
| `karaokekonverter-dev-delivery` stack | Separate IAM roles, GitHub identity provider and private versioned release bucket |
| `karaokekonverter-dev-github-deploy` role | Submit app change sets, store releases, publish three website assets and invalidate their CloudFront cache |
| `karaokekonverter-dev-cloudformation` role | Update the app's existing resources with scoped permissions |
| Existing Secrets Manager configuration | Continue storing the application's YouTube key and shared access code |

The application stays at version **0.3.0**, with SoundCloud, Spotify and the 20-track cap. No static AWS key, YouTube key or demo access code is supplied to this workflow. Reviewers can read the public code and docs; Michael can use the website with the access code supplied privately by the owner. He needs no AWS credentials to use the hosted demo.

## 1. Add these files to GitHub

Copy this update into the root of your existing local `karaokekonverter` repository, preserving the `scripts`, `tests`, `infra`, `docs` and `.github/workflows` directories. Replace the included existing files when asked. This is an overlay, not a replacement for the repository or its Git history.

Run in the repository's Windows PowerShell terminal:

```powershell
npm.cmd run check:public
```

Review the changed files, commit with a message such as `Add scoped AWS deployment and release recovery`, then push. Open **Actions → CI** and wait for **Validate and build** to pass. The deploy job stays skipped until `AWS_DEPLOY_ENABLED` is set to `true`.

Protect `main` with the **Validate and build** required check and pull requests. A solo maintainer need not require a second person's approval. Keep force pushes and branch deletion disabled. Review workflow/deployment-script changes carefully: trusted `main` code is allowed to deploy application code.

## 2. Create the delivery resources from CloudShell

Use your `chris-karaoke-admin` CloudShell session in Ohio. This setup uses Python's standard library and the installed AWS CLI; **no `npm ci`, Chromium download or SAM build is needed in CloudShell**.

Clone the public repository into a new, small setup directory:

```bash
git clone --depth 1 --branch main https://github.com/Chris-57/karaokekonverter.git "$HOME/karaoke-delivery-setup"
```

After that succeeds:

```bash
cd "$HOME/karaoke-delivery-setup"
```

If you already cloned that directory during this setup, enter it and use `git pull --ff-only` instead of cloning again. Confirm `scripts/bootstrap_delivery.py` is present.

Generate the account-specific setup template without creating resources:

```bash
python3 -m scripts.bootstrap_delivery --expected-account YOUR_12_DIGIT_ACCOUNT_ID
```

Replace `YOUR_12_DIGIT_ACCOUNT_ID` with the account ID from your successful `get-caller-identity` result. The script verifies the signed-in account, repository IDs, stack identity, existing resource IDs and available identity provider. It writes `.data/delivery/bootstrap-template.json`, which Git ignores.

The generated template creates two deployment roles and a private versioned artifact bucket. It creates the GitHub OIDC provider when absent, or reuses a compatible provider already in the account. The CloudFormation execution permissions are built from the app's current resource IDs. It does not grant `AdministratorAccess`, mutate the app's runtime roles, or read secret values. Inspect the generated template if you want to see the concrete policy scope.

Apply it:

```bash
python3 -m scripts.bootstrap_delivery --expected-account YOUR_12_DIGIT_ACCOUNT_ID --apply
```

This creates/updates **only the delivery stack**. It does not deploy a new app release. The command waits for CloudFormation and prints the values for the next step. If CloudShell disconnects, check the delivery stack from a new shell before retrying:

```bash
aws cloudformation describe-stacks --stack-name karaokekonverter-dev-delivery --region us-east-2 --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}' --output json --no-cli-pager
```

## 3. Add three GitHub repository variables

Open **Repository → Settings → Secrets and variables → Actions → Variables → New repository variable**. These are configuration values, not credentials.

| Variable name | Value |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | The `GitHubDeployRoleArn` printed by the setup command |
| `AWS_ACCOUNT_ID` | The same twelve-digit AWS account ID used above |
| `AWS_DEPLOY_ENABLED` | `true` — add this one last |

No GitHub environment is configured. Adding an `environment:` to the deployment job would change its OIDC subject and require a reviewed trust-policy update.

The repository was created after July 15, 2026. Its trust subject therefore includes the numeric owner/repository IDs supplied by the owner:

```text
repo:Chris-57@124647261/karaokekonverter@1361537293:ref:refs/heads/main
```

The audience is `sts.amazonaws.com`. The trust policy uses exact equality for both values. It does not trust forks, arbitrary branches or the older name-only subject. See [GitHub's AWS OIDC guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

## 4. Run the first deployment

Open **Actions → Deploy AWS → Run workflow**. Choose branch **main**, action **deploy**, and leave **release_id** empty.

The workflow:

1. Checks repository/event identity and that the checkout is still the current `main` commit.
2. Runs the public check, tests, syntax check, SAM lint/build and packaged-handler checks before AWS authentication.
3. Obtains a two-hour temporary AWS session, checking the expected account. One deployment runs at a time; a newer push does not cancel an active CloudFormation update.
4. Stores a snapshot of the existing template, Lambda archives and website assets. It marks that snapshot usable for restore only if the currently served website hashes and health contract match.
5. Uploads the built Lambda packages under a release-specific prefix and pins their S3 object versions.
6. Creates an **UPDATE** change set for the existing app. It rejects additions, removals, imports, replacements, and IAM/secret/saved-query modifications before executing it.
7. Waits for the stack to finish, publishes JS/CSS followed by HTML and a release marker, invalidates the CloudFront paths and waits for propagation.
8. Checks the served files' hashes, release marker and `/api/health`: expected version, both sources ready, access-code authentication and the 20-track cap. Only then does it mark the release verified.

The run summary contains the release ID, recovery snapshot ID, selected commit and website link. A skipped run for an obsolete commit is intentional; check the deployment associated with the latest successful `main` push.

**After the first green deploy**, open the website and submit one known working Spotify playlist and one SoundCloud playlist. Check the matching results and CloudWatch dashboard. These live requests exercise provider extraction and YouTube search; the automated health check only verifies website/configuration readiness.

Record the CI run URL, deployment run URL, commit, release ID and both smoke-test results in [deployment acceptance](evidence/deployment-acceptance.md). The public release marker is at the website's `/release.json`; it contains a release ID, commit and version, not credentials.

## 5. Prove automatic delivery and recovery

Make a harmless documentation change on a branch and merge it through a passing PR. Confirm that the successful `main` push automatically starts **Deploy AWS** and that the new run finishes verification.

Then follow the deliberate **restore** exercise in [deployment recovery](deployment-recovery.md), using the earlier verified release ID. The exercise updates the live demonstration, so schedule it when nobody is submitting conversions. Record its run URL and results, then deploy current `main` again. A restore does not change Git history; the next successful `main` push can deploy the current source again.

Do not claim that delivery/restore is operational until these AWS runs have actually completed. To pause future deployments, set `AWS_DEPLOY_ENABLED=false`; allow any active CloudFormation update to finish before making other changes.

## Permission and operational limits

- CloudFormation's service role is attached to the app stack on its first executed automated update and remains associated with it. A later manual update also uses that role unless an authorized operator explicitly supplies another one. Do not delete the delivery stack/role while the app depends on it. [CloudFormation service-role behavior](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html).
- This pipeline supports routine updates to existing resources. New resources, replacement changes, IAM policies, secret definitions and saved Logs Insights queries need a separate reviewed operator change and, where necessary, a generator/policy update. New properties on existing resources may also require additional scoped permissions. The failure is surfaced; the workflow does not grant itself more access.
- The GitHub role cannot directly read the configuration secret. However, an authorized code deployer can change what the application does using its existing runtime permissions. Protecting `main`, workflow files and maintainer access remains necessary.
- Website assets use fixed filenames. Publishing them is not an atomic website switch; a brief mixed-version window is possible. The post-deploy check and saved release provide detection/recovery, not zero-downtime deployment.
- Snapshots preserve code and website files, not DynamoDB job data or secret values. Restoring code does not reverse data writes or configuration changes made separately.
- Artifact storage, S3 requests, invalidations, health invocations and ordinary app use can incur AWS charges. The new bucket retains releases/object versions for recovery; no automatic expiry can accidentally remove the currently deployed code. Review storage and retire old releases deliberately. Deleting CloudWatch logs does not free CloudShell disk space.
- Deployment records/checksums detect accidental changes; they are not an independent tamper-proof attestation against someone who controls the deployment role. No public Actions build artifacts or application secrets are uploaded.

The implementation is in [bootstrap_delivery.py](../scripts/bootstrap_delivery.py), [delivery_event.py](../scripts/delivery_event.py), [deploy_aws.py](../scripts/deploy_aws.py) and [delivery_common.py](../scripts/delivery_common.py). The AWS credentials action is [pinned to v6.2.4's commit](https://github.com/aws-actions/configure-aws-credentials/commit/cbe3b392738ccf3f987d68400dafcf4b0624a56c).
