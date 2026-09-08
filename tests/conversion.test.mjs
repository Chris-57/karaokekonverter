import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, makeJob } from '../src/domain.mjs';
import { MemoryStore } from '../src/store.mjs';
import { convertJob } from '../src/conversion.mjs';

async function fixture(titles = ['One', 'Two']) {
  const store = new MemoryStore();
  const job = makeJob('https://soundcloud.com/example/sets/test-set');
  await store.create(job);
  return { store, job, source: { readPlaylist: async () => ({ title: 'Example set', tracks: titles.map(title => ({ title })) }) }, log: () => {} };
}

test('a complete job preserves track order and ignores duplicate delivery', async () => {
  const context = await fixture();
  const calls = [];
  context.youtube = { findMatch: async track => { calls.push(track.title); return { videoId: calls.length === 1 ? 'q4agmLDgRG0' : 'MnOIY1Bhhm0' }; } };
  await convertJob(context.job.id, context);
  await convertJob(context.job.id, context);
  const result = await context.store.get(context.job.id);
  assert.equal(result.status, 'COMPLETE');
  assert.deepEqual(calls, ['One', 'Two']);
  assert.equal(result.playlistUrl, 'https://www.youtube.com/watch_videos?video_ids=q4agmLDgRG0,MnOIY1Bhhm0');
  assert.equal(result.processed, 2);
});

test('unmatched songs produce a partial result containing successful matches', async () => {
  const context = await fixture();
  context.youtube = { findMatch: async track => track.title === 'One' ? { videoId: 'q4agmLDgRG0' } : null };
  await convertJob(context.job.id, context);
  const result = await context.store.get(context.job.id);
  assert.equal(result.status, 'PARTIAL');
  assert.deepEqual(result.results.map(track => track.status), ['MATCHED', 'UNMATCHED']);
  assert.equal(result.matchedCount, 1);
});

test('quota exhaustion stops further searches and keeps earlier matches', async () => {
  const context = await fixture(['One', 'Two', 'Three']);
  let calls = 0;
  context.youtube = { findMatch: async () => { if (++calls === 1) return { videoId: 'q4agmLDgRG0' }; throw new AppError('YOUTUBE_QUOTA_EXCEEDED', 'Search allowance reached.', 503); } };
  await convertJob(context.job.id, context);
  const result = await context.store.get(context.job.id);
  assert.equal(calls, 2);
  assert.equal(result.status, 'PARTIAL');
  assert.deepEqual(result.results.map(track => track.status), ['MATCHED', 'ERROR', 'SKIPPED']);
  assert.equal(result.error.code, 'YOUTUBE_QUOTA_EXCEEDED');
});

test('empty or blocked sources fail without spending YouTube search quota', async () => {
  for (const source of [{ readPlaylist: async () => ({ tracks: [] }) }, { readPlaylist: async () => { throw new AppError('SOURCE_BLOCKED', 'Verification requested.', 422); } }]) {
    const context = await fixture();
    let calls = 0;
    await convertJob(context.job.id, { ...context, source, youtube: { findMatch: async () => { calls++; } } });
    assert.equal(calls, 0);
    assert.equal((await context.store.get(context.job.id)).status, 'FAILED');
  }
});

test('unexpected provider errors are sanitized in results and logs', async () => {
  const context = await fixture();
  const logs = [];
  await convertJob(context.job.id, { ...context, source: { readPlaylist: async () => { throw new Error('sensitive-provider-response'); } }, youtube: {}, log: entry => logs.push(entry) });
  const result = await context.store.get(context.job.id);
  assert.equal(result.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify([result, logs]), /sensitive-provider-response/);
});
