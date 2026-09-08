# Local operations runbook

Applies to KaraokeKonverter 0.3.0 on the owner's computer.

## Normal operation

Run `npm.cmd start` from the application folder and open `http://localhost:3000`. Startup reports whether a YouTube key and browser are configured. No access code is needed. Stop with Ctrl+C; restarting clears the in-memory jobs.

Open **YouTube connection** at the top of the local website. Paste the key in its visible text field and press **Test and save**, or use **Test current key** when one is already configured. Each click sends exactly one real search to YouTube. A successful test saves the key in the user profile and activates it immediately; a failed test keeps the previous saved key. Test once after each server restart before submitting a playlist. Refreshing the webpage does not consume another test request.

Terminal setup remains available with `npm.cmd run setup`. Input is now visible and it performs the same search test before saving. The website is the simplest option for ordinary copying and pasting.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `npm` or Node is not found | Install Node.js 24 or newer, then open a new PowerShell window. |
| Cannot find `package.json` | Open PowerShell in the `karaokekonverter` folder containing `package.json`. |
| Key found — test before converting | Click **Test current key** in YouTube connection. No re-entry is necessary. |
| Browser not found | Install Chrome, then restart the app. For a nonstandard install, set `CHROME_EXECUTABLE_PATH` in local configuration. |
| Terminal paste is difficult | Start this release with `npm.cmd start`, then paste into the visible **YouTube API key** field on the website. |
| Updated key seems ignored | Confirm this release is running. The key saved through this version takes precedence over stale environment/.env keys and becomes active immediately. |
| Port 3000 already in use | Stop the old server with Ctrl+C, then start the new folder. |
| Website still shows only SoundCloud or asks for a code | Confirm the new server is running, then hard-refresh with Ctrl+F5. The local health response says `authentication: local-session`. |
| Invalid playlist URL | Use the full public playlist URL for the chosen source. Spotify short links, track/album pages, private tokens and lookalike domains are rejected. |
| Playlist too large | Use 20 tracks or fewer. The metadata probe's larger limit does not apply to conversion. |
| Spotify browser window appears | Expected in this local release. It uses a fresh profile and closes after reading. Do not sign in or use playback. |
| Source incomplete/unreadable | The page did not expose sufficient metadata. No YouTube search is started for that job. Inspect the source or use another small public playlist. |
| Source requests verification or login | The reader stops. The app does not bypass that requirement. |
| `YOUTUBE_KEY_INVALID` | Copy the complete key from Google Cloud Credentials and use Test and save. An invalid key is not saved. |
| `YOUTUBE_API_DISABLED` | Enable **YouTube Data API v3** in the same Google Cloud project that owns the key; allow a few minutes, then retest. |
| `YOUTUBE_API_RESTRICTED` | In the key's API restrictions, allow **YouTube Data API v3**. |
| `YOUTUBE_REFERRER_BLOCKED` | This is a Node server request, so a website-referrer restriction is incompatible. Use a server-compatible key, restrict it to YouTube Data API v3, and configure allowed server IPs where appropriate. Do not spoof a Referer header. |
| `YOUTUBE_IP_BLOCKED` | Check that the allowed IP is this computer's public outbound IP, not localhost or its private LAN address. |
| `YOUTUBE_ACCESS_DENIED` | Check Google Cloud project/API status and applicable key restrictions. The available response did not identify a more specific supported cause. |
| `YOUTUBE_REQUEST_REJECTED` | An unrecognized search rejection is blocking further calls; share the displayed code/HTTP status, not the key, for diagnosis. |
| `SETTINGS_SAVE_FAILED` | The search passed but disk saving failed. Check write access to the user-profile configuration directory. The active key was not replaced. |
| Search allowance exhausted | Stop repeated conversions. Check your project's quota/reset before retrying. |
| Some songs have no match | Review the successful candidates and missing titles. Complete source metadata does not imply a karaoke video exists. |
| Local origin required | Open the displayed localhost address directly. Do not use a public tunnel, alternate Host header or cross-site embedded page. |
| Copy is unavailable | The app selects the visible URL and provides Ctrl+C/Command+C instructions. |

## Diagnostic information to share

Send the displayed error, approximate time, source, track count and job ID when available. Terminal logs record job IDs, source/status, counts and timings; failed jobs include a safe error code. The webpage shows the actionable YouTube diagnosis. They omit keys and song titles. Do not share the user-profile configuration file, access/session token or API key.

## Update and rollback

Stop the current server and extract each release into a separate folder. Install dependencies using `npm.cmd ci`; saved owner settings remain in the user profile. Start the desired release from its folder. This avoids mixing old interface files with a new backend. Keep the last working release for rollback.

No local procedure in this document creates or changes AWS resources.

## Google references

- [YouTube search.list](https://developers.google.com/youtube/v3/docs/search/list): setup exercises the same search operation as conversions and consumes one search request.
- [YouTube Data API errors](https://developers.google.com/youtube/v3/docs/errors): quota and authorization failure categories.
- [Google error reasons](https://github.com/googleapis/googleapis/blob/master/google/api/error_reason.proto): invalid key, disabled service, API/client restriction categories.
- [API key restrictions](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys): client and API restrictions, including server IP versus website referrer restrictions.
