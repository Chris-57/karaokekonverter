import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { cleanSongTitle, decodeTitle, titleTokens } from './text.mjs';

export class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'AppError'; this.code = code; this.status = status; }
}
export const terminalStatuses = new Set(['COMPLETE', 'PARTIAL', 'FAILED']);
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const sourceLabels = { soundcloud: 'SoundCloud', spotify: 'Spotify' };

export function validatePlaylistUrl(value, source = 'soundcloud') {
  if (!Object.hasOwn(sourceLabels, source)) throw new AppError('INVALID_SOURCE', 'Choose SoundCloud or Spotify.');
  let url;
  try { url = new URL(value); } catch { throw new AppError('INVALID_URL', `Enter a full public ${sourceLabels[source]} playlist URL.`); }
  if (source === 'spotify') {
    const safeParameters = new Set(['si', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password || !/^\/(?:intl-[a-z-]+\/)?playlist\/[A-Za-z0-9]{22}\/?$/.test(url.pathname) || [...url.searchParams.keys()].some(key => !safeParameters.has(key))) {
      throw new AppError('INVALID_URL', 'Use a public https://open.spotify.com/playlist/... link. Short links, private access tokens and other Spotify pages are not supported.');
    }
    return `https://open.spotify.com/playlist/${url.pathname.split('/').filter(Boolean).at(-1)}`;
  }
  if (url.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname) || url.port || url.username || url.password || !/^\/[A-Za-z0-9_-]+\/sets\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) || url.searchParams.has('secret_token')) {
    throw new AppError('INVALID_URL', 'Use a public https://soundcloud.com/artist/sets/playlist link. Short links and private playlists are not supported.');
  }
  return `https://soundcloud.com${url.pathname.replace(/\/$/, '')}`;
}

export function requireAccess(authorization, expected) {
  if (!expected || expected.length < 16) throw new AppError('NOT_CONFIGURED', 'Conversion is not configured yet. Contact the application owner.', 503);
  const supplied = /^Bearer /i.test(String(authorization || '')) ? String(authorization).slice(7) : '';
  const hash = value => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(hash(supplied), hash(expected))) throw new AppError('UNAUTHORIZED', 'Check your access code and try again.', 401);
}

export function playlistName(value) {
  if (value !== undefined && typeof value !== 'string') throw new AppError('INVALID_NAME', 'Playlist name must be text.');
  const name = (value || '').replace(/\s+/g, ' ').trim();
  if (name.length > 100) throw new AppError('INVALID_NAME', 'Use a playlist name of 100 characters or fewer.');
  return name || 'KaraokePlaylist';
}

export function makeJob(sourceUrl, now = Date.now(), name, source = 'soundcloud') {
  return { id: randomUUID(), source, sourceUrl: validatePlaylistUrl(sourceUrl, source), playlistName: playlistName(name), status: 'QUEUED', stage: 'Waiting to start', processed: 0, total: 0, results: [], createdAt: now, updatedAt: now, expiresAt: Math.floor(now / 1000) + 86400 };
}

export function normalizeTracks(tracks, maxTracks = 20) {
  if (!Array.isArray(tracks) || !tracks.length) throw new AppError('EMPTY_PLAYLIST', 'No readable tracks were found in this public playlist.', 422);
  if (tracks.length > maxTracks) throw new AppError('PLAYLIST_TOO_LARGE', `This version supports up to ${maxTracks} tracks. Use a smaller playlist.`, 422);
  return tracks.map((track, index) => {
    const title = decodeTitle(track.title || '').trim().slice(0, 300);
    if (!title) throw new AppError('UNREADABLE_TRACK', `Track ${index + 1} has no readable title.`, 422);
    const artists = Array.isArray(track.artists) ? [...new Set(track.artists.filter(value => typeof value === 'string').map(value => decodeTitle(value).trim().slice(0, 200)).filter(Boolean))] : [];
    return { position: index + 1, title, artist: (artists.length ? artists.join(', ') : decodeTitle(track.artist || '').trim()).slice(0, 500), ...(artists.length ? { artists } : {}), ...(track.artistReliable ? { artistReliable: true } : {}) };
  });
}

export function temporaryPlaylistUrl(videoIds) {
  if (!Array.isArray(videoIds) || !videoIds.length || videoIds.some(id => !VIDEO_ID.test(id))) throw new AppError('INVALID_VIDEO_IDS', 'A playlist requires valid YouTube video IDs.', 422);
  // The original external tool generates this same playback URL. This is not a saved playlist API.
  return `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}`;
}

export function selectKaraokeMatch(track, candidates) {
  const sourceTokens = titleTokens(cleanSongTitle(track.title, track.artists));
  if (!sourceTokens.length) return null;
  const artistTokens = titleTokens(track.artist || '');
  const ranked = candidates.filter(item => VIDEO_ID.test(item?.id?.videoId || '')).map((item, index) => {
    const title = decodeTitle(item.snippet?.title || '');
    const words = new Set(titleTokens(title));
    const overlap = sourceTokens.filter(token => words.has(token)).length / sourceTokens.length;
    // SoundCloud uploaders are not always the recording artist, so this is a ranking clue.
    const artistOverlap = artistTokens.length ? artistTokens.filter(token => words.has(token)).length / artistTokens.length : 0;
    const creditedArtist = (track.artists || []).some(artist => { const tokens = titleTokens(artist); return tokens.length && tokens.every(token => words.has(token)); });
    const karaoke = /karaoke|instrumental|no vocals|backing track/i.test(title);
    const leadVocals = /with\s+(?:lead\s+)?vocals|vocal cover|guide vocals/i.test(title);
    const score = overlap + artistOverlap * .35 + (/karaoke/i.test(title) ? .15 : 0) + (/lyrics|on screen/i.test(title) ? .05 : 0);
    return { item, overlap, artistOverlap, creditedArtist, karaoke, leadVocals, score, index };
  }).filter(candidate => candidate.karaoke && !candidate.leadVocals && (!track.artistReliable || candidate.creditedArtist) && candidate.overlap >= (sourceTokens.length <= 2 ? 1 : .75)).sort((a, b) => b.score - a.score || a.index - b.index);
  if (!ranked.length) return null;
  const { item, overlap, artistOverlap } = ranked[0];
  return { videoId: item.id.videoId, title: decodeTitle(item.snippet?.title || '').slice(0, 300), channel: decodeTitle(item.snippet?.channelTitle || '').slice(0, 200), url: `https://www.youtube.com/watch?v=${item.id.videoId}`, reviewNeeded: true, titleOverlap: Number(overlap.toFixed(2)), artistOverlap: Number(artistOverlap.toFixed(2)) };
}

export function safeError(error) {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: 'INTERNAL_ERROR', message: 'The conversion could not finish. Please try again.' };
}

export function publicJob(job) {
  const { leaseUntil, ...data } = job;
  return data;
}
