import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.mjs';
import { makeJob } from '../src/domain.mjs';
import { MemoryStore } from '../src/store.mjs';
import { createLocalServer } from '../local/server.mjs';
const accessCode = 'test-access-code-123456';
const authorization = `Bearer ${accessCode}`;

test('unauthorized requests cannot create jobs or enqueue work', async () => {
  let queued = 0;
  const api = createApi({ store: new MemoryStore(), accessCode, enqueue: async () => { queued++; }, log: () => {} });
  const result = await api({ method: 'POST', path: '/api/conversions', authorization: 'Bearer wrong', body: { url: 'https://soundcloud.com/example/sets/test' } });
  assert.equal(result.status, 401);
  assert.equal(queued, 0);
});

test('each submission returns its own status URL and hides its processing lease', async () => {
  const store = new MemoryStore();
  const queued = [];
  const api = createApi({ store, accessCode, enqueue: async id => queued.push(id), log: () => {} });
  const request = { method: 'POST', path: '/api/conversions', authorization, body: { url: 'https://soundcloud.com/example/sets/test' } };
  const first = await api(request), second = await api(request);
  assert.equal(first.status, 202);
  assert.notEqual(first.data.id, second.data.id);
  assert.equal((await store.get(first.data.id)).playlistName, 'KaraokePlaylist');
  await store.claim(first.data.id);
  const status = await api({ method: 'GET', path: first.data.statusUrl, authorization });
  assert.equal(status.data.id, first.data.id);
  assert.ok(!('leaseUntil' in status.data));
  assert.equal(queued.length, 2);
});

test('expired results are unavailable even before DynamoDB physically removes them', async () => {
  const store = new MemoryStore();
  const job = makeJob('https://soundcloud.com/example/sets/test', Date.now() - 90000000);
  await store.create(job);
  const api = createApi({ store, accessCode, enqueue: async () => {} });
  assert.equal((await api({ method: 'GET', path: `/api/conversions/${job.id}`, authorization })).status, 404);
});

test('failed queue submission returns an error instead of a false acceptance', async () => {
  const store = new MemoryStore();
  let id;
  const api = createApi({ store, accessCode, enqueue: async jobId => { id = jobId; throw new Error('private queue diagnostic'); } });
  const result = await api({ method: 'POST', path: '/api/conversions', authorization, body: { url: 'https://soundcloud.com/example/sets/test' } });
  assert.equal(result.status, 503);
  assert.equal((await store.get(id)).status, 'FAILED');
  assert.doesNotMatch(JSON.stringify(result), /private queue diagnostic/);
});

test('local HTTP integration serves the website and completes an isolated conversion with provider fixtures', async t => {
  const server = createLocalServer({ config: { APP_ACCESS_CODE: accessCode }, runtime: { source: { readPlaylist: async () => ({ title: 'Fixture playlist', tracks: [{ title: 'Fixture song' }] }) }, youtube: { findMatch: async () => ({ videoId: 'q4agmLDgRG0', title: 'Fixture song karaoke', channel: 'Fixture channel', reviewNeeded: true }) } }, log: () => {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(base)).text(), /KaraokeKonverter/);
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  const response = await fetch(`${base}/api/conversions`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://soundcloud.com/example/sets/test', playlistName: '  Friday karaoke  ' }) });
  assert.equal(response.status, 202);
  const job = await response.json();
  let result;
  for (let attempt = 0; attempt < 30; attempt++) {
    result = await (await fetch(`${base}${job.statusUrl}`, { headers: { authorization } })).json();
    if (result.status === 'COMPLETE') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.playlistName, 'Friday karaoke');
  assert.equal(result.title, 'Friday karaoke');
  assert.equal(result.sourceTitle, 'Fixture playlist');
  assert.equal(result.playlistUrl, 'https://www.youtube.com/watch_videos?video_ids=q4agmLDgRG0');
  const malformed = await fetch(`${base}/api/conversions`, { method: 'POST', headers: { authorization }, body: '{' });
  assert.equal(malformed.status, 400);
});

test('invalid playlist names do not enqueue work', async () => {
  let queued = 0;
  const api = createApi({ store: new MemoryStore(), accessCode, enqueue: async () => { queued++; } });
  for (const playlistName of [100, 'x'.repeat(101)]) {
    const result = await api({ method: 'POST', path: '/api/conversions', authorization, body: { url: 'https://soundcloud.com/example/sets/test', playlistName } });
    assert.equal(result.status, 400);
    assert.equal(result.data.error.code, 'INVALID_NAME');
  }
  assert.equal(queued, 0);
});
