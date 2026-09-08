// Decode API title text without interpreting it as markup. The UI still uses textContent.
const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };
export function decodeTitle(value) {
  return String(value ?? '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|ndash|mdash|lsquo|rsquo|ldquo|rdquo|hellip);/gi, (entity, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()] ?? entity;
    const point = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '�';
  });
}

const edition = /^(?:(?:19|20)\d{2}\s*[-:]?\s*)?(?:remaster(?:ed)?|(?:original|album|single)\s+version|official(?:\s+(?:audio|video|music\s+video|lyric(?:s)?\s+video))?|(?:radio|single)\s+edit)(?:\s*[-:]?\s*(?:19|20)\d{2})?$/iu;
export function cleanSongTitle(value, artists = []) {
  return decodeTitle(value)
    .replace(/\(([^()]*)\)|\[([^\[\]]*)\]/g, (whole, round, square) => {
      const label = (round ?? square).trim();
      const withCredit = label.match(/^with\s+(.+)$/i);
      const knownCredit = withCredit && artists.some(artist => titleTokens(artist).join(' ') === titleTokens(withCredit[1]).join(' '));
      return edition.test(label) || /^(?:feat\.?|ft\.?|featuring)\s+/i.test(label) || knownCredit ? ' ' : whole;
    })
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, '')
    .replace(/^(.*)\s[-–—]\s(.+)$/, (whole, title, suffix) => edition.test(suffix.trim()) ? title : whole)
    .replace(/\s+/g, ' ').trim();
}

export function titleTokens(value) {
  return [...new Set(decodeTitle(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[’'`]/g, '').replace(/\b(?:[a-z]\.){2,}[a-z]?\.?/g, acronym => acronym.replaceAll('.', ''))
    .match(/[\p{L}\p{N}]+/gu) || [])];
}

export function songSearchQueries(track) {
  const title = cleanSongTitle(track.title, track.artists);
  const titleWords = new Set(titleTokens(title));
  const artist = decodeTitle(track.artists?.[0] || track.artist || '').trim();
  const artistWords = titleTokens(artist);
  const extraArtist = artistWords.length && !artistWords.every(word => titleWords.has(word)) ? artist : '';
  const base = [title, extraArtist].filter(Boolean).join(' ');
  return [`${base} karaoke`, `${base} karaoke lyrics`];
}
