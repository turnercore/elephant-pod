import type { CachedPodcast, EpisodeWithState, Podcast } from '@/types/domain';
import { nowIso } from '../dates';
import { db } from './db';

const maxArtworkBytes = 2_000_000;

type ArtworkLibrary = {
  feeds: Podcast[];
  cachedPodcasts: CachedPodcast[];
  episodes: EpisodeWithState[];
  cachedEpisodes: EpisodeWithState[];
};

export async function cacheArtworkForOfflineEpisodes(episodes: EpisodeWithState[], podcasts: Array<Podcast | CachedPodcast>): Promise<number> {
  const podcastById = new Map(podcasts.map((podcast) => [podcast.id, podcast]));
  const urls = new Set<string>();
  for (const episode of episodes.filter((item) => item.state.downloaded)) {
    addCacheableUrl(urls, episode.imageUrl);
    addCacheableUrl(urls, podcastById.get(episode.podcastId)?.imageUrl);
  }
  let cached = 0;
  for (const url of urls) {
    if (await cacheArtworkUrl(url)) cached += 1;
  }
  return cached;
}

export async function hydrateArtworkForLibrary(library: ArtworkLibrary): Promise<ArtworkLibrary & { objectUrls: string[] }> {
  const allUrls = new Set<string>();
  for (const podcast of [...library.feeds, ...library.cachedPodcasts]) addCacheableUrl(allUrls, podcast.imageUrl);
  for (const episode of [...library.episodes, ...library.cachedEpisodes]) addCacheableUrl(allUrls, episode.imageUrl);
  const cached = await db.artworkCache.bulkGet([...allUrls]);
  const cachedUrls = new Map<string, string>();
  const objectUrls: string[] = [];
  for (const entry of cached) {
    if (!entry?.blob) continue;
    const objectUrl = URL.createObjectURL(entry.blob);
    cachedUrls.set(entry.url, objectUrl);
    objectUrls.push(objectUrl);
  }
  const hydrate = <T extends { imageUrl?: string }>(item: T): T => {
    const imageUrl = item.imageUrl ? cachedUrls.get(item.imageUrl) : undefined;
    return imageUrl ? { ...item, imageUrl } : item;
  };
  return {
    feeds: library.feeds.map(hydrate),
    cachedPodcasts: library.cachedPodcasts.map(hydrate),
    episodes: library.episodes.map(hydrate),
    cachedEpisodes: library.cachedEpisodes.map(hydrate),
    objectUrls
  };
}

export function revokeArtworkObjectUrls(urls: string[]): void {
  for (const url of urls) URL.revokeObjectURL(url);
}

async function cacheArtworkUrl(url: string): Promise<boolean> {
  if (await db.artworkCache.get(url)) return false;
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return false;
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxArtworkBytes) return false;
    const blob = await response.blob();
    if (blob.size > maxArtworkBytes || !blob.type.startsWith('image/')) return false;
    const timestamp = nowIso();
    await db.artworkCache.put({
      url,
      blob,
      mimeType: blob.type,
      bytes: blob.size,
      cachedAt: timestamp,
      updatedAt: timestamp
    });
    return true;
  } catch {
    return false;
  }
}

function addCacheableUrl(urls: Set<string>, value: string | undefined): void {
  if (!value || value.startsWith('blob:') || value.startsWith('data:')) return;
  if (!value.startsWith('http://') && !value.startsWith('https://')) return;
  urls.add(value);
}
