import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson } from '../src/http.mjs';
import { soundCloudApiProvider } from '../src/providers/soundcloud-api.mjs';
import { soundCloudBrowserProvider } from '../src/providers/soundcloud-browser.mjs';
import { youtubeProvider } from '../src/providers/youtube.mjs';

test('retries transient failures within a fixed attempt budget', async () => {
  let calls = 0;
  const waits = [];
  const result = await fetchJson('https://example.com/api', { fetchImpl: async () => ++calls < 3 ? new Response('{}', { status: 503 }) : Response.json({ ok: true }), wait: async ms => waits.push(ms) });
  assert.equal(result.ok, true);
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
  calls = 0;
  await assert.rejects(fetchJson('https://example.com/api', { fetchImpl: async () => { calls++; return new Response('{}', { status: 429 }); }, wait: async () => {} }), { code: 'UPSTREAM_RATE_LIMIT' });
  assert.equal(calls, 3);
});

test('reports quota errors without retrying or exposing upstream details', async () => {
  let calls = 0;
  await assert.rejects(fetchJson('https://example.com/api', { fetchImpl: async () => { calls++; return Response.json({ error: { message: 'private diagnostic', errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 }); } }), error => error.code === 'YOUTUBE_QUOTA_EXCEEDED' && !error.message.includes('private diagnostic'));
  assert.equal(calls, 1);
});

test('follows SoundCloud API redirects only within the explicit host allowlist', async () => {
  const seen = [];
  await fetchJson('https://api.soundcloud.com/resolve', { headers: { authorization: 'OAuth test-token' }, allowedRedirectHosts: ['api.soundcloud.com'], fetchImpl: async (url, options) => { seen.push({ url, auth: options.headers.authorization }); return seen.length === 1 ? new Response(null, { status: 302, headers: { location: '/playlists/123' } }) : Response.json({ kind: 'playlist' }); } });
  assert.equal(seen[1].url, 'https://api.soundcloud.com/playlists/123');
  let calls = 0;
  await assert.rejects(fetchJson('https://api.soundcloud.com/resolve', { allowedRedirectHosts: ['api.soundcloud.com'], fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://other.example/steal-token' } }); } }), { code: 'UPSTREAM_REDIRECT' });
  assert.equal(calls, 1);
});

test('redirect loops terminate', async () => {
  let calls = 0;
  await assert.rejects(fetchJson('https://api.soundcloud.com/resolve', { allowedRedirectHosts: ['api.soundcloud.com'], fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: '/resolve' } }); } }), { code: 'UPSTREAM_REDIRECT' });
  assert.equal(calls, 4);
});

test('SoundCloud API mode caches tokens and returns official track metadata', async () => {
  let tokenRequests = 0;
  const provider = soundCloudApiProvider({ clientId: 'test-client', clientSecret: 'test-secret', fetchImpl: async (url, options) => {
    if (url.includes('/oauth/token')) { tokenRequests++; assert.equal(options.method, 'POST'); return Response.json({ access_token: 'test-token', expires_in: 3600 }); }
    assert.equal(options.headers.authorization, 'OAuth test-token');
    return Response.json({ kind: 'playlist', title: 'API set', track_count: 1, tracks: [{ title: 'One', publisher_metadata: { artist: 'Artist' } }] });
  } });
  const first = await provider.readPlaylist('https://soundcloud.com/example/sets/test', 20);
  await provider.readPlaylist('https://soundcloud.com/example/sets/test', 20);
  assert.deepEqual(first.tracks, [{ title: 'One', artist: 'Artist' }]);
  assert.equal(tokenRequests, 1);
});

test('browser extraction closes Chromium when SoundCloud requests verification', async () => {
  let closed = false;
  const page = { setDefaultTimeout() {}, setRequestInterception: async () => {}, on() {}, goto: async () => ({ status: () => 200 }), url: () => 'https://soundcloud.com/example/sets/test', evaluate: async () => ({ blocked: true, tracks: [] }) };
  const provider = soundCloudBrowserProvider({ launchBrowser: async () => ({ newPage: async () => page, close: async () => { closed = true; } }) });
  await assert.rejects(provider.readPlaylist('https://soundcloud.com/example/sets/test', 20), { code: 'SOURCE_BLOCKED' });
  assert.equal(closed, true);
});

test('SoundCloud refreshes an expiring token once for concurrent requests', async () => {
  let time = 0;
  const grants = [];
  const provider = soundCloudApiProvider({ clientId: 'test-client', clientSecret: 'test-secret', now: () => time, fetchImpl: async (url, options) => {
    if (url.includes('/oauth/token')) {
      const fields = new URLSearchParams(options.body);
      grants.push(fields.get('grant_type'));
      if (grants.length === 2) assert.equal(fields.get('refresh_token'), 'test-refresh-1');
      return Response.json({ access_token: `test-access-${grants.length}`, refresh_token: `test-refresh-${grants.length}`, expires_in: 3600 });
    }
    return Response.json({ kind: 'playlist', track_count: 1, tracks: [{ title: 'One' }] });
  } });
  const read = () => provider.readPlaylist('https://soundcloud.com/example/sets/test', 20);
  await read();
  time = 3600000;
  await Promise.all([read(), read()]);
  assert.deepEqual(grants, ['client_credentials', 'refresh_token']);
});

test('YouTube adapter uses authenticated search and tolerates empty results', async () => {
  const received = [];
  const provider = youtubeProvider('test-api-key', { fetchImpl: async (url, options) => { received.push({ url, options }); return Response.json({ items: [] }); } });
  assert.equal(await provider.findMatch({ title: 'One', artist: 'Artist' }), null);
  assert.deepEqual(received.map(item => new URL(item.url).searchParams.get('q')), ['One Artist karaoke', 'One Artist karaoke lyrics']);
  assert.ok(received.every(item => Object.values(item.options.headers).includes('test-api-key')));
  assert.ok(received.every(item => !item.url.includes('test-api-key')));
});

test('YouTube fallback finds a missed match and stops after one successful search', async () => {
  const queries = [];
  const item = { id: { videoId: 'q4agmLDgRG0' }, snippet: { title: 'Black Sabbath - Paranoid (Karaoke Version)' } };
  const provider = youtubeProvider('test-key', { fetchImpl: async url => { queries.push(new URL(url).searchParams.get('q')); return Response.json({ items: queries.length === 1 ? [] : [item] }); } });
  const match = await provider.findMatch({ title: 'Paranoid (2012 - Remaster)', artist: 'Black Sabbath' });
  assert.equal(match.videoId, 'q4agmLDgRG0');
  assert.equal(match.searchAttempt, 2);
  assert.deepEqual(queries, ['Paranoid Black Sabbath karaoke', 'Paranoid Black Sabbath karaoke lyrics']);
  let firstSearchCalls = 0;
  const fast = youtubeProvider('test-key', { fetchImpl: async () => { firstSearchCalls++; return Response.json({ items: [item] }); } });
  assert.equal((await fast.findMatch({ title: 'Paranoid', artist: 'Black Sabbath' })).searchAttempt, 1);
  assert.equal(firstSearchCalls, 1);
});

test('YouTube does not make a fallback search after quota exhaustion', async () => {
  let calls = 0;
  const provider = youtubeProvider('test-key', { fetchImpl: async () => { calls++; return Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 }); } });
  await assert.rejects(provider.findMatch({ title: 'Paranoid', artist: 'Black Sabbath' }), { code: 'YOUTUBE_QUOTA_EXCEEDED' });
  assert.equal(calls, 1);
});
