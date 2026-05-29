import { Clock3 } from 'lucide-react';
import type { EpisodeWithState } from '@/types/domain';
import { EmptyState } from '@/components/EmptyState';
import { EpisodeList } from '@/components/Episodes/EpisodeList';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';

export function HistoryPage({
  episodes,
  getPodcastImageUrl,
  handlers
}: {
  episodes: EpisodeWithState[];
  getPodcastImageUrl?: (podcastId: string) => string | undefined;
  handlers: Omit<React.ComponentProps<typeof EpisodeList>, 'episodes' | 'getPodcastImageUrl'>;
}) {
  const history = episodes
    .filter((episode) => episode.state.lastPlayedAt)
    .sort((a, b) => new Date(b.state.lastPlayedAt || 0).getTime() - new Date(a.state.lastPlayedAt || 0).getTime());

  return (
    <Panel title="History" action={<Badge tone="yellow">{history.length} played</Badge>} className="h-full">
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-4">
        {history.length ? (
          <EpisodeList episodes={history} getPodcastImageUrl={getPodcastImageUrl} {...handlers} />
        ) : (
          <EmptyState icon={<Clock3 size={26} aria-hidden />} title="No history yet">
            Start an episode and it will appear here.
          </EmptyState>
        )}
      </div>
    </Panel>
  );
}
