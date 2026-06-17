export type ServerCapabilities = {
  youtubeImport: {
    enabled: boolean;
  };
  podcastIndex: {
    enabled: boolean;
  };
  clips: {
    enabled: boolean;
  };
  silenceMaps: {
    enabled: boolean;
  };
  smartSkip: {
    enabled: boolean;
  };
};

export function buildServerCapabilities(options: { youtubeImportEnabled: boolean; smartSkipEnabled: boolean }): ServerCapabilities {
  return {
    youtubeImport: {
      enabled: options.youtubeImportEnabled
    },
    podcastIndex: {
      enabled: true
    },
    clips: {
      enabled: true
    },
    silenceMaps: {
      enabled: true
    },
    smartSkip: {
      enabled: options.smartSkipEnabled
    }
  };
}
