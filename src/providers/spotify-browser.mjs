import { AppError, validatePlaylistUrl } from '../domain.mjs';
import { launchPlaylistBrowser } from './browser-runtime.mjs';
import { extractSnapshot, scrollPlaylist } from './public-playlist-dom.mjs';
import { createCollector } from './playlist-collector.mjs';

export function spotifyRequestAllowed(rawUrl, resourceType) {
  if (['image', 'media', 'font'].includes(resourceType)) return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      ['spotify.com', 'scdn.co', 'spotifycdn.com', 'spotifycdn.net'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

// Public rendered metadata only. AWS uses the shared headless Chromium launcher.
export function spotifyBrowserProvider({ executablePath, headless = false, launchBrowser, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, log = entry => console.log(JSON.stringify(entry)) } = {}) {
  return {
    async readPlaylist(input, maxTracks = 20, { log: jobLog = log } = {}) {
      const url = validatePlaylistUrl(input, 'spotify');
      const collector = createCollector(null, maxTracks);
      let browser;
      let stage = 'launch';
      const started = now();
      try {
        browser = launchBrowser ? await launchBrowser() : await launchPlaylistBrowser({ executablePath, headless });
        stage = 'prepare';
        const page = await browser.newPage();
        page.setDefaultTimeout(10000);
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        await page.setRequestInterception(true);
        page.on('request', request => {
          let allowed = spotifyRequestAllowed(request.url(), request.resourceType());
          if (allowed && request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            try { allowed = validatePlaylistUrl(request.url(), 'spotify') === url; } catch { allowed = false; }
          }
          void (allowed ? request.continue() : request.abort()).catch(() => {});
        });
        stage = 'navigate';
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!response || response.status() >= 400) {
          const contentUnavailable = [401, 404, 410].includes(response?.status());
          throw new AppError(contentUnavailable ? 'PLAYLIST_UNAVAILABLE' : 'SOURCE_UNAVAILABLE', 'Spotify could not serve this public playlist. Check its availability and try again later.', contentUnavailable ? 422 : 502);
        }
        if (validatePlaylistUrl(page.url(), 'spotify') !== url) throw new AppError('SOURCE_UNAVAILABLE', 'Spotify redirected away from this public playlist.', 422);
        stage = 'extract';
        // Start the collection budget after navigation so cold starts do not use it up.
        const deadline = now() + 75000;
        let previous = '';
        let stable = 0;
        for (let round = 0; round < 100 && now() < deadline; round++) {
          const snapshot = await page.evaluate(extractSnapshot, 'spotify');
          const result = collector.add(snapshot);
          if (result.status === 'VERIFICATION_REQUIRED') throw new AppError('SOURCE_BLOCKED', 'Spotify is requesting verification. This version cannot read that page automatically.', 422);
          if (result.status === 'LOGIN_REQUIRED') throw new AppError('SOURCE_LOGIN_REQUIRED', 'Spotify requires access to this playlist. Use a playlist that is visible while signed out.', 422);
          if (result.status === 'LIMIT_EXCEEDED') throw new AppError('PLAYLIST_TOO_LARGE', `This version supports up to ${maxTracks} tracks. Use a smaller playlist.`, 422);
          if (result.status === 'INCONSISTENT_METADATA') throw new AppError('SOURCE_INCONSISTENT', 'The playlist changed or its order could not be established. Try again with a stable public playlist.', 422);
          const fingerprint = JSON.stringify([result.tracks, result.displayedCount]);
          stable = fingerprint === previous ? stable + 1 : 0;
          previous = fingerprint;
          if (result.status === 'COMPLETE_METADATA' && stable >= 2) {
            jobLog({ event: 'source_playlist_read', source: 'spotify', collectedCount: result.collectedCount, displayedCount: result.displayedCount, rounds: result.rounds, elapsedMs: now() - started });
            return { title: result.title, tracks: result.tracks.map(track => ({ ...track, artistReliable: true })) };
          }
          // A temporary scroll boundary does not establish that lazy loading is finished.
          if (snapshot.tracks.length) await page.evaluate(scrollPlaylist, 'spotify');
          const remaining = deadline - now();
          if (remaining > 0) await pause(Math.min(750, remaining));
        }
        const result = collector.result();
        if (!result.collectedCount) throw new AppError('SOURCE_UNREADABLE', 'No songs could be read from this Spotify playlist. Check that it is public; the page layout may also have changed.', 422);
        if (result.displayedCount === null) throw new AppError('SOURCE_INCOMPLETE', 'Spotify did not expose a reliable total track count, so this playlist could not be checked for completeness.', 422);
        throw new AppError('SOURCE_INCOMPLETE', 'Only part of the Spotify playlist or its artist information could be read. Try again with a smaller playlist.', 422);
      } catch (error) {
        const result = collector.result();
        const errorType = ['TimeoutError', 'ProtocolError', 'TargetCloseError', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'].includes(error?.name) ? error.name : 'Error';
        // Only fixed labels and counts: never raw errors, URLs, page contents or credentials.
        jobLog({ event: 'source_browser_failed', source: 'spotify', stage, errorType, collectedCount: result.collectedCount, displayedCount: result.displayedCount, elapsedMs: now() - started });
        if (error instanceof AppError) throw error;
        if (stage === 'launch') throw new AppError('BROWSER_START_FAILED', 'The playlist browser could not start. Please contact the application owner.', 503);
        if (errorType === 'TimeoutError') throw new AppError('SOURCE_TIMEOUT', 'The Spotify page could not be read within the time limit. Try again later.', 502);
        throw new AppError('SOURCE_UNAVAILABLE', 'The Spotify playlist reader encountered a browser error. Try again later or contact the application owner.', 502);
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    }
  };
}
