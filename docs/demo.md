# Try the hosted demo

Open [KaraokeKonverter on AWS](https://d2j5ofy3dzbrbx.cloudfront.net). Use the application access code supplied privately by Christopher. No AWS account, local installation, Google API key or music-provider sign-in is needed to use this hosted demonstration.

1. Choose **SoundCloud** or **Spotify** and paste a public playlist URL with no more than 20 tracks.
2. Optionally enter a set name, enter the supplied access code and select **Find karaoke versions**.
3. Follow the job's progress. Review the source titles and returned karaoke candidates.
4. Open the combined playback list, or use the displayed URL and **Copy link** button.
5. Repeat with the other source if desired.

Two small playlists used during development are [Chris1 on SoundCloud](https://soundcloud.com/chris-meumann/sets/chris1) and [Other Songs on Spotify](https://open.spotify.com/playlist/30NcvL51dhP4HKscAuzKY7). Public playlist contents and availability can change; check their current count before submitting.

## What the result means

A complete result found a candidate for every track. A partial result keeps successful matches and explains tracks that were not added. Review links let you check the videos. These matches use metadata, not audio analysis.

The custom name labels your set inside the app. The YouTube URL is a temporary playback list, so YouTube may call it **Untitled List**. It is not saved to your YouTube account.

If a source is blocked or a provider rejects a request, send the owner the displayed error and approximate time. Do not include the access code in screenshots or GitHub issues. One small conversion per source is sufficient for a quick demonstration; repeated searches consume the owner's quota.

## Review the engineering work

Start with the [architecture](architecture.md), then the [monitoring runbook](monitoring.md) and [validation record](validation.md). The [CI workflow](../.github/workflows/ci.yml) shows automatic tests and build checks. The AWS console/dashboard is owner-only; the public [monitoring evidence summary](evidence/monitoring-acceptance.md) records the observations that were supplied.

## Owner handoff

Share the repository and demo URLs with a reviewer, then provide the existing app access code privately. The current code is shared across demo visitors; there is no per-user revocation or automatic invitation expiry. Rotate it in Secrets Manager when access should end. The YouTube key and AWS deployment credentials are never part of the reviewer handoff.
