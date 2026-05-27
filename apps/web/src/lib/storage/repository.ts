import type { AppSettings, BackupFile, Clip, Episode, EpisodeState, EpisodeWithState, Podcast, ParsedFeedResult } from '@/types/domain';
import { nowIso } from '../dates';
import { defaultStateFor } from '../sampleData';
import { db } from './db';

export async function getSettings(): Promise<AppSettings> {
  const settings = await db.settings.get('local');
  if (!settings) throw new Error('Settings missing. Call ensureSeedData first.');
  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put({ ...settings, id: 'local', updatedAt: nowIso() });
}

export async function listFeeds(): Promise<Podcast[]> {
  return db.feeds.orderBy('title').toArray();
}

export async function listEpisodes(): Promise<EpisodeWithState[]> {
  const [episodes, states] = await Promise.all([db.episodes.toArray(), db.states.toArray()]);
  const map = new Map(states.map((s) => [s.episodeId, s]));
  return episodes.map((ep, index) => ({ ...ep, state: map.get(ep.id) || defaultStateFor(ep.id, index) }));
}

export async function listClips(): Promise<Clip[]> {
  return db.clips.orderBy('createdAt').reverse().toArray();
}

export async function upsertParsedFeed(result: ParsedFeedResult): Promise<void> {
  const timestamp = nowIso();
  await db.transaction('rw', db.feeds, db.episodes, db.states, async () => {
    await db.feeds.put({ ...result.podcast, updatedAt: timestamp, lastRefreshedAt: timestamp });
    for (const ep of result.episodes) {
      const existing = await db.episodes.get(ep.id);
      await db.episodes.put({ ...existing, ...ep, updatedAt: timestamp });
      const state = await db.states.get(ep.id);
      if (!state) await db.states.put(defaultStateFor(ep.id));
    }
  });
}

export async function updateEpisodeState(episodeId: string, patch: Partial<EpisodeState>): Promise<void> {
  const existing = await db.states.get(episodeId);
  const state = existing || defaultStateFor(episodeId);
  await db.states.put({ ...state, ...patch, updatedAt: nowIso() });
}

export async function queueEpisode(episodeId: string): Promise<void> {
  const states = await db.states.toArray();
  const max = states.reduce((acc, state) => Math.max(acc, state.queuePosition || 0), 0);
  await updateEpisodeState(episodeId, {
    inboxState: 'queued',
    queuedAt: nowIso(),
    queuePosition: max + 1
  });
}

export async function removeFromQueue(episodeId: string): Promise<void> {
  await updateEpisodeState(episodeId, { queuePosition: undefined, queuedAt: undefined });
  await normalizeQueuePositions();
}

export async function moveInQueue(episodeId: string, direction: -1 | 1): Promise<void> {
  const states = (await db.states.toArray())
    .filter((s) => s.queuePosition)
    .sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0));
  const index = states.findIndex((s) => s.episodeId === episodeId);
  const swapIndex = index + direction;
  if (index < 0 || swapIndex < 0 || swapIndex >= states.length) return;
  const a = states[index];
  const b = states[swapIndex];
  await Promise.all([
    updateEpisodeState(a.episodeId, { queuePosition: b.queuePosition }),
    updateEpisodeState(b.episodeId, { queuePosition: a.queuePosition })
  ]);
}

export async function normalizeQueuePositions(): Promise<void> {
  const queued = (await db.states.toArray())
    .filter((s) => s.queuePosition)
    .sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0));
  await db.transaction('rw', db.states, async () => {
    for (let i = 0; i < queued.length; i += 1) {
      await db.states.put({ ...queued[i], queuePosition: i + 1, updatedAt: nowIso() });
    }
  });
}

export async function markAllInFeedPlayed(podcastId: string): Promise<void> {
  const episodes = await db.episodes.where('podcastId').equals(podcastId).toArray();
  await Promise.all(
    episodes.map((ep) =>
      updateEpisodeState(ep.id, {
        played: true,
        playedAt: nowIso(),
        inboxState: 'archived',
        queuePosition: undefined
      })
    )
  );
  await normalizeQueuePositions();
}

export async function saveClip(clip: Clip): Promise<void> {
  await db.clips.put({ ...clip, updatedAt: nowIso() });
  const state = await db.states.get(clip.episodeId);
  await updateEpisodeState(clip.episodeId, { clipCount: (state?.clipCount || 0) + 1 });
}

export async function exportBackup(): Promise<BackupFile> {
  const [feeds, episodes, states, clips, settings, syncMeta, tombstones] = await Promise.all([
    db.feeds.toArray(),
    db.episodes.toArray(),
    db.states.toArray(),
    db.clips.toArray(),
    getSettings(),
    db.syncMeta.toArray(),
    db.tombstones.toArray()
  ]);
  return { version: 2, exportedAt: nowIso(), feeds, episodes, states, clips, settings, syncMeta, tombstones };
}

export async function importBackup(backup: BackupFile): Promise<void> {
  if (backup.version !== 1 && backup.version !== 2) throw new Error('Unsupported backup version.');
  await db.transaction('rw', [db.feeds, db.episodes, db.states, db.clips, db.settings, db.syncMeta, db.tombstones], async () => {
    await db.feeds.bulkPut(backup.feeds);
    await db.episodes.bulkPut(backup.episodes as Episode[]);
    await db.states.bulkPut(backup.states);
    await db.clips.bulkPut(backup.clips);
    await db.settings.put({ ...backup.settings, id: 'local', updatedAt: backup.settings.updatedAt || nowIso() });
    if (backup.syncMeta?.length) await db.syncMeta.bulkPut(backup.syncMeta);
    if (backup.tombstones?.length) await db.tombstones.bulkPut(backup.tombstones);
  });
}

export async function deletePlayedDownloadsIfNeeded(autoDelete: boolean): Promise<void> {
  if (!autoDelete) return;
  const playedDownloads = await db.states.where('downloaded').equals(1).and((s) => s.played && !s.favorite).toArray();
  await Promise.all(
    playedDownloads.map((state) =>
      updateEpisodeState(state.episodeId, {
        downloaded: false,
        downloadedAt: undefined,
        downloadPath: undefined,
        downloadBytes: undefined,
        downloadBackend: undefined
      })
    )
  );
}
