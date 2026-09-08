import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { testYoutubeKey, youtubeProvider } from '../src/providers/youtube.mjs';
import { createLocalServer } from '../local/server.mjs';
import { saveLocalConfig, loadLocalConfig } from '../local/config.mjs';
import { makeJob } from '../src/domain.mjs';
import { MemoryStore } from '../src/store.mjs';
import { convertJob } from '../src/conversion.mjs';

const goodKey = 'fixture-accepted-youtube-key';
const badKey = 'fixture-rejected-youtube-key';
const replacementKey = 'fixture-replacement-youtube-key';
const rejection = (reason = 'API_KEY_INVALID', status = 400) => Response.json({ error: { message: `private diagnostic ${badKey}`, errors: [{ reason: 'badRequest' }], details: [{ reason, metadata: { consumer: 'private-project' } }] } }, { status });
const candidate = { id: { videoId: 'fixture0001' }, snippet: { title: 'Artist One Karaoke', channelTitle: 'Fixture' } };
const searchFixture = async (_url, options) => options.headers['X-Goog-Api-Key'] === badKey ? rejection() : Response.json({ items: [candidate] });

async function start(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'karaoke-key-test-'));
  const settingsPath = join(root, 'config.json');
  const server = createLocalServer({ config: { CHROME_EXECUTABLE_PATH: '/fixture/chrome' }, settingsPath, verifyKey: key => testYoutubeKey(key, { fetchImpl: searchFixture }), log: () => {}, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(`${base}/api/session`)).json();
  const headers = { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' };
  const call = (path, body, extraHeaders = {}) => fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { base, call, root, settingsPath };
}

test('YouTube test makes one authenticated search, accepts empty results, and rejects malformed pasted input locally', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return Response.json({ items: [] }); };
  assert.equal((await testYoutubeKey(`  "${goodKey}"  `, { fetchImpl })).verified, true);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/youtube/v3/search');
  assert.equal(new URL(calls[0].url).searchParams.get('maxResults'), '1');
  assert.equal(calls[0].options.headers['X-Goog-Api-Key'], goodKey);
  assert.ok(!calls[0].url.includes(goodKey));
  for (const value of ['', '$env:YOUTUBE_API_KEY = wrong', 'a key with spaces', `first\n${goodKey}`]) await assert.rejects(testYoutubeKey(value, { fetchImpl }), { code: 'YOUTUBE_KEY_FORMAT' });
  assert.equal(calls.length, 1);
});

test('Google error reasons become specific safe diagnoses without retries or leaked diagnostics', async () => {
  for (const [reason, code, status = 403] of [
    ['API_KEY_INVALID', 'YOUTUBE_KEY_INVALID', 400], ['keyInvalid', 'YOUTUBE_KEY_INVALID', 400],
    ['SERVICE_DISABLED', 'YOUTUBE_API_DISABLED'], ['accessNotConfigured', 'YOUTUBE_API_DISABLED'],
    ['API_KEY_SERVICE_BLOCKED', 'YOUTUBE_API_RESTRICTED'], ['API_KEY_HTTP_REFERRER_BLOCKED', 'YOUTUBE_REFERRER_BLOCKED'],
    ['API_KEY_IP_ADDRESS_BLOCKED', 'YOUTUBE_IP_BLOCKED'], ['quotaExceeded', 'YOUTUBE_QUOTA_EXCEEDED'],
    ['dailyLimitExceeded', 'YOUTUBE_QUOTA_EXCEEDED'], ['forbidden', 'YOUTUBE_ACCESS_DENIED'],
    ['unknown', 'YOUTUBE_REQUEST_REJECTED', 400], ['rateLimitExceeded', 'YOUTUBE_RATE_LIMIT', 429]
  ]) {
    let calls = 0;
    await assert.rejects(testYoutubeKey(goodKey, { fetchImpl: async () => { calls++; return rejection(reason, status); } }), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /fixture-rejected|private diagnostic|private-project/);
      return true;
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(testYoutubeKey(goodKey, { fetchImpl: async () => { throw new Error(`connection failed ${goodKey}`); } }), { code: 'YOUTUBE_UNAVAILABLE' });
  await assert.rejects(testYoutubeKey(goodKey, { fetchImpl: async () => Response.json({ unexpected: true }) }), { code: 'YOUTUBE_RESPONSE' });
});

test('invalid YouTube key stops either source after one search and never becomes NO_MATCHES', async () => {
  for (const source of ['soundcloud', 'spotify']) {
    const store = new MemoryStore();
    const job = makeJob(source === 'spotify' ? 'https://open.spotify.com/playlist/30NcvL51dhP4HKscAuzKY7' : 'https://soundcloud.com/example/sets/test', Date.now(), 'Test', source);
    await store.create(job); let calls = 0;
    await convertJob(job.id, { store, sources: { [source]: { readPlaylist: async () => ({ title: 'Fixture', tracks: ['One', 'Two', 'Three'].map(title => ({ title })) }) } }, youtube: youtubeProvider(badKey, { fetchImpl: async () => { calls++; return rejection(); } }), log() {} });
    const finished = await store.get(job.id);
    assert.equal(calls, 1); assert.equal(finished.error.code, 'YOUTUBE_KEY_INVALID');
    assert.deepEqual(finished.results.map(track => track.status), ['ERROR', 'SKIPPED', 'SKIPPED']);
    assert.equal(finished.playlistUrl, null);
  }
});

test('local key setup gates conversions, preserves keys on rejection/save failure and updates searches without restarting', async t => {
  const conversionKeys = [];
  const instance = await start(t, {
    persistConfig: async (path, config) => {
      if (config.YOUTUBE_API_KEY === 'fixture-save-failure-key') throw new Error('private disk diagnostic');
      await saveLocalConfig(path, config);
    },
    buildRuntime: config => ({ sources: { soundcloud: { readPlaylist: async () => ({ tracks: [{ title: 'One', artist: 'Artist' }] }) } }, youtube: youtubeProvider(config.YOUTUBE_API_KEY, { fetchImpl: async (url, options) => { conversionKeys.push(options.headers['X-Goog-Api-Key']); return searchFixture(url, options); } }) })
  });
  const { call, settingsPath, root } = instance;
  const submission = { source: 'soundcloud', url: 'https://soundcloud.com/example/sets/test' };
  assert.equal((await (await call('/api/health')).json()).configured, false);
  assert.equal((await call('/api/conversions', submission)).status, 503);
  assert.equal((await call('/api/local/youtube', { apiKey: badKey })).status, 422);
  await assert.rejects(readFile(settingsPath), { code: 'ENOENT' });
  assert.equal((await call('/api/local/youtube', { apiKey: goodKey })).status, 200);
  assert.equal((await (await call('/api/health')).json()).configured, true);
  for (const key of [goodKey, replacementKey]) {
    if (key === replacementKey) assert.equal((await call('/api/local/youtube', { apiKey: key })).status, 200);
    const accepted = await (await call('/api/conversions', submission)).json();
    let job;
    for (let i = 0; i < 30; i++) {
      job = await (await call(accepted.statusUrl)).json();
      if (job.status === 'COMPLETE') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(job.status, 'COMPLETE');
  }
  assert.deepEqual(conversionKeys, [goodKey, replacementKey]);
  for (const [apiKey, status] of [[badKey, 422], ['fixture-save-failure-key', 500]]) {
    const response = await call('/api/local/youtube', { apiKey });
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes('private disk'));
    assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).YOUTUBE_API_KEY, replacementKey);
    assert.equal((await (await call('/api/health')).json()).configured, true);
  }
  const statusText = await (await call('/api/local/youtube')).text();
  assert.ok(!statusText.includes(replacementKey));
  assert.equal((await call('/api/local/youtube', {})).status, 200);
  const restored = await loadLocalConfig({ settingsPath, projectRoot: root, env: { YOUTUBE_API_KEY: badKey }, detectBrowser: async () => '/fixture/chrome' });
  assert.equal(restored.config.YOUTUBE_API_KEY, replacementKey);
});

test('unauthorized and cross-site setup requests do not test or save keys', async t => {
  let calls = 0;
  const { call } = await start(t, { verifyKey: async () => { calls++; } });
  assert.equal((await call('/api/local/youtube', { apiKey: goodKey }, { authorization: '' })).status, 401);
  assert.equal((await call('/api/local/youtube', { apiKey: goodKey }, { origin: 'https://other.example' })).status, 403);
  assert.equal((await call('/api/local/youtube', { apiKey: goodKey }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call('/api/local/youtube', { apiKey: goodKey }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal(calls, 0);
});

test('a later YouTube rejection remains readable after readiness is revoked and blocks the next conversion', async t => {
  let calls = 0;
  const { call } = await start(t, { buildRuntime: () => ({ sources: { soundcloud: { readPlaylist: async () => ({ tracks: [{ title: 'One' }, { title: 'Two' }] }) } }, youtube: youtubeProvider(goodKey, { fetchImpl: async () => { calls++; return rejection('API_KEY_SERVICE_BLOCKED', 403); } }) }) });
  assert.equal((await call('/api/local/youtube', { apiKey: goodKey })).status, 200);
  const submission = { url: 'https://soundcloud.com/example/sets/test' };
  const accepted = await (await call('/api/conversions', submission)).json();
  let finished;
  for (let i = 0; i < 30; i++) {
    const response = await call(accepted.statusUrl);
    assert.equal(response.status, 200);
    finished = await response.json();
    if (finished.status === 'FAILED') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(finished.error.code, 'YOUTUBE_API_RESTRICTED');
  assert.equal(calls, 1);
  assert.equal((await (await call('/api/health')).json()).configured, false);
  assert.equal((await call('/api/conversions', submission)).status, 503);
  assert.equal((await call(accepted.statusUrl)).status, 200);
});

test('concurrent connection tests cannot race or enqueue a conversion while saving', async t => {
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const entry = new Promise(resolve => { entered = resolve; });
  const { call } = await start(t, { verifyKey: async () => { calls++; entered(); await gate; return { verified: true, checkedAt: '2026-09-07T00:00:00Z' }; } });
  const first = call('/api/local/youtube', { apiKey: goodKey });
  await entry;
  assert.equal((await call('/api/local/youtube', { apiKey: replacementKey })).status, 409);
  assert.equal((await call('/api/conversions', { url: 'https://soundcloud.com/example/sets/test' })).status, 503);
  release(); assert.equal((await first).status, 200); assert.equal(calls, 1);
});

test('visible setup form displays failure then saves successfully and enables conversion without reload', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  const { document, window } = parseHTML(html);
  let verified = false; const posts = [];
  const fetchImpl = async (path, options = {}) => {
    if (path === '/api/health') return Response.json({ configured: verified, sources: ['soundcloud', 'spotify'], sourceReady: { soundcloud: true, spotify: true }, authentication: 'local-session' });
    if (path === '/api/session') return Response.json({ token: 'fixture-local-session-token' });
    assert.equal(options.headers.authorization, 'Bearer fixture-local-session-token');
    assert.equal(path, '/api/local/youtube');
    if (options.method === 'POST') {
      const { apiKey } = JSON.parse(options.body); posts.push(apiKey);
      if (apiKey === badKey) return Response.json({ error: { code: 'YOUTUBE_KEY_INVALID', message: 'YouTube rejected the API key.' } }, { status: 422 });
      verified = true;
      return Response.json({ message: 'YouTube search works. Key saved and ready to use.' });
    }
    return Response.json({ verified, keyConfigured: verified });
  };
  vm.runInNewContext(script, { document, URL, fetch: fetchImpl, AbortSignal, navigator: {}, setTimeout, clearTimeout });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush(); await flush();
  assert.equal(document.querySelector('#youtube-setup').hidden, false);
  assert.equal(document.querySelector('#youtube-setup').open, true);
  assert.equal(document.querySelector('#submit-button').disabled, true);
  assert.equal(document.querySelector('#youtube-key').type, 'text');
  for (const key of [badKey, goodKey]) {
    document.querySelector('#youtube-key').value = key;
    document.querySelector('#youtube-key').dispatchEvent(new window.Event('input'));
    document.querySelector('#youtube-key-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush(); await flush();
    assert.equal(document.querySelector('#submit-button').disabled, key === badKey);
    assert.match(document.querySelector('#youtube-key-message').textContent, key === badKey ? /YOUTUBE_KEY_INVALID/ : /Key saved/);
  }
  assert.deepEqual(posts, [badKey, goodKey]);
  assert.equal(document.querySelector('#youtube-key').value, '');
  assert.equal(document.querySelector('#test-current-key').hidden, false);
});
