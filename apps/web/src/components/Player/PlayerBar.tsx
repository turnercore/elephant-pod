import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LuArrowDownToLine as ArrowDownToLine, LuArrowUpToLine as ArrowUpToLine, LuCheck as Check, LuGripVertical as GripVertical, LuInbox as Inbox, LuListEnd as ListEnd, LuListMusic as ListMusic, LuListStart as ListStart, LuPause as Pause, LuPlay as Play, LuRotateCcw as RotateCcw, LuScissors as Scissors, LuSkipForward as SkipForward, LuSparkles as Sparkles, LuTrash2 as Trash2 } from 'react-icons/lu';
import { IoCheckmarkDoneOutline, IoChevronBackCircleOutline, IoChevronForwardCircleOutline } from 'react-icons/io5';
import { RiForward5Line, RiForward10Line, RiForward15Line, RiForward30Line, RiReplay5Line, RiReplay10Line, RiReplay15Line, RiReplay30Line } from 'react-icons/ri';
import type { IconType } from 'react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, EpisodeWithState } from '@/types/domain';
import type { SmartSkipEvent } from '@/lib/smartSkip/types';
import { formatDuration } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { SwipeActionRow } from '../Gestures/SwipeActionRow';
import { IconButton } from '../ui/IconButton';
import { SleepTimer } from './SleepTimer';

const speedSteps = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 2];
const SHEET_PEEK_PX = 132;
const SHEET_TOP_OFFSET_PX = 61;
const SHEET_VELOCITY = 0.62;
const SKIP_COMMIT_DELAY_MS = 230;

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
  const [sheetDragging, setSheetDragging] = useState(false);
  const [sheetOffset, setSheetOffset] = useState(0);
  const [optimisticSkipTime, setOptimisticSkipTime] = useState<number | null>(null);
  const [skipBackPulse, setSkipBackPulse] = useState(0);
  const [skipForwardPulse, setSkipForwardPulse] = useState(0);
  const sheetOffsetRef = useRef(0);
  const skipCommitTimerRef = useRef<number | null>(null);
  const optimisticSkipTimeRef = useRef<number | null>(null);
  const sheetGesture = useRef<{ pointerId: number; startX: number; startY: number; lastY: number; lastAt: number; velocity: number; startOffset: number; locked: boolean } | null>(null);
  const effectiveDuration = duration || current?.durationSec || 0;
  const displayedCurrentTime = optimisticSkipTime ?? currentTime;
  const progress = effectiveDuration > 0 ? Math.max(0, Math.min(100, (displayedCurrentTime / effectiveDuration) * 100)) : 0;
  const remaining = Math.max(0, effectiveDuration - displayedCurrentTime);
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
    clearPendingSkip();
  }, [collapseToken]);

  useEffect(() => {
    clearPendingSkip();
  }, [current?.id]);

  useEffect(() => {
    return () => clearPendingSkip();
  }, []);

  function clearPendingSkip() {
    if (skipCommitTimerRef.current !== null) {
      window.clearTimeout(skipCommitTimerRef.current);
      skipCommitTimerRef.current = null;
    }
    optimisticSkipTimeRef.current = null;
    setOptimisticSkipTime(null);
  }

  function queueSkip(seconds: number) {
    if (!current) return;
    const base = optimisticSkipTimeRef.current ?? currentTime;
    const next = Math.max(0, Math.min(base + seconds, effectiveDuration || Math.max(0, base + seconds)));
    optimisticSkipTimeRef.current = next;
    setOptimisticSkipTime(next);
    if (seconds < 0) setSkipBackPulse((value) => value + 1);
    else setSkipForwardPulse((value) => value + 1);
    if (skipCommitTimerRef.current !== null) window.clearTimeout(skipCommitTimerRef.current);
    skipCommitTimerRef.current = window.setTimeout(() => {
      skipCommitTimerRef.current = null;
      const target = optimisticSkipTimeRef.current;
      optimisticSkipTimeRef.current = null;
      setOptimisticSkipTime(null);
      if (target !== null) onSeek(target);
    }, SKIP_COMMIT_DELAY_MS);
  }

  function toggleSheet() {
    if (queueOpen) {
      closeSheetAnimated();
      return;
    }
    setQueueOpen(true);
    setSelectedQueueId(null);
    setTrackedSheetOffset(0);
  }

  function closeSheetAnimated() {
    setSheetDragging(false);
    setSelectedQueueId(null);
    setTrackedSheetOffset(closedSheetOffset());
    window.setTimeout(() => {
      setQueueOpen(false);
      setTrackedSheetOffset(0);
    }, 220);
  }

  function setTrackedSheetOffset(value: number) {
    sheetOffsetRef.current = value;
    setSheetOffset(value);
  }

  function closedSheetOffset() {
    if (typeof window === 'undefined') return 520;
    return Math.max(260, window.innerHeight - SHEET_TOP_OFFSET_PX - SHEET_PEEK_PX);
  }

  function handleSheetPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement | null;
    const startedOnHandle = Boolean(target?.closest('[data-sheet-handle]'));
    if (!startedOnHandle && target?.closest('button,a,input,select,textarea,[role="button"],[role="slider"],[data-player-control]')) return;
    const startOffset = queueOpen ? 0 : closedSheetOffset();
    sheetGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: performance.now(),
      velocity: 0,
      startOffset,
      locked: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleSheetPointerMove(event: React.PointerEvent<HTMLElement>) {
    const gesture = sheetGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dy = event.clientY - gesture.startY;
    const dx = event.clientX - gesture.startX;
    if (!gesture.locked) {
      if (Math.abs(dx) > Math.abs(dy) + 6) {
        sheetGesture.current = null;
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may already be released.
        }
        return;
      }
      if (Math.abs(dy) < 12 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
    }
    gesture.locked = true;
    event.preventDefault();
    const now = performance.now();
    const dt = Math.max(1, now - gesture.lastAt);
    gesture.velocity = (event.clientY - gesture.lastY) / dt;
    gesture.lastY = event.clientY;
    gesture.lastAt = now;
    setSheetDragging(true);
    setQueueOpen(true);
    setSelectedQueueId(null);
    setTrackedSheetOffset(Math.max(0, Math.min(closedSheetOffset(), gesture.startOffset + dy)));
  }

  function handleSheetPointerEnd(event: React.PointerEvent<HTMLElement>) {
    const gesture = sheetGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    sheetGesture.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }
    const closed = closedSheetOffset();
    const finalOffset = Math.max(0, Math.min(closed, gesture.startOffset + event.clientY - gesture.startY));
    sheetOffsetRef.current = finalOffset;
    const shouldOpen = finalOffset < closed * 0.58 || gesture.velocity < -SHEET_VELOCITY;
    const shouldClose = finalOffset > closed * 0.35 || gesture.velocity > SHEET_VELOCITY;
    setSheetDragging(false);
    if (shouldOpen && !shouldClose) {
      setQueueOpen(true);
      setTrackedSheetOffset(0);
      return;
    }
    if (shouldClose) {
      setTrackedSheetOffset(finalOffset);
      window.requestAnimationFrame(closeSheetAnimated);
      return;
    }
    setQueueOpen(true);
    setTrackedSheetOffset(0);
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
        queueOpen || sheetDragging ? 'fixed inset-x-0 bottom-0 top-[61px] z-40 flex flex-col border-t-0 shadow-2xl shadow-black md:left-[230px] md:top-0' : 'relative',
        queueOpen && !sheetDragging && sheetOffset === 0 && 'player-queue-stage',
        sheetDragging && 'transition-none'
      )}
      aria-label="Player"
      style={(queueOpen || sheetDragging) && sheetOffset > 0 ? { transform: `translate3d(0, ${sheetOffset}px, 0)` } : undefined}
      onPointerDown={handleSheetPointerDown}
      onPointerMove={handleSheetPointerMove}
      onPointerUp={handleSheetPointerEnd}
      onPointerCancel={handleSheetPointerEnd}
    >
      <div className={cn('border-b border-bone/15', queueOpen ? 'px-4 pb-3 pt-3 md:px-6' : 'px-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.85rem)] pt-2 md:px-3')}>
        <button
          type="button"
          aria-label={queueOpen ? 'Collapse player' : 'Open queue'}
          data-sheet-handle
          onClick={toggleSheet}
          className="mx-auto mb-1 block h-3.5 w-16 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow"
        >
          <span aria-hidden="true" className="mx-auto mt-1 block h-1 w-11 rounded-full bg-bone/45 transition-colors hover:bg-yellow/70" />
        </button>
        <div className={cn('mt-2 grid gap-2', queueOpen ? '' : '')}>
          {smartSkipNotice ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-eh border border-yellow/30 bg-yellow/10 px-3 py-2 text-sm font-bold text-yellow">
              <span>Skipped {smartSkipNotice.segment.label.toLowerCase()}</span>
              <button type="button" onClick={onUndoSmartSkip} className="rounded px-2 py-1 text-xs uppercase tracking-[0.06em] text-cream hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow">
                Undo
              </button>
            </div>
          ) : null}
          <CollapsedPlayer
            current={current}
            artworkUrl={currentArtworkUrl}
            currentEpisodeLabel={currentEpisodeLabel}
            progress={progress}
            duration={effectiveDuration}
            remaining={remaining}
            isPlaying={isPlaying}
            settings={settings}
            onToggle={onToggle}
            onSeek={onSeek}
            onSkipBy={queueSkip}
            skipBackPulse={skipBackPulse}
            skipForwardPulse={skipForwardPulse}
            onOpenEpisode={openEpisode}
            onOpenPodcast={openPodcast}
          />
          {queueOpen ? (
            <div className={cn('grid w-full gap-1 md:w-auto md:justify-self-end md:gap-2', canUseSilenceShortening ? 'grid-cols-5' : 'grid-cols-4')}>
              <IconButton
                label={settings.smartSkipEnabled ? 'Disable Smart Skip' : 'Enable Smart Skip'}
                title={settings.smartSkipEnabled ? 'Disable Smart Skip' : 'Enable Smart Skip'}
                onClick={() => onSettingsChange({ ...settings, smartSkipEnabled: !settings.smartSkipEnabled })}
                active={settings.smartSkipEnabled}
                className="h-10 w-full md:h-12 md:w-12"
              >
                <Sparkles size={18} aria-hidden />
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
                label="Mark as played and skip"
                onClick={() => {
                  if (current) onTogglePlayed(current);
                  onPlayNext();
                }}
                disabled={!current}
                className="h-10 w-full md:h-12 md:w-12"
              >
                <IoCheckmarkDoneOutline size={20} aria-hidden />
              </IconButton>
            </div>
          ) : null}
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
              <div className="grid min-h-[45vh] place-items-center px-6 text-center">
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
  const [draftValue, setDraftValue] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const max = Math.max(1, duration);
  const currentValue = Math.min(Math.max(0, duration * (progress / 100)), max);
  const displayValue = draftValue ?? currentValue;
  const displayProgress = duration > 0 ? Math.max(0, Math.min(100, (displayValue / duration) * 100)) : progress;

  useEffect(() => {
    if (!dragging) setDraftValue(null);
  }, [currentValue, dragging]);

  function commit(value: number) {
    const next = Math.max(0, Math.min(value, duration || value));
    setDragging(false);
    setDraftValue(null);
    if (duration) onSeek(next);
  }

  return (
    <input
      type="range"
      min={0}
      max={max}
      step={1}
      value={displayValue}
      aria-label="Seek playback"
      className="player-progress range-track h-3 min-w-0 w-full cursor-pointer appearance-none rounded-full bg-canvas/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow"
      style={{ '--progress': `${displayProgress}%` } as React.CSSProperties}
      data-player-control
      onPointerDown={() => setDragging(true)}
      onPointerUp={(event) => commit(Number(event.currentTarget.value))}
      onPointerCancel={() => {
        setDragging(false);
        setDraftValue(null);
      }}
      onInput={(event) => setDraftValue(Number(event.currentTarget.value))}
      onChange={(event) => {
        if (!dragging) commit(Number(event.currentTarget.value));
      }}
      onKeyUp={(event) => {
        if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End' || event.key === 'PageUp' || event.key === 'PageDown') {
          commit(Number(event.currentTarget.value));
        }
      }}
      onBlur={(event) => {
        if (draftValue !== null) commit(Number(event.currentTarget.value));
      }}
      disabled={!duration}
    />
  );
}

function SkipButton({
  direction,
  seconds,
  pulse,
  onClick,
  disabled,
  className
}: {
  direction: 'back' | 'forward';
  seconds: number;
  pulse: number;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const Icon = skipIcon(direction, seconds);
  const animationClass = direction === 'back' ? 'skip-icon-spin-back' : 'skip-icon-spin-forward';
  return (
    <IconButton
      label={`Skip ${direction === 'back' ? 'back' : 'forward'} ${seconds} seconds`}
      onClick={onClick}
      disabled={disabled}
      className={cn('group active:scale-95 active:brightness-125', className)}
    >
      <span key={`${direction}-${pulse}`} className={cn('grid place-items-center text-cream transition-colors group-active:text-yellow', pulse > 0 && animationClass)}>
        <Icon size={22} aria-hidden />
      </span>
    </IconButton>
  );
}

function skipIcon(direction: 'back' | 'forward', seconds: number): IconType {
  if (direction === 'forward') {
    if (seconds === 5) return RiForward5Line;
    if (seconds === 10) return RiForward10Line;
    if (seconds === 15) return RiForward15Line;
    if (seconds === 30) return RiForward30Line;
    return IoChevronForwardCircleOutline;
  }
  if (seconds === 5) return RiReplay5Line;
  if (seconds === 10) return RiReplay10Line;
  if (seconds === 15) return RiReplay15Line;
  if (seconds === 30) return RiReplay30Line;
  return IoChevronBackCircleOutline;
}

function CollapsedPlayer({
  current,
  artworkUrl,
  currentEpisodeLabel,
  progress,
  duration,
  remaining,
  isPlaying,
  settings,
  onToggle,
  onSeek,
  onSkipBy,
  skipBackPulse,
  skipForwardPulse,
  onOpenEpisode,
  onOpenPodcast
}: {
  current: EpisodeWithState | null;
  artworkUrl?: string;
  currentEpisodeLabel: string;
  progress: number;
  duration: number;
  remaining: number;
  isPlaying: boolean;
  settings: AppSettings;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onSkipBy: (seconds: number) => void;
  skipBackPulse: number;
  skipForwardPulse: number;
  onOpenEpisode: (episode: EpisodeWithState) => void;
  onOpenPodcast: (podcastId: string) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_6.75rem] items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_4.5rem] md:items-center">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_auto] gap-x-2 gap-y-2 py-0.5">
        <div className="col-span-2 min-w-0 self-start">
          <div className="min-w-0 w-full">
            <button type="button" onClick={() => current && onOpenEpisode(current)} className="block w-full max-w-full truncate text-left text-[15px] font-black leading-tight text-cream hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow md:text-base">
              {current?.title || 'Nothing playing'}
            </button>
            <button type="button" onClick={() => current && onOpenPodcast(current.podcastId)} className="mt-1 block w-full max-w-full truncate text-left text-xs font-bold leading-tight text-bone hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow md:text-sm">
              {current ? current.podcastTitle : 'Choose an episode.'}
            </button>
            {currentEpisodeLabel ? <p className="sr-only">{currentEpisodeLabel}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-end justify-end gap-1.5 self-end">
          <SkipButton direction="back" seconds={settings.skipBackSec} pulse={skipBackPulse} onClick={() => onSkipBy(-settings.skipBackSec)} disabled={!current} className="h-9 w-9 md:h-10 md:w-10" />
          <SkipButton direction="forward" seconds={settings.skipForwardSec} pulse={skipForwardPulse} onClick={() => onSkipBy(settings.skipForwardSec)} disabled={!current} className="h-9 w-9 md:h-10 md:w-10" />
        </div>
        <div className="col-span-2 grid grid-cols-[1fr_auto] items-center gap-2">
          <ProgressBar progress={progress} duration={duration} onSeek={onSeek} />
          <span className="min-w-[3.25rem] text-right text-[11px] font-black tabular-nums text-bone">{current ? formatRemainingLabel(remaining) : '-:--'}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={current ? onToggle : undefined}
        disabled={!current}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className="relative h-[6.75rem] w-[6.75rem] overflow-hidden rounded-eh border border-bone/15 bg-surface transition hover:border-yellow/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow disabled:opacity-45 md:h-[4.5rem] md:w-[4.5rem]"
      >
        <span className="absolute inset-0">
          {artworkUrl ? <img src={artworkUrl} alt="" className="h-full w-full object-cover" /> : null}
        </span>
        <span className="absolute inset-0 grid place-items-center bg-black/20">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-canvas/70 text-cream shadow-lg shadow-black/30 backdrop-blur-sm md:h-10 md:w-10">
            {isPlaying ? <Pause size={20} fill="currentColor" aria-hidden /> : <Play size={20} fill="currentColor" aria-hidden />}
          </span>
        </span>
      </button>
    </div>
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
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('button,a,input,select,textarea,[role="button"]')) return;
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
        if (event.key === 'Escape' && selected) onSelect();
      }}
      tabIndex={0}
      aria-label={`${episode.title} queue row`}
    >
      <SwipeActionRow
        contentClassName="rounded-eh"
        leftActions={[
          { key: 'send-inbox', label: 'Inbox', icon: <Inbox size={18} aria-hidden />, tone: 'primary', onAction: () => onSendInbox(episode) },
          { key: 'played', label: episode.state.played ? 'Unplayed' : 'Listened', icon: episode.state.played ? <RotateCcw size={18} aria-hidden /> : <Check size={18} aria-hidden />, tone: 'success', onAction: () => onTogglePlayed(episode) }
        ]}
        rightActions={[
          { key: 'top', label: 'Top', icon: <ListStart size={18} aria-hidden />, tone: 'primary', onAction: () => onQueueNext(episode) },
          { key: 'bottom', label: 'Bottom', icon: <ListEnd size={18} aria-hidden />, tone: 'default', onAction: () => onQueueEnd(episode) },
          { key: 'remove', label: 'Remove', icon: <Trash2 size={18} aria-hidden />, tone: 'danger', onAction: () => onRemoveQueue(episode) }
        ]}
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
            {progress > 0 && !episode.state.played ? <div className="mt-1 h-1 overflow-hidden rounded-full border border-bone/15 bg-bone/20"><span className="block h-full bg-coral" style={{ width: `${progress}%` }} /></div> : null}
          </div>
          <IconButton label={playLabel} active={isCurrentEpisode && isCurrentPlaying} onClick={(event) => { event.stopPropagation(); onPlayEpisode(episode); }} className="h-9 w-9">
            <PlayIcon size={16} fill="currentColor" aria-hidden />
          </IconButton>
        </div>
      </SwipeActionRow>
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
