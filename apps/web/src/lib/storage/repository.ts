import type { AppSettings, BackupFile, CachedPodcast, Clip, Episode, EpisodeState, EpisodeWithState, ListeningStats, Podcast, PodcastPreference, ParsedFeedResult, SortDirection } from '@/types/domain';
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

export async function getEpisodeWithState(episodeId: string): Promise<EpisodeWithState | null> {
  const [episode, cachedEpisode, state] = await Promise.all([
    db.episodes.get(episodeId),
    db.cachedEpisodes.get(episodeId),
    db.states.get(episodeId)
  ]);
  const found = episode || cachedEpisode;
  if (!found) return null;
  return { ...found, state: state || defaultStateFor(found.id) };
}

export async function listCachedPodcasts(): Promise<CachedPodcast[]> {
  return db.podcastCache.orderBy('title').toArray();
}

export async function listPodcastPreferences(): Promise<PodcastPreference[]> {
  return db.podcastPreferences.toArray();
}

export async function getListeningStats(): Promise<ListeningStats> {
  const stats = await db.listeningStats.get('local');
  return stats || emptyListeningStats();
}

export async function addListeningSample(sample: {
  episode: EpisodeWithState;
  listeningSec: number;
  contentSec: number;
  speedSavedSec: number;
  silenceSavedSec: number;
}): Promise<void> {
  const listeningSec = clampTelemetry(sample.listeningSec);
  const contentSec = clampTelemetry(sample.contentSec);
  const speedSavedSec = clampTelemetry(sample.speedSavedSec);
  const silenceSavedSec = clampTelemetry(sample.silenceSavedSec);
  if (listeningSec <= 0 && contentSec <= 0 && speedSavedSec <= 0 && silenceSavedSec <= 0) return;

  const timestamp = nowIso();
  const current = await getListeningStats();
  const existingPodcast = current.byPodcast[sample.episode.podcastId] || {
    podcastId: sample.episode.podcastId,
    podcastTitle: sample.episode.podcastTitle,
    listeningSec: 0,
    contentSec: 0,
    speedSavedSec: 0,
    silenceSavedSec: 0,
    updatedAt: timestamp
  };
  const next: ListeningStats = {
    ...current,
    listeningSec: current.listeningSec + listeningSec,
    contentSec: current.contentSec + contentSec,
    speedSavedSec: current.speedSavedSec + speedSavedSec,
    silenceSavedSec: current.silenceSavedSec + silenceSavedSec,
    byPodcast: {
      ...current.byPodcast,
      [sample.episode.podcastId]: {
        ...existingPodcast,
        podcastTitle: sample.episode.podcastTitle,
        listeningSec: existingPodcast.listeningSec + listeningSec,
        contentSec: existingPodcast.contentSec + contentSec,
        speedSavedSec: existingPodcast.speedSavedSec + speedSavedSec,
        silenceSavedSec: existingPodcast.silenceSavedSec + silenceSavedSec,
        updatedAt: timestamp
      }
    },
    updatedAt: timestamp
  };
  await db.listeningStats.put(next);
}

export async function listCachedEpisodes(podcastId?: string): Promise<EpisodeWithState[]> {
  const [episodes, states] = await Promise.all([
    podcastId ? db.cachedEpisodes.where('podcastId').equals(podcastId).toArray() : db.cachedEpisodes.toArray(),
    db.states.toArray()
  ]);
  const map = new Map(states.map((state) => [state.episodeId, state]));
  return episodes.map((episode, index) => ({ ...episode, state: map.get(episode.id) || defaultStateFor(episode.id, index) }));
}

export async function listClips(): Promise<Clip[]> {
  return db.clips.orderBy('createdAt').reverse().toArray();
}

export async function upsertParsedFeed(result: ParsedFeedResult): Promise<void> {
  const timestamp = nowIso();
  await db.transaction('rw', [db.feeds, db.episodes, db.states, db.podcastCache, db.cachedEpisodes, db.podcastPreferences], async () => {
    await db.feeds.put({ ...result.podcast, updatedAt: timestamp, lastRefreshedAt: timestamp });
    await putPodcastCache(result, timestamp);
    await ensurePodcastPreference(result.podcast.id);
    for (const ep of result.episodes) {
      const existing = await db.episodes.get(ep.id);
      await db.episodes.put({ ...existing, ...ep, updatedAt: timestamp });
      await db.cachedEpisodes.put({ ...existing, ...ep, updatedAt: timestamp });
      const state = await db.states.get(ep.id);
      if (!state) await db.states.put(defaultStateFor(ep.id));
    }
  });
}

export async function cacheParsedPodcast(result: ParsedFeedResult, podcastIndexId?: string): Promise<void> {
  const timestamp = nowIso();
  await db.transaction('rw', [db.podcastCache, db.cachedEpisodes, db.states, db.podcastPreferences], async () => {
    await putPodcastCache(result, timestamp, podcastIndexId);
    await ensurePodcastPreference(result.podcast.id);
    for (const ep of result.episodes) {
      const existing = await db.cachedEpisodes.get(ep.id);
      await db.cachedEpisodes.put({ ...existing, ...ep, updatedAt: timestamp });
      const state = await db.states.get(ep.id);
      if (!state) await db.states.put({ ...defaultStateFor(ep.id), inboxState: 'archived', inboxPosition: undefined });
    }
  });
}

export async function subscribeCachedPodcast(podcastId: string): Promise<void> {
  const [podcast, episodes] = await Promise.all([
    db.podcastCache.get(podcastId),
    db.cachedEpisodes.where('podcastId').equals(podcastId).toArray()
  ]);
  if (!podcast) throw new Error('Podcast is not cached yet.');
  const timestamp = nowIso();
  await db.transaction('rw', [db.feeds, db.episodes, db.states, db.podcastPreferences], async () => {
    await db.feeds.put(toSubscribedPodcast(podcast, timestamp));
    await ensurePodcastPreference(podcast.id);
    const preference = (await db.podcastPreferences.get(podcast.id)) || defaultPodcastPreference(podcast.id);
    for (const episode of episodes) {
      await db.episodes.put({ ...episode, updatedAt: timestamp });
      const state = await db.states.get(episode.id);
	      if (!state) {
	        await db.states.put({
	          ...defaultStateFor(episode.id),
	          inboxState: preference.addNewEpisodesToInbox ? 'new' : 'archived',
	          inboxPosition: preference.addNewEpisodesToInbox ? await nextInboxPosition() : undefined,
	          updatedAt: timestamp
	        });
	      }
    }
  });
}

export async function unsubscribePodcast(podcastId: string): Promise<void> {
  await db.feeds.delete(podcastId);
}

export async function updateEpisodeState(episodeId: string, patch: Partial<EpisodeState>): Promise<void> {
  const existing = await db.states.get(episodeId);
  const state = existing || defaultStateFor(episodeId);
  const next = { ...state, ...patch, updatedAt: nowIso() };
  if (next.queuePosition) {
    next.inboxState = 'archived';
    next.inboxPosition = undefined;
  }
  if (next.inboxState === 'new') {
    next.queuePosition = undefined;
    next.queuedAt = undefined;
  } else {
    next.inboxPosition = undefined;
  }
  if (next.played) {
    next.inboxState = 'archived';
    next.inboxPosition = undefined;
  }
  await db.states.put(next);
}

export async function queueEpisode(episodeId: string): Promise<void> {
  await addEpisodeToQueueEnd(episodeId);
}

export async function addEpisodeToQueueEnd(episodeId: string): Promise<void> {
  const states = await db.states.toArray();
  const max = states.reduce((acc, state) => Math.max(acc, state.queuePosition || 0), 0);
	  await updateEpisodeState(episodeId, {
	    inboxState: 'archived',
	    inboxPosition: undefined,
	    queuedAt: nowIso(),
	    queuePosition: max + 1
	  });
	  await normalizeInboxPositions();
	}

export async function addEpisodeToQueueNext(episodeId: string): Promise<void> {
  await insertEpisodeAtQueuePosition(episodeId, 1);
}

export async function playEpisodeAtQueueTop(episodeId: string): Promise<void> {
  await insertEpisodeAtQueuePosition(episodeId, 1);
  await updateEpisodeState(episodeId, { lastPlayedAt: nowIso() });
}

export async function reorderQueue(episodeId: string, targetPosition: number): Promise<void> {
  await insertEpisodeAtQueuePosition(episodeId, targetPosition);
}

async function insertEpisodeAtQueuePosition(episodeId: string, targetPosition: number): Promise<void> {
  const timestamp = nowIso();
  await db.transaction('rw', db.states, async () => {
    const states = (await db.states.toArray())
      .filter((state) => state.queuePosition && state.episodeId !== episodeId)
      .sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0));
    const position = Math.max(1, Math.min(targetPosition, states.length + 1));
    const existing = await db.states.get(episodeId);
    const nextStates: EpisodeState[] = [];
    let inserted = false;
    for (let index = 0; index < states.length; index += 1) {
      if (!inserted && index + 1 === position) {
	        nextStates.push({ ...(existing || defaultStateFor(episodeId)), inboxState: 'archived', inboxPosition: undefined, queuedAt: timestamp, queuePosition: nextStates.length + 1, updatedAt: timestamp });
        inserted = true;
      }
      nextStates.push({ ...states[index], queuePosition: nextStates.length + 1, updatedAt: timestamp });
    }
    if (!inserted) {
	      nextStates.push({ ...(existing || defaultStateFor(episodeId)), inboxState: 'archived', inboxPosition: undefined, queuedAt: timestamp, queuePosition: nextStates.length + 1, updatedAt: timestamp });
	    }
	    await db.states.bulkPut(nextStates);
	  });
	  await normalizeInboxPositions();
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
  const [subscribed, cached] = await Promise.all([
    db.episodes.where('podcastId').equals(podcastId).toArray(),
    db.cachedEpisodes.where('podcastId').equals(podcastId).toArray()
  ]);
  const episodes = uniqueEpisodes([...subscribed, ...cached]);
  await Promise.all(
    episodes.map((ep) =>
      updateEpisodeState(ep.id, {
	        played: true,
	        playedAt: nowIso(),
	        inboxState: 'archived',
	        inboxPosition: undefined,
	        queuePosition: undefined
	      })
    )
  );
  await normalizeQueuePositions();
}

export async function markAllInFeedUnplayed(podcastId: string): Promise<void> {
  const [subscribed, cached] = await Promise.all([
    db.episodes.where('podcastId').equals(podcastId).toArray(),
    db.cachedEpisodes.where('podcastId').equals(podcastId).toArray()
  ]);
  const episodes = uniqueEpisodes([...subscribed, ...cached]);
  await Promise.all(
    episodes.map((ep) =>
      updateEpisodeState(ep.id, {
        played: false,
        playedAt: undefined,
        progressSec: 0
      })
    )
  );
}

export async function sendAllUnplayedToInbox(podcastId: string): Promise<void> {
  const episodes = await listCachedEpisodes(podcastId);
	  for (const episode of episodes.filter((candidate) => !candidate.state.played)) {
	    await updateEpisodeState(episode.id, { inboxState: 'new', inboxPosition: await nextInboxPosition(), queuePosition: undefined, queuedAt: undefined });
	  }
	  await normalizeQueuePositions();
	  await normalizeInboxPositions();
	}
	
	export async function sendEpisodeToInbox(episodeId: string): Promise<void> {
	  await updateEpisodeState(episodeId, { inboxState: 'new', inboxPosition: await nextInboxPosition(), queuePosition: undefined, queuedAt: undefined });
	  await normalizeQueuePositions();
	  await normalizeInboxPositions();
	}

export async function getPodcastPreference(podcastId: string): Promise<PodcastPreference> {
  return (await db.podcastPreferences.get(podcastId)) || defaultPodcastPreference(podcastId);
}

export async function savePodcastPreference(preference: PodcastPreference): Promise<void> {
  await db.podcastPreferences.put({ ...preference, updatedAt: nowIso() });
}

export async function saveClip(clip: Clip): Promise<void> {
  await db.clips.put({ ...clip, updatedAt: nowIso() });
  const state = await db.states.get(clip.episodeId);
  await updateEpisodeState(clip.episodeId, { clipCount: (state?.clipCount || 0) + 1 });
}

export async function exportBackup(): Promise<BackupFile> {
  const [feeds, episodes, states, clips, settings, syncMeta, tombstones, podcastPreferences, podcastCache, cachedEpisodes, listeningStats] = await Promise.all([
    db.feeds.toArray(),
    db.episodes.toArray(),
    db.states.toArray(),
    db.clips.toArray(),
    getSettings(),
    db.syncMeta.toArray(),
    db.tombstones.toArray(),
    db.podcastPreferences.toArray(),
    db.podcastCache.toArray(),
    db.cachedEpisodes.toArray(),
    getListeningStats()
  ]);
  return { version: 2, exportedAt: nowIso(), feeds, episodes, states, clips, settings, syncMeta, tombstones, podcastPreferences, podcastCache, cachedEpisodes, listeningStats };
}

export async function importBackup(backup: BackupFile): Promise<void> {
  if (backup.version !== 1 && backup.version !== 2) throw new Error('Unsupported backup version.');
  await db.transaction('rw', [db.feeds, db.episodes, db.states, db.clips, db.settings, db.syncMeta, db.tombstones, db.podcastPreferences, db.podcastCache, db.cachedEpisodes, db.listeningStats], async () => {
    await db.feeds.bulkPut(backup.feeds);
    await db.episodes.bulkPut(backup.episodes as Episode[]);
    await db.states.bulkPut(backup.states);
    await db.clips.bulkPut(backup.clips);
    await db.settings.put({ ...backup.settings, id: 'local', updatedAt: backup.settings.updatedAt || nowIso() });
    if (backup.syncMeta?.length) await db.syncMeta.bulkPut(backup.syncMeta);
    if (backup.tombstones?.length) await db.tombstones.bulkPut(backup.tombstones);
    if (backup.podcastPreferences?.length) await db.podcastPreferences.bulkPut(backup.podcastPreferences);
    if (backup.podcastCache?.length) await db.podcastCache.bulkPut(backup.podcastCache);
    if (backup.cachedEpisodes?.length) await db.cachedEpisodes.bulkPut(backup.cachedEpisodes);
    if (backup.listeningStats) await db.listeningStats.put({ ...emptyListeningStats(), ...backup.listeningStats, id: 'local', updatedAt: backup.listeningStats.updatedAt || nowIso() });
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
        downloadBackend: undefined,
        downloadSource: undefined
      })
    )
  );
}

function defaultPodcastPreference(podcastId: string): PodcastPreference {
  return {
    podcastId,
    skipIntroSec: 0,
    skipOutroSec: 0,
    sortDirection: 'newest',
    addNewEpisodesToInbox: true,
    updatedAt: nowIso()
  };
}

async function ensurePodcastPreference(podcastId: string): Promise<void> {
  const existing = await db.podcastPreferences.get(podcastId);
  if (!existing) await db.podcastPreferences.put(defaultPodcastPreference(podcastId));
}

function emptyListeningStats(): ListeningStats {
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

function clampTelemetry(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 120);
}

function toSubscribedPodcast(podcast: CachedPodcast, timestamp: string): Podcast {
  return {
    id: podcast.id,
    title: podcast.title,
    author: podcast.author,
    description: podcast.description,
    imageUrl: podcast.imageUrl,
    feedUrl: podcast.feedUrl,
    websiteUrl: podcast.websiteUrl,
    tags: podcast.tags || podcast.categories || [],
    createdAt: podcast.createdAt || timestamp,
    updatedAt: timestamp,
    lastRefreshedAt: timestamp
  };
}

async function putPodcastCache(result: ParsedFeedResult, timestamp: string, podcastIndexId?: string): Promise<void> {
  const existing = await db.podcastCache.get(result.podcast.id);
  await db.podcastCache.put({
    ...result.podcast,
    categories: existing?.categories || result.podcast.tags || [],
    podcastIndexId: podcastIndexId || existing?.podcastIndexId,
    cachedAt: timestamp,
    cacheExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: timestamp
  });
}

function uniqueEpisodes(episodes: Episode[]): Episode[] {
  return [...new Map(episodes.map((episode) => [episode.id, episode])).values()];
}

async function nextInboxPosition(): Promise<number> {
  const states = await db.states.toArray();
  return states.reduce((acc, state) => Math.max(acc, state.inboxPosition || 0), 0) + 1;
}

export async function normalizeInboxPositions(): Promise<void> {
  const states = await db.states.toArray();
  const inbox = states
    .filter((state) => state.inboxState === 'new' && !state.queuePosition && !state.played)
    .sort((a, b) => (a.inboxPosition || 0) - (b.inboxPosition || 0));
  const timestamp = nowIso();
  await db.transaction('rw', db.states, async () => {
    for (let index = 0; index < inbox.length; index += 1) {
      await db.states.put({ ...inbox[index], inboxPosition: index + 1, updatedAt: timestamp });
    }
    const notInbox = states.filter((state) => state.inboxPosition && (state.inboxState !== 'new' || state.queuePosition || state.played));
    for (const state of notInbox) {
      await db.states.put({ ...state, inboxPosition: undefined, updatedAt: timestamp });
    }
  });
}
