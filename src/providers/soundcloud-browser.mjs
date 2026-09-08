import { AppError, validatePlaylistUrl } from '../domain.mjs';
import { launchPlaylistBrowser } from './browser-runtime.mjs';

export function soundCloudBrowserProvider({ executablePath = process.env.CHROME_EXECUTABLE_PATH, launchBrowser, log = entry => console.log(JSON.stringify(entry)) } = {}) {
  return {
    async readPlaylist(url, maxTracks, { log: jobLog = log } = {}) {
      const canonical = validatePlaylistUrl(url);
      let browser;
      let stage = 'launch';
      const started = Date.now();
      try {
        if (launchBrowser) browser = await launchBrowser();
        else browser = await launchPlaylistBrowser({ executablePath });
        stage = 'prepare';
        const page = await browser.newPage();
        page.setDefaultTimeout(20000);
        await page.setRequestInterception(true);
        page.on('request', request => {
          let allowed = false;
          try {
            const target = new URL(request.url());
            allowed = target.protocol === 'https:' && !target.port && ['soundcloud.com', 'sndcdn.com'].some(host => target.hostname === host || target.hostname.endsWith(`.${host}`));
          } catch { /* Malformed requests are blocked. */ }
          if (['image', 'media', 'font'].includes(request.resourceType())) allowed = false;
          void (allowed ? request.continue() : request.abort()).catch(() => {});
        });
        stage = 'navigate';
        const response = await page.goto(canonical, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!response || response.status() >= 400) {
          const contentUnavailable = [401, 404, 410].includes(response?.status());
          throw new AppError(contentUnavailable ? 'PLAYLIST_UNAVAILABLE' : 'SOURCE_UNAVAILABLE', 'SoundCloud could not serve this public playlist. Check its availability and try again later.', contentUnavailable ? 422 : 502);
        }
        validatePlaylistUrl(page.url());
        stage = 'extract';
        let previousCount = -1;
        let stableRounds = 0;
        let snapshot;
        for (let round = 0; round < 24; round++) {
          snapshot = await page.evaluate(() => {
            const pageText = document.body?.innerText || '';
            if (/verify (?:that )?you are human|checking your browser|unusual traffic|automated requests|captcha/i.test(pageText.slice(0, 8000))) return { blocked: true, tracks: [] };
            const rows = Array.from(document.querySelectorAll('.trackItem'));
            const tracks = rows.map(row => {
              const name = row.querySelector('.trackItem__trackTitle, .trackItem__content a.sc-link-dark');
              const uploader = row.querySelector('.trackItem__username, .trackItem__content a.sc-link-light');
              return name ? { title: name.textContent.trim(), artist: uploader?.textContent.trim() || '' } : null;
            }).filter(Boolean);
            // Read the public page's structured track list if the visual list is absent.
            if (!tracks.length) {
              for (const element of document.querySelectorAll('script[type="application/ld+json"]')) {
                try {
                  const parsed = JSON.parse(element.textContent);
                  const objects = Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed];
                  const playlist = objects.find(value => value['@type'] === 'MusicPlaylist');
                  const entries = playlist?.track?.itemListElement || playlist?.track || playlist?.itemListElement || [];
                  if (Array.isArray(entries)) for (const entry of entries) {
                    const item = entry.item || entry;
                    if (item.name) tracks.push({ title: item.name, artist: item.byArtist?.name || '' });
                  }
                } catch { /* Non-playlist structured data can be ignored. */ }
              }
            }
            const title = document.querySelector('h1')?.innerText || document.title;
            const countText = document.querySelector('.playlistDetails__trackCount')?.textContent || '';
            const declaredCount = Number((countText.match(/\d+/) || [0])[0]);
            const scrolling = document.scrollingElement || document.documentElement;
            scrolling.scrollBy(0, 800);
            return { title, tracks, declaredCount, blocked: false };
          });
          if (snapshot.blocked) throw new AppError('SOURCE_BLOCKED', 'SoundCloud is requesting verification. This version cannot read that page automatically.', 422);
          if (snapshot.tracks.length > maxTracks || snapshot.declaredCount > maxTracks) throw new AppError('PLAYLIST_TOO_LARGE', `This version supports up to ${maxTracks} tracks.`, 422);
          stableRounds = snapshot.tracks.length === previousCount && snapshot.tracks.length > 0 ? stableRounds + 1 : 0;
          previousCount = snapshot.tracks.length;
          if (stableRounds >= 5 && (!snapshot.declaredCount || snapshot.tracks.length >= snapshot.declaredCount)) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!snapshot?.tracks.length) throw new AppError('SOURCE_LAYOUT_CHANGED', 'No tracks could be read. Check that the playlist is public; SoundCloud may also have changed its page layout.', 422);
        if (snapshot.declaredCount && snapshot.tracks.length < snapshot.declaredCount) throw new AppError('SOURCE_INCOMPLETE', 'Only part of the playlist could be read. Try a smaller playlist.', 422);
        return { title: snapshot.title, tracks: snapshot.tracks };
      } catch (error) {
        if (error instanceof AppError) throw error;
        const errorType = ['TimeoutError', 'ProtocolError', 'TargetCloseError', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'].includes(error?.name) ? error.name : 'Error';
        // Fixed fields only: raw browser errors can include page content or URLs.
        jobLog({ event: 'source_browser_failed', source: 'soundcloud', stage, errorType, elapsedMs: Date.now() - started });
        if (stage === 'launch') throw new AppError('BROWSER_START_FAILED', 'The playlist browser could not start. Please contact the application owner.', 503);
        if (errorType === 'TimeoutError') throw new AppError('SOURCE_TIMEOUT', 'The SoundCloud page could not be read within the time limit. Try again later.', 502);
        throw new AppError('SOURCE_UNAVAILABLE', 'The SoundCloud playlist reader encountered an error. Please try again later.', 502);
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    }
  };
}
