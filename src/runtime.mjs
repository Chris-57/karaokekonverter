import { youtubeProvider } from './providers/youtube.mjs';
import { soundCloudApiProvider } from './providers/soundcloud-api.mjs';
import { soundCloudBrowserProvider } from './providers/soundcloud-browser.mjs';
import { spotifyBrowserProvider } from './providers/spotify-browser.mjs';
import { ENABLED_SOURCES, sourceConfiguration } from './source-config.mjs';

export function runtimeOptions(config, { enabledSources = ENABLED_SOURCES } = {}) {
  const { maxTracks } = sourceConfiguration(config, enabledSources);
  const mode = config.SOUNDCLOUD_MODE || 'browser';
  const sources = {};
  if (enabledSources.includes('soundcloud')) sources.soundcloud = mode === 'api' ? soundCloudApiProvider({ clientId: config.SOUNDCLOUD_CLIENT_ID, clientSecret: config.SOUNDCLOUD_CLIENT_SECRET }) : soundCloudBrowserProvider({ executablePath: config.CHROME_EXECUTABLE_PATH });
  if (enabledSources.includes('spotify')) sources.spotify = spotifyBrowserProvider({ executablePath: config.CHROME_EXECUTABLE_PATH, headless: config.SPOTIFY_HEADLESS === 'true' });
  return {
    maxTracks,
    sources,
    youtube: youtubeProvider(config.YOUTUBE_API_KEY)
  };
}
