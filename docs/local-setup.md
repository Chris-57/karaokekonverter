# Local setup

This runs a separate local instance. Reviewers using the hosted demo only need the privately supplied application access code.

## First run on Windows

1. Stop the previous app with **Ctrl+C**.
2. Extract this release into a **new folder**. Open the `karaokekonverter` folder containing `package.json`.
3. Open a **new PowerShell window** in that folder. You can type `powershell` in File Explorer's address bar and press Enter.
4. Run:

```powershell
npm.cmd ci
npm.cmd start
```

Open **http://localhost:3000**. In **YouTube connection**, paste your API key into the **visible** field and click **Test and save**. If a key is already configured, **Test current key** tests it without re-entering it. The test makes one real YouTube search request. Only an accepted key is saved; invalid-key, disabled-API, key-restriction and quota failures have specific messages. A replacement takes effect immediately, with no restart.

After the test passes, choose **SoundCloud** or **Spotify**, paste a public playlist link, optionally name the set, and press **Find karaoke versions**. Pasting a recognized link also selects its source automatically.

**No access code, Spotify account login, Spotify developer key, or `.env` file is required for the local browser flow.** You enter the key only in the local setup form; conversions use it in the backend. Status responses never return the saved key. The browser obtains an automatic local session, which is distinct from a music-service login.

Subsequent runs only need:

```powershell
npm.cmd start
```

After each server restart, use **Test current key** once before converting. Page refreshes do not require another test. Chrome/Edge is detected automatically at startup.

Requirements: **Node.js 24 or newer**, an installed Chrome/Chromium or Edge browser, and internet access. macOS/Linux users can run `npm` instead of `npm.cmd`; common Chrome paths are detected there as well.

## What to try first

Use the six-song **Other Songs** Spotify playlist:

[Other Songs on Spotify](https://open.spotify.com/playlist/30NcvL51dhP4HKscAuzKY7)

Then check the familiar SoundCloud playlist:

[Chris1 on SoundCloud](https://soundcloud.com/chris-meumann/sets/chris1)

Inspect each returned karaoke candidate before using the combined playback list. There is no guarantee that every song has a suitable karaoke recording. Missing matches are shown individually; successful matches remain available in a partial result.

The combined converter keeps its **20-track limit** to bound search usage. The separate metadata probe allowed 200 because it did not search YouTube. RapCaviar's 50 songs therefore exceed this app's current limit and will be rejected before YouTube searches begin.

Locally, Spotify uses the same visible temporary-browser mode as the successful probe. A separate Chrome/Edge window can appear while its playlist is read and then closes. Leave it alone; no login is needed. SoundCloud continues to use a background browser. The owner can explicitly set `SPOTIFY_HEADLESS=true` for a background Spotify browser, but that mode needs its own live check. AWS always uses the shared headless Lambda Chromium launcher, independent of this local setting.

## Keys and local configuration

**Test and save** saves settings outside the extracted project, so they survive changing release folders:

| System | Settings location |
| --- | --- |
| Windows | `%LOCALAPPDATA%\KaraokeKonverter\config.json` |
| macOS | `~/Library/Application Support/KaraokeKonverter/config.json` |
| Linux | `$XDG_CONFIG_HOME/KaraokeKonverter/config.json`, or `~/.config/KaraokeKonverter/config.json` |

This is a local configuration file containing the key as text. It is not included in the ZIP or served by the website. Do not commit or share it. The AWS deployment uses Secrets Manager instead.

For **YOUTUBE_API_KEY**, precedence is **saved local settings → process environment → optional project `.env`**. This makes a key you explicitly save win over an old PowerShell variable after restart. Other settings retain **process environment → optional project `.env` → saved local settings → defaults**. Startup reports where the key came from without printing it.

To change the key, open **YouTube connection** while no conversion is running, paste the replacement and click **Test and save**. Failed tests or failed disk writes preserve the previous saved key. Verification is scoped to the running server; a successful test is not a guarantee that quota or key settings cannot change later.

`npm.cmd run setup` remains an optional terminal alternative. It now uses ordinary **visible input** and tests one real search before saving. Prefer the website to avoid terminal paste issues.

An optional `.env.example` documents advanced settings. `SOUNDCLOUD_MODE=api` retains the official SoundCloud adapter for an owner who already has app credentials. The Spotify option in this release is browser extraction, not the Spotify Web API.


See [local troubleshooting](local-runbook.md) and [the architecture](architecture.md) for configuration and request boundaries.
