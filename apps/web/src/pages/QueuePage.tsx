import { ListMusic } from 'lucide-react';
import type { EpisodeWithState } from '@/types/domain';
import { Panel } from '@/components/ui/Panel';
import { QueuePanel } from '@/components/Queue/QueuePanel';
import { Badge } from '@/components/ui/Badge';

export function QueuePage({ episodes, onPlay, onMove, onRemove }: { episodes: EpisodeWithState[]; onPlay: (episode: EpisodeWithState) => void; onMove: (episode: EpisodeWithState, direction: -1 | 1) => void; onRemove: (episode: EpisodeWithState) => void }) {
  return (
    <Panel
      title="Queue"
      kicker="The next things you meant to hear"
      action={<Badge tone="yellow"><ListMusic size={13} aria-hidden /> {episodes.length} queued</Badge>}
      className="h-full"
    >
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-4">
        <QueuePanel episodes={episodes} onPlay={onPlay} onMove={onMove} onRemove={onRemove} />
      </div>
    </Panel>
  );
}
