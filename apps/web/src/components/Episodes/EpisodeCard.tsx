import { ArchiveX, Check, Download, ListPlus, MoreHorizontal, Play, RotateCcw, Scissors, Star } from 'lucide-react';
import type { EpisodeWithState } from '@/types/domain';
import { formatDate, formatDuration } from '@/lib/dates';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/IconButton';

interface EpisodeCardProps {
  episode: EpisodeWithState;
  compact?: boolean;
  onPlay: (episode: EpisodeWithState) => void;
  onQueue: (episode: EpisodeWithState) => void;
  onDismiss?: (episode: EpisodeWithState) => void;
  onDownload?: (episode: EpisodeWithState) => void;
  onTogglePlayed: (episode: EpisodeWithState) => void;
  onClip?: (episode: EpisodeWithState) => void;
}

export function EpisodeCard({ episode, compact, onPlay, onQueue, onDismiss, onDownload, onTogglePlayed, onClip }: EpisodeCardProps) {
  return (
    <article className="group rounded-eh border border-bone/15 bg-surface/80 p-3 transition hover:border-yellow/35">
      <div className="flex min-w-0 gap-3">
        <button
          aria-label={`Play ${episode.title}`}
          onClick={() => onPlay(episode)}
          className="grid h-14 w-14 shrink-0 place-items-center rounded-eh border border-yellow/35 bg-yellow text-canvas transition hover:bg-yellow/90"
        >
          <Play size={22} fill="currentColor" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={episode.state.played ? 'sage' : 'yellow'}>{episode.state.played ? 'Played' : 'New'}</Badge>
            {episode.state.downloaded && <Badge tone="teal">Offline</Badge>}
            {episode.state.queuePosition && <Badge tone="mauve">#{episode.state.queuePosition}</Badge>}
            {episode.state.favorite && <Star size={14} className="text-yellow" fill="currentColor" aria-label="Favorite" />}
          </div>
          <h3 className="line-clamp-2 text-sm font-black leading-snug text-cream md:text-base">{episode.title}</h3>
          <p className="mt-1 truncate text-xs text-bone">
            {episode.podcastTitle} · {formatDate(episode.publishedAt)} · {formatDuration(episode.durationSec)}
          </p>
          {!compact && episode.description && <p className="mt-2 line-clamp-2 text-sm leading-5 text-bone/90">{stripHtml(episode.description)}</p>}
          {episode.state.progressSec > 0 && !episode.state.played && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-[3px] bg-canvas">
              <div
                className="h-full bg-yellow"
                style={{ width: `${Math.min(100, ((episode.state.progressSec || 0) / (episode.durationSec || 1)) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <IconButton label="Add to queue" onClick={() => onQueue(episode)} active={Boolean(episode.state.queuePosition)}>
            <ListPlus size={18} aria-hidden />
          </IconButton>
          <IconButton label={episode.state.played ? 'Mark unplayed' : 'Mark played'} onClick={() => onTogglePlayed(episode)}>
            {episode.state.played ? <RotateCcw size={18} aria-hidden /> : <Check size={18} aria-hidden />}
          </IconButton>
          <div className="hidden gap-2 md:flex md:flex-col">
            {onDownload && (
              <IconButton label="Download" onClick={() => onDownload(episode)} active={episode.state.downloaded}>
                <Download size={18} aria-hidden />
              </IconButton>
            )}
            {onClip && (
              <IconButton label="Create clip" onClick={() => onClip(episode)}>
                <Scissors size={18} aria-hidden />
              </IconButton>
            )}
            {onDismiss && (
              <IconButton label="Dismiss from inbox" danger onClick={() => onDismiss(episode)}>
                <ArchiveX size={18} aria-hidden />
              </IconButton>
            )}
          </div>
          <IconButton label="More episode actions" className="md:hidden">
            <MoreHorizontal size={18} aria-hidden />
          </IconButton>
        </div>
      </div>
    </article>
  );
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
