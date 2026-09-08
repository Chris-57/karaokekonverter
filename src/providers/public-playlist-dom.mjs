// This function is serialized into the page. Read only the rendered playlist DOM.
// No private application state, cookies, storage, or internal API tokens are read.
export function extractSnapshot(provider) {
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('main');
  const title = clean(main?.querySelector('h1')?.textContent);
  const pageText = clean(document.body?.innerText || document.body?.textContent).slice(0, 18000);
  const grids = Array.from(main?.querySelectorAll('[role="grid"]') || []);
  let grid;
  if (provider === 'spotify') {
    // Other grids contain recommendations with their own positions. Never merge them.
    grid = grids.find(element => clean(element.getAttribute('aria-label')) === title && title);
  } else if (provider === 'apple') {
    const candidates = grids.filter(element =>
      element.getAttribute('data-testid') === 'tracklist' && element.querySelector('a[href*="/song/"]'));
    if (candidates.length === 1) grid = candidates[0];
  }
  const rows = Array.from(grid?.querySelectorAll('[role="row"]') || []);
  const tracks = [];
  for (const row of rows) {
    const link = row.querySelector(provider === 'spotify' ? 'a[href*="/track/"]' : 'a[href*="/song/"]');
    if (!link) continue;
    let url;
    try {
      url = new URL(link.getAttribute('href'), location.href);
      const correct = provider === 'spotify'
        ? url.hostname === 'open.spotify.com' && /^\/(?:intl-[a-z-]+\/)?track\/[A-Za-z0-9]{22}\/?$/.test(url.pathname)
        : url.hostname === 'music.apple.com' && /^\/[a-z]{2}\/song\/[^/]+\/\d+\/?$/.test(url.pathname);
      if (!correct || url.protocol !== 'https:') continue;
      url.search = ''; url.hash = '';
    } catch { continue; }
    const indexAttribute = provider === 'spotify' ? 'aria-rowindex' : 'data-row';
    const rawIndex = row.getAttribute(indexAttribute);
    const position = rawIndex !== null && /^\d+$/.test(rawIndex)
      ? Number(rawIndex) + (provider === 'spotify' ? -1 : 1) : null;
    const artists = Array.from(row.querySelectorAll('a[href*="/artist/"]'))
      .map(element => clean(element.textContent)).filter(Boolean);
    tracks.push({ position, title: clean(link.textContent), artists: [...new Set(artists)], url: url.href });
  }
  // Count comes from a separate count label, never the playlist title or recommendations.
  const counts = new Set();
  for (const element of main?.querySelectorAll('span,p') || []) {
    if (element.closest('[role="grid"],h1')) continue;
    if (element.querySelector('span,p')) continue;
    const match = clean(element.textContent).match(/^(\d[\d,]*)\s+(?:songs?|tracks?)(?:\s*[,·•]|$)/i);
    if (match) counts.add(Number(match[1].replaceAll(',', '')));
  }
  const declaredCount = counts.size === 1 ? [...counts][0] : null;
  // A Sign In button alone is normal on a public page. It is not a login wall.
  const explicitChallenge = /verify (?:that )?you(?:'re| are) (?:a )?human|checking your browser|unusual traffic|automated requests|complete (?:the|this) captcha/i.test(pageText);
  const loginRequired = !tracks.length && /(?:log|sign) in to (?:view|see|access) (?:this|the) playlist|you must (?:log|sign) in to continue/i.test(pageText);
  return {
    title, declaredCount, tracks, ambiguousCount: counts.size > 1,
    blocked: explicitChallenge, loginRequired,
    gridFound: Boolean(grid),
    positionSource: provider === 'spotify' ? 'aria-rowindex minus header' : 'data-row plus one'
  };
}

// Ordinary scrolling inside the real playlist scroll container, without clicking controls.
export function scrollPlaylist(provider) {
  const main = document.querySelector('main');
  const title = main?.querySelector('h1')?.textContent.trim();
  const grids = Array.from(main?.querySelectorAll('[role="grid"]') || []);
  const grid = provider === 'spotify'
    ? grids.find(element => element.getAttribute('aria-label')?.trim() === title)
    : grids.find(element => element.getAttribute('data-testid') === 'tracklist');
  let element = grid;
  while (element && element !== document.documentElement) {
    const style = getComputedStyle(element);
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2) break;
    element = element.parentElement;
  }
  const scroller = element && element !== document.documentElement ? element : document.scrollingElement;
  if (!scroller) return { atEnd: true };
  scroller.scrollBy({ top: Math.max(250, Math.floor(scroller.clientHeight * 0.7)), behavior: 'instant' });
  return { atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4 };
}
