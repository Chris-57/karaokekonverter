import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findLocalBrowser } from '../src/providers/browser-runtime.mjs';

const keys = ['YOUTUBE_API_KEY', 'APP_ACCESS_CODE', 'PORT', 'SOUNDCLOUD_MODE', 'CHROME_EXECUTABLE_PATH', 'SOUNDCLOUD_CLIENT_ID', 'SOUNDCLOUD_CLIENT_SECRET', 'SPOTIFY_HEADLESS', 'MAX_TRACKS'];
const select = object => Object.fromEntries(keys.filter(key => typeof object?.[key] === 'string' && object[key].trim()).map(key => [key, object[key].trim()]));

export function localConfigPath({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  const directory = platform === 'win32' ? env.LOCALAPPDATA || join(home, 'AppData', 'Local') : platform === 'darwin' ? join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME || join(home, '.config');
  return join(directory, 'KaraokeKonverter', 'config.json');
}

export async function loadLocalConfig({ env = process.env, settingsPath = localConfigPath({ env }), projectRoot = fileURLToPath(new URL('../', import.meta.url)), detectBrowser = findLocalBrowser } = {}) {
  let saved = {}, fromFile = {};
  try { saved = select(JSON.parse(await readFile(settingsPath, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`Could not read local settings at ${settingsPath}. Check that it contains valid JSON.`); }
  try { fromFile = select(parseEnv(await readFile(join(projectRoot, '.env'), 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read the optional project .env file. Check its format.'); }
  const environment = select(env);
  const config = { PORT: '3000', SOUNDCLOUD_MODE: 'browser', MAX_TRACKS: '20', SPOTIFY_HEADLESS: 'false', ...saved, ...fromFile, ...environment };
  // The key explicitly tested and saved by the owner must win after restart,
  // even if an older PowerShell variable or project .env still exists.
  if (saved.YOUTUBE_API_KEY) config.YOUTUBE_API_KEY = saved.YOUTUBE_API_KEY;
  const keySource = saved.YOUTUBE_API_KEY ? 'saved local settings' : environment.YOUTUBE_API_KEY ? 'environment' : fromFile.YOUTUBE_API_KEY ? 'project .env' : 'not configured';
  config.CHROME_EXECUTABLE_PATH = await detectBrowser(config.CHROME_EXECUTABLE_PATH) || '';
  return { config, settingsPath, keySource };
}

export async function saveLocalConfig(settingsPath, config) {
  const saved = select(config);
  delete saved.APP_ACCESS_CODE; // The local server creates a fresh browser-session token.
  const directory = dirname(settingsPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${settingsPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(saved, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, settingsPath);
}
