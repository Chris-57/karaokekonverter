import test from 'node:test';
import assert from 'node:assert/strict';
import { selectKaraokeMatch } from '../src/domain.mjs';
import { cleanSongTitle, decodeTitle, songSearchQueries } from '../src/text.mjs';

const candidate = (title, id = 'q4agmLDgRG0') => ({ id: { videoId: id }, snippet: { title, channelTitle: 'Fixture &amp; channel' } });

test('Paranoid and Iron Man both match after removing remaster metadata', () => {
  for (const song of ['Paranoid', 'Iron Man']) {
    const source = { title: `${song} (2012 - Remaster)`, artist: 'Black Sabbath' };
    const result = selectKaraokeMatch(source, [candidate(`Black Sabbath - ${song} (Karaoke Version)`)]);
    assert.equal(result.titleOverlap, 1);
    assert.equal(source.title, `${song} (2012 - Remaster)`);
  }
});

test('edition cleanup preserves meaningful parentheses and numeric song titles', () => {
  for (const title of ['1979', '1985', '(You Make Me Feel Like) A Natural Woman', "(Don't Fear) The Reaper", 'Live and Let Die']) assert.equal(cleanSongTitle(title), title);
  assert.equal(cleanSongTitle('Take Me Home, Country Roads (Original Version)'), 'Take Me Home, Country Roads');
  assert.equal(cleanSongTitle('Paranoid - 2012 Remaster'), 'Paranoid');
  assert.equal(cleanSongTitle('Still D.R.E. (feat. Snoop Dogg)'), 'Still D.R.E.');
});

test('decodes apostrophes and common title entities as text', () => {
  assert.equal(decodeTitle('It&#39;s My Life &amp; Guns N&#x27; Roses'), "It's My Life & Guns N' Roses");
  const result = selectKaraokeMatch({ title: "It's My Life", artist: 'Bon Jovi' }, [candidate('Bon Jovi - It&#39;s My Life (Karaoke Version)')]);
  assert.equal(result.title, "Bon Jovi - It's My Life (Karaoke Version)");
  assert.equal(result.channel, 'Fixture & channel');
  assert.equal(decodeTitle('&lt;img src=x onerror=alert(1)&gt;'), '<img src=x onerror=alert(1)>');
});

test('same-title artist clue outranks the wrong artist, while unrelated songs are rejected', () => {
  const result = selectKaraokeMatch({ title: 'Loser', artist: 'Tame Impala' }, [candidate('Beck - Loser Karaoke'), candidate('Tame Impala - Loser Karaoke', 'MnOIY1Bhhm0')]);
  assert.equal(result.videoId, 'MnOIY1Bhhm0');
  assert.equal(selectKaraokeMatch({ title: 'Paranoid', artist: 'Black Sabbath' }, [candidate('Black Sabbath - Iron Man Karaoke')]), null);
  assert.equal(selectKaraokeMatch({ title: 'Paranoid', artist: 'Black Sabbath' }, [candidate('Black Sabbath Paranoid Karaoke with lead vocals')]), null);
});

test('the eight songs in the second live playlist accept their reported candidate titles', () => {
  const cases = [
    ['Still D.R.E. (feat. Snoop Dogg)', 'Dr. Dre', 'Dr. Dre (feat. Snoop Dogg) - Still D.R.E. (Karaoke Version) with Lyrics On Screen'],
    ['Lose Yourself', 'Eminem', 'Lose Yourself - Eminem (Karaoke Songs With Lyrics - Original Key)'],
    ['Loser', 'Tame Impala', 'Loser - Tame Impala (Karaoke Songs With Lyrics - Original Key)'],
    ['Jolene', 'Dolly Parton', 'Dolly Parton - Jolene (Karaoke Version)'],
    ['Carry on Wayward Son', 'Kansas', 'Carry on Wayward Son - Kansas | Karaoke Version | KaraFun'],
    ['Little Wing', 'Jimi Hendrix', 'Little Wing - Jimi Hendrix | Karaoke Version | KaraFun'],
    ['Hysteria', 'Def Leppard', 'Def Leppard - Hysteria (Karaoke Version)'],
    ['Civil War', "Guns N' Roses", 'Civil War - Guns N&#39; Roses | Karaoke Version | KaraFun']
  ];
  for (const [title, artist, youtubeTitle] of cases) assert.ok(selectKaraokeMatch({ title, artist }, [candidate(youtubeTitle)]), title);
});

test('queries include a separate artist once and preserve musical title words', () => {
  assert.deepEqual(songSearchQueries({ title: 'Black Sabbath - Paranoid (2012 - Remaster)', artist: 'Black Sabbath' }), ['Black Sabbath - Paranoid karaoke', 'Black Sabbath - Paranoid karaoke lyrics']);
  assert.equal(songSearchQueries({ title: 'Music', artist: 'Madonna' })[0], 'Music Madonna karaoke');
});
