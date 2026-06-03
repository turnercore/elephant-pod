import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveLibraryPodcasts } from './libraryModel';
import type { CachedPodcast, EpisodeWithState, Podcast } from '@/types/domain';

describe('deriveLibraryPodcasts', () => {
  it('keeps subscribed feed-only podcasts in the library', () => {
    const library = deriveLibraryPodcasts([], [podcastFixture({ id: 'subscribed', title: 'Subscribed Show' })], []);

    assert.deepEqual(library.map((podcast) => podcast.id), ['subscribed']);
    assert.equal(library[0]?.title, 'Subscribed Show');
  });

  it('keeps podcasts represented only by downloaded, queued, or inbox episodes in the library', () => {
    const library = deriveLibraryPodcasts([], [], [
      episodeFixture({
        id: 'episode-1',
        podcastId: 'episode-only',
        podcastTitle: 'Episode Only Show',
        imageUrl: 'https://example.com/show.jpg'
      })
    ]);

    assert.equal(library[0]?.id, 'episode-only');
    assert.equal(library[0]?.imageUrl, 'https://example.com/show.jpg');
  });

  it('prefers cached podcast metadata over episode fallback metadata', () => {
    const cached = cachedPodcastFixture({ id: 'show', title: 'Cached Title', imageUrl: 'https://example.com/cached.jpg' });
    const library = deriveLibraryPodcasts([cached], [], [
      episodeFixture({ id: 'episode-1', podcastId: 'show', podcastTitle: 'Fallback Title', imageUrl: 'https://example.com/fallback.jpg' })
    ]);

    assert.equal(library[0]?.title, 'Cached Title');
    assert.equal(library[0]?.imageUrl, 'https://example.com/cached.jpg');
  });
});

function podcastFixture(overrides: Partial<Podcast> = {}): Podcast {
  const timestamp = '2026-06-03T00:00:00.000Z';
  return {
    id: 'podcast',
    title: 'Podcast',
    feedUrl: 'https://example.com/feed.xml',
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function cachedPodcastFixture(overrides: Partial<CachedPodcast> = {}): CachedPodcast {
  const podcast = podcastFixture(overrides);
  return {
    ...podcast,
    cachedAt: podcast.updatedAt,
    categories: [],
    ...overrides
  };
}

function episodeFixture(overrides: Partial<EpisodeWithState> = {}): EpisodeWithState {
  const timestamp = '2026-06-03T00:00:00.000Z';
  return {
    id: 'episode',
    podcastId: 'podcast',
    podcastTitle: 'Podcast',
    title: 'Episode',
    audioUrl: 'https://example.com/episode.mp3',
    publishedAt: timestamp,
    chapters: [],
    guid: 'episode-guid',
    createdAt: timestamp,
    updatedAt: timestamp,
    state: {
      episodeId: 'episode',
      played: false,
      progressSec: 0,
      inboxState: 'new',
      downloaded: true,
      favorite: false,
      clipCount: 0,
      updatedAt: timestamp
    },
    ...overrides
  };
}
