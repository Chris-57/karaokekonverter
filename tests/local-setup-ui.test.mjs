import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { loadLocalConfig, saveLocalConfig } from '../local/config.mjs';
import { findLocalBrowser } from '../src/providers/browser-runtime.mjs';

test('saved YouTube key survives project changes and stale shell overrides; other settings keep their precedence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'karaoke-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, 'owner', 'config.json');
  await saveLocalConfig(settingsPath, { YOUTUBE_API_KEY: 'saved-fixture-owner-key', APP_ACCESS_CODE: 'old-access-code-not-to-save', PORT: '3000' });
  assert.ok(!('APP_ACCESS_CODE' in JSON.parse(await readFile(settingsPath, 'utf8'))));
  const opts = { settingsPath, projectRoot: root, detectBrowser: async () => '/fixture/chrome', env: {} };
  const saved = await loadLocalConfig(opts);
  assert.equal(saved.config.YOUTUBE_API_KEY, 'saved-fixture-owner-key');
  assert.equal(saved.keySource, 'saved local settings');
  assert.equal(saved.config.CHROME_EXECUTABLE_PATH, '/fixture/chrome');
  await writeFile(join(root, '.env'), 'YOUTUBE_API_KEY=dotenv-fixture-key\nPORT=4000\n');
  assert.equal((await loadLocalConfig(opts)).config.YOUTUBE_API_KEY, 'saved-fixture-owner-key');
  const overridden = await loadLocalConfig({ ...opts, env: { YOUTUBE_API_KEY: 'environment-fixture-key', PORT: '5000' } });
  assert.equal(overridden.config.YOUTUBE_API_KEY, 'saved-fixture-owner-key');
  assert.equal(overridden.config.PORT, '5000');
  const firstRun = { ...opts, settingsPath: join(root, 'absent.json') };
  assert.equal((await loadLocalConfig(firstRun)).config.YOUTUBE_API_KEY, 'dotenv-fixture-key');
  assert.equal((await loadLocalConfig({ ...firstRun, env: { YOUTUBE_API_KEY: 'environment-fixture-key' } })).config.YOUTUBE_API_KEY, 'environment-fixture-key');
});

test('Chrome detection can fall back from a stale path and returns missing explicitly', async () => {
  assert.equal(await findLocalBrowser('/old/chrome', { platform: 'linux', env: {}, exists: async path => path === '/usr/bin/chromium' }), '/usr/bin/chromium');
  assert.equal(await findLocalBrowser(undefined, { platform: 'linux', env: {}, exists: async () => false }), null);
});

for (const authentication of ['local-session', 'access-code']) test(`source switch, Spotify submission and sharing work with ${authentication}`, async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  const { document, window } = parseHTML(html);
  const posts = [], copied = [], timers = [], requests = [];
  const code = authentication === 'local-session' ? 'fixture-local-session-token' : 'fixture-aws-access-code';
  const url = 'https://open.spotify.com/playlist/30NcvL51dhP4HKscAuzKY7';
  const output = 'https://www.youtube.com/watch_videos?video_ids=fixture0001';
  const fetchImpl = async (path, options = {}) => {
    requests.push(path);
    if (path === '/api/health') return Response.json({ configured: true, maxTracks: 20, sources: ['soundcloud', 'spotify'], sourceReady: { soundcloud: true, spotify: true }, authentication });
    if (path === '/api/session') return Response.json({ token: 'fixture-local-session-token' });
    assert.equal(options.headers.authorization, `Bearer ${code}`);
    if (path === '/api/local/youtube') return Response.json({ keyConfigured: true, verified: true });
    if (path === '/api/conversions') { posts.push(JSON.parse(options.body)); return Response.json({ id: 'fixture-job' }, { status: 202 }); }
    return Response.json({ source: 'spotify', sourceTitle: 'Other Songs', playlistName: 'Friday set', status: 'COMPLETE', total: 1, processed: 1, stage: 'Your set is ready', results: [{ position: 1, title: 'Robbery', artist: 'Juice WRLD', status: 'MATCHED', match: { videoId: 'fixture0001', title: 'Robbery karaoke', channel: 'Fixture channel' } }], playlistUrl: output });
  };
  vm.runInNewContext(script, { document, URL, fetch: fetchImpl, AbortSignal, navigator: { clipboard: { writeText: async value => copied.push(value) } }, setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {} });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush(); await flush();
  assert.equal(document.querySelector('#access-code-field').hidden, authentication === 'local-session');
  assert.equal(document.querySelector('#access-code').required, authentication !== 'local-session');
  if (authentication === 'access-code') {
    document.querySelector('#access-code').value = code;
    assert.equal(document.querySelector('#youtube-setup').hidden, true);
    assert.ok(!requests.some(path => path === '/api/session' || path.startsWith('/api/local/')));
  }
  const spotify = document.querySelector('input[value="spotify"]');
  assert.equal(spotify.disabled, false);
  spotify.checked = true; spotify.dispatchEvent(new window.Event('change'));
  assert.equal(document.querySelector('#url-label').textContent, 'Spotify playlist link');
  assert.match(document.querySelector('#playlist-url').placeholder, /open.spotify.com/);
  document.querySelector('#playlist-url').value = url;
  document.querySelector('#playlist-name').value = 'Friday set';
  document.querySelector('#convert-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await flush(); await flush();
  assert.deepEqual(posts, [{ source: 'spotify', url, playlistName: 'Friday set' }]);
  assert.equal(document.querySelector('#source-title').textContent, 'From Spotify: Other Songs');
  assert.equal(document.querySelector('#share-url').value, output);
  assert.equal(document.querySelector('#playlist-link').href, output);
  document.querySelector('#copy-link').dispatchEvent(new window.Event('click'));
  await flush();
  assert.deepEqual(copied, [output]);
  assert.equal(document.querySelector('#copy-feedback').textContent, 'Playlist link copied.');
  // A pasted SoundCloud URL also switches the input expectations back automatically.
  document.querySelector('#playlist-url').value = 'https://soundcloud.com/example/sets/test';
  document.querySelector('#playlist-url').dispatchEvent(new window.Event('input'));
  assert.equal(document.querySelector('#url-label').textContent, 'SoundCloud playlist link');
});
