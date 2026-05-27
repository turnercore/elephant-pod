import { FastForward, Pause, Play, Rewind, SkipForward } from 'lucide-react';
import type { AppSettings, EpisodeWithState } from '@/types/domain';
import { formatDuration } from '@/lib/dates';
import { IconButton } from '../ui/IconButton';
import { Select } from '../ui/Input';
import { SleepTimer } from './SleepTimer';

interface PlayerBarProps {
  current: EpisodeWithState | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  settings: AppSettings;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onSkipBy: (seconds: number) => void;
  onSettingsChange: (settings: AppSettings) => void;
  onStopForSleep: () => void;
  onPlayNext: () => void;
}

export function PlayerBar({ current, isPlaying, currentTime, duration, settings, onToggle, onSeek, onSkipBy, onSettingsChange, onStopForSleep, onPlayNext }: PlayerBarProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  return (
    <footer className="border-t border-bone/15 bg-canvas/95 p-3" aria-label="Player">
      <div className="mb-2 h-1.5 overflow-hidden rounded-[3px] bg-surface">
        <button
          aria-label="Seek playback"
          className="block h-full w-full text-left"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - bounds.left) / bounds.width;
            onSeek(Math.max(0, Math.min(1, ratio)) * duration);
          }}
        >
          <span className="block h-full bg-yellow" style={{ width: `${progress}%` }} />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-cream">{current?.title || 'Nothing playing'}</p>
          <p className="truncate text-xs text-bone">
            {current ? `${current.podcastTitle} · ${formatDuration(currentTime)} / ${formatDuration(duration || current.durationSec)}` : 'Choose an episode from Inbox, Queue, or Library.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton label={`Skip back ${settings.skipBackSec} seconds`} onClick={() => onSkipBy(-settings.skipBackSec)} disabled={!current}>
            <Rewind size={18} aria-hidden />
          </IconButton>
          <IconButton label={isPlaying ? 'Pause' : 'Play'} onClick={onToggle} active={isPlaying} disabled={!current} className="h-12 w-12">
            {isPlaying ? <Pause size={22} aria-hidden /> : <Play size={22} fill="currentColor" aria-hidden />}
          </IconButton>
          <IconButton label={`Skip forward ${settings.skipForwardSec} seconds`} onClick={() => onSkipBy(settings.skipForwardSec)} disabled={!current}>
            <FastForward size={18} aria-hidden />
          </IconButton>
          <IconButton label="Play next queued episode" onClick={onPlayNext}>
            <SkipForward size={18} aria-hidden />
          </IconButton>
        </div>
        <div className="hidden items-center gap-2 xl:flex">
          <Select
            aria-label="Playback speed"
            className="h-9 w-24 text-xs"
            value={settings.playbackRate}
            onChange={(event) => onSettingsChange({ ...settings, playbackRate: Number(event.target.value) })}
          >
            {[0.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.25, 2.5].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </Select>
          <SleepTimer onExpire={onStopForSleep} />
        </div>
      </div>
    </footer>
  );
}
