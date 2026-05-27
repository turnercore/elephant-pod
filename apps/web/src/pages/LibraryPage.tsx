import { CheckCheck, Rss } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { EpisodeFilter, EpisodeWithState, Podcast, SortDirection } from '@/types/domain';
import { EpisodeList } from '@/components/Episodes/EpisodeList';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';

export function LibraryPage({ feeds, episodes, handlers, onMarkFeedPlayed }: { feeds: Podcast[]; episodes: EpisodeWithState[]; handlers: Omit<React.ComponentProps<typeof EpisodeList>, 'episodes'>; onMarkFeedPlayed: (podcastId: string) => void }) {
  const [feedId, setFeedId] = useState('all');
  const [filter, setFilter] = useState<EpisodeFilter>('all');
  const [sort, setSort] = useState<SortDirection>('newest');

  const visible = useMemo(() => {
    return episodes
      .filter((episode) => feedId === 'all' || episode.podcastId === feedId)
      .filter((episode) => filter === 'all' || (filter === 'played' ? episode.state.played : !episode.state.played))
      .sort((a, b) => sort === 'newest' ? new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime() : new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
  }, [episodes, feedId, filter, sort]);

  return (
    <Panel title="Library" kicker="Subscriptions, filters, and back catalog" className="h-full">
      <div className="grid gap-3 border-b border-bone/15 p-4 md:grid-cols-[1fr_160px_160px_auto]">
        <Select value={feedId} onChange={(event) => setFeedId(event.target.value)} aria-label="Filter by show">
          <option value="all">All shows</option>
          {feeds.map((feed) => <option key={feed.id} value={feed.id}>{feed.title}</option>)}
        </Select>
        <Select value={filter} onChange={(event) => setFilter(event.target.value as EpisodeFilter)} aria-label="Filter by play state">
          <option value="all">All</option>
          <option value="unplayed">Unplayed</option>
          <option value="played">Played</option>
        </Select>
        <Select value={sort} onChange={(event) => setSort(event.target.value as SortDirection)} aria-label="Sort episodes">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </Select>
        <Button disabled={feedId === 'all'} onClick={() => onMarkFeedPlayed(feedId)}>
          <CheckCheck size={16} aria-hidden /> Mark show played
        </Button>
      </div>
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-4">
        <EpisodeList episodes={visible} {...handlers} />
      </div>
      <div className="border-t border-bone/15 p-3 text-xs text-bone">
        <Rss size={13} className="mr-1 inline text-yellow" aria-hidden /> RSS-first. OPML export/import is in Settings.
      </div>
    </Panel>
  );
}
