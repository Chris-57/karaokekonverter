'use strict';
const form = document.querySelector('#convert-form');
const submitButton = document.querySelector('#submit-button');
const formError = document.querySelector('#form-error');
const resultSection = document.querySelector('#results');
const resultError = document.querySelector('#result-error');
const refreshButton = document.querySelector('#refresh-button');
const shareUrl = document.querySelector('#share-url');
const copyButton = document.querySelector('#copy-link');
const copyFeedback = document.querySelector('#copy-feedback');
const urlInput = document.querySelector('#playlist-url');
const sourceInputs = [...document.querySelectorAll('input[name="source"]')];
const sourceLabels = { soundcloud: 'SoundCloud', spotify: 'Spotify' };
const sourceUrls = { soundcloud: '', spotify: '' };
const setupPanel = document.querySelector('#youtube-setup');
const keyInput = document.querySelector('#youtube-key');
const keyMessage = document.querySelector('#youtube-key-message');
const saveKeyButton = document.querySelector('#test-save-key');
const testKeyButton = document.querySelector('#test-current-key');
let connection;
let setupBusy = false;
let selectedSource = 'soundcloud';
let health;
let currentJob;
let currentCode;
let pollCount = 0;
let timer;
let generation = 0;
let busy = false;
let connected = false;

function notice(element, text) { element.textContent = text || ''; element.hidden = !text; }
function setBusy(value) {
  busy = value;
  submitButton.disabled = value || setupBusy || !connected || !health?.configured || health.sourceReady?.[selectedSource] === false;
  keyInput.disabled = value || setupBusy;
  saveKeyButton.disabled = value || setupBusy || !connected || !keyInput.value.trim();
  testKeyButton.disabled = value || setupBusy || !connected || !connection?.keyConfigured;
  for (const input of sourceInputs) {
    const available = health?.sources?.includes(input.value) && health.sourceReady?.[input.value] !== false;
    input.disabled = value || !available;
    input.closest('label').classList.toggle('unavailable', !available);
  }
  urlInput.disabled = value;
  document.querySelector('#playlist-name').disabled = value;
}
function selectSource(source, keepUrl = false) {
  if (!Object.hasOwn(sourceLabels, source)) return;
  if (!keepUrl && source !== selectedSource) {
    sourceUrls[selectedSource] = urlInput.value;
    urlInput.value = sourceUrls[source];
  }
  selectedSource = source;
  for (const input of sourceInputs) input.checked = input.value === source;
  document.querySelector('#url-label').textContent = `${sourceLabels[source]} playlist link`;
  urlInput.placeholder = source === 'spotify' ? 'https://open.spotify.com/playlist/...' : 'https://soundcloud.com/artist/sets/playlist';
  notice(document.querySelector('#source-notice'), source === 'spotify' ? 'Use a public playlist that is visible while signed out of Spotify.' : '');
  notice(formError, '');
  setBusy(busy);
}
for (const input of sourceInputs) input.addEventListener('change', () => { if (input.checked) selectSource(input.value); });
urlInput.addEventListener('input', () => {
  try {
    const url = new URL(urlInput.value.trim());
    const detected = url.hostname === 'open.spotify.com' ? 'spotify' : ['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname) ? 'soundcloud' : null;
    if (detected && detected !== selectedSource && !sourceInputs.find(input => input.value === detected).disabled) selectSource(detected, true);
  } catch { /* Let the user finish typing; the API validates the full URL. */ }
  sourceUrls[selectedSource] = urlInput.value;
});
async function acquireLocalSession() {
  const response = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Open the app at its localhost address and refresh the page.');
  const data = await response.json();
  if (typeof data.token !== 'string' || data.token.length < 16) throw new Error('The local session could not be started. Restart the app.');
  currentCode = data.token;
}
async function request(url, options = {}, renewed = false) {
  const response = await fetch(url, { ...options, cache: 'no-store', headers: { 'content-type': 'application/json', authorization: `Bearer ${currentCode}`, ...options.headers }, signal: AbortSignal.timeout(url === '/api/local/youtube' ? 20000 : 15000) });
  const data = await response.json();
  if (response.status === 401 && health?.authentication === 'local-session' && !renewed) {
    await acquireLocalSession();
    return request(url, options, true);
  }
  if (!response.ok) { const error = new Error(data.error?.message || 'The request could not finish.'); error.code = data.error?.code; throw error; }
  return data;
}
function render(job) {
  document.querySelector('#results-title').textContent = job.playlistName || job.title || 'KaraokePlaylist';
  notice(document.querySelector('#source-title'), job.sourceTitle ? `From ${sourceLabels[job.source] || 'SoundCloud'}: ${job.sourceTitle}` : '');
  document.querySelector('#status-label').textContent = ({ QUEUED: 'Queued', RUNNING: 'Converting', COMPLETE: 'Ready', PARTIAL: 'Partially ready', FAILED: 'Needs attention' })[job.status] || job.status;
  document.querySelector('#progress-text').textContent = `${job.stage || ''}${job.total ? ` · ${job.processed} of ${job.total} tracks processed` : ''}`;
  document.querySelector('#progress').value = job.total ? Math.round(job.processed / job.total * 100) : 0;
  const list = document.querySelector('#track-list');
  list.replaceChildren();
  for (const track of job.results || []) {
    const row = document.createElement('li'); row.className = 'track';
    const number = document.createElement('span'); number.className = 'track-number'; number.textContent = String(track.position).padStart(2, '0');
    const info = document.createElement('div');
    const title = document.createElement('p'); title.className = 'track-title'; title.textContent = track.title;
    info.append(title);
    if (track.artist) { const artist = document.createElement('p'); artist.className = 'source-artist'; artist.textContent = track.artist; info.append(artist); }
    const detail = document.createElement('p'); detail.className = 'track-detail'; detail.textContent = track.match ? `${track.match.title} · ${track.match.channel}` : track.reason || 'No match found';
    info.append(detail); row.append(number, info);
    if (track.match && /^[A-Za-z0-9_-]{11}$/.test(track.match.videoId)) {
      const link = document.createElement('a'); link.href = `https://www.youtube.com/watch?v=${track.match.videoId}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Review match ↗'; row.append(link);
    } else { const label = document.createElement('span'); label.className = 'track-status'; label.textContent = track.status === 'UNMATCHED' ? 'No match' : track.status === 'SKIPPED' ? 'Skipped' : 'Not added'; row.append(label); }
    list.append(row);
  }
  notice(resultError, job.error?.message);
  if (health?.authentication === 'local-session' && job.error?.code?.startsWith('YOUTUBE_')) {
    setupPanel.open = true;
    keyMessage.classList.remove('success');
    notice(keyMessage, `${job.error.message} (${job.error.code})`);
  }
  let validPlaylist = false;
  try { const url = new URL(job.playlistUrl); validPlaylist = url.origin === 'https://www.youtube.com' && url.pathname === '/watch_videos'; } catch { /* No result link yet. */ }
  document.querySelector('#playlist-actions').hidden = !validPlaylist;
  const nextUrl = validPlaylist ? job.playlistUrl : '';
  if (shareUrl.value !== nextUrl) {
    shareUrl.value = nextUrl;
    copyButton.textContent = 'Copy link';
    notice(copyFeedback, '');
  }
  copyButton.disabled = !validPlaylist;
  if (validPlaylist) document.querySelector('#playlist-link').href = nextUrl;
  else document.querySelector('#playlist-link').removeAttribute('href');
}
async function poll(version = generation) {
  refreshButton.hidden = true;
  try {
    const job = await request(`/api/conversions/${currentJob}`);
    if (version !== generation) return;
    render(job);
    if (['COMPLETE', 'PARTIAL', 'FAILED'].includes(job.status)) {
      if (health?.authentication === 'local-session' && job.error?.code?.startsWith('YOUTUBE_')) await refreshConnection();
      setBusy(false); return;
    }
    if (++pollCount >= 240) { notice(resultError, 'This conversion is taking longer than expected. Check progress again shortly.'); refreshButton.hidden = false; setBusy(false); return; }
    timer = setTimeout(() => poll(version), 2500);
  } catch (error) {
    if (version !== generation) return;
    notice(resultError, error.message || 'Could not check progress.'); refreshButton.hidden = false; setBusy(false);
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || setupBusy || !connected || !health?.configured || health.sourceReady?.[selectedSource] === false) return;
  clearTimeout(timer); notice(formError, ''); notice(resultError, '');
  const version = ++generation;
  if (health.authentication !== 'local-session') currentCode = document.querySelector('#access-code').value;
  setBusy(true);
  try {
    const playlistName = document.querySelector('#playlist-name').value.trim() || 'KaraokePlaylist';
    const source = selectedSource;
    const result = await request('/api/conversions', { method: 'POST', body: JSON.stringify({ source, url: urlInput.value.trim(), playlistName }) });
    if (version !== generation) return;
    currentJob = result.id; pollCount = 0; resultSection.hidden = false;
    render({ source, playlistName, status: 'QUEUED', stage: 'Waiting to start', results: [] });
    await poll(version);
  } catch (error) { if (version === generation) { notice(formError, error.message || 'Conversion could not start.'); setBusy(false); } }
});
refreshButton.addEventListener('click', () => { pollCount = 0; clearTimeout(timer); setBusy(true); void poll(); });
copyButton.addEventListener('click', async () => {
  const value = shareUrl.value;
  if (!value) return;
  copyButton.disabled = true;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
    if (shareUrl.value === value) { copyButton.textContent = 'Copied'; notice(copyFeedback, 'Playlist link copied.'); }
  } catch {
    if (shareUrl.value === value) {
      shareUrl.focus(); shareUrl.select();
      copyButton.textContent = 'Copy link';
      notice(copyFeedback, 'Automatic copying is unavailable. The link is selected: press Ctrl+C or Command+C, or use your device’s Copy command.');
    }
  } finally { copyButton.disabled = !shareUrl.value; }
});
async function connect() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('The conversion service could not be reached.');
    health = await response.json();
    document.querySelector('#track-limit').textContent = health.maxTracks || 20;
    const local = health.authentication === 'local-session';
    document.querySelector('#access-code-field').hidden = local;
    document.querySelector('#access-code').required = !local;
    setupPanel.hidden = !local;
    if (local) { await acquireLocalSession(); await refreshConnection(); }
    connected = true;
    const first = sourceInputs.find(input => health.sources?.includes(input.value) && health.sourceReady?.[input.value] !== false);
    if (first) selectSource(first.value);
    setBusy(false);
    if (!health.configured) notice(formError, local ? (connection?.verified ? 'Chrome or Edge was not found. Install a browser, restart the app, then test your current key.' : 'Test your key in YouTube connection above to enable conversion.') : 'This installation is awaiting setup. Please contact the application owner.');
  } catch (error) { connected = false; setBusy(false); notice(formError, error.message || 'The local service is unavailable. Start the app and refresh this page.'); }
}

async function refreshConnection() {
  connection = await request('/api/local/youtube');
  const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Could not refresh the local connection status. Refresh the page.');
  health = await response.json();
  document.querySelector('#youtube-key-status').textContent = connection.verified ? 'Search test passed' : connection.keyConfigured ? 'Key found — test before converting' : 'Paste a key to get started';
  testKeyButton.hidden = !connection.keyConfigured;
  if (!connection.verified) setupPanel.open = true;
}
keyInput.addEventListener('input', () => setBusy(busy));
async function testAndSaveKey(useCurrent = false) {
  if (busy || setupBusy || !connected) return;
  setupBusy = true; setBusy(busy);
  keyMessage.classList.remove('success');
  notice(keyMessage, 'Testing a YouTube search…');
  try {
    const result = await request('/api/local/youtube', { method: 'POST', body: JSON.stringify(useCurrent ? {} : { apiKey: keyInput.value }) });
    keyInput.value = '';
    keyMessage.classList.add('success');
    notice(keyMessage, result.message);
    notice(formError, '');
  } catch (error) {
    notice(keyMessage, `${error.message || 'The connection test could not finish.'}${error.code ? ` (${error.code})` : ''}`);
  } finally {
    try {
      await refreshConnection();
      if (connection.verified && !health.configured) notice(formError, 'The key works, but Chrome or Edge was not found. Install a browser and restart the app.');
    } catch { notice(formError, 'Could not refresh local settings. Refresh the page before converting.'); health.configured = false; }
    setupBusy = false; setBusy(busy);
  }
}
document.querySelector('#youtube-key-form').addEventListener('submit', event => { event.preventDefault(); if (keyInput.value.trim()) void testAndSaveKey(); });
testKeyButton.addEventListener('click', () => void testAndSaveKey(true));
void connect();
