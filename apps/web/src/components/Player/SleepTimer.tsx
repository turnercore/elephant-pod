import { LuMoon as Moon } from 'react-icons/lu';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '../ui/Button';

type SleepPreset = 5 | 10 | 30 | 60 | 'episode';

const presets: Array<{ value: SleepPreset; label: string }> = [
  { value: 5, label: '5m' },
  { value: 10, label: '10m' },
  { value: 30, label: '30m' },
  { value: 60, label: '60m' },
  { value: 'episode', label: 'End' }
];

export function SleepTimer({
  currentTime,
  duration,
  onExpire,
  className
}: {
  currentTime: number;
  duration: number;
  onExpire: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [episodeEndArmed, setEpisodeEndArmed] = useState(false);

  useEffect(() => {
    if (!deadline) {
      setRemainingMs(0);
      return;
    }
    const update = () => {
      const next = deadline - Date.now();
      if (next <= 0) {
        setDeadline(null);
        setStartedAt(null);
        setRemainingMs(0);
        onExpire();
        return;
      }
      setRemainingMs(next);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, onExpire]);

  useEffect(() => {
    if (!episodeEndArmed || !duration || currentTime < duration - 1) return;
    setEpisodeEndArmed(false);
    onExpire();
  }, [currentTime, duration, episodeEndArmed, onExpire]);

  const fill = useMemo(() => {
    if (episodeEndArmed && duration > 0) return Math.max(0, Math.min(100, (currentTime / duration) * 100));
    if (!deadline || !startedAt) return 0;
    const total = deadline - startedAt;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, ((total - remainingMs) / total) * 100));
  }, [currentTime, deadline, duration, episodeEndArmed, remainingMs, startedAt]);

  const active = Boolean(deadline || episodeEndArmed);
  const label = episodeEndArmed ? 'until end' : remainingMs ? `${Math.ceil(remainingMs / 60000)}m left` : 'Sleep timer';

  function armTimer(value: SleepPreset) {
    if (value === 'episode') {
      setDeadline(null);
      setStartedAt(null);
      setEpisodeEndArmed(true);
    } else {
      const now = Date.now();
      setStartedAt(now);
      setDeadline(now + value * 60_000);
      setEpisodeEndArmed(false);
    }
    setOpen(false);
  }

  function clearTimer() {
    setDeadline(null);
    setStartedAt(null);
    setRemainingMs(0);
    setEpisodeEndArmed(false);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={active ? `Sleep timer active: ${label}` : 'Set sleep timer'}
        data-tooltip={active ? `Sleep timer: ${label}` : 'Sleep timer'}
        onClick={() => setOpen((next) => !next)}
        className={cn('eh-tooltip grid h-10 w-10 place-items-center rounded-eh border border-bone/15 bg-surface/70 text-cream transition hover:border-yellow/50 hover:text-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow active:translate-y-px', className)}
        style={active ? { background: `conic-gradient(rgb(var(--color-yellow)) ${fill}%, rgb(var(--color-surface) / 0.7) ${fill}%)` } : undefined}
      >
        <Moon size={18} fill={active ? 'currentColor' : 'none'} aria-hidden />
      </button>
      {open ? (
        <div className="absolute bottom-full right-0 z-30 mb-2 grid min-w-48 gap-2 rounded-eh border border-bone/15 bg-canvas/95 p-2 shadow-xl shadow-black/40">
          <div className="grid grid-cols-3 gap-1.5">
            {presets.map((preset) => (
              <Button key={String(preset.value)} size="sm" variant="secondary" onClick={() => armTimer(preset.value)}>
                {preset.label}
              </Button>
            ))}
          </div>
          {active ? (
            <Button size="sm" variant="ghost" onClick={clearTimer}>
              Clear {label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
