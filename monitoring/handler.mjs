// Standalone, dependency-free Lambda. It has no database, queue or secret access.
const defaultLog = entry => process.stdout.write(`${JSON.stringify({ service: 'karaokekonverter', timestamp: new Date().toISOString(), component: 'monitor', ...entry })}\n`);

async function limitedText(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('EMPTY_BODY');
  let size = 0;
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('BODY_TOO_LARGE');
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts).toString('utf8');
}

export function createMonitor({ baseUrl = process.env.WEBSITE_URL, fetchImpl = fetch, log = defaultLog, timeoutMs = 8000, now = Date.now } = {}) {
  return async function handler(event = {}, context = {}) {
    if (event.operation === 'alarm-test') {
      if (![0, 1].includes(event.signal) || !/^[a-f0-9-]{36}$/.test(event.testId || '')) throw new Error('Invalid monitoring test');
      log({ event: 'monitoring_test', testFailure: event.signal, testId: event.testId, requestId: context.awsRequestId });
      return { testId: event.testId, signal: event.signal };
    }
    if (event.operation && event.operation !== 'check') throw new Error('Unknown monitoring operation');
    const started = now();
    let base;
    try {
      base = new URL(baseUrl);
      if (base.protocol !== 'https:' || !/^[a-z0-9]+\.cloudfront\.net$/.test(base.hostname) || base.port || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error();
    } catch {
      log({ event: 'availability_checked', availabilityFailure: 1, code: 'MONITOR_CONFIGURATION', elapsedMs: now() - started, requestId: context.awsRequestId });
      return { healthy: false, code: 'MONITOR_CONFIGURATION' };
    }
    const checks = await Promise.all(['website', 'health'].map(async probe => {
      const controller = new AbortController();
      let timer;
      let statusCode = 0;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('TIMEOUT')); }, timeoutMs);
        });
        await Promise.race([timeout, (async () => {
          const response = await fetchImpl(new URL(probe === 'website' ? '/' : '/api/health', base), { signal: controller.signal, redirect: 'manual', headers: { 'user-agent': 'KaraokeKonverter-Availability/0.3.0', accept: probe === 'website' ? 'text/html' : 'application/json' } });
          statusCode = response.status;
          if (response.status !== 200) { await response.body?.cancel(); throw new Error('HTTP_STATUS'); }
          const text = await limitedText(response, probe === 'website' ? 131072 : 8192);
          if (probe === 'website') {
            if (!response.headers.get('content-type')?.includes('text/html') || !/KaraokeKonverter/i.test(text) || !text.includes('app.js')) throw new Error('WEBSITE_CONTENT');
          } else {
            let health;
            try { health = JSON.parse(text); } catch { throw new Error('HEALTH_CONTENT'); }
            if (health.service !== 'karaokekonverter' || health.configured !== true || health.maxTracks !== 20 || health.authentication !== 'access-code' || health.output !== 'temporary-playback-link' || !['soundcloud', 'spotify'].every(source => health.sources?.includes(source) && health.sourceReady?.[source] === true)) throw new Error('HEALTH_CONFIGURATION');
          }
        })()]);
        return { probe, code: 'OK', statusCode };
      } catch (error) {
        const codes = ['TIMEOUT', 'HTTP_STATUS', 'BODY_TOO_LARGE', 'EMPTY_BODY', 'WEBSITE_CONTENT', 'HEALTH_CONTENT', 'HEALTH_CONFIGURATION'];
        const code = controller.signal.aborted ? 'TIMEOUT' : codes.includes(error.message) ? error.message : 'NETWORK_ERROR';
        log({ event: 'availability_endpoint_failed', probe, code, statusCode, requestId: context.awsRequestId });
        return { probe, code, statusCode };
      } finally { clearTimeout(timer); controller.abort(); }
    }));
    const healthy = checks.every(check => check.code === 'OK');
    log({ event: 'availability_checked', availabilityFailure: Number(!healthy), code: healthy ? 'OK' : 'ENDPOINT_FAILED', elapsedMs: now() - started, requestId: context.awsRequestId });
    return { healthy, checks };
  };
}
export const handler = createMonitor();
