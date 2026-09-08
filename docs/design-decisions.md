# My design decisions

I designed KaraokeKonverter to turn a public Spotify or SoundCloud playlist into a usable karaoke set while retaining the playlist's order. I rebuilt an earlier school project into an AWS portfolio application, with deployment, monitoring and recovery documented alongside the user-facing features.

Spotify support is a core requirement for this project. I kept a shared conversion contract so both sources use the same matching, progress reporting and playback output. The current Spotify adapter reads public-page metadata through Chromium; it does not implement Spotify Web API authorization. I document that dependency and its limits rather than treating one successful playlist as proof of permanent provider availability.

## Decisions and tradeoffs

| My decision | Reason | Tradeoff |
| --- | --- | --- |
| Put longer conversions behind SQS | The API can return a job ID promptly while a worker reads playlist pages and searches YouTube | I need job state, duplicate-delivery handling and queue monitoring |
| Keep source adapters separate from matching | Spotify and SoundCloud can share the conversion workflow while retaining provider-specific extraction | Public-page changes still require adapter maintenance and live tests |
| Limit public playlists to 20 tracks | Keep demonstrations and search usage bounded and make complete extraction verifiable | Larger playlists are rejected rather than silently shortened |
| Preserve partial results | A missing candidate should not discard the songs that already matched | Users must review each result; metadata matching cannot guarantee the right karaoke version |
| Use a temporary YouTube playback link | Provide a useful result without storing destination-account OAuth tokens | The set is not a saved, named playlist in a YouTube account |
| Separate a private demo code from provider credentials | A reviewer can use my hosted demo without receiving AWS or YouTube credentials | A shared access code has no individual revocation |
| Monitor handled application failures | A provider failure can be handled without causing a Lambda invocation error | Custom logs and metrics add operational work and cost |
| Use temporary GitHub OIDC credentials | Avoid storing a permanent AWS key in the repository or Actions secrets | Trust and execution policies need careful setup and live validation |
| Preserve deployed infrastructure during routine releases | Ship application code and website files without regenerating runtime roles | Infrastructure migrations require a separate reviewed operator update |

## What I learned during deployment

CloudFormation continued my first installation after CloudShell disconnected. I now check stack status directly instead of assuming a lost terminal stopped the AWS operation. A later build failed because CloudShell was using Node.js 20 and its home storage was full; the documented build procedure uses Node.js 24 and temporary storage.

The first automated releases exposed three separate issues: the AWS CLI download helper used the wrong argument form, the execution role lacked permission for the SAM transform, and a later change set proposed an IAM role modification that the release guard rejected. I kept these failures in the [acceptance record](evidence/deployment-acceptance.md). The application release path now preserves the deployed template and stack tags, with focused regressions for that behavior. The failed change set's exact IAM property difference was not retained, so I do not label it harmless or claim a more specific cause than the available evidence supports.

## Evidence and remaining work

I tested both sources in the hosted application, deployed the CloudWatch monitoring update, and received the controlled ALARM and OK emails. Those are small live acceptance samples. Automated fixtures cover additional failure and boundary cases, but they do not establish sustained availability, capacity or matching accuracy.

The latest baseline observation passed before the release guard stopped execution. The corrected application deployment and a deliberate restore still need successful live runs. My immediate priority is a usable demonstration; the remaining automation acceptance is recorded separately in [validation](validation.md) and the [roadmap](roadmap.md).
