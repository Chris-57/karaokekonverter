import { AppError, makeJob, publicJob, requireAccess, safeError } from './domain.mjs';
import { ENABLED_SOURCES } from './source-config.mjs';

export function createApi({ store, enqueue, accessCode, ready = true, maxTracks = 20, enabledSources = ENABLED_SOURCES, sourceReady = {}, authentication = 'access-code', log = entry => console.log(JSON.stringify(entry)) }) {
  return async function route({ method, path, authorization, body }) {
    const respond = (status, data) => ({ status, data });
    try {
      const isReady = typeof ready === 'function' ? ready() : ready;
      if (method === 'GET' && path === '/api/health') return respond(200, { service: 'karaokekonverter', version: '0.3.0', configured: Boolean(isReady && accessCode?.length >= 16), maxTracks, sources: enabledSources, sourceReady: Object.fromEntries(enabledSources.map(source => [source, sourceReady[source] !== false])), authentication, output: 'temporary-playback-link' });
      requireAccess(authorization, accessCode);
      if (method === 'POST' && path === '/api/conversions') {
        if (!isReady) throw new AppError('NOT_CONFIGURED', authentication === 'local-session' ? 'Test your YouTube key in YouTube connection before converting.' : 'Conversion is not configured yet. Contact the application owner.', 503);
        if (!body || typeof body !== 'object' || typeof body.url !== 'string') throw new AppError('INVALID_REQUEST', 'Provide a public playlist URL.');
        const source = body.source ?? 'soundcloud';
        if (!enabledSources.includes(source)) throw new AppError('INVALID_SOURCE', 'This playlist source is not enabled in this installation.');
        if (sourceReady[source] === false) throw new AppError('SOURCE_NOT_CONFIGURED', authentication === 'local-session' ? 'This playlist source is not configured yet. Run local setup and restart the app.' : 'This playlist source is not configured yet. Contact the application owner.', 503);
        const job = makeJob(body.url, Date.now(), body.playlistName, source);
        await store.create(job);
        try { await enqueue(job.id); }
        catch {
          await store.update(job.id, { status: 'FAILED', stage: 'Could not start', error: { code: 'QUEUE_UNAVAILABLE', message: 'The conversion could not be queued. Please try again.' } });
          throw new AppError('QUEUE_UNAVAILABLE', 'The conversion could not be queued. Please try again.', 503);
        }
        log({ event: 'conversion_submitted', jobId: job.id, source: job.source });
        return respond(202, { id: job.id, status: 'QUEUED', statusUrl: `/api/conversions/${job.id}` });
      }
      const match = path.match(/^\/api\/conversions\/([a-f0-9-]{36})$/);
      if (method === 'GET' && match) {
        const job = await store.get(match[1]);
        if (!job || job.expiresAt <= Math.floor(Date.now() / 1000)) throw new AppError('NOT_FOUND', 'This conversion could not be found or has expired.', 404);
        return respond(200, publicJob(job));
      }
      return respond(404, { error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
    } catch (error) {
      const safe = safeError(error);
      if (!(error instanceof AppError)) log({ event: 'api_failed', code: safe.code });
      return respond(error instanceof AppError ? error.status : 500, { error: safe });
    }
  };
}
