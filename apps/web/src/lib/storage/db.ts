import Dexie, { type Table } from 'dexie';
import type { AppSettings, CachedPodcast, Clip, Episode, EpisodeState, ListeningStats, Podcast, PodcastPreference, SilenceMap, SyncMeta, SyncTombstone } from '@/types/domain';
import { defaultSettings, defaultStateFor, demoEpisodes, demoPodcasts } from '../sampleData';
import { nowIso } from '../dates';

export class ElephantPodDatabase extends Dexie {
  feeds!: Table<Podcast, string>;
  episodes!: Table<Episode, string>;
  states!: Table<EpisodeState, string>;
  clips!: Table<Clip, string>;
  settings!: Table<AppSettings, string>;
  syncMeta!: Table<SyncMeta, string>;
  tombstones!: Table<SyncTombstone, string>;
  podcastCache!: Table<CachedPodcast, string>;
  cachedEpisodes!: Table<Episode, string>;
  podcastPreferences!: Table<PodcastPreference, string>;
  listeningStats!: Table<ListeningStats, string>;
  silenceMaps!: Table<SilenceMap, string>;

  constructor() {
    super('elephant-pod');
    this.version(1).stores({
      feeds: 'id, feedUrl, title, updatedAt',
      episodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      states: 'episodeId, played, inboxState, queuePosition, downloaded, updatedAt',
      clips: 'id, episodeId, createdAt, updatedAt',
      settings: 'id'
    });
    this.version(2).stores({
      feeds: 'id, feedUrl, title, updatedAt',
      episodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      states: 'episodeId, played, inboxState, inboxPosition, queuePosition, downloaded, downloadedAt, updatedAt',
      clips: 'id, episodeId, createdAt, updatedAt, renderStatus',
      settings: 'id, updatedAt',
      syncMeta: 'id, deviceId, updatedAt',
      tombstones: 'id, tableName, localId, deletedAt, pushedAt'
    });
    this.version(3).stores({
      feeds: 'id, feedUrl, title, updatedAt',
      episodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      states: 'episodeId, played, inboxState, inboxPosition, queuePosition, downloaded, downloadedAt, updatedAt',
      clips: 'id, episodeId, createdAt, updatedAt, renderStatus',
      settings: 'id, updatedAt',
      syncMeta: 'id, deviceId, updatedAt',
      tombstones: 'id, tableName, localId, deletedAt, pushedAt',
      podcastCache: 'id, feedUrl, title, cachedAt, cacheExpiresAt, updatedAt',
      cachedEpisodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      podcastPreferences: 'podcastId, updatedAt'
    });
    this.version(4).stores({
      feeds: 'id, feedUrl, title, updatedAt',
      episodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      states: 'episodeId, played, inboxState, inboxPosition, queuePosition, downloaded, downloadedAt, updatedAt',
      clips: 'id, episodeId, createdAt, updatedAt, renderStatus',
      settings: 'id, updatedAt',
      syncMeta: 'id, deviceId, updatedAt',
      tombstones: 'id, tableName, localId, deletedAt, pushedAt',
      podcastCache: 'id, feedUrl, title, cachedAt, cacheExpiresAt, updatedAt',
      cachedEpisodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      podcastPreferences: 'podcastId, updatedAt'
    }).upgrade(async (tx) => {
      const states = await tx.table<EpisodeState, string>('states').toArray();
      let inboxCursor = 1;
      for (const state of states) {
        const inInbox = state.inboxState === 'new' && !state.queuePosition && !state.played;
        await tx.table<EpisodeState, string>('states').put({
          ...state,
          inboxState: (state.inboxState as string) === 'queued' ? 'archived' : state.inboxState,
          inboxPosition: inInbox ? state.inboxPosition || inboxCursor++ : undefined,
          updatedAt: state.updatedAt || nowIso()
        });
      }
    });
    this.version(5).stores({
      feeds: 'id, feedUrl, title, updatedAt',
      episodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      states: 'episodeId, played, inboxState, inboxPosition, queuePosition, downloaded, downloadedAt, updatedAt',
      clips: 'id, episodeId, createdAt, updatedAt, renderStatus',
      settings: 'id, updatedAt',
      syncMeta: 'id, deviceId, updatedAt',
      tombstones: 'id, tableName, localId, deletedAt, pushedAt',
      podcastCache: 'id, feedUrl, title, cachedAt, cacheExpiresAt, updatedAt',
      cachedEpisodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      podcastPreferences: 'podcastId, updatedAt'
    }).upgrade(async (tx) => {
      const settings = await tx.table<AppSettings, string>('settings').get('local');
      if (!settings) return;
      await tx.table<AppSettings, string>('settings').put({
        ...defaultSettings,
        ...settings,
        autoDownload: settings.autoDownload ?? defaultSettings.autoDownload,
        autoDownloadInbox: settings.autoDownloadInbox ?? defaultSettings.autoDownloadInbox,
        autoDeleteAfterListen: settings.autoDeleteAfterListen ?? defaultSettings.autoDeleteAfterListen,
        inboxSortDirection: settings.inboxSortDirection ?? defaultSettings.inboxSortDirection,
        updatedAt: settings.updatedAt || nowIso()
      });
    });
    this.version(6).stores({
      feeds: 'id, feedUrl, title, updatedAt',
      episodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      states: 'episodeId, played, inboxState, inboxPosition, queuePosition, downloaded, downloadedAt, updatedAt',
      clips: 'id, episodeId, createdAt, updatedAt, renderStatus',
      settings: 'id, updatedAt',
      syncMeta: 'id, deviceId, updatedAt',
      tombstones: 'id, tableName, localId, deletedAt, pushedAt',
      podcastCache: 'id, feedUrl, title, cachedAt, cacheExpiresAt, updatedAt',
      cachedEpisodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      podcastPreferences: 'podcastId, updatedAt'
    }).upgrade(async (tx) => {
      const settings = await tx.table<AppSettings, string>('settings').get('local');
      if (!settings) return;
      await tx.table<AppSettings, string>('settings').put({
        ...defaultSettings,
        ...settings,
        autoDeleteAfterListen: settings.autoDeleteAfterListen ?? defaultSettings.autoDeleteAfterListen,
        updatedAt: settings.updatedAt || nowIso()
      });
    });
    this.version(7).stores({
      feeds: 'id, feedUrl, title, updatedAt',
      episodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      states: 'episodeId, played, inboxState, inboxPosition, queuePosition, downloaded, downloadedAt, updatedAt',
      clips: 'id, episodeId, createdAt, updatedAt, renderStatus',
      settings: 'id, updatedAt',
      syncMeta: 'id, deviceId, updatedAt',
      tombstones: 'id, tableName, localId, deletedAt, pushedAt',
      podcastCache: 'id, feedUrl, title, cachedAt, cacheExpiresAt, updatedAt',
      cachedEpisodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      podcastPreferences: 'podcastId, updatedAt',
      listeningStats: 'id, updatedAt'
    }).upgrade(async (tx) => {
      const stats = await tx.table<ListeningStats, string>('listeningStats').get('local');
      if (!stats) await tx.table<ListeningStats, string>('listeningStats').put(defaultListeningStats());
    });
    this.version(8).stores({
      feeds: 'id, feedUrl, title, updatedAt',
      episodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      states: 'episodeId, played, inboxState, inboxPosition, queuePosition, downloaded, downloadedAt, updatedAt',
      clips: 'id, episodeId, createdAt, updatedAt, renderStatus',
      settings: 'id, updatedAt',
      syncMeta: 'id, deviceId, updatedAt',
      tombstones: 'id, tableName, localId, deletedAt, pushedAt',
      podcastCache: 'id, feedUrl, title, cachedAt, cacheExpiresAt, updatedAt',
      cachedEpisodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      podcastPreferences: 'podcastId, updatedAt',
      listeningStats: 'id, updatedAt'
    }).upgrade(async (tx) => {
      const settings = await tx.table<AppSettings, string>('settings').get('local');
      if (!settings) return;
      await tx.table<AppSettings, string>('settings').put({
        ...defaultSettings,
        ...settings,
        nativeAudioPreferred: settings.nativeAudioPreferred ?? defaultSettings.nativeAudioPreferred,
        updatedAt: settings.updatedAt || nowIso()
      });
    });
    this.version(9).stores({
      feeds: 'id, feedUrl, title, updatedAt',
      episodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      states: 'episodeId, played, inboxState, inboxPosition, queuePosition, downloaded, downloadedAt, updatedAt',
      clips: 'id, episodeId, createdAt, updatedAt, renderStatus',
      settings: 'id, updatedAt',
      syncMeta: 'id, deviceId, updatedAt',
      tombstones: 'id, tableName, localId, deletedAt, pushedAt',
      podcastCache: 'id, feedUrl, title, cachedAt, cacheExpiresAt, updatedAt',
      cachedEpisodes: 'id, podcastId, podcastTitle, publishedAt, title, guid, updatedAt',
      podcastPreferences: 'podcastId, updatedAt',
      listeningStats: 'id, updatedAt',
      silenceMaps: 'id, episodeId, audioUrl, status, updatedAt, lastRequestedAt, lastCheckedAt'
    });
  }
}

export const db = new ElephantPodDatabase();

export async function ensureSeedData(): Promise<void> {
  const now = nowIso();
  const settings = await db.settings.get('local');
  if (!settings) {
    await db.settings.put({ ...defaultSettings, deviceId: crypto.randomUUID(), updatedAt: now });
  } else if (!settings.deviceId || !settings.updatedAt || settings.autoDownloadInbox === undefined || settings.autoDeleteAfterListen === undefined || settings.nativeAudioPreferred === undefined || !settings.inboxSortDirection) {
    await db.settings.put({
      ...defaultSettings,
      ...settings,
      autoDownload: settings.autoDownload ?? defaultSettings.autoDownload,
      autoDownloadInbox: settings.autoDownloadInbox ?? defaultSettings.autoDownloadInbox,
      autoDeleteAfterListen: settings.autoDeleteAfterListen ?? defaultSettings.autoDeleteAfterListen,
      nativeAudioPreferred: settings.nativeAudioPreferred ?? defaultSettings.nativeAudioPreferred,
      inboxSortDirection: settings.inboxSortDirection || defaultSettings.inboxSortDirection,
      deviceId: settings.deviceId || crypto.randomUUID(),
      updatedAt: settings.updatedAt || now
    });
  }

  const stats = await db.listeningStats.get('local');
  if (!stats) await db.listeningStats.put(defaultListeningStats());

  const meta = await db.syncMeta.get('main');
  if (!meta) {
    const current = await db.settings.get('local');
    await db.syncMeta.put({ id: 'main', deviceId: current?.deviceId || crypto.randomUUID(), updatedAt: now });
  }

  const feedCount = await db.feeds.count();
  if (feedCount === 0) {
    await db.transaction('rw', db.feeds, db.episodes, db.states, async () => {
      await db.feeds.bulkPut(demoPodcasts);
      await db.episodes.bulkPut(demoEpisodes);
      await db.states.bulkPut(demoEpisodes.map((ep, index) => defaultStateFor(ep.id, index)));
    });
  }
}

function defaultListeningStats(): ListeningStats {
  return {
    id: 'local',
    listeningSec: 0,
    contentSec: 0,
    speedSavedSec: 0,
    silenceSavedSec: 0,
    byPodcast: {},
    updatedAt: nowIso()
  };
}
