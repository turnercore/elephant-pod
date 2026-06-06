import { type ReactNode, useRef, useState } from 'react';
import { LuRefreshCw as RefreshCw } from 'react-icons/lu';
import { cn } from '@/lib/cn';

const TRIGGER_PX = 76;
const MAX_PULL_PX = 112;

export function PullToRefresh({
  children,
  onRefresh,
  className
}: {
  children: ReactNode;
  onRefresh: () => void | Promise<void>;
  className?: string;
}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wheelResetTimerRef = useRef<number | null>(null);

  function nearestScrollable() {
    let node = rootRef.current?.parentElement || null;
    while (node) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    return null;
  }

  async function runRefresh() {
    setRefreshing(true);
    setPull(TRIGGER_PX);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse') return;
    if ((nearestScrollable()?.scrollTop || 0) > 0 || refreshing) return;
    startYRef.current = event.clientY;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (startYRef.current === null || refreshing) return;
    if ((nearestScrollable()?.scrollTop || 0) > 0) {
      startYRef.current = null;
      setPull(0);
      return;
    }
    const delta = event.clientY - startYRef.current;
    if (delta <= 0) return;
    if (delta > 12) event.preventDefault();
    setPull(Math.min(MAX_PULL_PX, Math.pow(delta, 0.86)));
  }

  function handlePointerEnd() {
    if (startYRef.current === null) return;
    startYRef.current = null;
    if (pull >= TRIGGER_PX) {
      void runRefresh();
      return;
    }
    setPull(0);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (refreshing) return;
    if ((nearestScrollable()?.scrollTop || 0) > 0) return;
    if (event.deltaY >= 0) {
      if (pull > 0) setPull((current) => Math.max(0, current - Math.min(30, event.deltaY)));
      return;
    }

    event.preventDefault();
    if (wheelResetTimerRef.current) window.clearTimeout(wheelResetTimerRef.current);
    const nextPull = Math.min(MAX_PULL_PX, pull + Math.min(30, Math.abs(event.deltaY) * 0.65));
    setPull(nextPull);
    if (nextPull >= TRIGGER_PX) {
      void runRefresh();
      return;
    }
    wheelResetTimerRef.current = window.setTimeout(() => setPull(0), 220);
  }

  const armed = pull >= TRIGGER_PX;

  return (
    <div
      ref={rootRef}
      className={cn('relative min-w-0 max-w-full overscroll-contain', className)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onWheel={handleWheel}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-10 z-10 flex justify-center transition-transform duration-150"
        style={{ transform: `translateY(${Math.max(-44, pull - 58)}px)` }}
      >
        <div className={cn('mt-2 grid h-10 w-10 place-items-center rounded-full border shadow-lg shadow-black/30', armed || refreshing ? 'border-yellow/40 bg-yellow text-canvas' : 'border-bone/20 bg-canvas/95 text-bone')}>
          <RefreshCw size={18} className={refreshing ? 'animate-spin' : undefined} />
        </div>
      </div>
      <div className="transition-transform duration-150" style={{ transform: `translateY(${refreshing ? TRIGGER_PX : pull}px)` }}>
        {children}
      </div>
    </div>
  );
}
