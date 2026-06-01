import { LuListMusic as ListMusic } from 'react-icons/lu';
import type { EpisodeWithState } from '@/types/domain';
import { Panel } from '@/components/ui/Panel';
import { QueuePanel } from '@/components/Queue/QueuePanel';
import { Badge } from '@/components/ui/Badge';

export function QueuePage({ episodes, onPlay, onMove, onRemove }: { episodes: EpisodeWithState[]; onPlay: (episode: EpisodeWithState) => void; onMove: (episode: EpisodeWithState, direction: -1 | 1) => void; onRemove: (episode: EpisodeWithState) => void }) {
  return (
    <Panel
      title="Queue"
      action={<Badge tone="yellow" aria-label={`${episodes.length} queued episodes`}><ListMusic size={13} aria-hidden /> {episodes.length}</Badge>}
      className="h-full"
    >
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-4">
        <QueuePanel episodes={episodes} onPlay={onPlay} onMove={onMove} onRemove={onRemove} />
      </div>
    </Panel>
  );
}
