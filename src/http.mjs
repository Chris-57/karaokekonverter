import { AppError } from './domain.mjs';

export async function fetchJson(url, { fetchImpl = fetch, headers = {}, method = 'GET', body, attempts = 3, allowedRedirectHosts = [], mapError, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      let target = new URL(url);
      const signal = AbortSignal.timeout(12000);
      for (let redirects = 0; ; redirects++) {
        response = await fetchImpl(target.toString(), { method, headers, body, signal, redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location || redirects >= 3 || method !== 'GET') throw new AppError('UPSTREAM_REDIRECT', 'A music service returned an unsupported redirect.', 502);
        const next = new URL(location, target);
        if (next.protocol !== 'https:' || next.username || next.password || next.port || !allowedRedirectHosts.includes(next.hostname)) throw new AppError('UPSTREAM_REDIRECT', 'A music service returned an unsupported redirect.', 502);
        await response.body?.cancel();
        target = next;
      }
    }
    catch (error) {
      if (error instanceof AppError) throw error;
      if (attempt + 1 < attempts) { await wait(300 * 2 ** attempt); continue; }
      throw mapError?.(0) || new AppError('UPSTREAM_UNAVAILABLE', 'A music service could not be reached. Try again shortly.', 502);
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt + 1 < attempts) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await wait(Math.min(5000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt));
        continue;
      }
      throw mapError?.(response.status) || new AppError(response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_UNAVAILABLE', 'The music service is temporarily unavailable or rate limited. Try again later.', 502);
    }
    let data;
    try { data = await response.json(); } catch { throw new AppError('UPSTREAM_RESPONSE', 'A music service returned an unreadable response.', 502); }
    if (!response.ok) {
      const mapped = mapError?.(response.status, data);
      if (mapped) throw mapped;
      const reasons = data?.error?.errors?.map(item => item.reason) || [];
      if (reasons.some(reason => ['quotaExceeded', 'dailyLimitExceeded'].includes(reason))) throw new AppError('YOUTUBE_QUOTA_EXCEEDED', 'The YouTube search allowance has been reached. Try again after it resets.', 503);
      if ([401, 403].includes(response.status)) throw new AppError('UPSTREAM_AUTH', 'The application could not access a music service. Contact the application owner.', 502);
      if (response.status === 404) throw new AppError('PLAYLIST_UNAVAILABLE', 'This playlist is unavailable or private.', 422);
      throw new AppError('UPSTREAM_RESPONSE', 'A music service rejected this request.', 502);
    }
    return data;
  }
}
