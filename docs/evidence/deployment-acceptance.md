# My deployment acceptance record

Updated **2026-09-08**. I record successful steps and failures separately so a prepared release is never confused with a verified deployment.

## Working application and repository

- Repository: `Chris-57/karaokekonverter`, repository ID `1361537293`, owner ID `124647261`, default branch `main`.
- My first successful CI: [run 34242550368](https://github.com/Chris-57/karaokekonverter/actions/runs/34242550368). My dependency fix also passed on commit `56fc13b`; Dependabot closed the obsolete linter proposal without merging it.
- I deployed version 0.3.0 to `karaokekonverter-dev` in Ohio and tested both Spotify and SoundCloud conversions.
- I observed dashboard metrics and received the controlled monitoring ALARM and OK emails. These are sample live checks, not a measured availability objective.

## Delivery progress

| Check | Evidence |
| --- | --- |
| Delivery bootstrap | I created/updated `karaokekonverter-dev-delivery` successfully on September 8 |
| OIDC temporary AWS credentials | The credentials step succeeded in the deployment runs below |
| Initial automated release | [Run 34252993376](https://github.com/Chris-57/karaokekonverter/actions/runs/34252993376), commit `1103abc`, stopped at the S3 download helper before an application update |
| S3 correction and automatic trigger | [Run 34256306001](https://github.com/Chris-57/karaokekonverter/actions/runs/34256306001), commit `e2b9a41e023f2837a8fe296c8ab9399e8ba36a4b`, passed pre-deployment checks and captured a baseline, then stopped because the execution role lacked SAM transform permission |
| SAM permission correction | I applied the setup correction; the subsequent run created a change set and reached the resource guard, beyond the previous authorization failure |
| Latest attempted release | [Run 34258887801](https://github.com/Chris-57/karaokekonverter/actions/runs/34258887801), commit `49d3c6b566e374b1918a875bc684d2b0df5f7a68`, stopped at the proposed `ApiFunctionRole` modification before execution |
| Latest observed baseline | `snapshot-34258887801-1`: served website hashes and Spotify/SoundCloud configuration passed |
| Prepared, unverified release | `run-34258887801-1`: prepared only; not applied and not a verified restore target |
| Corrected application release | Code now retains deployed infrastructure and stack tags; successful live execution/publication still pending |
| Post-release Spotify and SoundCloud tests | Pending the first successful corrected deploy |
| Successful automatic main release | Triggering was observed; end-to-end verification still pending |
| Deliberate restore and return to main | Pending live exercise and recorded results |

The last failure did not replace the running app. A baseline check confirms website/configuration readiness at that time; it does not make a new playlist conversion or prove ongoing availability. The exact IAM property difference was not retained in that failed run.

## Implementation verification

The initial delivery preparation passed 80 JavaScript and 37 Python tests. The [S3 correction](deployment-s3-fix.md) and [SAM permission correction](deployment-sam-permission-fix.md) have their own historical records.

The [application release correction](deployment-application-fix.md) passed **52 local Python tests**, including orchestration of deploy and restore with controlled AWS responses. The real AWS CLI integration class was skipped locally because CLI v2 was unavailable; its two cases are required on GitHub. The actual SAM source expanded to 56 resources, and comparison confirmed that only three Lambda code locations changed. The resulting processed template passed lint with SAM 1.166.1 and cfn-lint 1.53.3. No live AWS mutation or provider request was part of those local checks.

See [delivery-validation.json](../delivery-validation.json) for the current machine-readable record and [apply-deployment-fix.md](../apply-deployment-fix.md) for the next steps. After a successful run, record its URL, commit, verified release ID, and both source results here. Keep access codes, private playlist content and raw account logs out of the public record.
