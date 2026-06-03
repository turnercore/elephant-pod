import type { DownloadBackend, EpisodeWithState } from '@/types/domain';
import {
  isTauriRuntime,
  nativeDeleteEpisode,
  nativeDownloadEpisode,
  nativeDownloadedFileUrl,
  nativeDownloadedUrl,
  nativePruneDownloads,
  nativeStorageStats,
  toNativeFileUrl,
  safeEpisodeFileName
} from '../native/tauriBridge';

const CACHE_NAME = 'elephant-pod-episode-cache-v2';

export interface DownloadOutcome {
  backend: DownloadBackend;
  path?: string;
  bytes?: number;
}

export function canUseCacheStorage(): boolean {
  return typeof caches !== 'undefined';
}

export async function downloadEpisodeToCache(episode: EpisodeWithState): Promise<DownloadOutcome> {
  if (isTauriRuntime()) {
    const native = await nativeDownloadEpisode({
      episodeId: episode.id,
      audioUrl: episode.audioUrl,
      fileName: safeEpisodeFileName(episode)
    });
    if (native) {
      return { backend: 'tauri-filesystem', path: native.path, bytes: native.bytes };
    }
  }

  if (!canUseCacheStorage()) throw new Error('Cache Storage is unavailable in this environment.');
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(episode.audioUrl, { mode: 'cors' });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const clone = response.clone();
  await cache.put(episode.audioUrl, response);
  const bytes = Number(clone.headers.get('content-length') || episode.enclosureLength || 0) || undefined;
  return { backend: 'browser-cache', bytes };
}

export async function deleteEpisodeFromCache(episode: EpisodeWithState): Promise<void> {
  if (isTauriRuntime()) {
    await nativeDeleteEpisode(episode.id);
    return;
  }
  if (!canUseCacheStorage()) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(episode.audioUrl);
}

export async function getCachedEpisodeUrl(episode: EpisodeWithState): Promise<string> {
  if (isTauriRuntime() && episode.state.downloaded) {
    const nativeUrl = await nativeDownloadedUrl(episode.id);
    if (nativeUrl) return nativeUrl;
  }

  if (!canUseCacheStorage()) return episode.audioUrl;
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(episode.audioUrl);
  if (!response) return episode.audioUrl;
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function getNativePlaybackEpisodeUrl(episode: EpisodeWithState): Promise<string> {
  if (isTauriRuntime() && episode.state.downloaded) {
    const fileUrl = await nativeDownloadedFileUrl(episode.id);
    if (fileUrl) return fileUrl;
    if (episode.state.downloadPath) return toNativeFileUrl(episode.state.downloadPath);
  }
  return episode.audioUrl;
}

export async function estimateStorageMb(): Promise<number> {
  if (isTauriRuntime()) {
    const native = await nativeStorageStats();
    if (native) return Math.round((native.bytes / 1024 / 1024) * 10) / 10;
  }
  if (!navigator.storage?.estimate) return 0;
  const estimate = await navigator.storage.estimate();
  return Math.round(((estimate.usage || 0) / 1024 / 1024) * 10) / 10;
}

export async function pruneOfflineDownloads(storageCapMb: number): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  const maxBytes = Math.max(1, storageCapMb) * 1024 * 1024;
  return (await nativePruneDownloads(maxBytes)) || [];
}

export function isProbablyWifi(): boolean {
  const connection = (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }).connection;
  if (!connection) return true;
  if (connection.type) return connection.type === 'wifi' || connection.type === 'ethernet';
  return connection.effectiveType !== '2g' && connection.effectiveType !== 'slow-2g';
}
