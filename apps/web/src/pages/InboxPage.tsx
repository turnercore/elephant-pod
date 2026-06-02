import { LuArchiveX as ArchiveX, LuListEnd as ListEnd, LuListStart as ListStart, LuPause as Pause, LuPlay as Play, LuRefreshCw as RefreshCw, LuRss as Rss } from 'react-icons/lu';
import { useRef, useState } from 'react';
import type { EpisodeWithState } from '@/types/domain';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Panel } from '@/components/ui/Panel';
import { formatDuration, formatEpisodeReleaseDate } from '@/lib/dates';

interface InboxPageProps {
  episodes: EpisodeWithState[];
  onRefreshFeeds: () => void;
  getPodcastImageUrl?: (podcastId: string) => string | undefined;
  handlers: {
    onPlay: (episode: EpisodeWithState) => void;
    onPlayNext?: (episode: EpisodeWithState) => void;
    onQueueEnd?: (episode: EpisodeWithState) => void;
    onDismiss?: (episode: EpisodeWithState) => void;
    onOpenEpisode?: (episode: EpisodeWithState) => void;
    currentEpisodeId?: string;
    isCurrentPlaying?: boolean;
  };
}

export function InboxPage({ episodes, onRefreshFeeds, getPodcastImageUrl, handlers }: InboxPageProps) {
  return (
    <Panel
      title="Inbox"
      action={
        <IconButton label="Refresh feeds" onClick={onRefreshFeeds}>
          <RefreshCw size={17} aria-hidden />
        </IconButton>
      }
      className="h-full"
    >
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-4">
        {episodes.length ? (
          <div className="grid gap-3">
            {episodes.map((episode) => (
              <InboxTriageRow key={episode.id} episode={episode} podcastImageUrl={getPodcastImageUrl?.(episode.podcastId)} handlers={handlers} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Rss size={26} aria-hidden />} title="Inbox is empty">
            New subscribed episodes land here for triage.
          </EmptyState>
        )}
      </div>
    </Panel>
  );
}

function InboxTriageRow({ episode, podcastImageUrl, handlers }: { episode: EpisodeWithState; podcastImageUrl?: string; handlers: InboxPageProps['handlers'] }) {
  const startX = useRef<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const artworkUrl = episode.imageUrl || podcastImageUrl;
  const isCurrentEpisode = handlers.currentEpisodeId === episode.id;
  const PlayIcon = isCurrentEpisode && handlers.isCurrentPlaying ? Pause : Play;
  const playLabel = isCurrentEpisode && handlers.isCurrentPlaying ? 'Pause episode' : 'Play now';

  function onTouchEnd(clientX: number) {
    if (startX.current === null) return;
    const delta = clientX - startX.current;
    startX.current = null;
    if (delta < -80) {
      handlers.onDismiss?.(episode);
      return;
    }
    if (delta > 130) {
      (handlers.onQueueEnd || handlers.onPlayNext)?.(episode);
      return;
    }
    if (delta > 50) setRevealed(true);
  }

  return (
    <article
      className="rounded-eh border border-bone/15 bg-surface/80 p-3 transition hover:border-yellow/35"
      onTouchStart={(event) => {
        startX.current = event.changedTouches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => onTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
    >
      <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
        <div className="hidden gap-2 md:flex">
          <IconButton label="Dismiss from inbox" danger onClick={() => handlers.onDismiss?.(episode)}>
            <ArchiveX size={18} aria-hidden />
          </IconButton>
        </div>
        <button type="button" onClick={() => handlers.onOpenEpisode?.(episode)} className="grid min-w-0 grid-cols-[64px_1fr] gap-3 text-left" aria-label={`Open ${episode.title}`}>
          {artworkUrl ? <img src={artworkUrl} alt="" className="h-16 w-16 rounded-eh border border-bone/15 object-cover" /> : <div className="h-16 w-16 rounded-eh border border-bone/15 bg-canvas" />}
          <span className="min-w-0">
            <span className="block truncate text-xs font-black uppercase tracking-[0.05em] text-yellow">{episode.podcastTitle}</span>
            <span className="mt-1 block line-clamp-2 text-sm font-black leading-snug text-cream">{episode.title}</span>
            <span className="mt-1 block truncate text-xs text-bone">{formatEpisodeReleaseDate(episode.publishedAt)} · {formatDuration(episode.durationSec)}</span>
            {episode.description ? <span className="mt-2 block line-clamp-2 text-sm leading-5 text-bone/90">{stripHtml(episode.description)}</span> : null}
          </span>
        </button>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <IconButton label={playLabel} active={isCurrentEpisode && handlers.isCurrentPlaying} onClick={() => handlers.onPlay(episode)}>
            <PlayIcon size={18} fill="currentColor" aria-hidden />
          </IconButton>
          <IconButton label="Play next" onClick={() => handlers.onPlayNext?.(episode)}>
            <ListStart size={18} aria-hidden />
          </IconButton>
          <IconButton label="Add to end of queue" onClick={() => handlers.onQueueEnd?.(episode)}>
            <ListEnd size={18} aria-hidden />
          </IconButton>
          <IconButton label="Dismiss from inbox" danger className="md:hidden" onClick={() => handlers.onDismiss?.(episode)}>
            <ArchiveX size={18} aria-hidden />
          </IconButton>
        </div>
      </div>
      {revealed ? (
        <div className="mt-3 flex gap-2 rounded-eh border border-yellow/20 bg-yellow/10 p-2 md:hidden">
          <Button size="sm" variant="primary" onClick={() => handlers.onPlay(episode)}>{isCurrentEpisode && handlers.isCurrentPlaying ? 'Pause' : 'Play now'}</Button>
          <Button size="sm" onClick={() => handlers.onPlayNext?.(episode)}>Next</Button>
          <Button size="sm" onClick={() => handlers.onQueueEnd?.(episode)}>End</Button>
        </div>
      ) : null}
    </article>
  );
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
