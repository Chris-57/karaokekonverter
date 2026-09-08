import { AppError, validatePlaylistUrl } from '../domain.mjs';
import { fetchJson } from '../http.mjs';

export function soundCloudApiProvider({ clientId, clientSecret, fetchImpl = fetch, now = Date.now }) {
  let token;
  let refreshToken;
  let pendingToken;
  let expires = 0;
  async function getToken() {
    if (!clientId || !clientSecret) throw new AppError('NOT_CONFIGURED', 'SoundCloud API access has not been configured.', 503);
    if (token && now() < expires) return token;
    if (!pendingToken) pendingToken = (async () => {
      const fields = refreshToken ? { grant_type: 'refresh_token', refresh_token: refreshToken } : { grant_type: 'client_credentials' };
      // A refresh token is single-use, so never automatically replay this POST.
      const data = await fetchJson('https://secure.soundcloud.com/oauth/token', { fetchImpl, attempts: 1, method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
      if (!data.access_token) throw new AppError('UPSTREAM_AUTH', 'SoundCloud did not provide an access token.', 502);
      token = data.access_token;
      refreshToken = data.refresh_token;
      expires = now() + Math.max(0, Number(data.expires_in || 3600) - 120) * 1000;
      return token;
    })();
    try { return await pendingToken; } finally { pendingToken = undefined; }
  }
  return {
    async readPlaylist(url, maxTracks) {
      const canonical = validatePlaylistUrl(url);
      const accessToken = await getToken();
      const headers = { authorization: `OAuth ${accessToken}`, accept: 'application/json' };
      const playlist = await fetchJson(`https://api.soundcloud.com/resolve?${new URLSearchParams({ url: canonical })}`, { fetchImpl, headers, allowedRedirectHosts: ['api.soundcloud.com'] });
      if (playlist.kind !== 'playlist') throw new AppError('INVALID_PLAYLIST', 'This SoundCloud URL did not resolve to a playlist.', 422);
      if (playlist.track_count > maxTracks) throw new AppError('PLAYLIST_TOO_LARGE', `This version supports up to ${maxTracks} tracks.`, 422);
      let tracks = playlist.tracks || [];
      if (!tracks.length || tracks.some(track => !track.title) || tracks.length < Number(playlist.track_count || 0)) {
        const playlistId = playlist.urn || playlist.id;
        if (!playlistId) throw new AppError('UPSTREAM_RESPONSE', 'The playlist response had no identifier.', 502);
        const data = await fetchJson(`https://api.soundcloud.com/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${maxTracks + 1}&linked_partitioning=true`, { fetchImpl, headers });
        tracks = Array.isArray(data) ? data : data.collection || [];
        if (data.next_href) throw new AppError('PLAYLIST_TOO_LARGE', 'Use a smaller playlist for this version.', 422);
      }
      if (tracks.length < Number(playlist.track_count || 0)) throw new AppError('SOURCE_INCOMPLETE', 'SoundCloud returned only part of this playlist.', 422);
      return { title: playlist.title, tracks: tracks.map(track => ({ title: track.title, artist: track.publisher_metadata?.artist || '' })) };
    }
  };
}
