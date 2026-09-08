import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlaylistUrl, requireAccess, normalizeTracks, temporaryPlaylistUrl, selectKaraokeMatch } from '../src/domain.mjs';

test('accepts public playlist URLs and removes tracking parameters', () => {
  assert.equal(validatePlaylistUrl('https://www.soundcloud.com/example/sets/test-set/?utm_source=share#tracks'), 'https://soundcloud.com/example/sets/test-set');
});

test('rejects private, non-playlist, local, and lookalike URLs before a network request', () => {
  for (const value of ['http://soundcloud.com/a/sets/b', 'https://soundcloud.com.evil.example/a/sets/b', 'https://soundcloud.com@127.0.0.1/a/sets/b', 'https://127.0.0.1/a/sets/b', 'https://soundcloud.com:8443/a/sets/b', 'https://soundcloud.com/a/song', 'https://soundcloud.com/a/sets/b?secret_token=s-private', 'https://on.soundcloud.com/abc', 'file:///etc/passwd', undefined]) {
    assert.throws(() => validatePlaylistUrl(value), { code: 'INVALID_URL' });
  }
});

test('requires a configured access code and a Bearer credential', () => {
  const code = 'test-access-code-123456';
  requireAccess(`Bearer ${code}`, code);
  assert.throws(() => requireAccess(code, code), { code: 'UNAUTHORIZED' });
  assert.throws(() => requireAccess('Bearer wrong', code), { code: 'UNAUTHORIZED' });
  assert.throws(() => requireAccess('', ''), { code: 'NOT_CONFIGURED' });
});

test('never silently truncates large playlists or accepts missing titles', () => {
  assert.throws(() => normalizeTracks([]), { code: 'EMPTY_PLAYLIST' });
  assert.throws(() => normalizeTracks([{ title: 'One' }, { title: 'Two' }], 1), { code: 'PLAYLIST_TOO_LARGE' });
  assert.throws(() => normalizeTracks([{ title: '' }]), { code: 'UNREADABLE_TRACK' });
});

test('constructs a temporary playback URL preserving order and duplicates', () => {
  assert.equal(temporaryPlaylistUrl(['q4agmLDgRG0', 'MnOIY1Bhhm0', 'q4agmLDgRG0']), 'https://www.youtube.com/watch_videos?video_ids=q4agmLDgRG0,MnOIY1Bhhm0,q4agmLDgRG0');
  assert.throws(() => temporaryPlaylistUrl(['invalid']), { code: 'INVALID_VIDEO_IDS' });
});

test('prefers a relevant karaoke result over an unrelated first result', () => {
  const result = selectKaraokeMatch({ title: 'Dancing Queen', artist: 'ABBA' }, [
    { id: { videoId: 'q4agmLDgRG0' }, snippet: { title: 'Some Other Song Karaoke' } },
    { id: { videoId: 'MnOIY1Bhhm0' }, snippet: { title: 'ABBA - Dancing Queen (Karaoke with lyrics)', channelTitle: 'Example channel' } }
  ]);
  assert.equal(result.videoId, 'MnOIY1Bhhm0');
  assert.equal(result.reviewNeeded, true);
  assert.equal(selectKaraokeMatch({ title: 'Dancing Queen', artist: 'ABBA' }, [{ id: { videoId: 'q4agmLDgRG0' }, snippet: { title: 'ABBA Dancing Queen Official Audio' } }]), null);
});
