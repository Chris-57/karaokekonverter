# Changelog

Historical entries describe the state at each release. See [current validation](docs/validation.md) for subsequent live acceptance.

## Unreleased — deployment automation

- Add a separate IAM/bootstrap stack with an exact numeric-ID GitHub OIDC subject, two scoped roles and private versioned release storage.
- Add an opt-in deployment workflow after successful main CI, current-commit checks, pre-authentication tests/build, and serialized existing-stack updates.
- Reject resource additions/removals/replacements and IAM/secret/saved-query changes before executing a change set.
- Snapshot the deployed baseline, pin Lambda archive versions, publish website assets and verify health/file hashes before marking a release verified.
- Add an explicit restore action, offline delivery regressions and setup/recovery/acceptance guides. First live OIDC deployment and restore remain owner-run acceptance.
- Keep the application version, SoundCloud/Spotify paths, 20-track cap, runtime dependencies and app stack definition at 0.3.0.

## Repository publication — 2026-09-08

- Prepare Chris-57/karaokekonverter with a reviewer README, architecture/demo/operations guides and current acceptance evidence.
- Add GitHub CI for public-file checks, 80 JavaScript tests, five Python tests, SAM lint/build and packaged-handler imports; first hosted run follows publication.
- Pin Action commits and development tools, add Dependabot, CODEOWNERS and contributor/PR guidance.
- Check staged credentials and accidentally tracked settings; exclude local configuration and raw reports.
- Correct CloudShell build instructions to use Node.js 24 and temporary storage. Keep application version 0.3.0, runtime behavior, provider dependencies and infrastructure unchanged.
- The owner subsequently supplied passing initial and dependency-fix CI results. SAM now selects its compatible cfn-lint dependency; Dependabot closed the incompatible standalone-linter proposal. CI itself has no AWS credentials or deployment permissions.

## 0.3.0 — CloudWatch operations and alerts

- Add an 18-widget dashboard, ten bounded custom metric series, saved Logs Insights queries and ten alarms using the existing confirmed SNS topic.
- Log handled API/provider faults, partial-result failures, job duration, queue waiting and source outcomes with request/job correlation and fixed safe fields. Add HTTP API access logs and retain logs for 14 days.
- Add a small EventBridge-scheduled Lambda that checks the website and both-source readiness every five minutes without using YouTube quota or reading credentials.
- Add an IAM-only isolated alert test, with real metric-filter/alarm/SNS-action verification, reset on failures, and credential-free evidence reports.
- Document deployment, thresholds, incident response, costs and the distinction between a healthy probe and a successful live provider conversion.
- Keep both sources, the 20-track cap, provider dependencies, stored data, existing secret/topic and frontend assets. 76 JavaScript tests and five Python CLI tests pass; new probe builds and the SAM template validates. Live monitoring deployment and email receipt remain owner-run acceptance.

## 0.2.4 — Spotify in the AWS application

- Enable SoundCloud and Spotify through shared source configuration in the AWS API and worker. The existing frontend source switch follows health; the AWS access-code boundary stays in place.
- Use the corrected Lambda Chromium startup for Spotify. Give collection its own bounded waiting budget after navigation and continue through temporary scroll boundaries until metadata is complete or the budget ends.
- Distinguish Spotify browser startup failures, actual timeouts and other browser errors. Log safe source/stage/count/timing diagnostics and complete-read counts.
- Add focused coverage for both AWS handler routes, the cloud source switch, source readiness, 20/21-song limits, delayed rows, finite waiting, failure cleanup and duplicate delivery. All 67 fixture tests pass.
- Add the existing-stack update guide and live cloud acceptance checklist. Record the owner-reported successful SoundCloud AWS run after 0.2.3; live Spotify cloud acceptance remains pending.
- Keep resource definitions, dependency versions, static frontend files and the 20-track scope unchanged from 0.2.3. The template description and release metadata are updated.

## 0.2.3 — Lambda browser startup correction

- Await Puppeteer's asynchronous default arguments before passing them into the Lambda Chromium launcher. The missing await reproduced `TypeError: options.filter is not a function` with the pinned Puppeteer 25.1.0 dependency.
- Distinguish SoundCloud browser startup failures, actual timeout errors and other browser errors. Log the failing stage, an allowlisted error type and elapsed time without raw error messages, page content, URLs or credentials.
- Add regression coverage using the installed Puppeteer SDK and controlled browser failures, including cleanup and diagnostic sanitization.
- Keep the infrastructure template, dependencies, frontend, 20-track limit and AWS SoundCloud-only provider configuration unchanged. This update targets the existing stack. A successful cloud conversion is still required after deployment; Spotify on AWS remains pending.

## 0.2.2 — AWS account preparation

- Retained the 20-track scope and the working local conversion behavior.
- Removed worker reserved concurrency because the target account reports a total Lambda concurrency quota of 10. The existing SQS event-source maximum of two remains in place; it limits this queue and does not reserve capacity or cap direct invocations.
- Added CloudShell Node.js 24 installation and account-preparation instructions, including deployment identity and billing checks.
- Recorded the owner’s confirmation that the local application works, and the initial account/tooling evidence. AWS deployment and live cloud acceptance remain pending.

## 0.2.1 — visible, verified YouTube setup

- Added a visible local webpage key field, Test and save, and Test current key. Each test makes exactly one real YouTube search and saves only after success; a replacement is active immediately.
- Require an explicit test once per local server session before conversion. Status endpoints do not expose the stored key. Setup requests keep the existing local session/Host/Origin boundary and cannot race active jobs or other saves.
- Replaced masked terminal setup with ordinary visible input and actual API verification.
- Saved local YouTube keys now take precedence over stale environment or project .env key values. Other configuration precedence is unchanged.
- Added specific YouTube invalid-key, disabled-API, restriction, quota and request errors. Stop subsequent searches and retain the real failure instead of reporting NO_MATCHES.
- Added eight targeted tests; 53 tests pass with controlled provider responses. Live owner-key validation remains the next acceptance check.

## 0.2.0 — combined local release

- Added SoundCloud/Spotify source controls and automatic source selection when a supported link is pasted. Source identity now persists through API, worker and result display.
- Integrated the validated Spotify browser reader. It requires complete, ordered title/artist metadata, excludes recommendations, preserves duplicates and stops before search on incomplete, changed, oversized or challenged pages.
- Normalized Spotify artist arrays for shared YouTube matching. Search uses the primary artist; reliable credits help reject same-title candidates from unrelated artists. Known with/feat credits are removed from search identity while display titles are preserved.
- Added one-time masked local setup, persistent owner settings outside the project, and automatic Chrome/Edge detection. Starting the local website no longer requires copying an access code.
- Added automatic local sessions with loopback binding, Host/Origin checks and cross-site API rejection. The existing AWS handler retains its separate access-code flow and SoundCloud-only provider configuration.
- Preserved set naming, source titles, progress, partial results, direct playback links and clipboard copying. Added source artist display to help review matches.
- Added 12 focused integration/configuration/interface checks; all 45 tests pass. The six-song metadata input comes from the owner's successful Other Songs report; YouTube results in tests remain fixtures.
- Runtime dependency versions are unchanged. Added pinned LinkeDOM as a development dependency for DOM behavior tests.
- Updated local documentation and retained the AWS deployment/operations plan separately. No AWS deployment or GitHub publication was performed.

## 0.1.1

- Fixed a reproduced false rejection of Paranoid caused by remaster/year labels. Search/ranking use normalized titles while original titles remain visible.
- Added artist/uploader hints and one fallback search when the initial query has no suitable match. This can consume additional search quota for unmatched tracks.
- Preserved meaningful parentheses and numeric song titles. Added regression cases for all eight songs in the second live playlist.
- Decoded common HTML entities in API title/channel text, including apostrophes in It's My Life and Guns N' Roses. UI rendering still uses text nodes.
- Added optional app playlist names, defaulting to `KaraokePlaylist`, while retaining the source playlist title. YouTube's temporary-list title is unchanged; saved named playlists require the next OAuth feature.
- Added a visible read-only sharing URL, Copy link button, success feedback, and manual-copy fallback. Preserved the direct playback hyperlink.
- Updated validation with the owner's two live local runs and error messages. Automated suite: 33 passing tests.
- Runtime dependencies and AWS resources are unchanged.

## 0.1.0

Initial SoundCloud baseline: frontend, local server, provider adapters, asynchronous AWS template, job tracking, temporary playback URLs, and 24 automated tests.
