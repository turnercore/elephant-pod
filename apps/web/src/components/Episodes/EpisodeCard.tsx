import { ArchiveX, Check, Download, Inbox, ListEnd, ListStart, MoreHorizontal, Pause, Play, RotateCcw, Scissors, Star } from 'lucide-react';
import { useRef, useState } from 'react';
import type { EpisodeWithState } from '@/types/domain';
import { formatDate, formatDuration } from '@/lib/dates';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/IconButton';

interface EpisodeCardProps {
  episode: EpisodeWithState;
  compact?: boolean;
  onPlay: (episode: EpisodeWithState) => void;
  onQueue: (episode: EpisodeWithState) => void;
  onPlayNext?: (episode: EpisodeWithState) => void;
  onQueueEnd?: (episode: EpisodeWithState) => void;
  onSendInbox?: (episode: EpisodeWithState) => void;
  onDismiss?: (episode: EpisodeWithState) => void;
  onDownload?: (episode: EpisodeWithState) => void;
  onTogglePlayed: (episode: EpisodeWithState) => void;
  onClip?: (episode: EpisodeWithState) => void;
  onOpenEpisode?: (episode: EpisodeWithState) => void;
  onOpenPodcast?: (podcastId: string) => void;
  podcastImageUrl?: string;
  currentEpisodeId?: string;
  isCurrentPlaying?: boolean;
}

export function EpisodeCard({
  episode,
  compact,
  onPlay,
  onQueue,
  onPlayNext,
  onQueueEnd,
  onSendInbox,
  onDismiss,
  onDownload,
  onTogglePlayed,
  onClip,
  onOpenEpisode,
  onOpenPodcast,
  podcastImageUrl,
  currentEpisodeId,
  isCurrentPlaying
}: EpisodeCardProps) {
  const [revealed, setRevealed] = useState(false);
  const startX = useRef<number | null>(null);
  const artworkUrl = episode.imageUrl || podcastImageUrl;
  const isCurrentEpisode = currentEpisodeId === episode.id;
  const playLabel = isCurrentEpisode && isCurrentPlaying ? `Pause ${episode.title}` : `Play ${episode.title}`;
  const PlayIcon = isCurrentEpisode && isCurrentPlaying ? Pause : Play;
  const progress = episode.durationSec ? Math.min(100, ((episode.state.progressSec || 0) / episode.durationSec) * 100) : 0;
  const badges = [
    episode.state.played ? 'Played' : 'New',
    episode.state.downloaded ? 'Offline' : '',
    episode.state.queuePosition ? `#${episode.state.queuePosition}` : ''
  ].filter(Boolean);

  return (
    <article
      className="group rounded-eh border border-bone/15 bg-surface/85 transition hover:border-yellow/35"
      onTouchStart={(event) => {
        startX.current = event.changedTouches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        if (startX.current === null) return;
        const delta = (event.changedTouches[0]?.clientX ?? 0) - startX.current;
        startX.current = null;
        if (Math.abs(delta) > 48) setRevealed((open) => !open);
      }}
    >
      <div className="grid grid-cols-[56px_1fr_auto] items-center gap-3 p-2.5 md:grid-cols-[64px_1fr_auto] md:p-3">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" className="h-14 w-14 rounded-eh border border-bone/15 object-cover md:h-16 md:w-16" />
        ) : (
          <button
            aria-label={playLabel}
            title={playLabel}
            onClick={() => onPlay(episode)}
            className="grid h-14 w-14 place-items-center rounded-eh border border-yellow/35 bg-yellow text-canvas transition hover:bg-yellow/90 md:h-16 md:w-16"
          >
            <PlayIcon size={22} fill="currentColor" aria-hidden />
          </button>
        )}
        <div className="min-w-0">
          {badges.length ? (
            <div className="mb-1 flex min-w-0 items-center gap-1.5">
              {badges.slice(0, 3).map((badge) => (
                <Badge key={badge} tone={badge === 'Offline' ? 'teal' : badge.startsWith('#') ? 'mauve' : episode.state.played ? 'sage' : 'yellow'}>{badge}</Badge>
              ))}
              {episode.state.favorite && <Star size={13} className="shrink-0 text-yellow" fill="currentColor" aria-label="Favorite" />}
            </div>
          ) : null}
          <button type="button" onClick={() => onOpenEpisode?.(episode)} className="block max-w-full truncate text-left text-sm font-black leading-tight text-cream hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow md:text-[0.95rem]" aria-label={`Open ${episode.title}`} title={`Open ${episode.title}`}>
            {episode.title}
          </button>
          <p className="mt-0.5 truncate text-xs text-bone">{formatDate(episode.publishedAt)} · {formatDuration(episode.durationSec)}</p>
          <button
            type="button"
            onClick={() => onOpenPodcast?.(episode.podcastId)}
            className="mt-0.5 block max-w-full truncate text-left text-xs font-bold text-yellow hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow"
          >
            {episode.podcastTitle}
          </button>
          {!compact && episode.description ? <p className="mt-1 line-clamp-1 text-sm leading-5 text-bone/90 md:line-clamp-2">{stripHtml(episode.description)}</p> : null}
          {progress > 0 && !episode.state.played ? <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-canvas"><span className="block h-full bg-coral" style={{ width: `${progress}%` }} /></div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <IconButton label={playLabel} active={isCurrentEpisode && isCurrentPlaying} onClick={() => onPlay(episode)} className="h-10 w-10">
            <PlayIcon size={17} fill="currentColor" aria-hidden />
          </IconButton>
          <IconButton label={revealed ? 'Hide episode actions' : 'Show episode actions'} active={revealed} onClick={() => setRevealed((open) => !open)} className="h-10 w-10">
            <MoreHorizontal size={17} aria-hidden />
          </IconButton>
        </div>
      </div>

      {revealed ? (
        <div className="grid grid-cols-4 gap-1.5 border-t border-bone/15 bg-canvas/50 p-2 md:grid-cols-8">
          <IconButton label={playLabel} active={isCurrentEpisode && isCurrentPlaying} onClick={() => onPlay(episode)} className="h-9 w-full">
            <PlayIcon size={16} fill="currentColor" aria-hidden />
          </IconButton>
          <IconButton label="Play next" onClick={() => (onPlayNext || onQueue)(episode)} active={Boolean(episode.state.queuePosition === 1)} className="h-9 w-full">
            <ListStart size={16} aria-hidden />
          </IconButton>
          <IconButton label="Add to end of queue" onClick={() => (onQueueEnd || onQueue)(episode)} active={Boolean(episode.state.queuePosition)} className="h-9 w-full">
            <ListEnd size={16} aria-hidden />
          </IconButton>
          <IconButton label={episode.state.played ? 'Mark unplayed' : 'Mark played'} onClick={() => onTogglePlayed(episode)} className="h-9 w-full">
            {episode.state.played ? <RotateCcw size={16} aria-hidden /> : <Check size={16} aria-hidden />}
          </IconButton>
          {onDownload ? (
            <IconButton label="Download" onClick={() => onDownload(episode)} active={episode.state.downloaded} className="h-9 w-full">
              <Download size={16} aria-hidden />
            </IconButton>
          ) : null}
          {onClip ? (
            <IconButton label="Create clip" onClick={() => onClip(episode)} className="h-9 w-full">
              <Scissors size={16} aria-hidden />
            </IconButton>
          ) : null}
          {onSendInbox ? (
            <IconButton label="Send to inbox" onClick={() => onSendInbox(episode)} active={episode.state.inboxState === 'new'} className="h-9 w-full">
              <Inbox size={16} aria-hidden />
            </IconButton>
          ) : null}
          {onDismiss ? (
            <IconButton label="Dismiss from inbox" danger onClick={() => onDismiss(episode)} className="h-9 w-full">
              <ArchiveX size={16} aria-hidden />
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
