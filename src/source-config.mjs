export const ENABLED_SOURCES = Object.freeze(['soundcloud', 'spotify']);

// Shared by the API and worker so advertised sources and processing stay aligned.
// Readiness is a configuration check, not a live provider reachability test.
export function sourceConfiguration(config, enabledSources = ENABLED_SOURCES) {
  const mode = config.SOUNDCLOUD_MODE || 'browser';
  if (!['api', 'browser'].includes(mode)) throw new Error('SOUNDCLOUD_MODE must be browser or api');
  return {
    enabledSources: [...enabledSources],
    maxTracks: Math.min(20, Math.max(1, Math.floor(Number(config.MAX_TRACKS) || 20))),
    ready: Boolean(config.YOUTUBE_API_KEY),
    sourceReady: {
      soundcloud: mode === 'browser' || (mode === 'api' && Boolean(config.SOUNDCLOUD_CLIENT_ID && config.SOUNDCLOUD_CLIENT_SECRET)),
      spotify: true
    }
  };
}
