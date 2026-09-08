import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, makeJob } from '../src/domain.mjs';
import { MemoryStore } from '../src/store.mjs';
import { convertJob } from '../src/conversion.mjs';
import { structuredLog, isOperationalFailure } from '../src/observability.mjs';
import { createAwsApiHandler } from '../src/aws/api-handler.mjs';
import { createAwsWorkerHandler } from '../src/aws/worker-handler.mjs';
import { createMonitor } from '../monitoring/handler.mjs';
import { soundCloudBrowserProvider } from '../src/providers/soundcloud-browser.mjs';
import { spotifyBrowserProvider } from '../src/providers/spotify-browser.mjs';

test('provider HTTP outages and rate limits page the operator while missing playlists do not', async () => {
  for (const [factory, url] of [[soundCloudBrowserProvider, 'https://soundcloud.com/example/sets/test'], [spotifyBrowserProvider, 'https://open.spotify.com/playlist/1234567890123456789012']]) {
    for (const status of [401, 404, 410, 403, 429, 500, 503]) {
      let closed = false;
      const page = { setDefaultTimeout() {}, setRequestInterception: async () => {}, setExtraHTTPHeaders: async () => {}, on() {}, goto: async () => ({ status: () => status }) };
      const provider = factory({ log: () => {}, launchBrowser: async () => ({ newPage: async () => page, close: async () => { closed = true; } }) });
      await assert.rejects(provider.readPlaylist(url, 20), error => {
        assert.equal(isOperationalFailure(error.code), ![401, 404, 410].includes(status));
        return true;
      });
      assert.equal(closed, true);
    }
  }
});

test('monitoring separates normal content outcomes from provider or system faults', () => {
  for (const code of ['NO_MATCHES', 'PLAYLIST_TOO_LARGE', 'EMPTY_PLAYLIST', 'PLAYLIST_UNAVAILABLE', 'SOURCE_LOGIN_REQUIRED', 'UNAUTHORIZED']) assert.equal(isOperationalFailure(code), false, code);
  for (const code of ['SOURCE_TIMEOUT', 'SOURCE_INCOMPLETE', 'SOURCE_LAYOUT_CHANGED', 'SOURCE_BLOCKED', 'YOUTUBE_QUOTA_EXCEEDED', 'YOUTUBE_KEY_INVALID', 'INTERNAL_ERROR', 'NEW_UNKNOWN_FAILURE']) assert.equal(isOperationalFailure(code), true, code);
});

test('terminal metrics retain both sources, counts and quota failures in partial results without duplicate outcomes', async () => {
  for (const source of ['soundcloud', 'spotify']) {
    for (const scenario of ['complete', 'partial', 'no-matches', 'quota', 'oversize', 'timeout']) {
      const store = new MemoryStore();
      const url = source === 'soundcloud' ? 'https://soundcloud.com/example/sets/test' : 'https://open.spotify.com/playlist/1234567890123456789012';
      const job = makeJob(url, Date.now() - 1000, 'Fixture', source);
      await store.create(job);
      const logs = [];
      let calls = 0;
      const reader = { readPlaylist: async (_url, _limit, { log }) => {
        log({ event: 'source_playlist_read', collectedCount: 2 });
        if (scenario === 'oversize') throw new AppError('PLAYLIST_TOO_LARGE', 'Limit', 422);
        if (scenario === 'timeout') throw new AppError('SOURCE_TIMEOUT', 'Timeout', 502);
        return { tracks: [{ title: 'One' }, { title: 'Two' }] };
      } };
      const options = { store, sources: { [source]: reader }, log: entry => logs.push(entry), youtube: { findMatch: async () => {
        calls++;
        if (scenario === 'quota' && calls === 2) throw new AppError('YOUTUBE_QUOTA_EXCEEDED', 'Quota', 503);
        if (scenario === 'no-matches' || (scenario === 'partial' && calls === 2)) return null;
        return { videoId: 'fixture0001' };
      } } };
      await convertJob(job.id, options);
      await convertJob(job.id, options);
      const outcomes = logs.filter(entry => entry.outcome === 1);
      assert.equal(outcomes.length, 1);
      const terminal = outcomes[0];
      assert.equal(terminal.source, source);
      assert.equal(terminal.jobId, job.id);
      assert.equal(terminal.operationalFailure, Number(['quota', 'timeout'].includes(scenario)));
      assert.equal(terminal.completedJobs + terminal.partialJobs + terminal.failedJobs, 1);
      assert.equal(terminal.status, (await store.get(job.id)).status);
      if (scenario === 'quota') { assert.equal(terminal.partialJobs, 1); assert.equal(terminal.matched, 1); assert.equal(terminal.code, 'YOUTUBE_QUOTA_EXCEEDED'); }
      assert.ok(logs.find(entry => entry.event === 'conversion_started').queueWaitMs >= 1000);
      assert.equal(logs.find(entry => entry.event === 'source_playlist_read').jobId, job.id);
      assert.equal(logs.filter(entry => entry.event === 'conversion_started').length, 1);
    }
  }
});

test('failed persistence emits an infrastructure fault and retains SQS retry behavior', async () => {
  const logs = [];
  const id = '00000000-0000-4000-a000-000000000000';
  const worker = createAwsWorkerHandler({ store: { claim: async () => { throw new Error('private DB details'); } }, loadConfig: async () => ({}), buildRuntime: () => ({}), log: entry => logs.push(entry) });
  assert.deepEqual(await worker({ Records: [{ messageId: 'msg-1', attributes: { ApproximateReceiveCount: '2' }, body: JSON.stringify({ id }) }] }, { awsRequestId: 'request-1' }), { batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
  assert.equal(logs.filter(entry => entry.operationalFailure === 1).length, 1);
  assert.equal(logs[0].receiveCount, 2);
  assert.equal(logs[0].requestId, 'request-1');
  assert.equal(logs[0].jobId, id);
  assert.doesNotMatch(JSON.stringify(logs), /private DB details/);
  assert.equal(logs.some(entry => entry.outcome === 1), false);
});

test('API monitoring catches handled 503s but excludes bad credentials, JSON and oversized requests', async () => {
  const config = { APP_ACCESS_CODE: 'fixture-access-code', YOUTUBE_API_KEY: 'fixture-private-key' };
  for (const scenario of ['config', 'queue', 'unauthorized', 'json', 'large']) {
    const logs = [];
    const api = createAwsApiHandler({ store: new MemoryStore(), loadConfig: async () => { if (scenario === 'config') throw new Error('private-service-response'); return config; }, enqueue: async () => { throw new Error('private-queue-details'); }, log: entry => logs.push(entry) });
    const result = await api({ requestContext: { requestId: 'gateway-1', http: { method: 'POST' } }, rawPath: '/api/conversions', headers: { authorization: `Bearer ${scenario === 'unauthorized' ? 'wrong' : config.APP_ACCESS_CODE}` }, body: scenario === 'json' ? '{' : scenario === 'large' ? 'a'.repeat(5000) : JSON.stringify({ url: 'https://soundcloud.com/example/sets/test', source: 'soundcloud' }) }, { awsRequestId: 'lambda-1' });
    const summary = logs.filter(entry => entry.event === 'api_request_finished');
    assert.equal(summary.length, 1);
    assert.equal(summary[0].statusCode, result.statusCode);
    assert.equal(summary[0].operationalFailure, Number(['config', 'queue'].includes(scenario)));
    assert.equal(summary[0].apiRequestId, 'gateway-1');
    assert.equal(summary[0].requestId, 'lambda-1');
    assert.doesNotMatch(JSON.stringify(logs), /private|fixture-access-code|soundcloud.com/);
  }
});

test('structured output is one JSON record, omits unknown/private fields and rejects malformed numeric values', () => {
  let line;
  structuredLog({ event: 'conversion_failed', source: 'spotify', operationalFailure: 1, elapsedMs: Infinity, tracks: -1, message: 'private-key', authorization: 'Bearer private', url: 'https://private.example', stack: 'private stack', code: 'UNSAFE\nTEXT' }, value => { line = value; });
  const data = JSON.parse(line);
  assert.equal(data.operationalFailure, 1);
  assert.equal(line.split('\n').length, 2);
  assert.doesNotMatch(line, /private|UNSAFE|Infinity/);
  assert.equal(data.elapsedMs, undefined);
  assert.equal(data.tracks, undefined);
});

const healthy = { service: 'karaokekonverter', configured: true, maxTracks: 20, sources: ['soundcloud', 'spotify'], sourceReady: { soundcloud: true, spotify: true }, authentication: 'access-code', output: 'temporary-playback-link' };
const baseUrl = 'https://fixture.cloudfront.net';
const html = () => new Response('<title>KaraokeKonverter</title><script src="app.js"></script>', { headers: { 'content-type': 'text/html' } });
test('availability checks HTML plus both-source readiness without provider calls or credentials', async () => {
  const calls = [], logs = [];
  const monitor = createMonitor({ baseUrl, log: entry => logs.push(entry), fetchImpl: async (url, options) => {
    calls.push(url.href);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.authorization, undefined);
    return url.pathname === '/' ? html() : Response.json(healthy);
  } });
  assert.equal((await monitor()).healthy, true);
  assert.deepEqual(calls.sort(), [baseUrl + '/', baseUrl + '/api/health']);
  assert.equal(logs.at(-1).availabilityFailure, 0);
});

test('availability rejects redirects, missing Spotify readiness, wrong HTML, oversized bodies and stalled requests', async () => {
  for (const scenario of ['redirect', 'missing-source', 'wrong-html', 'large', 'hang', 'network']) {
    const logs = [];
    const monitor = createMonitor({ baseUrl, timeoutMs: 15, log: entry => logs.push(entry), fetchImpl: async url => {
      if (scenario === 'hang') return new Promise(() => {});
      if (scenario === 'network') throw new Error('private network details');
      if (scenario === 'redirect') return new Response('', { status: 302, headers: { location: 'https://untrusted.example' } });
      if (url.pathname === '/') return scenario === 'wrong-html' ? new Response('Another site') : html();
      if (scenario === 'large') return new Response('a'.repeat(8193));
      return Response.json({ ...healthy, ...(scenario === 'missing-source' ? { sources: ['soundcloud'] } : {}) });
    } });
    assert.equal((await monitor()).healthy, false, scenario);
    assert.equal(logs.at(-1).availabilityFailure, 1);
    assert.doesNotMatch(JSON.stringify(logs), /private network details|untrusted.example/);
  }
});

test('monitor rejects arbitrary destinations and isolated alert testing makes no HTTP requests or availability samples', async () => {
  let calls = 0;
  const logs = [];
  const monitor = createMonitor({ baseUrl: 'http://127.0.0.1', log: entry => logs.push(entry), fetchImpl: async () => { calls++; } });
  assert.equal((await monitor()).code, 'MONITOR_CONFIGURATION');
  assert.equal(calls, 0);
  logs.length = 0;
  const testId = '00000000-0000-4000-a000-000000000000';
  for (const signal of [1, 0]) assert.deepEqual(await monitor({ operation: 'alarm-test', signal, testId }), { testId, signal });
  await assert.rejects(monitor({ operation: 'alarm-test', signal: 8, testId }));
  await assert.rejects(monitor({ operation: 'unknown' }));
  assert.equal(calls, 0);
  assert.deepEqual(logs.map(entry => entry.testFailure), [1, 0]);
  assert.equal(logs.some(entry => Object.hasOwn(entry, 'availabilityFailure')), false);
});
