import { LuPodcast as Podcast } from 'react-icons/lu';
import type { EpisodeWithState } from '@/types/domain';
import { EmptyState } from '../EmptyState';
import { EpisodeCard } from './EpisodeCard';

type CardHandlers = Omit<Parameters<typeof EpisodeCard>[0], 'episode' | 'podcastImageUrl'>;

export function EpisodeList({
  episodes,
  podcastImageUrl,
  getPodcastImageUrl,
  downloadingEpisodeIds,
  confirmDeleteDownloadEpisodeId,
  episodeBadgesById,
  ...handlers
}: {
  episodes: EpisodeWithState[];
  podcastImageUrl?: string;
  getPodcastImageUrl?: (podcastId: string) => string | undefined;
  downloadingEpisodeIds?: Set<string>;
  confirmDeleteDownloadEpisodeId?: string | null;
  episodeBadgesById?: Record<string, string[]>;
} & CardHandlers) {
  if (!episodes.length) {
    return (
      <EmptyState icon={<Podcast size={26} aria-hidden />} title="Nothing here yet">
        Add a feed, refresh your subscriptions, or loosen the active filters.
      </EmptyState>
    );
  }

  return (
    <div className="grid min-w-0 gap-0 md:gap-3" aria-label="Episode list">
      {episodes.map((episode) => (
        <EpisodeCard
          key={episode.id}
          episode={episode}
          podcastImageUrl={podcastImageUrl || getPodcastImageUrl?.(episode.podcastId)}
          downloading={downloadingEpisodeIds?.has(episode.id)}
          confirmingDeleteDownload={confirmDeleteDownloadEpisodeId === episode.id}
          processedBadges={episodeBadgesById?.[episode.id]}
          {...handlers}
        />
      ))}
    </div>
  );
}
