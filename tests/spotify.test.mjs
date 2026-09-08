import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { get as httpGet } from 'node:http';
import { parseHTML } from 'linkedom';
import { spotifyBrowserProvider, spotifyRequestAllowed } from '../src/providers/spotify-browser.mjs';
import { extractSnapshot } from '../src/providers/public-playlist-dom.mjs';
import { createCollector } from '../src/providers/playlist-collector.mjs';
import { validatePlaylistUrl, makeJob, normalizeTracks, selectKaraokeMatch } from '../src/domain.mjs';
import { songSearchQueries, cleanSongTitle } from '../src/text.mjs';
import { runtimeOptions } from '../src/runtime.mjs';
import { MemoryStore } from '../src/store.mjs';
import { convertJob } from '../src/conversion.mjs';
import { createLocalServer } from '../local/server.mjs';
import { youtubeProvider } from '../src/providers/youtube.mjs';

const playlistUrl = 'https://open.spotify.com/playlist/30NcvL51dhP4HKscAuzKY7';
const fixture = JSON.parse(await readFile(new URL('./fixtures/spotify-other-songs.json', import.meta.url), 'utf8'));
const full = { ...fixture, gridFound: true };
function fakeBrowser(snapshots) {
  let reads = 0, closed = false;
  const page = {
    setDefaultTimeout() {}, async setExtraHTTPHeaders() {}, async setRequestInterception() {}, on() {},
    async goto() { return { status: () => 200 }; }, url() { return playlistUrl; },
    async evaluate(fn) { return fn.name === 'scrollPlaylist' ? { atEnd: true } : snapshots[Math.min(reads++, snapshots.length - 1)]; }
  };
  return { launchBrowser: async () => ({ newPage: async () => page, close: async () => { closed = true; } }), pause: async () => {}, log: () => {}, get reads() { return reads; }, get closed() { return closed; } };
}

test('Spotify URLs are canonicalized and stay bound to the chosen source', () => {
  assert.equal(validatePlaylistUrl(`${playlistUrl}?si=share`, 'spotify'), playlistUrl);
  assert.equal(validatePlaylistUrl(playlistUrl.replace('/playlist/', '/intl-en/playlist/'), 'spotify'), playlistUrl);
  for (const url of [playlistUrl.replace('open.spotify.com', 'open.spotify.com.evil.test'), `${playlistUrl}?access_token=private`, playlistUrl.replace('/playlist/', '/track/'), 'https://spotify.link/short', 'https://localhost/playlist/x', 'https://soundcloud.com/user/sets/list']) {
    assert.throws(() => validatePlaylistUrl(url, 'spotify'), { code: 'INVALID_URL' });
  }
  assert.throws(() => validatePlaylistUrl(playlistUrl, 'soundcloud'), { code: 'INVALID_URL' });
});

test('the actual Spotify DOM extractor ignores recommendation rows and title numbers', () => {
  const row = (position, title) => `<div role="row" aria-rowindex="${position + 1}"><a href="/track/1234567890123456789012">${title}</a><a href="/artist/1234567890123456789012">Artist</a></div>`;
  const { document } = parseHTML(`<html><body><main><h1>Top 50</h1><span>2 songs</span><div role="grid" aria-label="Top 50">${row(1, 'One')}${row(2, 'Two')}</div><div role="grid" aria-label="Recommended">${row(1, 'Wrong')}</div></main></body></html>`);
  const actual = vm.runInNewContext(`(${extractSnapshot.toString()})('spotify')`, { document, URL, location: { href: playlistUrl } });
  assert.equal(actual.declaredCount, 2);
  assert.equal(actual.tracks.length, 2);
  assert.equal(actual.tracks[1].title, 'Two');
});

test('Spotify reader collects virtualized rows in order, then closes the browser', async () => {
  const fake = fakeBrowser([{ ...full, tracks: [] }, { ...full, tracks: fixture.tracks.slice(0, 3) }, { ...full, tracks: fixture.tracks.slice(2) }]);
  const result = await spotifyBrowserProvider(fake).readPlaylist(playlistUrl, 20);
  assert.equal(result.tracks.length, 6);
  assert.deepEqual(result.tracks.map(t => t.position), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.tracks[2].artists, ['Mustard', 'Migos']);
  assert.ok(result.tracks.every(t => t.artistReliable));
  assert.equal(fake.closed, true);
});

test('Spotify reader rejects partial, unknown-count, oversized and challenged sources before searches', async () => {
  for (const [snapshot, code] of [
    [{ ...full, tracks: fixture.tracks.slice(0, 2) }, 'SOURCE_INCOMPLETE'],
    [{ ...full, declaredCount: null }, 'SOURCE_INCOMPLETE'],
    [{ ...full, declaredCount: 50 }, 'PLAYLIST_TOO_LARGE'],
    [{ ...full, blocked: true, tracks: [] }, 'SOURCE_BLOCKED'],
    [{ ...full, loginRequired: true, tracks: [] }, 'SOURCE_LOGIN_REQUIRED'],
    [{ ...full, tracks: fixture.tracks.map((t, i) => i ? t : { ...t, artists: [] }) }, 'SOURCE_INCOMPLETE']
  ]) {
    const fake = fakeBrowser([snapshot]);
    const store = new MemoryStore(); const job = makeJob(playlistUrl, Date.now(), 'Test', 'spotify'); await store.create(job);
    let searches = 0;
    await convertJob(job.id, { store, sources: { spotify: spotifyBrowserProvider(fake) }, youtube: { findMatch: async () => { searches++; } }, log: () => {} });
    assert.equal((await store.get(job.id)).error.code, code);
    assert.equal(searches, 0);
    assert.equal(fake.closed, true);
  }
});

test('collection preserves duplicated songs and detects changes at existing positions', () => {
  const collector = createCollector(null, 20);
  const first = fixture.tracks[0];
  collector.add({ ...full, declaredCount: 2, tracks: [first] });
  assert.equal(collector.add({ ...full, declaredCount: 2, tracks: [{ ...first, position: 2 }] }).status, 'COMPLETE_METADATA');
  assert.equal(collector.result().tracks.length, 2);
  assert.equal(collector.add({ ...full, declaredCount: 2, tracks: [{ ...first, title: 'Changed' }] }).status, 'INCONSISTENT_METADATA');
});

test('Spotify credits feed matching without treating with/feat credits as title identity', () => {
  const tracks = normalizeTracks(fixture.tracks.map(t => ({ ...t, artistReliable: true })));
  assert.equal(tracks[2].artist, 'Mustard, Migos');
  assert.deepEqual(songSearchQueries(tracks[2]), ['Pure Water Mustard karaoke', 'Pure Water Mustard karaoke lyrics']);
  assert.deepEqual(songSearchQueries(tracks[3]), ['Freddy Krueger YNW Melly karaoke', 'Freddy Krueger YNW Melly karaoke lyrics']);
  assert.equal(cleanSongTitle('(With or Without You)', ['U2']), '(With or Without You)');
  const item = title => ({ id: { videoId: 'fixture0001' }, snippet: { title } });
  assert.equal(selectKaraokeMatch(tracks[0], [item('Robbery - Wrong Artist Karaoke')]), null);
  assert.ok(selectKaraokeMatch(tracks[0], [item('Juice WRLD Robbery Karaoke')]));
  assert.ok(selectKaraokeMatch(tracks[2], [item('Pure Water - Migos Karaoke')]));
});

test('Spotify resource guard rejects private addresses, lookalikes and audio requests', () => {
  assert.equal(spotifyRequestAllowed('https://api-partner.spotify.com/example', 'fetch'), true);
  for (const url of ['http://open.spotify.com/', 'https://127.0.0.1/', 'https://169.254.169.254/', 'https://spotify.com.evil.test/']) assert.equal(spotifyRequestAllowed(url, 'fetch'), false);
  assert.equal(spotifyRequestAllowed('https://open.spotify.com/example', 'media'), false);
});

test('the default runtime enables SoundCloud and Spotify with the same 20-track cap', () => {
  const runtime = runtimeOptions({ YOUTUBE_API_KEY: 'fixture-key', MAX_TRACKS: '100' });
  assert.deepEqual(Object.keys(runtime.sources), ['soundcloud', 'spotify']);
  assert.equal(runtime.maxTracks, 20);
  assert.deepEqual(Object.keys(runtimeOptions({ YOUTUBE_API_KEY: 'fixture-key' }, { enabledSources: ['spotify'] }).sources), ['spotify']);
});

test('Spotify accepts all 20 virtualized rows including duplicates and rejects 21 before YouTube', async () => {
  const tracks = Array.from({ length: 20 }, (_, i) => ({ ...fixture.tracks[i % fixture.tracks.length], position: i + 1 }));
  const snapshot = { ...full, declaredCount: 20, tracks };
  const fake = fakeBrowser([0, 5, 10, 15].map(start => ({ ...snapshot, tracks: tracks.slice(start, start + 5) })));
  const result = await spotifyBrowserProvider(fake).readPlaylist(playlistUrl, 20);
  assert.deepEqual(result.tracks.map(track => track.position), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual(result.tracks.map(track => track.title), tracks.map(track => track.title));
  assert.equal(result.tracks[0].url, result.tracks[6].url);
  assert.ok(fake.closed);

  const store = new MemoryStore();
  const job = makeJob(playlistUrl, Date.now(), 'Over limit', 'spotify');
  await store.create(job);
  let searches = 0;
  const oversized = fakeBrowser([{ ...snapshot, declaredCount: 21 }]);
  await convertJob(job.id, { store, sources: { spotify: spotifyBrowserProvider(oversized) }, youtube: { findMatch: async () => { searches++; } }, log: () => {} });
  assert.equal((await store.get(job.id)).error.code, 'PLAYLIST_TOO_LARGE');
  assert.equal(searches, 0);
  assert.ok(oversized.closed);
});

test('Spotify waits for delayed rows at a temporary scroll boundary', async () => {
  const partial = { ...full, tracks: fixture.tracks.slice(0, 2) };
  const fake = fakeBrowser([...Array(16).fill(partial), full]);
  const result = await spotifyBrowserProvider(fake).readPlaylist(playlistUrl, 20);
  assert.equal(result.tracks.length, 6);
  assert.ok(fake.reads >= 19);
  assert.ok(fake.closed);
});

test('Spotify ends incomplete reads within its collection budget and logs only safe counts', async () => {
  const fake = fakeBrowser([{ ...full, tracks: fixture.tracks.slice(0, 2) }]);
  const logs = [];
  let time = 0;
  const provider = spotifyBrowserProvider({ ...fake, now: () => time, pause: async ms => { time += ms + 5000; }, log: entry => logs.push(entry) });
  await assert.rejects(provider.readPlaylist(playlistUrl, 20), { code: 'SOURCE_INCOMPLETE' });
  assert.ok(fake.reads < 100);
  assert.ok(time >= 75000);
  assert.ok(fake.closed);
  assert.equal(logs[0].stage, 'extract');
  assert.equal(logs[0].collectedCount, 2);
  assert.equal(logs[0].displayedCount, 6);
  assert.doesNotMatch(JSON.stringify(logs), /Other Songs|Robbery|https:/);
});

test('local session and real conversion modules route both sources and protect owner credentials', async t => {
  const fake = fakeBrowser([full]);
  const calls = [];
  const candidates = ['Juice WRLD - Robbery Karaoke', 'Lil Mosey - Noticed Karaoke', 'Mustard & Migos - Pure Water Karaoke', 'YNW Melly - Freddy Krueger Karaoke', 'Lil Tecca - Ransom Karaoke', "21 Savage - can't leave without it Karaoke"];
  const ownerKey = 'fixture-owner-key-not-public';
  const server = createLocalServer({ config: { YOUTUBE_API_KEY: ownerKey }, runtime: {
    sources: { spotify: spotifyBrowserProvider(fake), soundcloud: { readPlaylist: async () => ({ title: 'SoundCloud fixture', tracks: [{ title: 'Robbery', artist: 'Juice WRLD' }] }) } },
    youtube: youtubeProvider(ownerKey, { fetchImpl: async url => {
      calls.push(new URL(url).searchParams.get('q'));
      return Response.json({ items: candidates.map((title, i) => ({ id: { videoId: `fixture000${i + 1}` }, snippet: { title, channelTitle: 'Fixture channel' } })) });
    } })
  }, log: () => {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.authentication, 'local-session'); assert.equal(health.configured, true);
  assert.equal((await fetch(`${base}/api/session`, { headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/session`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    httpGet(`${base}/api/session`, { headers: { Host: 'other.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal((await fetch(`${base}/api/conversions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'spotify', url: playlistUrl }) })).status, 401);
  const session = await (await fetch(`${base}/api/session`)).json();
  assert.ok(session.token.length >= 16);
  assert.ok(!JSON.stringify([health, session]).includes(ownerKey));
  const headers = { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' };
  for (const source of ['spotify', 'soundcloud']) {
    const response = await fetch(`${base}/api/conversions`, { method: 'POST', headers, body: JSON.stringify({ source, url: source === 'spotify' ? playlistUrl : 'https://soundcloud.com/example/sets/test', playlistName: 'Friday set' }) });
    assert.equal(response.status, 202);
    const accepted = await response.json(); let job;
    for (let attempt = 0; attempt < 30; attempt++) {
      job = await (await fetch(`${base}${accepted.statusUrl}`, { headers })).json();
      if (['COMPLETE', 'PARTIAL', 'FAILED'].includes(job.status)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'COMPLETE'); assert.equal(job.source, source); assert.equal(job.playlistName, 'Friday set');
    assert.equal(job.total, source === 'spotify' ? 6 : 1);
    if (source === 'spotify') assert.equal(job.playlistUrl, 'https://www.youtube.com/watch_videos?video_ids=fixture0001,fixture0002,fixture0003,fixture0004,fixture0005,fixture0006');
  }
  const before = calls.length;
  for (const body of [{ source: 'soundcloud', url: playlistUrl }, { source: 'other', url: playlistUrl }]) assert.equal((await fetch(`${base}/api/conversions`, { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
  assert.equal(calls.length, before);
  assert.equal(fake.closed, true);
});
