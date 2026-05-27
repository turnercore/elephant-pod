import Dexie, { type Table } from 'dexie';
import type { AppSettings, Clip, Episode, EpisodeState, Podcast, SyncMeta, SyncTombstone } from '@/types/domain';
import { defaultSettings, defaultStateFor, demoEpisodes, demoPodcasts } from '../sampleData';
import { nowIso } from '../dates';

export class ElephantEarsDatabase extends Dexie {
  feeds!: Table<Podcast, string>;
  episodes!: Table<Episode, string>;
  states!: Table<EpisodeState, string>;
  clips!: Table<Clip, string>;
  settings!: Table<AppSettings, string>;
  syncMeta!: Table<SyncMeta, string>;
  tombstones!: Table<SyncTombstone, string>;

  constructor() {
    super('elephant-ears');
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
      states: 'episodeId, played, inboxState, queuePosition, downloaded, downloadedAt, updatedAt',
      clips: 'id, episodeId, createdAt, updatedAt, renderStatus',
      settings: 'id, updatedAt',
      syncMeta: 'id, deviceId, updatedAt',
      tombstones: 'id, tableName, localId, deletedAt, pushedAt'
    });
  }
}

export const db = new ElephantEarsDatabase();

export async function ensureSeedData(): Promise<void> {
  const now = nowIso();
  const settings = await db.settings.get('local');
  if (!settings) {
    await db.settings.put({ ...defaultSettings, deviceId: crypto.randomUUID(), updatedAt: now });
  } else if (!settings.deviceId || !settings.updatedAt) {
    await db.settings.put({ ...defaultSettings, ...settings, deviceId: settings.deviceId || crypto.randomUUID(), updatedAt: settings.updatedAt || now });
  }

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
