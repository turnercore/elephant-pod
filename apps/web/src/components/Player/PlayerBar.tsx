import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LuArrowDownToLine as ArrowDownToLine, LuArrowUpToLine as ArrowUpToLine, LuCheck as Check, LuFastForward as FastForward, LuGripVertical as GripVertical, LuInbox as Inbox, LuListEnd as ListEnd, LuListMusic as ListMusic, LuListStart as ListStart, LuPause as Pause, LuPlay as Play, LuRewind as Rewind, LuRotateCcw as RotateCcw, LuScissors as Scissors, LuSkipForward as SkipForward, LuTrash2 as Trash2 } from 'react-icons/lu';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, EpisodeWithState } from '@/types/domain';
import type { SmartSkipEvent } from '@/lib/smartSkip/types';
import { formatDuration } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { IconButton } from '../ui/IconButton';
import { SleepTimer } from './SleepTimer';

const speedSteps = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 2];

interface PlayerBarProps {
  current: EpisodeWithState | null;
  queue: EpisodeWithState[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  settings: AppSettings;
  currentSkipSilence: boolean;
  canUseSilenceShortening: boolean;
  smartSkipNotice?: SmartSkipEvent | null;
  collapseToken?: number;
  onCurrentSkipSilenceChange: (enabled: boolean) => void;
  onUndoSmartSkip?: () => void;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onSkipBy: (seconds: number) => void;
  onSettingsChange: (settings: AppSettings) => void;
  onStopForSleep: () => void;
  onPlayNext: () => void;
  onPlayEpisode: (episode: EpisodeWithState) => void;
  onQueueNext: (episode: EpisodeWithState) => void;
  onQueueEnd: (episode: EpisodeWithState) => void;
  onSendInbox: (episode: EpisodeWithState) => void;
  onRemoveQueue: (episode: EpisodeWithState) => void;
  onTogglePlayed: (episode: EpisodeWithState) => void;
  onReorderQueue: (episode: EpisodeWithState, position: number) => void;
  onOpenEpisode: (episode: EpisodeWithState) => void;
  onOpenPodcast: (podcastId: string) => void;
  getPodcastImageUrl?: (podcastId: string) => string | undefined;
}

export function PlayerBar({
  current,
  queue,
  isPlaying,
  currentTime,
  duration,
  settings,
  currentSkipSilence,
  canUseSilenceShortening,
  smartSkipNotice,
  collapseToken,
  onCurrentSkipSilenceChange,
  onUndoSmartSkip,
  onToggle,
  onSeek,
  onSkipBy,
  onSettingsChange,
  onStopForSleep,
  onPlayNext,
  onPlayEpisode,
  onQueueNext,
  onQueueEnd,
  onSendInbox,
  onRemoveQueue,
  onTogglePlayed,
  onReorderQueue,
  onOpenEpisode,
  onOpenPodcast,
  getPodcastImageUrl
}: PlayerBarProps) {
  const [queueOpen, setQueueOpen] = useState(false);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const startY = useRef<number | null>(null);
  const effectiveDuration = duration || current?.durationSec || 0;
  const progress = effectiveDuration > 0 ? Math.max(0, Math.min(100, (currentTime / effectiveDuration) * 100)) : 0;
  const remaining = Math.max(0, effectiveDuration - currentTime);
  const currentArtworkUrl = current ? current.imageUrl || getPodcastImageUrl?.(current.podcastId) : undefined;
  const currentEpisodeLabel = current ? formatEpisodeLabel(current) : '';
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const visibleQueue = useMemo(() => queue.filter((episode) => episode.id !== current?.id), [current?.id, queue]);
  const queueIds = useMemo(() => visibleQueue.map((episode) => episode.id), [visibleQueue]);

  useEffect(() => {
    setQueueOpen(false);
    setSelectedQueueId(null);
  }, [collapseToken]);

  function toggleSheet() {
    setQueueOpen((open) => !open);
    setSelectedQueueId(null);
  }

  function handleSheetTouchEnd(clientY: number) {
    if (startY.current === null) return;
    const delta = clientY - startY.current;
    startY.current = null;
    if (delta < -48) setQueueOpen(true);
    if (delta > 48) setQueueOpen(false);
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : '';
    if (!overId || activeId === overId) return;
    const activeEpisode = visibleQueue.find((episode) => episode.id === activeId);
    const overIndex = visibleQueue.findIndex((episode) => episode.id === overId);
    if (!activeEpisode || overIndex < 0) return;
    onReorderQueue(activeEpisode, overIndex + (current ? 2 : 1));
    setSelectedQueueId(null);
  }

  function openEpisode(episode: EpisodeWithState) {
    setQueueOpen(false);
    setSelectedQueueId(null);
    onOpenEpisode(episode);
  }

  function openPodcast(podcastId: string) {
    setQueueOpen(false);
    setSelectedQueueId(null);
    onOpenPodcast(podcastId);
  }

  function cycleSpeed() {
    const index = speedSteps.findIndex((rate) => rate === settings.playbackRate);
    const next = speedSteps[(index + 1) % speedSteps.length] ?? 1;
    onSettingsChange({ ...settings, playbackRate: next });
  }

  return (
    <footer
      className={cn(
        'border-t border-bone/15 bg-canvas text-cream transition-[height,transform] duration-300 ease-out',
        queueOpen ? 'player-queue-stage fixed inset-x-0 bottom-0 top-[61px] z-40 flex flex-col border-t-0 shadow-2xl shadow-black md:left-[230px] md:top-0' : 'relative'
      )}
      aria-label="Player"
      onTouchStart={(event) => {
        startY.current = event.changedTouches[0]?.clientY ?? null;
      }}
      onTouchEnd={(event) => handleSheetTouchEnd(event.changedTouches[0]?.clientY ?? 0)}
    >
      <div className={cn('border-b border-bone/15', queueOpen ? 'bg-surface px-4 pb-3 pt-3 md:px-6' : 'px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.85rem)] pt-2')}>
        {queueOpen ? (
          <div className="relative mb-2 grid min-h-[5.5rem] grid-cols-[6rem_1fr] items-center gap-3 pr-16 sm:min-h-[7rem] sm:grid-cols-[7rem_1fr] md:min-h-[8rem] md:grid-cols-[8rem_1fr]">
            {currentArtworkUrl ? (
              <div className="aspect-square w-24 overflow-hidden rounded-[16px] border border-bone/15 bg-canvas shadow-xl shadow-black/30 sm:w-28 md:w-32">
                <img src={currentArtworkUrl} alt="" className="h-full w-full object-cover" />
              </div>
            ) : <div aria-hidden />}
            <div className="min-w-0 rounded-eh border border-bone/15 bg-canvas/40 px-3 py-2 shadow-lg shadow-black/20">
              {currentEpisodeLabel ? <p className="mb-0.5 truncate text-[10px] font-black uppercase tracking-[0.08em] text-yellow">{currentEpisodeLabel}</p> : null}
              <button type="button" onClick={() => current && openEpisode(current)} className="block max-w-full truncate text-left text-lg font-black leading-tight hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow md:text-2xl">
                {current?.title || 'Nothing playing'}
              </button>
              <button type="button" onClick={() => current && openPodcast(current.podcastId)} className="block max-w-full truncate text-left text-sm text-bone hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow">
                {current ? current.podcastTitle : 'Choose an episode from Inbox, Library, or Search.'}
              </button>
            </div>
            <button
              type="button"
              aria-label="Collapse player"
              data-tooltip="Collapse player"
              onClick={toggleSheet}
              className="eh-tooltip flex h-9 min-w-14 items-center justify-center gap-1 rounded-eh border border-bone/15 bg-surface/90 px-2 text-sm font-black text-cream shadow-lg shadow-black/25 transition hover:border-yellow/50 hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow md:h-10"
              style={{ position: 'absolute', top: 0, right: 0 }}
            >
              <ArrowDownToLine size={16} aria-hidden />
              <span>{visibleQueue.length}</span>
            </button>
          </div>
        ) : null}
        {queueOpen ? (
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <ProgressBar progress={progress} duration={effectiveDuration} onSeek={onSeek} />
            {current ? <span className="min-w-[3.5rem] text-right text-[11px] font-black tabular-nums text-bone">{formatRemainingLabel(remaining)}</span> : null}
          </div>
        ) : null}
        <div className={cn('mt-2 grid gap-2', queueOpen ? '' : '')}>
          {smartSkipNotice ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-eh border border-yellow/30 bg-yellow/10 px-3 py-2 text-sm font-bold text-yellow">
              <span>Skipped {smartSkipNotice.segment.label.toLowerCase()}</span>
              <button type="button" onClick={onUndoSmartSkip} className="rounded px-2 py-1 text-xs uppercase tracking-[0.06em] text-cream hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow">
                Undo
              </button>
            </div>
          ) : null}
          {!queueOpen ? (
            <CollapsedPlayer
              current={current}
              artworkUrl={currentArtworkUrl}
              currentEpisodeLabel={currentEpisodeLabel}
              progress={progress}
              duration={effectiveDuration}
              remaining={remaining}
              queueCount={visibleQueue.length}
              isPlaying={isPlaying}
              settings={settings}
              onToggle={onToggle}
              onSeek={onSeek}
              onSkipBy={onSkipBy}
              onOpenEpisode={openEpisode}
              onOpenPodcast={openPodcast}
              onOpenQueue={toggleSheet}
            />
          ) : (
          <div className={cn('grid w-full gap-1 md:w-auto md:justify-self-end md:gap-2', canUseSilenceShortening ? 'grid-cols-7' : 'grid-cols-6')}>
              <IconButton label={`Skip back ${settings.skipBackSec} seconds`} onClick={() => onSkipBy(-settings.skipBackSec)} disabled={!current} className="h-10 w-full md:h-12 md:w-12">
                <Rewind size={18} aria-hidden />
              </IconButton>
              <IconButton label={isPlaying ? 'Pause' : 'Play'} onClick={onToggle} active={isPlaying} disabled={!current} className="h-10 w-full md:h-12 md:w-12">
                {isPlaying ? <Pause size={20} aria-hidden /> : <Play size={20} fill="currentColor" aria-hidden />}
              </IconButton>
              <IconButton label={`Skip forward ${settings.skipForwardSec} seconds`} onClick={() => onSkipBy(settings.skipForwardSec)} disabled={!current} className="h-10 w-full md:h-12 md:w-12">
                <FastForward size={18} aria-hidden />
              </IconButton>
              <IconButton label="Cycle playback speed" onClick={cycleSpeed} className="h-10 w-full text-xs font-black md:h-12 md:w-12">
                {formatSpeed(settings.playbackRate)}
              </IconButton>
              <SleepTimer currentTime={currentTime} duration={effectiveDuration} onExpire={onStopForSleep} className="h-10 w-full md:h-12 md:w-12" />
              {canUseSilenceShortening ? (
                <IconButton label={currentSkipSilence ? 'Disable skip silence for this episode' : 'Enable skip silence for this episode'} onClick={() => onCurrentSkipSilenceChange(!currentSkipSilence)} disabled={!current} className="h-10 w-full md:h-12 md:w-12">
                  <Scissors size={18} aria-hidden />
                </IconButton>
              ) : null}
              <IconButton
                label="Skip to next podcast"
                onClick={() => {
                  if (current) onTogglePlayed(current);
                  onPlayNext();
                }}
                disabled={!current}
                className="h-10 w-full md:h-12 md:w-12"
              >
                <SkipForward size={18} aria-hidden />
              </IconButton>
          </div>
          )}
        </div>
      </div>

      {queueOpen ? (
        <section className="flex min-h-0 flex-1 flex-col bg-canvas" aria-label="Queue manager">
          <div className="flex items-center justify-between border-b border-bone/15 px-3 py-2 md:px-6">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="eh-title text-xl leading-none md:text-2xl">Queue</h2>
            </div>
            <div className="grid h-7 min-w-7 place-items-center rounded-eh border border-yellow/30 bg-yellow/10 px-2 text-xs font-black text-yellow">{visibleQueue.length}</div>
          </div>
          <div className="scrollbar-soft min-h-0 flex-1 overflow-auto p-2 md:p-5">
            {visibleQueue.length ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={queueIds} strategy={verticalListSortingStrategy}>
                  <div className="mx-auto grid max-w-4xl gap-1.5">
                    {visibleQueue.map((episode) => (
                      <QueueDrawerRow
                        key={episode.id}
                        episode={episode}
                        selected={selectedQueueId === episode.id}
                        onSelect={() => setSelectedQueueId((currentId) => currentId === episode.id ? null : episode.id)}
                        onPlayEpisode={onPlayEpisode}
                        onQueueNext={onQueueNext}
                        onQueueEnd={onQueueEnd}
                        onSendInbox={onSendInbox}
                        onRemoveQueue={onRemoveQueue}
                        onTogglePlayed={onTogglePlayed}
                        onOpenEpisode={openEpisode}
                        onOpenPodcast={openPodcast}
                        podcastImageUrl={getPodcastImageUrl?.(episode.podcastId)}
                        currentEpisodeId={current?.id}
                        isCurrentPlaying={isPlaying}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="mx-auto grid min-h-[45vh] max-w-3xl place-items-center rounded-eh border border-dashed border-bone/20 bg-surface/45 p-8 text-center">
                <div>
                  <ListMusic size={32} className="mx-auto mb-4 text-yellow" aria-hidden />
                  <h3 className="eh-title text-xl">Queue is empty</h3>
                  <p className="mt-2 text-sm text-bone">Add episodes from Inbox, Search, or a podcast page.</p>
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </footer>
  );
}

function ProgressBar({ progress, duration, onSeek }: { progress: number; duration: number; onSeek: (seconds: number) => void }) {
  return (
    <input
      type="range"
      min={0}
      max={Math.max(1, duration)}
      step={1}
      value={Math.min(Math.max(0, duration * (progress / 100)), Math.max(1, duration))}
      aria-label="Seek playback"
      className="player-progress range-track h-3 w-full cursor-pointer appearance-none rounded-full bg-canvas/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow"
      style={{ '--progress': `${progress}%` } as React.CSSProperties}
      onChange={(event) => onSeek(Number(event.target.value))}
      disabled={!duration}
    />
  );
}

function CollapsedPlayer({
  current,
  artworkUrl,
  currentEpisodeLabel,
  progress,
  duration,
  remaining,
  queueCount,
  isPlaying,
  settings,
  onToggle,
  onSeek,
  onSkipBy,
  onOpenEpisode,
  onOpenPodcast,
  onOpenQueue
}: {
  current: EpisodeWithState | null;
  artworkUrl?: string;
  currentEpisodeLabel: string;
  progress: number;
  duration: number;
  remaining: number;
  queueCount: number;
  isPlaying: boolean;
  settings: AppSettings;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onSkipBy: (seconds: number) => void;
  onOpenEpisode: (episode: EpisodeWithState) => void;
  onOpenPodcast: (podcastId: string) => void;
  onOpenQueue: () => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[56px_1fr_auto] items-center gap-3">
        <button
          type="button"
          onClick={current ? onToggle : undefined}
          disabled={!current}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="relative h-14 w-14 overflow-hidden rounded-eh border border-bone/15 bg-surface transition hover:border-yellow/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow disabled:opacity-45"
        >
          {artworkUrl ? <img src={artworkUrl} alt="" className="h-full w-full object-cover" /> : null}
          <span className="absolute inset-0 grid place-items-center bg-black/25 text-cream">
            {isPlaying ? <Pause size={20} fill="currentColor" aria-hidden /> : <Play size={20} fill="currentColor" aria-hidden />}
          </span>
        </button>
        <div className="min-w-0">
          {currentEpisodeLabel ? <p className="mb-0.5 truncate text-[10px] font-black uppercase tracking-[0.08em] text-yellow">{currentEpisodeLabel}</p> : null}
          <button type="button" onClick={() => current && onOpenEpisode(current)} className="block max-w-full truncate text-left text-sm font-black leading-tight hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow">
            {current?.title || 'Nothing playing'}
          </button>
          <button type="button" onClick={() => current && onOpenPodcast(current.podcastId)} className="mt-0.5 block max-w-full truncate text-left text-xs text-bone hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow">
            {current ? current.podcastTitle : 'Choose an episode.'}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <IconButton label={`Skip back ${settings.skipBackSec} seconds`} onClick={() => onSkipBy(-settings.skipBackSec)} disabled={!current} className="h-9 w-9">
            <Rewind size={16} aria-hidden />
          </IconButton>
          <IconButton label={`Skip forward ${settings.skipForwardSec} seconds`} onClick={() => onSkipBy(settings.skipForwardSec)} disabled={!current} className="h-9 w-9">
            <FastForward size={16} aria-hidden />
          </IconButton>
          <button
            type="button"
            aria-label="Open queue"
            data-tooltip="Open queue"
            onClick={onOpenQueue}
            className="eh-tooltip flex h-9 min-w-11 items-center justify-center gap-1 rounded-eh border border-bone/15 bg-surface/70 px-2 text-sm font-black text-cream transition hover:border-yellow/50 hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow"
          >
            <ArrowUpToLine size={16} aria-hidden />
            <span>{queueCount}</span>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <ProgressBar progress={progress} duration={duration} onSeek={onSeek} />
        {current ? <span className="min-w-[3.5rem] text-right text-[11px] font-black tabular-nums text-bone">{formatRemainingLabel(remaining)}</span> : null}
      </div>
    </div>
  );
}

function QueueCountButton({ count, onClick, active, className }: { count: number; onClick: () => void; active?: boolean; className?: string }) {
  return (
    <button
      type="button"
      aria-label={active ? 'Collapse player' : 'Open queue'}
      data-tooltip={active ? 'Collapse player' : 'Open queue'}
      onClick={onClick}
      className={cn(
        'eh-tooltip flex h-10 min-w-12 items-center justify-center gap-1.5 rounded-eh border px-2 font-black transition hover:border-yellow/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow active:translate-y-px',
        active ? 'border-yellow bg-yellow text-canvas' : 'border-bone/15 bg-surface/70 text-cream',
        className
      )}
    >
      <ListMusic size={17} aria-hidden />
      <span className="text-xs leading-none">{count}</span>
    </button>
  );
}

function QueueDrawerRow({
  episode,
  selected,
  onSelect,
  onPlayEpisode,
  onQueueNext,
  onQueueEnd,
  onSendInbox,
  onRemoveQueue,
  onTogglePlayed,
  onOpenEpisode,
  onOpenPodcast,
  podcastImageUrl,
  currentEpisodeId,
  isCurrentPlaying
}: {
  episode: EpisodeWithState;
  selected: boolean;
  onSelect: () => void;
  onPlayEpisode: (episode: EpisodeWithState) => void;
  onQueueNext: (episode: EpisodeWithState) => void;
  onQueueEnd: (episode: EpisodeWithState) => void;
  onSendInbox: (episode: EpisodeWithState) => void;
  onRemoveQueue: (episode: EpisodeWithState) => void;
  onTogglePlayed: (episode: EpisodeWithState) => void;
  onOpenEpisode: (episode: EpisodeWithState) => void;
  onOpenPodcast: (podcastId: string) => void;
  podcastImageUrl?: string;
  currentEpisodeId?: string;
  isCurrentPlaying?: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: episode.id });
  const startX = useRef<number | null>(null);
  const artworkUrl = episode.imageUrl || podcastImageUrl;
  const isCurrentEpisode = currentEpisodeId === episode.id;
  const PlayIcon = isCurrentEpisode && isCurrentPlaying ? Pause : Play;
  const playLabel = isCurrentEpisode && isCurrentPlaying ? 'Pause' : 'Play now';
  const progress = episode.durationSec ? Math.min(100, ((episode.state.progressSec || 0) / episode.durationSec) * 100) : 0;

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-eh border border-bone/15 bg-surface/85 transition hover:border-yellow/35',
        selected && 'border-yellow/50 bg-yellow/10',
        isDragging && 'relative z-20 scale-[1.01] border-yellow bg-canvas shadow-xl shadow-black/40'
      )}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
        if (event.key === 'Escape' && selected) onSelect();
      }}
      onTouchStart={(event) => {
        startX.current = event.changedTouches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        if (startX.current === null) return;
        const delta = (event.changedTouches[0]?.clientX ?? 0) - startX.current;
        startX.current = null;
        if (Math.abs(delta) > 48) onSelect();
      }}
      tabIndex={0}
      aria-label={`${episode.title} queue row`}
    >
      <div className="grid grid-cols-[auto_52px_1fr_auto] items-center gap-2 p-2 md:grid-cols-[auto_56px_1fr_auto] md:gap-3">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Drag ${episode.title}`}
          data-tooltip="Drag to reorder"
          className="eh-tooltip grid h-9 w-7 place-items-center rounded-eh text-bone transition hover:bg-cream/5 hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={18} aria-hidden />
        </button>
        {artworkUrl ? <img src={artworkUrl} alt="" className="h-[52px] w-[52px] rounded-eh border border-bone/15 object-cover md:h-14 md:w-14" /> : <div className="h-[52px] w-[52px] rounded-eh border border-bone/15 bg-canvas md:h-14 md:w-14" />}
        <div className="min-w-0">
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpenEpisode(episode); }} className="block max-w-full truncate text-left text-sm font-black leading-tight text-cream hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow">{episode.title}</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpenPodcast(episode.podcastId); }} className="mt-0.5 block max-w-full truncate text-left text-[11px] font-bold uppercase tracking-[0.05em] text-yellow hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow">{episode.podcastTitle}</button>
          <p className="mt-0.5 truncate text-[11px] text-bone">{formatDuration(episode.durationSec)}{episode.state.progressSec ? ` · ${formatDuration(episode.state.progressSec)} in` : ''}</p>
          {progress > 0 && !episode.state.played ? <div className="mt-1 h-1 overflow-hidden rounded-full bg-canvas"><span className="block h-full bg-coral" style={{ width: `${progress}%` }} /></div> : null}
        </div>
        <IconButton label={playLabel} active={isCurrentEpisode && isCurrentPlaying} onClick={(event) => { event.stopPropagation(); onPlayEpisode(episode); }} className="h-9 w-9">
          <PlayIcon size={16} fill="currentColor" aria-hidden />
        </IconButton>
      </div>
      {selected ? (
        <div className="grid grid-cols-5 gap-1.5 border-t border-bone/15 bg-canvas/50 p-2" onClick={(event) => event.stopPropagation()}>
          <IconButton label="Play next" onClick={() => onQueueNext(episode)} className="h-9 w-full"><ListStart size={16} aria-hidden /></IconButton>
          <IconButton label="Send to end" onClick={() => onQueueEnd(episode)} className="h-9 w-full"><ListEnd size={16} aria-hidden /></IconButton>
          <IconButton label="Send back to inbox" onClick={() => onSendInbox(episode)} className="h-9 w-full"><Inbox size={16} aria-hidden /></IconButton>
          <IconButton label={episode.state.played ? 'Mark unplayed' : 'Mark played'} onClick={() => onTogglePlayed(episode)} className="h-9 w-full">{episode.state.played ? <RotateCcw size={16} aria-hidden /> : <Check size={16} aria-hidden />}</IconButton>
          <IconButton label="Remove from queue" danger onClick={() => onRemoveQueue(episode)} className="h-9 w-full"><Trash2 size={16} aria-hidden /></IconButton>
        </div>
      ) : null}
    </article>
  );
}

function formatEpisodeLabel(episode: EpisodeWithState): string {
  if (episode.seasonNumber && episode.episodeNumber) return `S${episode.seasonNumber} E${episode.episodeNumber}`;
  if (episode.episodeNumber) return `E${episode.episodeNumber}`;
  return '';
}

function formatSpeed(rate: number): string {
  return `${Number(rate.toFixed(1))}x`;
}

function formatRemainingLabel(remaining: number): string {
  return formatDuration(Math.max(0, Math.ceil(remaining)));
}
