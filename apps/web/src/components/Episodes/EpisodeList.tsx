import { Podcast } from 'lucide-react';
import type { EpisodeWithState } from '@/types/domain';
import { EmptyState } from '../EmptyState';
import { EpisodeCard } from './EpisodeCard';

type CardHandlers = Omit<Parameters<typeof EpisodeCard>[0], 'episode' | 'podcastImageUrl'>;

export function EpisodeList({
  episodes,
  podcastImageUrl,
  getPodcastImageUrl,
  ...handlers
}: {
  episodes: EpisodeWithState[];
  podcastImageUrl?: string;
  getPodcastImageUrl?: (podcastId: string) => string | undefined;
} & CardHandlers) {
  if (!episodes.length) {
    return (
      <EmptyState icon={<Podcast size={26} aria-hidden />} title="Nothing here yet">
        Add a feed, refresh your subscriptions, or loosen the active filters.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-3" aria-label="Episode list">
      {episodes.map((episode) => (
        <EpisodeCard key={episode.id} episode={episode} podcastImageUrl={podcastImageUrl || getPodcastImageUrl?.(episode.podcastId)} {...handlers} />
      ))}
    </div>
  );
}
