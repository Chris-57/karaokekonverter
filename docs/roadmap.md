# Roadmap

## Working baseline

Version 0.3.0 supports the local and AWS SoundCloud/Spotify conversion paths with a 20-track cap. The owner reports successful live conversions from both sources. CloudWatch dashboard data and controlled ALARM/OK email receipt have been supplied. See [validation](validation.md) and [monitoring evidence](evidence/monitoring-acceptance.md).

## Completed: publish the repository and run CI

The public repository is `Chris-57/karaokekonverter`. It includes source, tests, infrastructure, operational documentation, a pinned CI workflow and dependency-update proposals. The owner supplied passing initial and dependency-fix CI runs. The application runtime, provider dependencies and app stack definitions remain those of the working 0.3.0 release.

## Current: connect and accept AWS deployment automation

1. Merge the prepared delivery workflow and require passing CI for `main`.
2. Apply the separate IAM/bootstrap stack using the existing administrator's CloudShell session.
3. Configure the three non-secret repository variables and run the first OIDC deployment.
4. Verify live Spotify and SoundCloud conversions, then a harmless automatic main release and deliberate restore of a verified release.
5. Record commit, workflow URL and release/recovery evidence in the public reviewer materials. Keep API keys and the shared demo code private.

The workflow, resource-scoped bootstrap generator, release snapshots, post-deploy checks and restore action are implemented in this update. Live AWS authorization/deployment/restore are not yet claimed. Follow [deployment automation](deployment-automation.md); manual infrastructure changes must account for the persistent CloudFormation service role described there.

## Remaining acceptance and product decisions

Record live 20/21-track boundaries, a per-source job trace and deliberately exercised queue/retry behavior when those checks are needed. Existing fixture coverage is not a substitute for those live records. The small successful runs are not a throughput or availability objective.

Spotify's public-page adapter remains dependent on provider behavior and its supported-access decision. Broader public-service operation needs that decision, usage controls and an access design beyond a shared demonstration code.

Saved named YouTube playlists would require authorization for a destination account and playlist-write APIs, with explicit token storage/revocation and partial-write handling. The current temporary link and app-only name remain the agreed output. Other providers and larger playlists are outside the current scope.
