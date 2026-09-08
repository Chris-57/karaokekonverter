import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadLocalConfig, saveLocalConfig } from '../local/config.mjs';
import { normalizeYoutubeKey, testYoutubeKey } from '../src/providers/youtube.mjs';
import { AppError } from '../src/domain.mjs';

let terminal;
try {
  console.log('KaraokeKonverter local setup');
  console.log('You can also start the app and use the visible YouTube connection form on the website.');
  const { config, settingsPath, keySource } = await loadLocalConfig();
  console.log(`YouTube API key: ${config.YOUTUBE_API_KEY ? `found in ${keySource}` : 'needed'}`);
  terminal = createInterface({ input: stdin, output: stdout });
  const entered = await terminal.question(config.YOUTUBE_API_KEY ? 'Paste a replacement key, or press Enter to test the current key (visible input): ' : 'Paste your YouTube API key, then press Enter (visible input): ');
  terminal.close();
  const key = normalizeYoutubeKey(entered.trim() || config.YOUTUBE_API_KEY);
  console.log('Testing one YouTube search request…');
  await testYoutubeKey(key);
  try { await saveLocalConfig(settingsPath, { ...config, YOUTUBE_API_KEY: key }); }
  catch { throw new AppError('SETTINGS_SAVE_FAILED', 'YouTube accepted the key, but local settings could not be saved. Check that your user settings folder is writable.'); }
  console.log(`YouTube search works. Key saved to: ${settingsPath}`);
  console.log(`Chrome/Edge: ${config.CHROME_EXECUTABLE_PATH ? 'found automatically' : 'not found; install Chrome before converting'}`);
  console.log('The saved key takes priority over older YouTube key environment settings.');
  console.log('Start the app with npm.cmd start. The website offers a connection test before converting.');
} catch (error) {
  console.error(error instanceof AppError ? `${error.message} (${error.code})` : 'Setup could not finish. Start the app and use YouTube connection, or check your local settings file.');
  process.exitCode = 1;
} finally { terminal?.close(); }
