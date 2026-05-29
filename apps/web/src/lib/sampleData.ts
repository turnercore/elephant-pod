import type { AppSettings, Episode, EpisodeState, Podcast } from '@/types/domain';
import { nowIso } from './dates';
import { stableId } from './ids';

const createdAt = '2026-05-27T08:00:00.000Z';

export const defaultSettings: AppSettings = {
  id: 'local',
  skipForwardSec: 30,
  skipBackSec: 15,
  resumeRewindSec: 8,
  playbackRate: 1,
  autoPlayNext: true,
  autoDownload: true,
  autoDownloadInbox: false,
  autoDeleteAfterListen: true,
  downloadOnlyWifi: true,
  storageCapMb: 2048,
  inboxSortDirection: 'newest',
  refreshIntervalMinutes: 720,
  silenceShortening: false,
  silenceShorteningMode: 'server-ffmpeg',
  silenceThreshold: 0.018,
  silenceThresholdDb: -42,
  silenceMinMs: 350,
  silenceBoostRate: 2.15,
  smartSkipEnabled: true,
  smartSkipAds: true,
  smartSkipSponsors: true,
  smartSkipIntros: false,
  smartSkipOutros: false,
  smartSkipNetworkPromos: true,
  smartSkipSelfPromos: false,
  smartSkipSilence: false,
  smartSkipSoftPrompt: true,
  smartSkipUseServerMedia: true,
  nativeAudioPreferred: true,
  serverUrl: import.meta.env.VITE_API_BASE_URL || '',
  theme: 'dark',
  updatedAt: nowIso()
};

export const demoPodcasts: Podcast[] = [
  {
    id: stableId('elephant-pod-show', 'feed'),
    title: 'Elephant Pod Field Notes',
    author: 'Elephant Hand Games',
    description: 'Design notes, devlogs, and strange little systems for people who never forget the fun.',
    imageUrl: '',
    feedUrl: 'https://example.com/elephant-pod.xml',
    websiteUrl: 'https://elephanthand.com',
    tags: ['studio', 'design'],
    createdAt,
    updatedAt: createdAt,
    lastRefreshedAt: createdAt
  },
  {
    id: stableId('open-podcast-lab', 'feed'),
    title: 'Open Podcast Lab',
    author: 'Local First Radio',
    description: 'A demo feed for testing queueing, sync, RSS, and offline flows.',
    imageUrl: '',
    feedUrl: 'https://example.com/open-podcast-lab.xml',
    websiteUrl: 'https://example.com',
    tags: ['tech', 'local-first'],
    createdAt,
    updatedAt: createdAt,
    lastRefreshedAt: createdAt
  }
];

function episode(feed: Podcast, n: number, title: string, daysAgo: number, durationSec: number): Episode {
  const published = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return {
    id: stableId(`${feed.id}:${n}:${title}`, 'ep'),
    podcastId: feed.id,
    podcastTitle: feed.title,
    title,
    description:
      'Demo episode with chapters, playback state, queue actions, and local-first persistence. Replace this seed data by adding real RSS feeds.',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    websiteUrl: feed.websiteUrl,
    imageUrl: feed.imageUrl,
    publishedAt: published,
    durationSec,
    explicit: false,
    chapters: [
      { id: stableId(`${title}:intro`, 'ch'), title: 'Cold open', startsAt: 0 },
      { id: stableId(`${title}:main`, 'ch'), title: 'Main idea', startsAt: Math.floor(durationSec * 0.22) },
      { id: stableId(`${title}:toolkit`, 'ch'), title: 'Toolkit', startsAt: Math.floor(durationSec * 0.55) },
      { id: stableId(`${title}:wrap`, 'ch'), title: 'Wrap', startsAt: Math.floor(durationSec * 0.83) }
    ],
    guid: `${feed.feedUrl}#${n}`,
    enclosureLength: durationSec * 32000,
    createdAt: published,
    updatedAt: nowIso()
  };
}

export const demoEpisodes: Episode[] = [
  episode(demoPodcasts[0], 1, 'Inbox, Queue, and the Shape of Attention', 1, 3280),
  episode(demoPodcasts[0], 2, 'Designing With Fewer Words and Better Buttons', 5, 2470),
  episode(demoPodcasts[0], 3, 'The Local-First Listening Machine', 9, 3860),
  episode(demoPodcasts[1], 1, 'RSS Is Still the Good Weird Internet', 2, 2920),
  episode(demoPodcasts[1], 2, 'Sync Without Surrender', 6, 3120),
  episode(demoPodcasts[1], 3, 'Podcast Apps Are Not Music Apps', 10, 4210)
];

export function defaultStateFor(episodeId: string, index = 0): EpisodeState {
  return {
    episodeId,
    played: false,
    progressSec: 0,
    inboxState: index < 4 ? 'new' : 'archived',
    inboxPosition: index < 4 ? index + 1 : undefined,
    downloaded: false,
    favorite: false,
    clipCount: 0,
    updatedAt: nowIso()
  };
}
