import type { AppSettings, EpisodeWithState } from '@/types/domain';
import { deleteEpisodeFromCache, downloadEpisodeToCache, isProbablyWifi, pruneOfflineDownloads } from '../storage/cache';
import { listEpisodes, updateEpisodeState } from '../storage/repository';
import { nowIso } from '../dates';

export async function maybeAutoDownload(episodes: EpisodeWithState[], settings: AppSettings): Promise<number> {
  if (!settings.autoDownload) return 0;
  if (settings.downloadOnlyWifi && !isProbablyWifi()) return 0;
  const candidates = episodes.filter((ep) => ep.state.inboxState === 'queued' && !ep.state.downloaded).slice(0, 5);
  let count = 0;
  for (const episode of candidates) {
    try {
      const download = await downloadEpisodeToCache(episode);
      await updateEpisodeState(episode.id, {
        downloaded: true,
        downloadedAt: nowIso(),
        downloadPath: download.path,
        downloadBytes: download.bytes,
        downloadBackend: download.backend
      });
      count += 1;
    } catch {
      // Hosts often block CORS. Native Tauri downloads handle this where available.
    }
  }
  return count;
}

export async function autoDeleteAfterListen(episode: EpisodeWithState, settings: AppSettings): Promise<void> {
  if (!settings.autoDeleteAfterListen || episode.state.favorite) return;
  await deleteEpisodeFromCache(episode);
  await updateEpisodeState(episode.id, {
    downloaded: false,
    downloadedAt: undefined,
    downloadPath: undefined,
    downloadBytes: undefined,
    downloadBackend: undefined
  });
}

export async function pruneDownloadsOverCap(settings: AppSettings): Promise<number> {
  const deletedIds = await pruneOfflineDownloads(settings.storageCapMb);
  if (!deletedIds.length) return 0;

  const episodes = await listEpisodes();
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
          downloadBackend: undefined
        })
      )
  );
  return deletedIds.length;
}
