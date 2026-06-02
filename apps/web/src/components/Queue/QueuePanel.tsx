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
    <div className="grid gap-2" aria-label="Queue items">
      {episodes.map((episode, index) => (
        <article key={episode.id} className="flex items-center gap-3 rounded-eh border border-bone/15 bg-surface/80 p-3">
          <div className="grid h-9 w-9 place-items-center rounded-eh border border-mauve/45 bg-mauve/20 text-sm font-black text-cream">{index + 1}</div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-black text-cream">{episode.title}</h3>
            <p className="truncate text-xs text-bone">{episode.podcastTitle} · {formatEpisodeReleaseDate(episode.publishedAt)}</p>
          </div>
          <div className="flex gap-2">
            <IconButton label={`Play ${episode.title}`} onClick={() => onPlay(episode)}>
              <Play size={17} fill="currentColor" aria-hidden />
            </IconButton>
            <IconButton label="Move up" onClick={() => onMove(episode, -1)} disabled={index === 0}>
              <ArrowUp size={17} aria-hidden />
            </IconButton>
            <IconButton label="Move down" onClick={() => onMove(episode, 1)} disabled={index === episodes.length - 1}>
              <ArrowDown size={17} aria-hidden />
            </IconButton>
            <IconButton label="Remove from queue" danger onClick={() => onRemove(episode)}>
              <Trash2 size={17} aria-hidden />
            </IconButton>
          </div>
        </article>
      ))}
    </div>
  );
}
