import { LuPodcast as PodcastIcon } from 'react-icons/lu';
import { useMemo } from 'react';
import type { CachedPodcast, EpisodeWithState, Podcast } from '@/types/domain';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { cn } from '@/lib/cn';

export function LibraryPage({
  podcasts,
  subscribedFeeds,
  episodes,
  onOpenPodcast
}: {
  podcasts: CachedPodcast[];
  subscribedFeeds: Podcast[];
  episodes: EpisodeWithState[];
  onOpenPodcast: (podcastId: string) => void;
}) {
  const subscribedIds = useMemo(() => new Set(subscribedFeeds.map((feed) => feed.id)), [subscribedFeeds]);
  const stats = useMemo(() => {
    const map = new Map<string, { total: number; unplayed: number }>();
    for (const episode of episodes) {
      const row = map.get(episode.podcastId) || { total: 0, unplayed: 0 };
      row.total += 1;
      if (!episode.state.played) row.unplayed += 1;
      map.set(episode.podcastId, row);
    }
    return map;
  }, [episodes]);
  const sorted = useMemo(() => {
    return [...podcasts].filter((podcast) => subscribedIds.has(podcast.id)).sort((a, b) => a.title.localeCompare(b.title));
  }, [podcasts, subscribedIds]);

  return (
    <Panel title="Library" action={<Badge tone="yellow">{sorted.length} podcasts</Badge>} className="h-full">
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-4">
        {sorted.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
            {sorted.map((podcast) => (
              <PodcastCard
                key={podcast.id}
                podcast={podcast}
                episodeCount={stats.get(podcast.id)?.total ?? 0}
                unplayedCount={stats.get(podcast.id)?.unplayed ?? 0}
                onClick={() => onOpenPodcast(podcast.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={<PodcastIcon size={26} aria-hidden />} title="No subscribed podcasts yet">
            Add a podcast from Search or paste an RSS feed in Inbox.
          </EmptyState>
        )}
      </div>
    </Panel>
  );
}

function PodcastCard({ podcast, episodeCount, unplayedCount, onClick }: { podcast: CachedPodcast; episodeCount: number; unplayedCount: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group min-w-0 text-left" aria-label={`Open ${podcast.title}`} title={`Open ${podcast.title}`}>
      <div className="relative">
        <PodcastArtwork podcast={podcast} className="aspect-square w-full" />
        {unplayedCount > 0 ? (
          <span className="absolute right-2 top-2 grid min-h-7 min-w-7 place-items-center rounded-full bg-yellow px-2 text-xs font-black text-canvas shadow-lg shadow-black/35">
            {unplayedCount}
          </span>
        ) : null}
      </div>
      <div className="mt-3 min-w-0">
        <h3 className="truncate text-sm font-black text-cream group-hover:text-yellow">{podcast.title}</h3>
        <p className="mt-1 truncate text-xs text-bone">{podcast.author || `${episodeCount} episodes`}</p>
      </div>
    </button>
  );
}

function PodcastArtwork({ podcast, className }: { podcast: CachedPodcast; className?: string }) {
  if (podcast.imageUrl) {
    return <img src={podcast.imageUrl} alt={`${podcast.title} artwork`} className={cn('rounded-eh border border-bone/15 bg-surface object-cover shadow-lg shadow-black/25', className)} />;
  }
  return (
    <div className={cn('grid place-items-center rounded-eh border border-bone/15 bg-surface text-yellow shadow-lg shadow-black/25', className)}>
      <PodcastIcon size={32} aria-hidden />
    </div>
  );
}
