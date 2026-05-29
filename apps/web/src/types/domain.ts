export type SectionKey = 'inbox' | 'queue' | 'library' | 'search' | 'history' | 'downloads' | 'settings';

export type InboxState = 'new' | 'dismissed' | 'archived';
export type EpisodeFilter = 'all' | 'played' | 'unplayed';
export type SortDirection = 'newest' | 'oldest';
export type ClipRenderStatus = 'local-only' | 'queued' | 'pending' | 'rendering' | 'ready' | 'rendered' | 'failed' | 'range-link' | 'time-range-only';
export type DownloadBackend = 'browser-cache' | 'tauri-filesystem';
export type DownloadSource = 'manual' | 'queue' | 'inbox';
export type SilenceShorteningMode = 'off' | 'web-audio' | 'server-ffmpeg' | 'native';

export interface Podcast {
  id: string;
  title: string;
  author?: string;
  description?: string;
  imageUrl?: string;
  feedUrl: string;
  websiteUrl?: string;
  tags: string[];
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CachedPodcast extends Podcast {
  cachedAt: string;
  cacheExpiresAt?: string;
  podcastIndexId?: string;
  categories: string[];
}

export interface PodcastPreference {
  podcastId: string;
  playbackRate?: number;
  skipForwardSec?: number;
  skipBackSec?: number;
  skipIntroSec?: number;
  skipOutroSec?: number;
  silenceShortening?: boolean;
  sortDirection: SortDirection;
  addNewEpisodesToInbox: boolean;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  title: string;
  startsAt: number;
  url?: string;
}

export interface Episode {
  id: string;
  podcastId: string;
  podcastTitle: string;
  title: string;
  description?: string;
  audioUrl: string;
  websiteUrl?: string;
  imageUrl?: string;
  publishedAt: string;
  durationSec?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  explicit?: boolean;
  chapters: Chapter[];
  guid: string;
  enclosureLength?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeState {
  episodeId: string;
  played: boolean;
  playedAt?: string;
  lastPlayedAt?: string;
  progressSec: number;
  inboxState: InboxState;
  inboxPosition?: number;
  queuedAt?: string;
  queuePosition?: number;
  downloaded: boolean;
  downloadedAt?: string;
  /** Device-local filesystem path returned by Tauri native downloads. Never required for web-only mode. */
  downloadPath?: string;
  /** Size written by the native downloader or browser cache estimate when known. */
  downloadBytes?: number;
  downloadBackend?: DownloadBackend;
  /** Device-local reason this file was cached. Not synced; used for retention cleanup. */
  downloadSource?: DownloadSource;
  favorite: boolean;
  deletedAt?: string;
  clipCount: number;
  updatedAt: string;
}

export interface Clip {
  id: string;
  episodeId: string;
  podcastTitle: string;
  episodeTitle: string;
  sourceAudioUrl: string;
  startSec: number;
  endSec: number;
  title: string;
  note?: string;
  publicUrl?: string;
  serverClipId?: string;
  renderedUrl?: string;
  renderedAudioUrl?: string;
  renderedVideoUrl?: string;
  renderStatus?: ClipRenderStatus;
  renderError?: string;
  fileSizeBytes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  id: 'local';
  skipForwardSec: number;
  skipBackSec: number;
  resumeRewindSec: number;
  playbackRate: number;
  autoPlayNext: boolean;
  autoDownload: boolean;
  autoDownloadInbox: boolean;
  autoDeleteAfterListen: boolean;
  downloadOnlyWifi: boolean;
  storageCapMb: number;
  inboxSortDirection: SortDirection;
  refreshIntervalMinutes: number;
  silenceShortening: boolean;
  silenceShorteningMode: SilenceShorteningMode;
  /** Web Audio fallback threshold. Lower values skip only very quiet spans. */
  silenceThreshold: number;
  /** Server/native ffmpeg threshold, typically -45 to -35 dB. */
  silenceThresholdDb: number;
  /** Minimum span treated as silence by native/server processors. */
  silenceMinMs: number;
  silenceMinimumDurationSec?: number;
  silenceBoostRate: number;
  nativeAudioPreferred: boolean;
  syncEnabled: boolean;
  serverUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  lastSyncAt?: string;
  syncPullCursor?: string;
  syncPushCursor?: string;
  deviceId?: string;
  updatedAt?: string;
  theme: 'dark' | 'light';
}

export interface PodcastListeningStats {
  podcastId: string;
  podcastTitle: string;
  listeningSec: number;
  contentSec: number;
  speedSavedSec: number;
  silenceSavedSec: number;
  updatedAt: string;
}

export interface ListeningStats {
  id: 'local';
  listeningSec: number;
  contentSec: number;
  speedSavedSec: number;
  silenceSavedSec: number;
  byPodcast: Record<string, PodcastListeningStats>;
  updatedAt: string;
}

export interface SyncMeta {
  id: 'main';
  deviceId: string;
  lastPulledAt?: string;
  lastPushedAt?: string;
  lastSyncError?: string;
  updatedAt: string;
}

export type TombstoneTable = 'subscriptions' | 'episodes' | 'episode_states' | 'clips';

export interface SyncTombstone {
  id: string;
  tableName: TombstoneTable;
  localId: string;
  deletedAt: string;
  pushedAt?: string;
}

export interface EpisodeWithState extends Episode {
  state: EpisodeState;
}

export interface BackupFile {
  version: 1 | 2;
  exportedAt: string;
  feeds: Podcast[];
  episodes: Episode[];
  states: EpisodeState[];
  clips: Clip[];
  settings: AppSettings;
  syncMeta?: SyncMeta[];
  tombstones?: SyncTombstone[];
  podcastPreferences?: PodcastPreference[];
  podcastCache?: CachedPodcast[];
  cachedEpisodes?: Episode[];
  listeningStats?: ListeningStats;
}

export interface ParsedFeedResult {
  podcast: Podcast;
  episodes: Episode[];
}
