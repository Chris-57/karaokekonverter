import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApi } from '../src/api.mjs';
import { MemoryStore } from '../src/store.mjs';
import { convertJob } from '../src/conversion.mjs';
import { runtimeOptions } from '../src/runtime.mjs';
import { loadLocalConfig, localConfigPath, saveLocalConfig } from './config.mjs';
import { AppError, requireAccess, safeError } from '../src/domain.mjs';
import { normalizeYoutubeKey, testYoutubeKey } from '../src/providers/youtube.mjs';

export function createLocalServer({ config = process.env, settingsPath = localConfigPath(), keySource = 'configuration', store = new MemoryStore(), runtime, verifyKey = testYoutubeKey, persistConfig = saveLocalConfig, buildRuntime = runtimeOptions, log = entry => console.log(JSON.stringify(entry)) } = {}) {
  config = { ...config };
  const enabledSources = runtime ? Object.keys(runtime.sources || (runtime.source ? { soundcloud: runtime.source } : {})) : ['soundcloud', 'spotify'];
  const sourceReady = runtime ? Object.fromEntries(enabledSources.map(source => [source, true])) : {
    soundcloud: Boolean(config.SOUNDCLOUD_MODE === 'api' ? config.SOUNDCLOUD_CLIENT_ID && config.SOUNDCLOUD_CLIENT_SECRET : config.CHROME_EXECUTABLE_PATH),
    spotify: Boolean(config.CHROME_EXECUTABLE_PATH)
  };
  let verified = Boolean(runtime), checkedAt = null, checking = false, activeJobs = 0;
  const ready = () => Boolean(verified && !checking && Object.values(sourceReady).some(Boolean));
  const connection = () => ({ keyConfigured: Boolean(config.YOUTUBE_API_KEY), keySource: config.YOUTUBE_API_KEY ? keySource : 'not configured', verified, checkedAt });
  const accessCode = config.APP_ACCESS_CODE || randomBytes(24).toString('hex');
  const maxTracks = Math.min(20, Math.max(1, Number(config.MAX_TRACKS) || 20));
  let work = Promise.resolve();
  let conversionRuntime = runtime;
  const api = createApi({ store, accessCode, ready, maxTracks, enabledSources, sourceReady, authentication: 'local-session', log, enqueue: async id => {
    conversionRuntime ||= buildRuntime(config, { enabledSources: enabledSources.filter(source => sourceReady[source]) });
    const jobRuntime = conversionRuntime;
    activeJobs++;
    work = work.then(async () => {
      await convertJob(id, { store, ...jobRuntime, maxTracks, log });
      const finished = await store.get(id);
      if (finished?.error?.code?.startsWith('YOUTUBE_')) verified = false;
    }).catch(error => log({ event: 'local_worker_failed', type: error.name })).finally(() => { activeJobs--; });
  } });
  const publicRoot = fileURLToPath(new URL('../dist/', import.meta.url));
  const files = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]]);
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    response.setHeader('Cache-Control', 'no-store');
    // Local session bootstrap is only available on this loopback server. Host and
    // Origin checks prevent a different website from reading or using its token.
    const port = request.socket.localPort;
    const host = request.headers.host?.toLowerCase();
    const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`, ...(port === 80 ? ['localhost', '127.0.0.1'] : [])];
    const reject = () => { response.writeHead(403, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { code: 'LOCAL_ORIGIN_REQUIRED', message: 'Open the app directly at its localhost address.' } })); };
    if (!allowedHosts.includes(host)) { reject(); return; }
    const origin = new URL(`http://${host}`).origin;
    if (request.headers.origin && request.headers.origin !== origin) { reject(); return; }
    let requestUrl;
    try { requestUrl = new URL(request.url, origin); } catch { reject(); return; }
    if (requestUrl.origin !== origin) { reject(); return; }
    const requestPath = requestUrl.pathname;
    if (requestPath.startsWith('/api/') && request.headers['sec-fetch-site'] === 'cross-site') { reject(); return; }
    try {
      if (request.method === 'GET' && requestPath === '/api/session') {
        response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ token: accessCode })); return;
      }
      if (requestPath.startsWith('/api/')) {
        let raw = '';
        for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > 4096) { response.writeHead(413); response.end(JSON.stringify({ error: { message: 'Request too large.' } })); return; } }
        let body;
        try { body = raw ? JSON.parse(raw) : undefined; } catch { response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Invalid JSON.' } })); return; }
        if (requestPath === '/api/local/youtube') {
          let status = 200, data;
          try {
            requireAccess(request.headers.authorization, accessCode);
            if (request.method === 'GET') data = connection();
            else if (request.method === 'POST') {
              if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new AppError('INVALID_REQUEST', 'Send the key using the local setup form.', 415);
              if (checking || activeJobs) throw new AppError('SETUP_BUSY', 'Wait for the current test or conversion to finish, then try again.', 409);
              if (!body || typeof body !== 'object' || Array.isArray(body) || (body.apiKey !== undefined && typeof body.apiKey !== 'string')) throw new AppError('INVALID_REQUEST', 'Enter a YouTube API key as text.');
              const key = normalizeYoutubeKey(body.apiKey?.trim() || config.YOUTUBE_API_KEY);
              checking = true;
              try {
                const test = await verifyKey(key);
                if (test?.verified !== true) throw new AppError('YOUTUBE_RESPONSE', 'YouTube verification did not complete. Try again.', 502);
                const nextConfig = { ...config, YOUTUBE_API_KEY: key };
                try { await persistConfig(settingsPath, nextConfig); }
                catch { throw new AppError('SETTINGS_SAVE_FAILED', 'YouTube accepted the key, but local settings could not be saved. Check that your user settings folder is writable. Your active key was not changed.', 500); }
                config = nextConfig;
                conversionRuntime = undefined;
                verified = true; checkedAt = test.checkedAt; keySource = 'saved local settings';
                data = { ...connection(), message: 'YouTube search works. Key saved and ready to use.' };
              } catch (error) {
                if (key === config.YOUTUBE_API_KEY && error.code !== 'SETTINGS_SAVE_FAILED') verified = false;
                throw error;
              } finally { checking = false; }
            } else throw new AppError('METHOD_NOT_ALLOWED', 'Use the local setup form to test and save a key.', 405);
          } catch (error) {
            status = error instanceof AppError ? error.status : 500;
            data = { error: error instanceof AppError ? safeError(error) : { code: 'SETUP_FAILED', message: 'The key could not be tested or saved. Try again.' } };
          }
          response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)); return;
        }
        const result = await api({ method: request.method, path: requestPath, authorization: request.headers.authorization, body });
        response.writeHead(result.status, { 'content-type': 'application/json' }); response.end(JSON.stringify(result.data)); return;
      }
      const asset = files.get(requestPath);
      if (!asset || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404); response.end('Not found'); return; }
      const content = await readFile(path.join(publicRoot, asset[0]));
      response.writeHead(200, { 'content-type': asset[1] }); response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(500); response.end('Request failed.'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { config, keySource, settingsPath } = await loadLocalConfig();
    const port = Number(config.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number from 1 to 65535.');
    if (!['browser', 'api'].includes(config.SOUNDCLOUD_MODE)) throw new Error('SOUNDCLOUD_MODE must be browser or api.');
    const server = createLocalServer({ config: { ...config, APP_ACCESS_CODE: undefined }, keySource, settingsPath });
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the old app with Ctrl+C, then run npm.cmd start again.` : 'The local server could not start.'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => {
      console.log(`KaraokeKonverter 0.2.2 is available locally. Open http://localhost:${port}`);
      console.log(`YouTube key: ${config.YOUTUBE_API_KEY ? `found (${keySource}); test it in YouTube connection on the website` : 'paste and test your key in YouTube connection on the website'}`);
      console.log(`Chrome/Edge: ${config.CHROME_EXECUTABLE_PATH ? 'found' : 'not found; install Chrome and run npm.cmd run setup'}`);
      console.log('No access code is needed on the local website. Stop the app with Ctrl+C.');
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
