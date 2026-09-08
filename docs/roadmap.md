# My project roadmap

## Working baseline

I have deployed KaraokeKonverter 0.3.0 and tested both Spotify and SoundCloud conversions with the 20-track cap. I also observed CloudWatch metrics and received the controlled ALARM/OK emails. The public repository includes source, tests, infrastructure and technical documentation, and my initial and dependency-fix CI runs passed. See [validation](validation.md).

## Current priority: complete application delivery

The delivery bootstrap, OIDC authentication and baseline snapshot checks have worked in AWS. The latest release stopped before execution because its change set proposed an IAM role change. The corrected application release path preserves deployed infrastructure and stack tags; local regressions and full-template lint passed.

1. Apply the [application release correction](apply-deployment-fix.md) and obtain a green CI result for that commit.
2. Record a successful **Deploy AWS** run that ends with verified website hashes, health and release marker.
3. Test one known working Spotify playlist and one SoundCloud playlist on the deployed app.
4. Confirm a later passing main push produces an automatically verified release.
5. Exercise restoration of an earlier verified release, test both sources, and return to current main.

I am keeping the existing application usable while completing these checks. The [acceptance record](evidence/deployment-acceptance.md) separates a working demonstration from the still-unverified deployment and restore steps.

## Later acceptance and product decisions

Record live 20/21-track boundaries, a per-source job trace and deliberate queue/retry behavior when those checks are needed. Fixture coverage does not establish sustained capacity or availability.

Spotify remains central to my project. Its current public-page adapter depends on provider behavior; broader service operation needs a supported access decision and usage controls beyond a shared demo code.

Saved named YouTube playlists would require destination-account authorization and playlist-write APIs, with token revocation and partial-write handling. The current output remains a temporary playback link with an app-only set name. Other providers and larger playlists are outside the present scope.
