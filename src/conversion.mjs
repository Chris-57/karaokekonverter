import { AppError, normalizeTracks, safeError, sourceLabels, temporaryPlaylistUrl } from './domain.mjs';
import { isOperationalFailure, outcomeFields, scopedLog } from './observability.mjs';

export async function convertJob(id, { store, source, sources, youtube, maxTracks = 20, log = entry => console.log(JSON.stringify(entry)) }) {
  if (!await store.claim(id)) { log({ event: 'conversion_skipped', jobId: id }); return; }
  const job = await store.get(id);
  const started = Date.now();
  log = scopedLog(log, { jobId: id, source: job.source });
  log({ event: 'conversion_started', queueWaitMs: Math.max(0, started - job.createdAt) });
  let trackCount = 0;
  let matchedCount = 0;
  try {
    const reader = sources?.[job.source] || (job.source === 'soundcloud' ? source : undefined);
    if (!reader) throw new AppError('SOURCE_NOT_CONFIGURED', 'This playlist source is not configured for conversion.', 503);
    await store.update(id, { stage: `Reading the ${sourceLabels[job.source] || 'source'} playlist` });
    const playlist = await reader.readPlaylist(job.sourceUrl, maxTracks, { log });
    const tracks = normalizeTracks(playlist.tracks, maxTracks);
    trackCount = tracks.length;
    await store.update(id, { title: job.playlistName || 'KaraokePlaylist', sourceTitle: String(playlist.title || '').slice(0, 300), total: tracks.length, stage: 'Finding karaoke matches' });
    const results = [];
    let blockingError;
    let operationalCode;
    for (const track of tracks) {
      if (blockingError) {
        results.push({ ...track, status: 'SKIPPED', reason: blockingError.message });
      } else {
        try {
          const match = await youtube.findMatch(track);
          results.push(match ? { ...track, status: 'MATCHED', match } : { ...track, status: 'UNMATCHED', reason: 'No suitable karaoke result was found. Try a more specific song title.' });
          if (match) matchedCount++;
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          const safe = safeError(error);
          if (isOperationalFailure(safe.code)) operationalCode ||= safe.code;
          results.push({ ...track, status: 'ERROR', reason: safe.message });
          // Stop issuing further searches when the provider itself is unavailable.
          if (safe.code.startsWith('YOUTUBE_') || ['UPSTREAM_AUTH', 'UPSTREAM_RESPONSE', 'UPSTREAM_REDIRECT', 'UPSTREAM_RATE_LIMIT', 'UPSTREAM_UNAVAILABLE', 'NOT_CONFIGURED'].includes(safe.code)) blockingError = safe;
        }
      }
      await store.update(id, { processed: results.length, results: [...results] });
    }
    const matched = results.filter(result => result.status === 'MATCHED');
    const status = matched.length === tracks.length ? 'COMPLETE' : matched.length ? 'PARTIAL' : 'FAILED';
    await store.update(id, { status, stage: status === 'COMPLETE' ? 'Your set is ready' : status === 'PARTIAL' ? 'Some tracks need attention' : 'No karaoke set could be created', matchedCount: matched.length, playlistUrl: matched.length ? temporaryPlaylistUrl(matched.map(result => result.match.videoId)) : null, error: blockingError || (status === 'FAILED' ? { code: 'NO_MATCHES', message: 'No suitable karaoke matches were found. Try another public playlist.' } : null) });
    const code = operationalCode || blockingError?.code || (status === 'COMPLETE' ? 'NONE' : 'NO_MATCHES');
    log({ event: 'conversion_finished', status, code, tracks: tracks.length, matched: matched.length, elapsedMs: Date.now() - started, ...outcomeFields(status, code) });
  } catch (error) {
    const safe = safeError(error);
    await store.update(id, { status: 'FAILED', stage: 'Conversion failed', error: safe });
    log({ event: 'conversion_failed', status: 'FAILED', code: safe.code, tracks: trackCount, matched: matchedCount, elapsedMs: Date.now() - started, ...outcomeFields('FAILED', safe.code) });
  }
}
