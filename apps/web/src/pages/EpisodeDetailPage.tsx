import { LuCheck as Check, LuDownload as Download, LuInbox as Inbox, LuListEnd as ListEnd, LuListStart as ListStart, LuPlay as Play, LuRotateCcw as RotateCcw } from 'react-icons/lu';
import type { EpisodeWithState } from '@/types/domain';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { formatDuration, formatEpisodeReleaseDate } from '@/lib/dates';

export function EpisodeDetailPage({
  episode,
  podcastImageUrl,
  onOpenPodcast,
  onPlay,
  onPlayNext,
  onQueueEnd,
  onSendInbox,
  onDownload,
  onTogglePlayed
}: {
  episode: EpisodeWithState;
  podcastImageUrl?: string;
  onOpenPodcast: (podcastId: string) => void;
  onPlay: (episode: EpisodeWithState) => void;
  onPlayNext: (episode: EpisodeWithState) => void;
  onQueueEnd: (episode: EpisodeWithState) => void;
  onSendInbox: (episode: EpisodeWithState) => void;
  onDownload?: (episode: EpisodeWithState) => void;
  onTogglePlayed: (episode: EpisodeWithState) => void;
}) {
  const episodeArtworkUrl = episode.imageUrl;
  const artworkUrl = episodeArtworkUrl || podcastImageUrl;

  return (
    <Panel
      title={episode.title}
      className="h-full"
    >
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-4">
        <div className="grid gap-5 lg:grid-cols-[180px_1fr]">
          <div className="relative">
            {artworkUrl ? (
              <img src={artworkUrl} alt="" className="aspect-square w-full rounded-eh border border-bone/15 object-cover shadow-lg shadow-black/30" />
            ) : (
              <div className="aspect-square rounded-eh border border-bone/15 bg-surface" />
            )}
            {podcastImageUrl && episodeArtworkUrl ? (
              <button
                type="button"
                onClick={() => onOpenPodcast(episode.podcastId)}
                className="eh-tooltip absolute left-2 top-2 z-10 h-14 w-14 overflow-hidden rounded-eh border-2 border-yellow bg-surface shadow-lg shadow-black/35 transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow"
                aria-label={`Open ${episode.podcastTitle}`}
                data-tooltip={`Open ${episode.podcastTitle}`}
              >
                <img src={podcastImageUrl} alt="" className="h-full w-full object-cover" />
              </button>
            ) : null}
          </div>
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={episode.state.played ? 'sage' : 'yellow'}>{episode.state.played ? 'Played' : 'Unplayed'}</Badge>
              {episode.state.inboxState === 'new' ? <Badge tone="mauve">Inbox #{episode.state.inboxPosition}</Badge> : null}
              {episode.state.queuePosition ? <Badge tone="teal">Queue #{episode.state.queuePosition}</Badge> : null}
              {episode.state.downloaded ? <Badge tone="teal">Offline</Badge> : null}
            </div>
            <button type="button" onClick={() => onOpenPodcast(episode.podcastId)} className="mt-3 flex max-w-xl items-center gap-3 rounded-eh border border-bone/15 bg-surface/70 p-2 text-left transition hover:border-yellow/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow" aria-label={`Open ${episode.podcastTitle}`}>
              {podcastImageUrl ? <img src={podcastImageUrl} alt="" className="h-12 w-12 shrink-0 rounded-[12px] border border-bone/15 object-cover" /> : null}
              <span className="min-w-0">
                <span className="block text-[0.65rem] font-black uppercase tracking-[0.08em] text-bone">Podcast</span>
                <span className="block truncate text-sm font-black text-yellow">{episode.podcastTitle}</span>
              </span>
            </button>
            <p className="mt-2 text-sm text-bone">{formatEpisodeReleaseDate(episode.publishedAt)} · {formatDuration(episode.durationSec)}</p>
            {episode.state.progressSec > 0 && !episode.state.played ? (
              <p className="mt-2 text-sm text-bone">Progress: {formatDuration(episode.state.progressSec)} / {formatDuration(episode.durationSec)}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => onPlay(episode)}>
                <Play size={16} fill="currentColor" aria-hidden />
                Play now
              </Button>
              <Button variant="secondary" onClick={() => onPlayNext(episode)}>
                <ListStart size={16} aria-hidden />
                Play next
              </Button>
              <Button variant="secondary" onClick={() => onQueueEnd(episode)}>
                <ListEnd size={16} aria-hidden />
                Add to end
              </Button>
              <Button variant="secondary" onClick={() => onSendInbox(episode)}>
                <Inbox size={16} aria-hidden />
                Send to inbox
              </Button>
              {onDownload ? (
                <Button variant="secondary" onClick={() => onDownload(episode)}>
                  <Download size={16} aria-hidden />
                  Download
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => onTogglePlayed(episode)}>
                {episode.state.played ? <RotateCcw size={16} aria-hidden /> : <Check size={16} aria-hidden />}
                {episode.state.played ? 'Mark unplayed' : 'Mark played'}
              </Button>
            </div>
          </div>
        </div>
        {episode.description ? (
          <div className="mt-6 rounded-eh border border-bone/15 bg-canvas/30 p-4 text-sm leading-7 text-bone" dangerouslySetInnerHTML={{ __html: episode.description }} />
        ) : null}
      </div>
    </Panel>
  );
}
