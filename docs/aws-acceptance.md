# Cloud acceptance checklist — 0.3.0

Use these procedures after a relevant [AWS update](aws-deployment.md). The owner has already supplied successful small runs for both sources and monitoring acceptance; [validation](validation.md) records completed and outstanding evidence. The goal is to establish live AWS behavior for both sources. Automated fixture checks already cover the code paths; they do not prove that Spotify will serve the public page to the Lambda browser.

Use the application's CloudFront website and its existing access code. The local key-entry screen is not an AWS setup step. Both sources use the owner's existing YouTube key from Secrets Manager. No Spotify sign-in or Spotify developer key is used by this adapter.

Real successful conversions make YouTube search requests and consume the project's available quota; empty or unsuitable matches can require one fallback query per song. Run each case once initially. The owner has already set up the AWS budget; this checklist does not require changing it.

## A. Small playlist tests first

1. Check `/api/health`: version `0.3.0`, `configured: true`, `maxTracks: 20`, both sources listed, and browser-mode source readiness true.
2. Open the website, hard-refresh with **Ctrl+F5**, and confirm the SoundCloud and Spotify controls are available. The access-code field remains visible; a music-service login is not requested.
3. Choose **Spotify** and submit the same small public playlist that worked locally. The earlier sample was [Other Songs](https://open.spotify.com/playlist/30NcvL51dhP4HKscAuzKY7). Check its current public track count and order in a signed-out browser first; the earlier report had six songs.
4. Record the start time and watch the stage progress from reading Spotify to finding matches. Compare every source row with the public playlist: title, artist credits, count and order. Every input song should appear in the result, including songs with no karaoke match.
5. Open individual **Review match** links. Confirm song identity and that the recording is suitable karaoke. A `PARTIAL` result is acceptable when extraction is complete and specific songs lack matches; missing source rows are not acceptable.
6. Open the combined link, check the order of the matched videos, then use **Copy link** and paste it into a new tab. Both controls should open the same list.
7. Repeat once with [SoundCloud Chris1](https://soundcloud.com/chris-meumann/sets/chris1) to check the working baseline after this update. Compare against its current visible count; earlier it contained six songs.

If Spotify fails at reading, capture its error and recent worker logs using the [monitoring runbook](monitoring.md). A blocked, incomplete or login-required read means Spotify cloud acceptance is still open, even if infrastructure deployment and health checks passed.

## B. Boundary and input checks

Use small public test playlists you control where practical. Playlist creation/visibility changes happen in your provider account; app visitors still use the resulting public links without signing in.

| Case | What to do | Passing result |
| --- | --- | --- |
| 20 songs, Spotify | Use a public playlist with exactly 20 visible songs; preferably include a repeated song at a different position | All 20 source rows are present and in order. Each has a match or a specific no-match/error state. Repeated songs retain both positions. |
| 20 songs, SoundCloud | Submit a public playlist with exactly 20 visible songs | All 20 source rows are present in source order, with no silent truncation. |
| 21 songs, each source | Submit a public playlist with 21 visible songs | A clear limit error (`PLAYLIST_TOO_LARGE` in the stored job), no generated link, and no YouTube matching stage. The app must not turn it into a 20-song subset. |
| Incorrect access code | Use a valid small playlist URL and an intentionally incorrect application code | Access-code error; no new conversion starts. Restore the correct code afterwards. |
| Invalid URL | Submit `https://example.com/` as the playlist link | Clear invalid-playlist-link error, no new conversion starts. |
| Private/unavailable playlist | Use a legitimate unavailable/private playlist link if you already have one | Clear failure with no partial source list treated as complete. The reader does not ask you to sign in. |
| Name and sharing | Use a custom name on one small test; leave the name blank on another planned test | App uses the custom name or `KaraokePlaylist`. YouTube can still call the temporary list `Untitled List`. Visible, copied and direct links agree. |
| Partial match | Observe an existing run with an unmatched song, or use a small playlist containing a song unlikely to have a karaoke recording | All source rows remain visible. Successful matches still form an ordered link; unmatched rows explain the omission. A provider/key failure remains an error, not “no matches.” |

If the partial-match case does not occur naturally, record it as fixture-covered with live verification pending; do not invalidate a working API key or exhaust quota just to force it.

## C. Persistence and duplicate delivery

These checks demonstrate the AWS queue and database behavior. Use a completed small test job and the resources belonging to `karaokekonverter-dev`.

### Find a job and confirm persistence

In **CloudFormation → karaokekonverter-dev → Outputs**, find `JobsTableName` and `WorkerLogGroup`. Open that table in **DynamoDB → Explore items** and locate your test by `createdAt`, `source` and `playlistName`. Record its `id`, `status`, `total`, `processed`, `matchedCount` and `updatedAt`.

Alternatively, the browser's **F12 → Network** tab shows the submission to `/api/conversions`; its response contains the job ID. The polling response at `/api/conversions/{id}` shows the same record without its internal lease. Share only the job ID and relevant diagnostic fields, not Authorization headers.

Reload the AWS console or reopen CloudShell and check that same item. It should still exist until expiration. Jobs use a 24-hour expiry; DynamoDB may physically remove an expired item later. A website reload currently does not automatically resume a previous result screen, so that UI behavior is not a persistence failure.

### Deliver the same completed job again

1. Choose an unexpired job already marked `COMPLETE` and record its `updatedAt` value.
2. In the stack **Resources** tab, open the queue for logical resource **JobsQueue**. Use **Send and receive messages → Send message**. Send only this body, replacing the placeholder with that completed job's UUID:

```json
{"id":"COMPLETED_JOB_UUID"}
```

3. Wait for the worker to consume the message. You should see another Lambda invocation, while the job's state and `updatedAt` remain unchanged. There should be no new `source_playlist_read` or `conversion_finished` for that job. This demonstrates the existing claim check skipping duplicate completed work.

Sending the same public URL through the website creates a new job and may repeat searches. That is intentionally a fresh conversion, not a duplicate SQS-delivery test. Do not purge the queue, change stored status/lease fields, or redrive a DLQ to perform this check.

For a small concurrency check, submit one small playlist from each of two browser tabs. Each must keep its own job ID, source and results. The queue permits up to two concurrent workers when shared account capacity is available; it does not guarantee an exact runtime or ordering between jobs.

## D. Evidence to retain

For each live case, record:

| Field | Example / purpose |
| --- | --- |
| Time and version | UTC timestamp and health version `0.3.0` |
| Source / input size | Spotify, 6 visible songs |
| Job ID | Correlates DynamoDB with CloudWatch |
| Result | `COMPLETE`, `PARTIAL` or specific failure code |
| Counts | Source count, rows processed, matches returned |
| Review | Order correct; titles/artists checked; copied link opened |
| Duration | Your observed elapsed time and Lambda REPORT duration, identified separately |
| Evidence | Result screenshot and relevant sanitized log entries |

Minimum next feedback: the Spotify result (including all source rows), health version, and whether SoundCloud still works. If a failure occurs, include its approximate time and the `source_browser_failed` / `conversion_failed` entries. We can then record live acceptance accurately and move to monitoring, alerts and CI/CD.
