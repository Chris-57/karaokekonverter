# Deployment acceptance record

Prepared on 2026-09-08. This record distinguishes implementation checks from live AWS acceptance.

## Supplied baseline

- Public repository: `Chris-57/karaokekonverter`, numeric repository ID `1361537293`, owner ID `124647261`, default branch `main`.
- Owner's first successful CI: [run 34242550368](https://github.com/Chris-57/karaokekonverter/actions/runs/34242550368).
- The owner supplied a later passing dependency-fix CI result for main commit `56fc13b`. Dependabot closed the obsolete cfn-lint PR without merging it.
- Application stack: `karaokekonverter-dev`, Ohio, `UPDATE_COMPLETE` before the delivery setup; no existing CloudFormation service role or IAM OIDC provider was reported.
- Working Spotify and SoundCloud conversions and monitoring ALARM/OK emails were reported separately by the owner.

## Implementation verification

The delivery update passed **80 JavaScript tests and 37 Python tests** (five monitoring and 32 delivery tests), source checks, and application/bootstrap template lint. A version-pinned variant of the app template also passed lint. Delivery tests cover exact OIDC subject/account scopes, event/branch rejection, change-set pagination and replacement restrictions, artifact version pinning, release checksums, health checks and suppression of a verified marker after a failed release. Template validation uses synthetic metadata. These checks make no AWS mutations and do not exercise live IAM authorization or provider conversion. See [delivery-validation.json](../delivery-validation.json) for the environment and limits.

The subsequent [S3 transport correction](deployment-s3-fix.md) passed **39 local Python tests**. Two real AWS CLI v2 tests are required on GitHub; their class is skipped in the preparation workspace because the CLI is unavailable. The owner then supplied a hosted run that passed pre-deployment checks and completed the real S3 snapshot downloads. That run found a missing SAM transform permission before execution of a change set. The [bootstrap permission correction](deployment-sam-permission-fix.md) passes **40 local Python tests** and generated-template lint; its live policy update and deployment remain pending.

## Live acceptance to record

| Check | Result / evidence |
| --- | --- |
| CI run for this delivery update | Owner screenshot shows passing CI for main `1103abc`; the first deploy also passed its tests, lint and clean build before requesting credentials |
| Delivery bootstrap stack complete | Owner supplied successful creation/update of `karaokekonverter-dev-delivery` on 2026-09-08 |
| OIDC temporary AWS credentials | Owner's first deployment shows the credentials step succeeded; this is not acceptance of every later AWS permission |
| First manual Deploy AWS run URL and commit | [Run 34252993376](https://github.com/Chris-57/karaokekonverter/actions/runs/34252993376), commit `1103abc`, failed on the initial S3 baseline download before an application update |
| Corrected S3 transport in hosted CI and deployment | [Run 34256306001](https://github.com/Chris-57/karaokekonverter/actions/runs/34256306001), commit `e2b9a41e023f2837a8fe296c8ab9399e8ba36a4b`, passed pre-deployment checks and saved the baseline snapshot |
| Baseline snapshot ID | `snapshot-34256306001-1`, verified against website hashes and both-source configuration |
| Verified new release ID | Pending; `run-34256306001-1` was prepared but was not deployed or marked verified |
| SAM transform permission in the CloudFormation service role | Original policy omitted the required grant; corrected generator and regression supplied, owner bootstrap update/retry pending |
| Spotify smoke test after deployment | Pending owner run |
| SoundCloud smoke test after deployment | Pending owner run |
| Automatic deployment from a later successful main push | The `workflow_run` trigger started run 34256306001 automatically; successful end-to-end deployment remains pending |
| Restore of earlier verified release: run URL and restoredFrom | Pending owner run |
| Post-restore checks and return to current main | Pending owner run |

Keep access codes, credentials, private playlist content and unredacted account logs out of this public record. A deployment success proves the documented website/configuration checks; the two source smoke tests provide separate evidence of live extraction/matching.
