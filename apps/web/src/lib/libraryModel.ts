import type { CachedPodcast, EpisodeWithState, Podcast, PodcastPreference } from '@/types/domain';

export function deriveLibraryPodcasts(cached: CachedPodcast[], subscribed: Podcast[], episodes: EpisodeWithState[], preferences: PodcastPreference[] = []): CachedPodcast[] {
  const map = new Map<string, CachedPodcast>();
  const libraryIds = new Set(preferences.filter((preference) => preference.inLibrary).map((preference) => preference.podcastId));
  const preferenceByPodcastId = new Map(preferences.map((preference) => [preference.podcastId, preference]));
  for (const podcast of cached) {
    const preference = preferenceByPodcastId.get(podcast.id);
    if (libraryIds.has(podcast.id) || preference?.inLibrary === undefined) map.set(podcast.id, podcast);
  }
  for (const podcast of subscribed) {
    map.set(podcast.id, {
      ...podcast,
      cachedAt: podcast.updatedAt,
      cacheExpiresAt: undefined,
      podcastIndexId: undefined,
      categories: podcast.tags || []
    });
  }
  for (const episode of episodes) {
    if (map.has(episode.podcastId)) continue;
    const preference = preferenceByPodcastId.get(episode.podcastId);
    if (!libraryIds.has(episode.podcastId) && preference?.inLibrary !== undefined) continue;
    const timestamp = episode.updatedAt || episode.publishedAt || new Date().toISOString();
    map.set(episode.podcastId, {
      id: episode.podcastId,
      title: episode.podcastTitle,
      author: undefined,
      description: undefined,
      imageUrl: episode.imageUrl,
      feedUrl: '',
      websiteUrl: undefined,
      tags: [],
      sourceType: undefined,
      sourceUrl: undefined,
      externalId: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      cachedAt: timestamp,
      cacheExpiresAt: undefined,
      podcastIndexId: undefined,
      categories: []
    });
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
}
