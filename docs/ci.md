# Continuous integration

The workflow is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs on branch pushes, pull requests targeting `main`, and a manual **Run workflow** request. The job is named **Validate and build**. My first `main` CI passed; its [run URL](https://github.com/Chris-57/karaokekonverter/actions/runs/34242550368) records the checks. The Actions badge reports the current workflow status.

## Gates

| Gate | What it establishes |
| --- | --- |
| Public repository check | Common secret/private-file checks, staged-content checks and local Markdown link targets |
| `npm ci` | The application installs from the committed dependency lockfile |
| JavaScript tests | Existing 76 application/monitoring tests plus four repository-check regressions |
| Python tests | Monitoring-CLI, identity/permission, source-contract, preserved-template, change-set, artifact and recovery regressions |
| Source check | JavaScript syntax and the existing narrow credential-pattern check |
| SAM lint | Infrastructure template syntax and resource-property validation |
| Delivery bootstrap lint | Generated IAM/storage template validation against synthetic account metadata |
| SAM build | API, worker and availability Lambda artifacts can be produced from this checkout |
| Artifact imports | All three built entry points export handlers and both worker source readers are packaged |

Tests and import checks do not invoke the live AWS application, launch a provider browser or spend YouTube quota. A successful build does not establish live provider accessibility. [Validation](validation.md) records separate cloud acceptance.

## Tooling and permissions

The job uses an Ubuntu 24.04 hosted runner, Node.js 24 and Python 3.12. SAM CLI 1.166.1 is pinned in `requirements-ci.txt`; SAM itself requires `cfn-lint>=1.52.0,<1.54`. Pip installs the linter within that range. There is no separate direct linter pin for Dependabot to update independently. Application dependency versions are locked; Python's transitive tool dependencies are still resolved by pip. GitHub Action references are pinned to full commit hashes, with release versions noted alongside them. Dependabot proposes weekly updates for Actions, npm and pip; updates require review.

The first dependency-update PR proposed `cfn-lint==1.56.0` alongside SAM CLI 1.166.1. Pip rejected the incompatible requirements before SAM validation or build. Removing the redundant direct linter pin lets the resolver honor SAM's declared dependency. Both the branch-push and pull-request runs reported the same conflict. My dependency fix passed CI on main commit `56fc13b`; Dependabot then closed the obsolete proposal without merging it. Those older red runs remain historical results. A future SAM upgrade must still pass the complete workflow.

The token has read-only contents permission, checkout credentials are not persisted, and no repository or AWS secrets are referenced. There is no `id-token: write`, AWS authentication step, provider-key input or deployment command. Public PRs use the `pull_request` trigger, not privileged `pull_request_target`. Runs for the same branch cancel superseded CI runs; the job has a 20-minute limit. No generated build artifacts or raw reports are uploaded to public Actions artifacts.

The workflow uses ordinary GitHub runners. GitHub billing depends on the account, repository visibility and runner choices; no paid larger runner is configured.

## Accept the first hosted run

1. Publish the repository and open **Actions → CI → Validate and build**.
2. Confirm that all gates complete, including the full SAM build and final import step.
3. Save the run URL in the validation record. Do not mark a build as passed when it is skipped or still running.
4. Add a branch rule for `main` requiring a pull request and the **Validate and build** check after that check has appeared. A solo maintainer does not need to require another person's approval. Disallow force pushes and branch deletion for the normal workflow.

A deliberately failing regression on a separate PR can demonstrate that CI blocks a merge; restore it before merging. It is not necessary to break the live application or replace a working API key.

## Separate AWS deployment workflow

CI is running on the published repository. [Deploy AWS](../.github/workflows/deploy.yml) runs separately after a successful CI **push on main**, or a manual request on main. I configured its separate delivery stack and repository variables, and temporary credential acquisition has passed. Setting `AWS_DEPLOY_ENABLED=false` pauses future deploy jobs while keeping CI available. PR CI runs cannot trigger a deployment. The deployment validates the repository's numeric IDs and selected commit, and checks that main has not advanced before requesting AWS credentials and again before executing a change set.

That workflow builds and tests its own selected checkout, uses OIDC temporary credentials, updates the three Lambda code packages through a scoped CloudFormation role while retaining deployed infrastructure, publishes the static frontend, waits for invalidation, and checks health and exact file hashes. A verified marker is written only after those checks. Private versioned artifacts and baseline snapshots support deliberate restoration. [Setup](deployment-automation.md), [recovery](deployment-recovery.md) and [live acceptance](evidence/deployment-acceptance.md) distinguish implemented checks from my live cloud evidence.

New GitHub repositories can have immutable owner/repository IDs in their OIDC subject. Build the trust policy from the actual repository identity and supported claim format rather than assuming the older name-only example. No long-lived AWS key is needed. [GitHub AWS OIDC guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).

References: [GitHub workflow security](https://docs.github.com/en/actions/reference/security/secure-use), [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0), [setup-python v7.0.0](https://github.com/actions/setup-python/releases/tag/v7.0.0), [AWS SAM build](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-using-build.html).
