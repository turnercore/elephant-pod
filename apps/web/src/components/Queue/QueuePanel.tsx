import { LuArrowDown as ArrowDown, LuArrowUp as ArrowUp, LuListMusic as ListMusic, LuPlay as Play, LuTrash2 as Trash2 } from 'react-icons/lu';
import type { EpisodeWithState } from '@/types/domain';
import { formatEpisodeReleaseDate } from '@/lib/dates';
import { EmptyState } from '../EmptyState';
import { IconButton } from '../ui/IconButton';

interface QueuePanelProps {
  episodes: EpisodeWithState[];
  onPlay: (episode: EpisodeWithState) => void;
  onMove: (episode: EpisodeWithState, direction: -1 | 1) => void;
  onRemove: (episode: EpisodeWithState) => void;
}

export function QueuePanel({ episodes, onPlay, onMove, onRemove }: QueuePanelProps) {
  if (!episodes.length) {
    return (
      <EmptyState icon={<ListMusic size={28} aria-hidden />} title="Queue is empty">
        Send episodes from Inbox or Library into the queue. The queue is intentionally obvious and manual-first.
      </EmptyState>
    );
  }

  return (
    <div className="grid min-w-0 gap-0 md:gap-2" aria-label="Queue items">
      {episodes.map((episode, index) => (
        <article key={episode.id} className="flex min-w-0 items-center gap-2 border-b border-bone/15 bg-surface/55 p-2 md:gap-3 md:rounded-eh md:border md:bg-surface/80 md:p-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-eh border border-mauve/45 bg-mauve/20 text-xs font-black text-cream md:h-9 md:w-9 md:text-sm">{index + 1}</div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-black text-cream">{episode.title}</h3>
            <p className="truncate text-xs text-bone">{episode.podcastTitle} · {formatEpisodeReleaseDate(episode.publishedAt)}</p>
          </div>
          <div className="flex shrink-0 gap-1 md:gap-2">
            <IconButton label={`Play ${episode.title}`} onClick={() => onPlay(episode)} className="h-8 w-8 md:h-10 md:w-10">
              <Play size={17} fill="currentColor" aria-hidden />
            </IconButton>
            <IconButton label="Move up" onClick={() => onMove(episode, -1)} disabled={index === 0} className="h-8 w-8 md:h-10 md:w-10">
              <ArrowUp size={17} aria-hidden />
            </IconButton>
            <IconButton label="Move down" onClick={() => onMove(episode, 1)} disabled={index === episodes.length - 1} className="h-8 w-8 md:h-10 md:w-10">
              <ArrowDown size={17} aria-hidden />
            </IconButton>
            <IconButton label="Remove from queue" danger onClick={() => onRemove(episode)} className="h-8 w-8 md:h-10 md:w-10">
              <Trash2 size={17} aria-hidden />
            </IconButton>
          </div>
        </article>
      ))}
    </div>
  );
}
