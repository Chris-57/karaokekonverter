import test from 'node:test';
import assert from 'node:assert/strict';
import { createAwsApiHandler } from '../src/aws/api-handler.mjs';
import { createAwsWorkerHandler } from '../src/aws/worker-handler.mjs';
import { runtimeOptions } from '../src/runtime.mjs';
import { MemoryStore } from '../src/store.mjs';
import { AppError } from '../src/domain.mjs';

const config = { APP_ACCESS_CODE: 'fixture-aws-access-code', YOUTUBE_API_KEY: 'fixture-owner-key', SOUNDCLOUD_MODE: 'browser', MAX_TRACKS: '100' };
const urls = { soundcloud: 'https://soundcloud.com/example/sets/test', spotify: 'https://open.spotify.com/playlist/1234567890123456789012' };
const event = (method, path, body, code = config.APP_ACCESS_CODE) => ({ requestContext: { http: { method } }, rawPath: path, headers: { authorization: `Bearer ${code}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
const log = () => {};

test('AWS health, accepted source and worker route agree for both providers; duplicate delivery does no new work', async () => {
  const store = new MemoryStore();
  const queued = [], reads = [], searches = [];
  const loadConfig = async () => config;
  const api = createAwsApiHandler({ store, loadConfig, enqueue: async id => queued.push(id), log });
  const worker = createAwsWorkerHandler({ store, loadConfig, log, buildRuntime: value => {
    const options = runtimeOptions(value);
    // Replace external provider operations only; use the real AWS handler, runtime,
    // API routing, conversion, claim and status code with an in-memory test store.
    for (const [source, provider] of Object.entries(options.sources)) provider.readPlaylist = async (url, maxTracks) => {
      assert.equal(url, urls[source]);
      assert.equal(maxTracks, 20);
      reads.push(source);
      return { title: `${source} fixture`, tracks: [{ title: 'One', artist: 'Artist' }, { title: 'Two', artist: 'Artist' }] };
    };
    options.youtube.findMatch = async track => {
      searches.push(track.title);
      return { videoId: track.title === 'One' ? 'fixture0001' : 'fixture0002', title: `${track.title} karaoke`, channel: 'Fixture' };
    };
    return options;
  } });
  const healthResponse = await api(event('GET', '/api/health', undefined, 'wrong'));
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(healthResponse.headers['cache-control'], 'no-store');
  const health = JSON.parse(healthResponse.body);
  assert.equal(health.version, '0.3.0');
  assert.equal(health.configured, true);
  assert.equal(health.authentication, 'access-code');
  assert.equal(health.maxTracks, 20);
  assert.deepEqual(health.sources, ['soundcloud', 'spotify']);
  assert.deepEqual(health.sourceReady, { soundcloud: true, spotify: true });
  assert.doesNotMatch(healthResponse.body, /fixture-owner-key|fixture-aws-access-code/);

  for (const source of health.sources) {
    const rejected = await api(event('POST', '/api/conversions', { source, url: urls[source] }, 'wrong'));
    assert.equal(rejected.statusCode, 401);
    assert.equal(queued.length, reads.length);
    const accepted = await api(event('POST', '/api/conversions', { source, url: urls[source], playlistName: 'Cloud set' }));
    assert.equal(accepted.statusCode, 202);
    const job = JSON.parse(accepted.body);
    assert.equal(queued.at(-1), job.id);
    const delivery = { Records: [{ messageId: `fixture-${source}`, body: JSON.stringify({ id: job.id }) }] };
    assert.deepEqual(await worker(delivery), { batchItemFailures: [] });
    const status = JSON.parse((await api(event('GET', job.statusUrl))).body);
    assert.equal(status.status, 'COMPLETE');
    assert.equal(status.source, source);
    assert.equal(status.sourceTitle, `${source} fixture`);
    assert.equal(status.playlistName, 'Cloud set');
    assert.equal(status.total, 2);
    assert.equal(status.processed, 2);
    assert.equal(status.playlistUrl, 'https://www.youtube.com/watch_videos?video_ids=fixture0001,fixture0002');
    assert.equal(status.leaseUntil, undefined);
    const calls = searches.length;
    assert.deepEqual(await worker(delivery), { batchItemFailures: [] });
    assert.equal(searches.length, calls);
  }
  assert.deepEqual(reads, ['soundcloud', 'spotify']);
  assert.deepEqual(searches, ['One', 'Two', 'One', 'Two']);
});

test('AWS source readiness keeps Spotify usable when optional SoundCloud API credentials are missing', async () => {
  const queued = [];
  const api = createAwsApiHandler({ store: new MemoryStore(), loadConfig: async () => ({ ...config, SOUNDCLOUD_MODE: 'api' }), enqueue: async id => queued.push(id), log });
  const health = JSON.parse((await api(event('GET', '/api/health'))).body);
  assert.equal(health.configured, true);
  assert.deepEqual(health.sourceReady, { soundcloud: false, spotify: true });
  const soundcloud = await api(event('POST', '/api/conversions', { source: 'soundcloud', url: urls.soundcloud }));
  assert.equal(soundcloud.statusCode, 503);
  assert.equal(JSON.parse(soundcloud.body).error.code, 'SOURCE_NOT_CONFIGURED');
  assert.doesNotMatch(soundcloud.body, /local setup/);
  assert.equal((await api(event('POST', '/api/conversions', { source: 'spotify', url: urls.spotify }))).statusCode, 202);
  assert.equal(queued.length, 1);
});

test('AWS rejects invalid source requests without queueing and exposes no local setup endpoints', async () => {
  const queued = [];
  const api = createAwsApiHandler({ store: new MemoryStore(), loadConfig: async () => config, enqueue: async id => queued.push(id), log });
  for (const body of [{ source: 'spotify', url: urls.soundcloud }, { source: 'apple', url: urls.spotify }]) {
    assert.equal((await api(event('POST', '/api/conversions', body))).statusCode, 400);
  }
  for (const path of ['/api/session', '/api/local/youtube']) assert.equal((await api(event('GET', path))).statusCode, 404);
  assert.equal(queued.length, 0);
});

test('AWS persists handled Spotify extraction failures and retries infrastructure failures only', async () => {
  const store = new MemoryStore();
  const loadConfig = async () => config;
  const api = createAwsApiHandler({ store, loadConfig, enqueue: async () => {}, log });
  let searches = 0;
  const worker = createAwsWorkerHandler({ store, loadConfig, log, buildRuntime: value => {
    const options = runtimeOptions(value);
    options.sources.spotify.readPlaylist = async () => { throw new AppError('SOURCE_INCOMPLETE', 'Only part of this playlist could be read.', 422); };
    options.youtube.findMatch = async () => { searches++; };
    return options;
  } });
  const accepted = JSON.parse((await api(event('POST', '/api/conversions', { source: 'spotify', url: urls.spotify }))).body);
  const outcome = await worker({ Records: [
    { messageId: 'handled', body: JSON.stringify({ id: accepted.id }) },
    { messageId: 'malformed', body: '{}' }
  ] });
  assert.deepEqual(outcome, { batchItemFailures: [{ itemIdentifier: 'malformed' }] });
  const status = JSON.parse((await api(event('GET', accepted.statusUrl))).body);
  assert.equal(status.status, 'FAILED');
  assert.equal(status.error.code, 'SOURCE_INCOMPLETE');
  assert.equal(searches, 0);
});
