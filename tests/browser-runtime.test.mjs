import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer, { TimeoutError } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { launchPlaylistBrowser } from '../src/providers/browser-runtime.mjs';
import { soundCloudBrowserProvider } from '../src/providers/soundcloud-browser.mjs';
import { spotifyBrowserProvider } from '../src/providers/spotify-browser.mjs';

const playlistUrl = 'https://soundcloud.com/example/sets/test';

test('Lambda browser launch passes resolved arguments from the installed Puppeteer SDK', async t => {
  const previous = process.env.AWS_LAMBDA_FUNCTION_NAME;
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'fixture-worker';
  t.after(() => {
    if (previous === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = previous;
  });
  const browser = {};
  t.mock.method(chromium, 'executablePath', async () => '/tmp/fixture-chromium');
  t.mock.method(puppeteer, 'launch', async options => {
    assert.ok(Array.isArray(options.args), 'Puppeteer must receive an argument array, not a Promise');
    assert.ok(options.args.includes('--no-sandbox'));
    assert.equal(options.executablePath, '/tmp/fixture-chromium');
    assert.equal(options.headless, 'shell');
    return browser;
  });
  assert.equal(await launchPlaylistBrowser(), browser);
});

test('SoundCloud startup failures identify the launch stage without disclosing raw errors', async () => {
  const logs = [];
  const provider = soundCloudBrowserProvider({
    launchBrowser: async () => { throw new TypeError('private-browser-detail'); },
    log: entry => logs.push(entry)
  });
  await assert.rejects(provider.readPlaylist(playlistUrl, 20), { code: 'BROWSER_START_FAILED' });
  assert.equal(logs[0].stage, 'launch');
  assert.equal(logs[0].errorType, 'TypeError');
  assert.doesNotMatch(JSON.stringify(logs), /private-browser-detail/);
});

function failingPage(error, failAt, url = playlistUrl) {
  let closed = false;
  const page = {
    setDefaultTimeout() {}, setRequestInterception: async () => {}, setExtraHTTPHeaders: async () => {}, on() {},
    goto: async () => { if (failAt === 'navigate') throw error; return { status: () => 200 }; },
    url: () => url,
    evaluate: async () => { throw error; }
  };
  return {
    launchBrowser: async () => ({ newPage: async () => page, close: async () => { closed = true; } }),
    isClosed: () => closed
  };
}

test('SoundCloud navigation timeouts are identified and close the browser', async () => {
  const fake = failingPage(new TimeoutError('private-timeout-detail'), 'navigate');
  const logs = [];
  const provider = soundCloudBrowserProvider({ ...fake, log: entry => logs.push(entry) });
  await assert.rejects(provider.readPlaylist(playlistUrl, 20), { code: 'SOURCE_TIMEOUT' });
  assert.equal(logs[0].stage, 'navigate');
  assert.equal(logs[0].errorType, 'TimeoutError');
  assert.ok(fake.isClosed());
  assert.doesNotMatch(JSON.stringify(logs), /private-timeout-detail/);
});

test('Spotify uses the Lambda Chromium launcher without a desktop executable or signed-in profile', async t => {
  const previous = process.env.AWS_LAMBDA_FUNCTION_NAME;
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'fixture-worker';
  t.after(() => {
    if (previous === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = previous;
  });
  const url = 'https://open.spotify.com/playlist/1234567890123456789012';
  const snapshot = { title: 'Fixture set', declaredCount: 1, gridFound: true, tracks: [{ position: 1, title: 'Fixture song', artists: ['Fixture artist'], url: 'https://open.spotify.com/track/1234567890123456789012' }] };
  let launches = 0, closed = false;
  const page = {
    setDefaultTimeout() {}, setExtraHTTPHeaders: async () => {}, setRequestInterception: async () => {}, on() {},
    goto: async () => ({ status: () => 200 }), url: () => url,
    evaluate: async fn => fn.name === 'scrollPlaylist' ? { atEnd: true } : snapshot
  };
  t.mock.method(chromium, 'executablePath', async () => '/tmp/fixture-chromium');
  t.mock.method(puppeteer, 'launch', async options => {
    launches++;
    assert.ok(Array.isArray(options.args));
    assert.equal(options.headless, 'shell');
    assert.equal(options.executablePath, '/tmp/fixture-chromium');
    assert.equal(options.userDataDir, undefined);
    return { newPage: async () => page, close: async () => { closed = true; } };
  });
  const result = await spotifyBrowserProvider({ headless: false, pause: async () => {}, log: () => {} }).readPlaylist(url, 20);
  assert.equal(result.tracks.length, 1);
  assert.equal(launches, 1);
  assert.ok(closed);
});

test('Spotify distinguishes launch, timeout and extraction failures without disclosing raw errors', async () => {
  const url = 'https://open.spotify.com/playlist/1234567890123456789012';
  for (const [stage, error, code] of [
    ['launch', new TypeError('private-startup-detail'), 'BROWSER_START_FAILED'],
    ['navigate', new TimeoutError('private-navigation-detail'), 'SOURCE_TIMEOUT'],
    ['extract', new TypeError('private-extraction-detail'), 'SOURCE_UNAVAILABLE']
  ]) {
    const logs = [];
    const fake = stage === 'launch' ? { launchBrowser: async () => { throw error; } } : failingPage(error, stage, url);
    const provider = spotifyBrowserProvider({ ...fake, log: entry => logs.push(entry) });
    await assert.rejects(provider.readPlaylist(url, 20), result => {
      assert.equal(result.code, code);
      assert.doesNotMatch(result.message, /private-/);
      return true;
    });
    assert.equal(logs[0].source, 'spotify');
    assert.equal(logs[0].stage, stage);
    assert.equal(logs[0].errorType, error.name);
    assert.doesNotMatch(JSON.stringify(logs), /private-/);
    if (stage !== 'launch') assert.ok(fake.isClosed());
  }
});

test('SoundCloud extraction crashes are not reported as timeouts', async () => {
  const fake = failingPage(new TypeError('private-extraction-detail'), 'extract');
  const logs = [];
  const provider = soundCloudBrowserProvider({ ...fake, log: entry => logs.push(entry) });
  await assert.rejects(provider.readPlaylist(playlistUrl, 20), error => {
    assert.equal(error.code, 'SOURCE_UNAVAILABLE');
    assert.doesNotMatch(error.message, /time limit|private-extraction-detail/);
    return true;
  });
  assert.equal(logs[0].stage, 'extract');
  assert.equal(logs[0].errorType, 'TypeError');
  assert.ok(fake.isClosed());
  assert.doesNotMatch(JSON.stringify(logs), /private-extraction-detail/);
});
