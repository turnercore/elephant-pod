import type { AppSettings, EpisodeWithState } from '@/types/domain';
import { deleteEpisodeFromCache, downloadEpisodeToCache, isProbablyWifi, pruneOfflineDownloads } from '../storage/cache';
import { isTauriRuntime } from '../native/tauriBridge';
import { getEpisodeWithState, listCachedEpisodes, listEpisodes, updateEpisodeState } from '../storage/repository';
import { nowIso } from '../dates';

export async function maybeAutoDownload(episodes: EpisodeWithState[], settings: AppSettings): Promise<number> {
  if (settings.downloadOnlyWifi && !isProbablyWifi()) return 0;
  const queued = settings.autoDownload
    ? episodes
      .filter((ep) => ep.state.queuePosition && !ep.state.downloaded)
      .sort((a, b) => (a.state.queuePosition || 0) - (b.state.queuePosition || 0))
      .map((episode) => ({ episode, source: 'queue' as const }))
    : [];
  const inbox = settings.autoDownloadInbox
    ? episodes
      .filter((ep) => ep.state.inboxState === 'new' && ep.state.inboxPosition && !ep.state.queuePosition && !ep.state.played && !ep.state.downloaded)
      .sort((a, b) => {
        const direction = settings.inboxSortDirection || 'newest';
        const dateSort = direction === 'oldest' ? publishedAsc(a, b) : publishedDesc(a, b);
        return dateSort || (a.state.inboxPosition || 0) - (b.state.inboxPosition || 0);
      })
      .map((episode) => ({ episode, source: 'inbox' as const }))
    : [];
  const candidates = [...queued, ...inbox].slice(0, 8);
  let count = 0;
  for (const { episode, source } of candidates) {
    if (!shouldAttemptAutomaticDownload(episode)) continue;
    try {
      const download = await downloadEpisodeToCache(episode);
      await updateEpisodeState(episode.id, {
        downloaded: true,
        downloadedAt: nowIso(),
        downloadPath: download.path,
        downloadBytes: download.bytes,
        downloadBackend: download.backend,
        downloadSource: source
      });
      count += 1;
    } catch {
      // Hosts often block CORS. Native Tauri downloads handle this where available.
    }
  }
  return count;
}

function shouldAttemptAutomaticDownload(episode: EpisodeWithState): boolean {
  if (isTauriRuntime()) return true;
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(episode.audioUrl, window.location.href);
    return url.protocol === 'blob:' || url.protocol === 'data:' || url.origin === window.location.origin;
  } catch {
    return false;
  }
}

export async function deleteDismissedInboxDownload(episode: EpisodeWithState): Promise<void> {
  if (!episode.state.downloaded || episode.state.favorite || episode.state.queuePosition || episode.state.downloadSource === 'manual') return;
  await clearDownload(episode);
}

export async function autoDeleteAfterListen(episode: EpisodeWithState, settings: AppSettings): Promise<void> {
  await deleteInactiveDownloadIfNeeded(episode.id, settings);
}

export async function deleteInactiveDownloadIfNeeded(episodeOrId: EpisodeWithState | string, settings: AppSettings): Promise<boolean> {
  if (!settings.autoDeleteAfterListen) return false;
  const episode = typeof episodeOrId === 'string' ? await getEpisodeWithState(episodeOrId) : episodeOrId;
  if (!episode || !shouldDeleteInactiveDownload(episode)) return false;
  await clearDownload(episode);
  return true;
}

export async function deleteInactiveDownloadsIfNeeded(settings: AppSettings, knownEpisodes?: EpisodeWithState[]): Promise<number> {
  if (!settings.autoDeleteAfterListen) return 0;
  const episodes = uniqueEpisodes(knownEpisodes || [...(await listCachedEpisodes()), ...(await listEpisodes())]);
  let count = 0;
  for (const episode of episodes) {
    if (!shouldDeleteInactiveDownload(episode)) continue;
    await clearDownload(episode);
    count += 1;
  }
  return count;
}

export async function pruneDownloadsOverCap(settings: AppSettings, knownEpisodes?: EpisodeWithState[]): Promise<number> {
  const episodes = (knownEpisodes || await listEpisodes()).filter((episode) => episode.state.downloaded);
  const maxBytes = Math.max(1, settings.storageCapMb) * 1024 * 1024;
  let totalBytes = episodes.reduce((sum, episode) => sum + (episode.state.downloadBytes || estimateEpisodeBytes(episode)), 0);
  if (totalBytes <= maxBytes) return 0;

  let count = 0;
  const queueRanks = rankedIds(episodes.filter((episode) => episode.state.queuePosition).sort((a, b) => (a.state.queuePosition || 0) - (b.state.queuePosition || 0)));
  const inboxRanks = rankedIds(
    episodes
      .filter((episode) => episode.state.inboxState === 'new' && episode.state.inboxPosition && !episode.state.queuePosition && !episode.state.played)
      .sort((a, b) => {
        const direction = settings.inboxSortDirection || 'newest';
        const dateSort = direction === 'oldest' ? publishedAsc(a, b) : publishedDesc(a, b);
        return dateSort || (a.state.inboxPosition || 0) - (b.state.inboxPosition || 0);
      })
  );
  const candidates = [...episodes].sort((a, b) => storagePriority(a, queueRanks, inboxRanks) - storagePriority(b, queueRanks, inboxRanks));
  for (const episode of candidates) {
    if (totalBytes <= maxBytes) break;
    await deleteEpisodeFromCache(episode);
    totalBytes = totalBytes - (episode.state.downloadBytes || estimateEpisodeBytes(episode));
    await updateEpisodeState(episode.id, {
      downloaded: false,
      downloadedAt: undefined,
      downloadPath: undefined,
      downloadBytes: undefined,
      downloadBackend: undefined,
      downloadSource: undefined
    });
    count += 1;
  }

  if (count) return count;
  const deletedIds = await pruneOfflineDownloads(settings.storageCapMb);
  if (!deletedIds.length) return 0;
  const toMark = new Set(deletedIds);
  await Promise.all(
    episodes
      .filter((episode) => toMark.has(episode.id))
      .map((episode) =>
        updateEpisodeState(episode.id, {
          downloaded: false,
          downloadedAt: undefined,
          downloadPath: undefined,
          downloadBytes: undefined,
          downloadBackend: undefined,
          downloadSource: undefined
        })
      )
  );
  return deletedIds.length;
}

function shouldDeleteInactiveDownload(episode: EpisodeWithState): boolean {
  if (!episode.state.downloaded || episode.state.favorite) return false;
  if (episode.state.queuePosition) return false;
  if (episode.state.inboxState === 'new' && episode.state.inboxPosition && !episode.state.played) return false;
  return true;
}

async function clearDownload(episode: EpisodeWithState): Promise<void> {
  await deleteEpisodeFromCache(episode);
  await updateEpisodeState(episode.id, {
    downloaded: false,
    downloadedAt: undefined,
    downloadPath: undefined,
    downloadBytes: undefined,
    downloadBackend: undefined,
    downloadSource: undefined
  });
}

function uniqueEpisodes(episodes: EpisodeWithState[]): EpisodeWithState[] {
  return [...new Map(episodes.map((episode) => [episode.id, episode])).values()];
}

function estimateEpisodeBytes(episode: EpisodeWithState): number {
  return episode.enclosureLength || Math.max(episode.durationSec || 0, 1) * 32_000;
}

function storagePriority(episode: EpisodeWithState, queueRanks: Map<string, number>, inboxRanks: Map<string, number>): number {
  if (episode.state.favorite) return 1_000_000;
  const queueRank = queueRanks.get(episode.id);
  if (queueRank) return 500_000 - queueRank;
  const inboxRank = inboxRanks.get(episode.id);
  if (inboxRank) return 250_000 - inboxRank;
  return 0;
}

function rankedIds(episodes: EpisodeWithState[]): Map<string, number> {
  return new Map(episodes.map((episode, index) => [episode.id, index + 1]));
}

function publishedDesc(a: EpisodeWithState, b: EpisodeWithState): number {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

function publishedAsc(a: EpisodeWithState, b: EpisodeWithState): number {
  return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
}
