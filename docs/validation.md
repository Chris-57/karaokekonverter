# Validation record

Application baseline: **0.3.0**. Repository preparation: **September 8, 2026**. I record controlled tests separately from my live application checks. The current deployment correction preserves the working runtime, provider dependencies, website assets and SAM infrastructure source.

## Automated coverage

| Check | Scope | Result |
| --- | --- | --- |
| 76 application/monitoring JavaScript tests | Source validation, matching, HTTP integration, job lifecycle, browser cleanup, AWS handler contracts and monitoring | Passed again during repository preparation |
| Four repository-check tests | Credential detection in docs, staged-secret detection, forcibly tracked settings, safe examples and relative links | Passed; 80 JavaScript tests in total, with no failures or skips |
| Five Python monitoring CLI tests | ALARM/OK state transitions, reset on failure, action evidence and confirmed-subscription handling | Passed again during repository preparation |
| Current Python suite | Monitoring plus delivery identity, permissions, source contract, preserved infrastructure, deploy/restore orchestration, artifacts and verification | 52 local tests passed; the AWS CLI integration class was skipped locally (two cases required on GitHub) |
| Processed application release template | Actual SAM source expanded to 56 resources; preservation of all content except three Lambda code locations | Structural comparison and SAM/cfn-lint passed with synthetic archive versions |
| Source checks | JavaScript syntax and narrow embedded-credential checks | Passed for 47 files |
| Public repository check | Source/docs/private filenames, Git index content and local Markdown links | Passed during preparation; required again before publication and in CI |
| SAM lint | CloudFormation/SAM resource configuration | Passed again for the unchanged 0.3.0 template |
| Packaged entry points | Import all three handlers and confirm both provider readers are present | Passed using byte-verified existing artifacts and installed dependencies; not a new clean build |
| Clean SAM build | Produces all three Lambda artifacts | My CloudShell build and initial GitHub CI passed; later deployment attempts also passed build checks before the release stage |
| CI execution | Push/PR workflow including packaged-handler imports | My [successful initial run](https://github.com/Chris-57/karaokekonverter/actions/runs/34242550368) and passing dependency-fix result establish hosted CI; the latest application release correction needs its own hosted run |

The original pre-publication preparation results are retained in [repository-validation.json](repository-validation.json) as a historical record. Local tests reused the working release's installed dependencies; I subsequently obtained passing hosted CI. The infrastructure/monitoring design counts are in [monitoring-validation.json](monitoring-validation.json). [Delivery validation](delivery-validation.json) and [deployment acceptance](evidence/deployment-acceptance.md) track the new workflow separately.

Tests use controlled provider responses and do not contact my AWS account or music providers. Simulated DOM and handler tests do not emulate the complete SQS/DynamoDB services, execute a real Windows browser, or establish public-provider approval. The tests include the installed Puppeteer launch-argument contract. Artifact imports do not invoke the handlers.

## My live acceptance checks

I ran the combined application locally, deployed the AWS stack, and tested successful SoundCloud and Spotify conversions. After the monitoring update I confirmed **UPDATE_COMPLETE**, successful monitoring commands, and receipt of both controlled **ALARM and OK** emails.

CloudWatch screenshots show the conversion metrics populated, 14 source tracks / 13 matches in the displayed sample, processing and queue-wait durations, an in-flight queue sample that drained, zero displayed infrastructure failure samples, and ten alarms in OK. The log-group inventory confirms 14-day retention for the four current project groups. [The monitoring evidence summary](evidence/monitoring-acceptance.md) preserves the observations and their limits without publishing account screenshots or credentials.

The aggregate 13/14 result is sample evidence, not a match-quality benchmark. The screenshots alone do not identify the unmatched song or divide the counts by source. The small 4xx spike remains unattributed. A healthy scheduled probe checks website/configuration availability; it does not test YouTube credentials or live playlist extraction.

## Selected regression history

| Release | Problem and resolution | Evidence |
| --- | --- | --- |
| 0.1.1 | A remaster label reduced title-match coverage for Paranoid; normalize edition tokens, retain artist hints, add bounded fallback search and decode title entities | Reproduced matching regression and controlled tests; I tested the update successfully |
| 0.2.0 | Add Spotify alongside SoundCloud without changing the shared job contract | My signed-out metadata probes read 50/50 and 6/6 tracks; the six-track fixture is retained. Metadata probes do not imply support for 50-track conversions |
| 0.2.1 | Generic provider rejection was being relabeled as no matches | Specific sanitized YouTube errors, single-search Test and save, saved-key precedence and stop-on-provider-failure tests |
| 0.2.3 | Puppeteer's asynchronous default arguments were passed to Lambda launch without awaiting them | Installed-SDK reproduction and regression; I completed a successful SoundCloud conversion after deployment |
| 0.2.4 | Enable Spotify on AWS with complete virtualized-list collection and explicit bounds | 67 controlled tests; I later tested both AWS sources successfully |
| 0.3.0 | Add useful application failure signals beyond native Lambda errors | 76 JavaScript / five Python tests; my subsequent build/deployment, dashboard evidence and ALARM/OK inbox confirmation |

The first AWS deployment continued after CloudShell disconnected, and completed in CloudFormation. A later local build attempt failed from Node.js 20 and CloudShell home storage exhaustion; selecting Node.js 24 and building under `/tmp` resolved my build failure. These are documented operating lessons rather than application downtime measurements.

## Remaining work

| Item | Remaining evidence |
| --- | --- |
| CI for latest correction | Successful GitHub Actions URL for the application release correction |
| Application deployment automation | Bootstrap, OIDC and snapshots have passed; record successful execution, website publication and verification using the preserved infrastructure template |
| Deployment recovery | Run the prepared restore action for a verified release and record live results |
| Live 20/21-track boundaries | Accept 20 complete rows and reject 21 before searches for each source; fixture coverage already exists |
| Per-source trace | Saved conversion-outcomes query and one correlated job trace |
| Queue failure behavior | Deliberately exercised live retry/DLQ behavior; fixtures cover handler and claim contracts |
| Capacity and availability | Sustained workload measurements and an explicit objective if needed |
| Provider access | Supported-access decision for broader Spotify service use |

Use [AWS acceptance](aws-acceptance.md) for the detailed live procedure. None of these pending checks is required to keep the already working demonstration running, and no load/SLO guarantee is inferred from the existing small samples.
