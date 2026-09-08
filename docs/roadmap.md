# Roadmap

## Working baseline

Version 0.3.0 supports the local and AWS SoundCloud/Spotify conversion paths with a 20-track cap. The owner reports successful live conversions from both sources. CloudWatch dashboard data and controlled ALARM/OK email receipt have been supplied. See [validation](validation.md) and [monitoring evidence](evidence/monitoring-acceptance.md).

## Current: publish the repository and run CI

The prepared public repository targets `Chris-57/karaokekonverter`. It includes source, tests, infrastructure, operational documentation, a pinned CI workflow and dependency-update proposals. The first hosted CI run is pending publication. The application runtime, provider dependencies and AWS resource definitions remain those of the working 0.3.0 release.

## Next: AWS deployment automation

1. Publish the repository, record its first passing CI run and require that check for `main`.
2. Configure GitHub OIDC with trust scoped to the actual repository identity and intended release branch/environment.
3. Automate updates to the existing stack and website assets, with one deployment at a time and post-deployment health checks.
4. Exercise a harmless release and a documented redeployment of a known-good release. Record commit, workflow run and resulting application version.
5. Add the deployment workflow and recovery evidence to the public reviewer materials. Keep API keys and the shared demo code private.

No OIDC role, deployment workflow or automated rollback is included in the first repository preparation. The existing CloudShell deployment method remains available in [AWS deployment](aws-deployment.md).

## Remaining acceptance and product decisions

Record live 20/21-track boundaries, a per-source job trace and deliberately exercised queue/retry behavior when those checks are needed. Existing fixture coverage is not a substitute for those live records. The small successful runs are not a throughput or availability objective.

Spotify's public-page adapter remains dependent on provider behavior and its supported-access decision. Broader public-service operation needs that decision, usage controls and an access design beyond a shared demonstration code.

Saved named YouTube playlists would require authorization for a destination account and playlist-write APIs, with explicit token storage/revocation and partial-write handling. The current temporary link and app-only name remain the agreed output. Other providers and larger playlists are outside the current scope.
