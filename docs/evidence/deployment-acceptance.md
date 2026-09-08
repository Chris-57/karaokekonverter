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

The subsequent [S3 transport correction](deployment-s3-fix.md) passes **39 local Python tests**. Two real AWS CLI v2 tests are required on GitHub and remain pending there; their test class is skipped in the preparation workspace because the CLI is unavailable. The owner has since supplied successful bootstrap/OIDC evidence and a failed first deployment, as recorded below.

## Live acceptance to record

| Check | Result / evidence |
| --- | --- |
| CI run for this delivery update | Owner screenshot shows passing CI for main `1103abc`; the first deploy also passed its tests, lint and clean build before requesting credentials |
| Delivery bootstrap stack complete | Owner supplied successful creation/update of `karaokekonverter-dev-delivery` on 2026-09-08 |
| OIDC temporary AWS credentials | Owner's first deployment shows the credentials step succeeded; this is not acceptance of every later AWS permission |
| First manual Deploy AWS run URL and commit | [Run 34252993376](https://github.com/Chris-57/karaokekonverter/actions/runs/34252993376), commit `1103abc`, failed on the initial S3 baseline download before an application update |
| Corrected S3 transport in hosted CI and deployment | Pending owner push/run of the S3 fix |
| Verified release ID and baseline snapshot ID | Pending owner run |
| Spotify smoke test after deployment | Pending owner run |
| SoundCloud smoke test after deployment | Pending owner run |
| Automatic deployment from a later successful main push | Pending owner run |
| Restore of earlier verified release: run URL and restoredFrom | Pending owner run |
| Post-restore checks and return to current main | Pending owner run |

Keep access codes, credentials, private playlist content and unredacted account logs out of this public record. A deployment success proves the documented website/configuration checks; the two source smoke tests provide separate evidence of live extraction/matching.
