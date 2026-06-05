import { LuPodcast as PodcastIcon, LuSearch as Search } from 'react-icons/lu';
import { useMemo, useState } from 'react';
import type { CachedPodcast, EpisodeWithState, Podcast } from '@/types/domain';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
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
  const [query, setQuery] = useState('');
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
    const normalizedQuery = normalizeSearch(query);
    return [...podcasts]
      .filter((podcast) => !normalizedQuery || scorePodcast(podcast, normalizedQuery) > 0)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [podcasts, query]);

  return (
    <Panel title="Library" action={<Badge tone="yellow">{sorted.length} podcasts</Badge>} className="h-full">
      <div className="border-b border-bone/15 p-4">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bone" size={18} aria-hidden />
          <Input
            className="h-12 w-full pl-10"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter subscribed podcasts"
            aria-label="Filter library podcasts"
          />
        </div>
      </div>
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4 md:p-4">
        {sorted.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
            {sorted.map((podcast) => (
              <PodcastCard
                key={podcast.id}
                podcast={podcast}
                episodeCount={stats.get(podcast.id)?.total ?? 0}
                unplayedCount={stats.get(podcast.id)?.unplayed ?? 0}
                subscribed={subscribedIds.has(podcast.id)}
                onClick={() => onOpenPodcast(podcast.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={<PodcastIcon size={26} aria-hidden />} title="Library is empty">
            {query.trim() ? 'No library podcasts match this filter.' : 'Subscribe, download, queue, or inbox an episode to keep a podcast here.'}
          </EmptyState>
        )}
      </div>
    </Panel>
  );
}

function scorePodcast(podcast: CachedPodcast, query: string): number {
  let score = 0;
  score += scoreField(normalizeSearch(podcast.title), query, 1000);
  score += scoreField(normalizeSearch(podcast.author || ''), query, 700);
  score += scoreField(normalizeSearch(podcast.feedUrl), query, 650);
  score += scoreField(normalizeSearch(podcast.sourceUrl || ''), query, 650);
  score += scoreField(normalizeSearch((podcast.categories || podcast.tags || []).join(' ')), query, 160);
  score += scoreField(normalizeSearch(podcast.description || ''), query, 60);
  return score;
}

function scoreField(field: string, query: string, weight: number): number {
  if (!field) return 0;
  if (field === query) return weight;
  if (field.startsWith(query)) return Math.floor(weight * 0.9);
  if (field.includes(query)) return Math.floor(weight * 0.7);
  const tokens = query.split(' ').filter(Boolean);
  const hits = tokens.filter((token) => field.includes(token)).length;
  return hits ? Math.floor((hits / tokens.length) * weight * 0.5) : 0;
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function PodcastCard({ podcast, episodeCount, unplayedCount, subscribed, onClick }: { podcast: CachedPodcast; episodeCount: number; unplayedCount: number; subscribed: boolean; onClick: () => void }) {
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
        <p className="mt-1 truncate text-xs text-bone">{subscribed ? 'Subscribed' : 'In library'} · {episodeCount} episodes</p>
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
