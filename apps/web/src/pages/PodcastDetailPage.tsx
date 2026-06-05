import { LuArrowDownWideNarrow as ArrowDownWideNarrow, LuArrowUpWideNarrow as ArrowUpWideNarrow, LuCheck as Check, LuCheckCheck as CheckCheck, LuInbox as Inbox, LuRefreshCw as RefreshCw, LuRotateCcw as RotateCcw, LuSettings2 as Settings2, LuX as X } from 'react-icons/lu';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { AppSettings, CachedPodcast, EpisodeWithState, PodcastPreference } from '@/types/domain';
import { EpisodeList } from '@/components/Episodes/EpisodeList';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input, Select } from '@/components/ui/Input';
import { Panel } from '@/components/ui/Panel';
import { Switch } from '@/components/ui/Switch';
import { formatDate } from '@/lib/dates';

type EpisodeHandlers = Omit<React.ComponentProps<typeof EpisodeList>, 'episodes'>;

export function PodcastDetailPage({
  podcast,
  subscribed,
  episodes,
  preference,
  smartSkipDefaults,
  onSubscribe,
  onUnsubscribe,
  onRefresh,
  onPreferenceChange,
  onSendAllUnplayedToInbox,
  onMarkAllPlayed,
  onMarkAllUnplayed,
  handlers,
  canUseSmartSkip = false
}: {
  podcast: CachedPodcast;
  subscribed: boolean;
  episodes: EpisodeWithState[];
  preference: PodcastPreference;
  smartSkipDefaults: Pick<AppSettings, 'smartSkipEnabled' | 'smartSkipCommercials' | 'smartSkipIntros' | 'smartSkipOutros' | 'smartSkipSelfPromos' | 'smartSkipSilence' | 'smartSkipIncludeSoftMatches'>;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  onRefresh: () => void;
  onPreferenceChange: (preference: PodcastPreference) => void;
  onSendAllUnplayedToInbox: () => void;
  onMarkAllPlayed: () => void;
  onMarkAllUnplayed: () => void;
  handlers: EpisodeHandlers;
  canUseSmartSkip?: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'played' | 'unplayed'>('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [visibleCount, setVisibleCount] = useState(() => pageSize());
  const sortedEpisodes = useMemo(() => {
    return episodes
      .filter((episode) => {
        if (filter === 'played') return episode.state.played;
        if (filter === 'unplayed') return !episode.state.played;
        return true;
      })
      .sort((a, b) => {
        const delta = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        return preference.sortDirection === 'oldest' ? -delta : delta;
      });
  }, [episodes, filter, preference.sortDirection]);

  useEffect(() => {
    setVisibleCount(pageSize());
  }, [podcast.id, filter, preference.sortDirection]);

  const visibleEpisodes = sortedEpisodes.slice(0, visibleCount);
  const hiddenEpisodeCount = Math.max(0, sortedEpisodes.length - visibleEpisodes.length);
  const unplayedCount = episodes.filter((episode) => !episode.state.played).length;
  const podcastSmartSkipEnabled = preference.smartSkipEnabled ?? smartSkipDefaults.smartSkipEnabled;
  const podcastSmartSkipDisabled = !podcastSmartSkipEnabled;

  return (
    <Panel
      title={podcast.title}
      className="h-full"
    >
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto px-3 py-3 md:p-4">
        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <div className="mx-auto w-full max-w-[22rem] lg:mx-0 lg:max-w-none">
            {podcast.imageUrl ? (
              <img src={podcast.imageUrl} alt={`${podcast.title} artwork`} className="aspect-square w-full rounded-eh border border-bone/15 object-cover shadow-lg shadow-black/30" />
            ) : (
              <div className="aspect-square rounded-eh border border-bone/15 bg-surface" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge tone="mauve">In library</Badge>
              <Badge tone={subscribed ? 'yellow' : 'sage'}>{subscribed ? 'Subscribed' : 'Not subscribed'}</Badge>
              <Badge tone="teal">{episodes.length} episodes</Badge>
              <Badge tone="sage">{unplayedCount} unplayed</Badge>
              {podcast.cachedAt ? <Badge tone="mauve">Cached {formatDate(podcast.cachedAt)}</Badge> : null}
            </div>
            {podcast.author ? <p className="mt-3 text-sm font-bold text-yellow">{podcast.author}</p> : null}
            {podcast.description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-bone">{stripHtml(podcast.description)}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant={subscribed ? 'danger' : 'primary'} onClick={subscribed ? onUnsubscribe : onSubscribe}>
                {subscribed ? 'Unsubscribe' : 'Subscribe'}
              </Button>
              <IconButton label="Refresh cache" onClick={onRefresh}>
                <RefreshCw size={17} aria-hidden />
              </IconButton>
              <IconButton label={settingsOpen ? 'Hide podcast settings' : 'Show podcast settings'} active={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>
                <Settings2 size={17} aria-hidden />
              </IconButton>
            </div>
          </div>
        </div>

        {settingsOpen ? (
          <section className="mt-5 rounded-eh border border-bone/15 bg-canvas/30 p-4" aria-label="Podcast settings">
            <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.06em] text-cream">
              <Settings2 size={16} aria-hidden />
              Podcast settings
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.05em] text-bone">
                Speed
                <Select value={preference.playbackRate ?? ''} onChange={(event) => onPreferenceChange({ ...preference, playbackRate: event.target.value ? Number(event.target.value) : undefined })}>
                  <option value="">Default</option>
                  {[0.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.25, 2.5].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
                </Select>
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.05em] text-bone">
                Skip back
                <Select value={preference.skipBackSec ?? ''} onChange={(event) => onPreferenceChange({ ...preference, skipBackSec: event.target.value ? Number(event.target.value) : undefined })}>
                  <option value="">Default</option>
                  {[5, 10, 15, 30].map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}
                </Select>
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.05em] text-bone">
                Skip forward
                <Select value={preference.skipForwardSec ?? ''} onChange={(event) => onPreferenceChange({ ...preference, skipForwardSec: event.target.value ? Number(event.target.value) : undefined })}>
                  <option value="">Default</option>
                  {[10, 15, 30, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}
                </Select>
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.05em] text-bone">
                Skip intro
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={preference.skipIntroSec ?? 0}
                  onChange={(event) => onPreferenceChange({ ...preference, skipIntroSec: Math.max(0, Number(event.target.value) || 0) })}
                  aria-label="Skip intro seconds"
                />
              </label>
              <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.05em] text-bone">
                Skip outro
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={preference.skipOutroSec ?? 0}
                  onChange={(event) => onPreferenceChange({ ...preference, skipOutroSec: Math.max(0, Number(event.target.value) || 0) })}
                  aria-label="Skip outro seconds"
                />
              </label>
              <div className="grid gap-2 text-xs font-bold uppercase tracking-[0.05em] text-bone md:col-span-2 xl:col-span-4">
                {subscribed ? <Switch checked={preference.addNewEpisodesToInbox} onCheckedChange={(checked) => onPreferenceChange({ ...preference, addNewEpisodesToInbox: checked })} label="New episodes to Inbox" /> : null}
                {canUseSmartSkip ? (
                  <>
                    <Switch checked={podcastSmartSkipEnabled} onCheckedChange={(checked) => onPreferenceChange({ ...preference, smartSkipEnabled: checked })} label="Smart Skip for this podcast" />
                    <Switch checked={Boolean(preference.smartSkipCommercials ?? smartSkipDefaults.smartSkipCommercials)} disabled={podcastSmartSkipDisabled} onCheckedChange={(checked) => onPreferenceChange({ ...preference, smartSkipCommercials: checked })} label="Skip sponsors/ads" />
                    <Switch checked={preference.smartSkipIntro ?? smartSkipDefaults.smartSkipIntros} disabled={podcastSmartSkipDisabled} onCheckedChange={(checked) => onPreferenceChange({ ...preference, smartSkipIntro: checked })} label="Skip intros" />
                    <Switch checked={preference.smartSkipOutro ?? smartSkipDefaults.smartSkipOutros} disabled={podcastSmartSkipDisabled} onCheckedChange={(checked) => onPreferenceChange({ ...preference, smartSkipOutro: checked })} label="Skip outros" />
                    <Switch checked={preference.smartSkipSelfPromos ?? smartSkipDefaults.smartSkipSelfPromos} disabled={podcastSmartSkipDisabled} onCheckedChange={(checked) => onPreferenceChange({ ...preference, smartSkipSelfPromos: checked })} label="Skip self-promo" />
                    <Switch checked={preference.smartSkipSilence ?? smartSkipDefaults.smartSkipSilence} disabled={podcastSmartSkipDisabled} onCheckedChange={(checked) => onPreferenceChange({ ...preference, smartSkipSilence: checked })} label="Skip silence" />
                    <Switch checked={Boolean(preference.smartSkipIncludeSoftMatches ?? smartSkipDefaults.smartSkipIncludeSoftMatches)} disabled={podcastSmartSkipDisabled} onCheckedChange={(checked) => onPreferenceChange({ ...preference, smartSkipIncludeSoftMatches: checked })} label="Include soft matches" />
                  </>
                ) : null}
              </div>
              <div className="grid gap-2 md:col-span-2 xl:col-span-4">
                <ConfirmActionButton
                  action="send"
                  activeAction={confirmAction}
                  icon={<Inbox size={16} aria-hidden />}
                  label="Send unplayed to Inbox"
                  message={`Send ${unplayedCount} unplayed episode${unplayedCount === 1 ? '' : 's'} to Inbox?`}
                  onRequest={setConfirmAction}
                  onConfirm={onSendAllUnplayedToInbox}
                />
                <ConfirmActionButton
                  action="played"
                  activeAction={confirmAction}
                  icon={<CheckCheck size={16} aria-hidden />}
                  label="Mark all played"
                  message={`Mark all ${episodes.length} episode${episodes.length === 1 ? '' : 's'} as played?`}
                  onRequest={setConfirmAction}
                  onConfirm={onMarkAllPlayed}
                />
                <ConfirmActionButton
                  action="unplayed"
                  activeAction={confirmAction}
                  icon={<RotateCcw size={16} aria-hidden />}
                  label="Mark all unplayed"
                  message={`Mark all ${episodes.length} episode${episodes.length === 1 ? '' : 's'} as unplayed?`}
                  onRequest={setConfirmAction}
                  onConfirm={onMarkAllUnplayed}
                />
              </div>
            </div>
          </section>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select className="w-40" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter episodes">
            <option value="all">All</option>
            <option value="unplayed">Unplayed</option>
            <option value="played">Played</option>
          </Select>
          <IconButton
            label={preference.sortDirection === 'newest' ? 'Sort oldest first' : 'Sort newest first'}
            onClick={() => onPreferenceChange({ ...preference, sortDirection: preference.sortDirection === 'newest' ? 'oldest' : 'newest' })}
          >
            {preference.sortDirection === 'newest' ? <ArrowDownWideNarrow size={18} aria-hidden /> : <ArrowUpWideNarrow size={18} aria-hidden />}
          </IconButton>
        </div>
        <div className="mt-4">
          <EpisodeList episodes={visibleEpisodes} podcastImageUrl={podcast.imageUrl} {...handlers} />
          {hiddenEpisodeCount > 0 ? (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={() => setVisibleCount((count) => count + pageSize())}>
                Load more episodes ({hiddenEpisodeCount} remaining)
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

type ConfirmAction = 'send' | 'played' | 'unplayed';

function ConfirmActionButton({
  action,
  activeAction,
  icon,
  label,
  message,
  onRequest,
  onConfirm
}: {
  action: ConfirmAction;
  activeAction: ConfirmAction | null;
  icon: ReactNode;
  label: string;
  message: string;
  onRequest: (action: ConfirmAction | null) => void;
  onConfirm: () => void;
}) {
  const confirming = activeAction === action;
  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-eh border border-yellow/30 bg-yellow/10 p-2">
        <span className="text-sm font-bold text-cream">{message}</span>
        <span className="flex gap-2">
          <IconButton
            label={`Confirm: ${message}`}
            active
            onClick={() => {
              onConfirm();
              onRequest(null);
            }}
          >
            <Check size={17} aria-hidden />
          </IconButton>
          <IconButton label="Cancel" danger onClick={() => onRequest(null)}>
            <X size={17} aria-hidden />
          </IconButton>
        </span>
      </div>
    );
  }

  return (
    <Button variant="secondary" onClick={() => onRequest(action)}>
      {icon}
      {label}
    </Button>
  );
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function pageSize() {
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) return 25;
  return 80;
}
