import { AppError, selectKaraokeMatch } from '../domain.mjs';
import { fetchJson } from '../http.mjs';
import { songSearchQueries } from '../text.mjs';

// Allowlisted diagnoses only: Google responses may include credentials, project
// numbers or request URLs. Never forward their raw message or metadata.
export function youtubeError(status, data) {
  const error = data?.error;
  const reasons = new Set([
    ...(Array.isArray(error?.errors) ? error.errors.map(item => item?.reason) : []),
    ...(Array.isArray(error?.details) ? error.details.map(item => item?.reason) : [])
  ].filter(value => typeof value === 'string'));
  const has = (...values) => values.some(value => reasons.has(value));
  if (has('API_KEY_INVALID', 'API_KEY_EXPIRED', 'keyInvalid', 'keyExpired') || /api key (?:not valid|is invalid)/i.test(String(error?.message || ''))) return new AppError('YOUTUBE_KEY_INVALID', 'YouTube rejected the API key. Copy the full key from Google Cloud Credentials, then test it again.', 422);
  if (has('SERVICE_DISABLED', 'accessNotConfigured', 'serviceDisabled')) return new AppError('YOUTUBE_API_DISABLED', 'YouTube Data API v3 is disabled for this key’s Google Cloud project. Enable it in APIs & Services, wait a few minutes, then test again.', 503);
  if (has('API_KEY_SERVICE_BLOCKED')) return new AppError('YOUTUBE_API_RESTRICTED', 'This key’s API restrictions do not allow YouTube Data API v3. Add that API to the key’s allowed APIs in Google Cloud Credentials, then test again.', 503);
  if (has('API_KEY_HTTP_REFERRER_BLOCKED')) return new AppError('YOUTUBE_REFERRER_BLOCKED', 'This key is restricted to website referrers. KaraokeKonverter calls YouTube from its Node server; use a server-compatible key restricted to YouTube Data API v3, then test again.', 503);
  if (has('API_KEY_IP_ADDRESS_BLOCKED')) return new AppError('YOUTUBE_IP_BLOCKED', 'This key’s IP restrictions block this computer’s public outbound IP address. Update the allowed server IPs in Google Cloud Credentials, then test again.', 503);
  if (has('API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED', 'ipRefererBlocked')) return new AppError('YOUTUBE_CLIENT_BLOCKED', 'This key’s application restrictions block the local Node server. Check its allowed clients in Google Cloud Credentials, then test again.', 503);
  if (has('quotaExceeded', 'dailyLimitExceeded', 'QUOTA_EXCEEDED')) return new AppError('YOUTUBE_QUOTA_EXCEEDED', 'The Google project’s YouTube search allowance has been reached. Check its quota and reset time before trying again.', 503);
  if (status === 429 || has('rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED')) return new AppError('YOUTUBE_RATE_LIMIT', 'YouTube is rate limiting requests. Wait before testing or converting again.', 503);
  if (!status || status >= 500) return new AppError('YOUTUBE_UNAVAILABLE', 'YouTube could not be reached or is temporarily unavailable. Check your connection and try again shortly.', 502);
  if ([401, 403].includes(status)) return new AppError('YOUTUBE_ACCESS_DENIED', 'YouTube denied access. Check that YouTube Data API v3 is enabled and this key’s API and application restrictions allow the request.', 503);
  return new AppError('YOUTUBE_REQUEST_REJECTED', `YouTube rejected the search request (HTTP ${status}). Test the key in YouTube connection before trying another playlist.`, 502);
}

export function normalizeYoutubeKey(value) {
  let key = typeof value === 'string' ? value.trim() : '';
  if (/^(["']).*\1$/.test(key)) key = key.slice(1, -1).trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(key)) throw new AppError('YOUTUBE_KEY_FORMAT', 'Paste the complete API key only, without a command, spaces or line breaks.', 422);
  return key;
}

export async function testYoutubeKey(value, { fetchImpl = fetch } = {}) {
  const key = normalizeYoutubeKey(value);
  const query = new URL('https://www.googleapis.com/youtube/v3/search');
  query.search = new URLSearchParams({ part: 'snippet', q: 'karaoke', type: 'video', maxResults: '1', safeSearch: 'moderate' });
  // Exactly one real search, with the same endpoint/header as conversions.
  // No retries, playlist extraction, account sign-in or playlist creation.
  const data = await fetchJson(query, { fetchImpl, attempts: 1, mapError: youtubeError, headers: { 'X-Goog-Api-Key': key, accept: 'application/json' } });
  if (!Array.isArray(data?.items)) throw new AppError('YOUTUBE_RESPONSE', 'YouTube returned an unexpected search response. The key has not been saved; try again shortly.', 502);
  return { verified: true, checkedAt: new Date().toISOString() };
}

export function youtubeProvider(apiKey, { fetchImpl = fetch, wait } = {}) {
  if (!apiKey) throw new AppError('NOT_CONFIGURED', 'YouTube search has not been configured.', 503);
  return {
    async findMatch(track) {
      const queries = songSearchQueries(track);
      for (let attempt = 0; attempt < queries.length; attempt++) {
        const query = new URL('https://www.googleapis.com/youtube/v3/search');
        query.search = new URLSearchParams({ part: 'snippet', q: queries[attempt], type: 'video', maxResults: '5', safeSearch: 'moderate' });
        const data = await fetchJson(query, { fetchImpl, wait, mapError: youtubeError, headers: { 'X-Goog-Api-Key': apiKey, accept: 'application/json' } });
        const match = selectKaraokeMatch(track, data.items || []);
        if (match) return { ...match, searchAttempt: attempt + 1 };
      }
      return null;
    }
  };
}
