# Continuous integration

The workflow is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs on branch pushes, pull requests targeting `main`, and a manual **Run workflow** request. The job is named **Validate and build**. The first hosted result is pending until this repository is published; the Actions badge reports that actual result.

## Gates

| Gate | What it establishes |
| --- | --- |
| Public repository check | Common secret/private-file checks, staged-content checks and local Markdown link targets |
| `npm ci` | The application installs from the committed dependency lockfile |
| JavaScript tests | Existing 76 application/monitoring tests plus four repository-check regressions |
| Python tests | Five monitoring-CLI tests for transitions, notification evidence and reset behavior |
| Source check | JavaScript syntax and the existing narrow credential-pattern check |
| SAM lint | Infrastructure template syntax and resource-property validation |
| SAM build | API, worker and availability Lambda artifacts can be produced from this checkout |
| Artifact imports | All three built entry points export handlers and both worker source readers are packaged |

Tests and import checks do not invoke the live AWS application, launch a provider browser or spend YouTube quota. A successful build does not establish live provider accessibility. [Validation](validation.md) records separate cloud acceptance.

## Tooling and permissions

The job uses an Ubuntu 24.04 hosted runner, Node.js 24 and Python 3.12. SAM CLI 1.166.1 and cfn-lint 1.53.3 are pinned in `requirements-ci.txt`. Application dependency versions are locked; Python's transitive tool dependencies are still resolved by pip. GitHub Action references are pinned to full commit hashes, with release versions noted alongside them. Dependabot proposes weekly updates for Actions, npm and pip; updates require review.

The token has read-only contents permission, checkout credentials are not persisted, and no repository or AWS secrets are referenced. There is no `id-token: write`, AWS authentication step, provider-key input or deployment command. Public PRs use the `pull_request` trigger, not privileged `pull_request_target`. Runs for the same branch cancel superseded CI runs; the job has a 20-minute limit. No generated build artifacts or raw reports are uploaded to public Actions artifacts.

The workflow uses ordinary GitHub runners. GitHub billing depends on the account, repository visibility and runner choices; no paid larger runner is configured.

## Accept the first hosted run

1. Publish the repository and open **Actions → CI → Validate and build**.
2. Confirm that all gates complete, including the full SAM build and final import step.
3. Save the run URL in the validation record. Do not mark a build as passed when it is skipped or still running.
4. Add a branch rule for `main` requiring a pull request and the **Validate and build** check after that check has appeared. A solo maintainer does not need to require another person's approval. Disallow force pushes and branch deletion for the normal workflow.

A deliberately failing regression on a separate PR can demonstrate that CI blocks a merge; restore it before merging. It is not necessary to break the live application or replace a working API key.

## Next: AWS deployment automation

CI is ready to publish. CD will be added after the first run and repository identity are confirmed. The intended deployment uses GitHub OIDC temporary credentials, an IAM trust policy restricted to this repository and its deployment branch/environment, scoped CloudFormation/artifact/site permissions, and a single concurrent deployment to the existing stack.

The deployment must publish both backend/infrastructure and static frontend changes, wait for stack completion, check the CloudFront page and expected health contract, and record the deployed commit. A failed post-deploy health check needs an explicit recovery procedure; successful CloudFormation completion alone is insufficient. Redeployment of a verified prior release will be documented and tested separately.

New GitHub repositories can have immutable owner/repository IDs in their OIDC subject. Build the trust policy from the actual repository identity and supported claim format rather than assuming the older name-only example. No long-lived AWS key is needed. [GitHub AWS OIDC guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

References: [GitHub workflow security](https://docs.github.com/en/actions/reference/security/secure-use), [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0), [setup-python v7.0.0](https://github.com/actions/setup-python/releases/tag/v7.0.0), [AWS SAM build](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-using-build.html).
