import { LuArchiveX as ArchiveX, LuListEnd as ListEnd, LuListStart as ListStart, LuPause as Pause, LuPlay as Play, LuRss as Rss, LuSparkles as Sparkles } from 'react-icons/lu';
import type { EpisodeWithState } from '@/types/domain';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { SwipeActionRow } from '@/components/Gestures/SwipeActionRow';
import { PullToRefresh } from '@/components/Gestures/PullToRefresh';
import { IconButton } from '@/components/ui/IconButton';
import { Panel } from '@/components/ui/Panel';
import { formatDuration, formatEpisodeReleaseDate } from '@/lib/dates';

interface InboxPageProps {
  episodes: EpisodeWithState[];
  onRefreshFeeds: () => void;
  getPodcastImageUrl?: (podcastId: string) => string | undefined;
  episodeBadgesById?: Record<string, string[]>;
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

export function InboxPage({ episodes, onRefreshFeeds, getPodcastImageUrl, episodeBadgesById = {}, handlers }: InboxPageProps) {
  return (
    <Panel
      title="Inbox"
      className="h-full"
    >
      <PullToRefresh onRefresh={onRefreshFeeds} className="px-0 py-3 md:p-4">
        {episodes.length ? (
          <div className="grid gap-3">
            {episodes.map((episode) => (
              <InboxTriageRow key={episode.id} episode={episode} podcastImageUrl={getPodcastImageUrl?.(episode.podcastId)} processedBadges={episodeBadgesById[episode.id]} handlers={handlers} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Rss size={26} aria-hidden />} title="Inbox is empty">
            New subscribed episodes land here for triage.
          </EmptyState>
        )}
      </PullToRefresh>
    </Panel>
  );
}

function InboxTriageRow({ episode, podcastImageUrl, processedBadges = [], handlers }: { episode: EpisodeWithState; podcastImageUrl?: string; processedBadges?: string[]; handlers: InboxPageProps['handlers'] }) {
  const artworkUrl = episode.imageUrl || podcastImageUrl;
  const isCurrentEpisode = handlers.currentEpisodeId === episode.id;
  const PlayIcon = isCurrentEpisode && handlers.isCurrentPlaying ? Pause : Play;
  const playLabel = isCurrentEpisode && handlers.isCurrentPlaying ? 'Pause episode' : 'Play now';

  return (
    <SwipeActionRow
      ariaLabel={`${episode.title} inbox row`}
      className="rounded-eh border border-bone/15 bg-canvas transition hover:border-yellow/35"
      contentClassName="rounded-eh"
      leftActions={[
        { key: 'queue-end', label: 'Queue', icon: <ListEnd size={18} aria-hidden />, tone: 'primary', onAction: () => handlers.onQueueEnd?.(episode) },
        { key: 'play-next', label: 'Next', icon: <ListStart size={18} aria-hidden />, tone: 'default', onAction: () => handlers.onPlayNext?.(episode) }
      ]}
      rightActions={[
        { key: 'remove-inbox', label: 'Remove', icon: <ArchiveX size={18} aria-hidden />, tone: 'danger', onAction: () => handlers.onDismiss?.(episode) }
      ]}
    >
      <article className="p-3">
        <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
        <div className="hidden gap-2 md:flex">
          <IconButton label="Dismiss from inbox" danger onClick={() => handlers.onDismiss?.(episode)}>
            <ArchiveX size={18} aria-hidden />
          </IconButton>
        </div>
        <button type="button" onClick={() => handlers.onOpenEpisode?.(episode)} className="grid min-w-0 grid-cols-[64px_1fr] gap-3 text-left" aria-label={`Open ${episode.title}`}>
          {artworkUrl ? <img src={artworkUrl} alt="" className="h-16 w-16 rounded-eh border border-bone/15 object-cover" /> : <div className="h-16 w-16 rounded-eh border border-bone/15 bg-canvas" />}
          <span className="min-w-0">
            {processedBadges.length ? (
              <span className="mb-1 flex flex-wrap gap-1.5">
                {processedBadges.map((badge) => (
                  <InboxBadge key={badge} badge={badge} />
                ))}
              </span>
            ) : null}
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
      </article>
    </SwipeActionRow>
  );
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function InboxBadge({ badge }: { badge: string }) {
  if (badge === 'Smart Skip') {
    return (
      <Badge tone="teal" className="gap-1" title="Smart Skip processed">
        <Sparkles size={12} aria-hidden />
        <span>Smart Skip</span>
      </Badge>
    );
  }
  if (badge === 'Smart Skip queued') {
    return (
      <Badge tone="mauve" className="gap-1" title="Smart Skip queued">
        <Sparkles size={12} aria-hidden />
        <span>Queued</span>
      </Badge>
    );
  }
  return <Badge tone="mauve">{badge}</Badge>;
}
