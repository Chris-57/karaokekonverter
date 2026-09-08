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

## Live acceptance to record

| Check | Result / evidence |
| --- | --- |
| CI run for this delivery update | Pending owner run |
| Delivery bootstrap stack complete | Pending owner run |
| First manual Deploy AWS run URL and commit | Pending owner run |
| Verified release ID and baseline snapshot ID | Pending owner run |
| Spotify smoke test after deployment | Pending owner run |
| SoundCloud smoke test after deployment | Pending owner run |
| Automatic deployment from a later successful main push | Pending owner run |
| Restore of earlier verified release: run URL and restoredFrom | Pending owner run |
| Post-restore checks and return to current main | Pending owner run |

Keep access codes, credentials, private playlist content and unredacted account logs out of this public record. A deployment success proves the documented website/configuration checks; the two source smoke tests provide separate evidence of live extraction/matching.
