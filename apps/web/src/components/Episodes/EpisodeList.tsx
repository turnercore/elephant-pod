import { Podcast } from 'lucide-react';
import type { EpisodeWithState } from '@/types/domain';
import { EmptyState } from '../EmptyState';
import { EpisodeCard } from './EpisodeCard';

type CardHandlers = Omit<Parameters<typeof EpisodeCard>[0], 'episode'>;

export function EpisodeList({ episodes, ...handlers }: { episodes: EpisodeWithState[] } & CardHandlers) {
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
        <EpisodeCard key={episode.id} episode={episode} {...handlers} />
      ))}
    </div>
  );
}
