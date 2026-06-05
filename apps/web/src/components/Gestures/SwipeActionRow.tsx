import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SwipeAction {
  key: string;
  label: string;
  icon: ReactNode;
  tone?: 'default' | 'primary' | 'danger' | 'success';
  onAction: () => void;
}

interface SwipeActionRowProps {
  children: ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

const REVEAL_DISTANCE = 92;
const MAX_OFFSET = 210;

export function SwipeActionRow({
  children,
  leftActions = [],
  rightActions = [],
  className,
  contentClassName,
  disabled,
  ariaLabel
}: SwipeActionRowProps) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(0);
  const suppressClickUntil = useRef(0);
  const gesture = useRef<{ pointerId: number; startX: number; startY: number; locked: boolean } | null>(null);

  const canSwipeLeft = rightActions.length > 0;
  const canSwipeRight = leftActions.length > 0;

  function clampOffset(value: number) {
    const min = canSwipeLeft ? -MAX_OFFSET : 0;
    const max = canSwipeRight ? MAX_OFFSET : 0;
    return Math.max(min, Math.min(max, value));
  }

  function close() {
    setTrackedOffset(0);
    setDragging(false);
  }

  function setTrackedOffset(value: number) {
    offsetRef.current = value;
    setOffset(value);
  }

  function start(event: React.PointerEvent<HTMLElement>) {
    if (disabled || event.pointerType === 'mouse') return;
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      locked: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.locked && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) return;
    if (Math.abs(dx) > 8) current.locked = true;
    if (!current.locked) return;

    setDragging(true);
    setTrackedOffset(clampOffset(dx));
  }

  function end(event: React.PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    const dx = offsetRef.current;
    setDragging(false);
    if (current.locked) suppressClickUntil.current = Date.now() + 350;

    if (dx <= -REVEAL_DISTANCE && rightActions.length) {
      setTrackedOffset(-Math.min(MAX_OFFSET, Math.max(REVEAL_DISTANCE, rightActions.length * 74)));
      return;
    }
    if (dx >= REVEAL_DISTANCE && leftActions.length) {
      setTrackedOffset(Math.min(MAX_OFFSET, Math.max(REVEAL_DISTANCE, leftActions.length * 74)));
      return;
    }
    close();
  }

  function handleClickCapture(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-swipe-action]')) return;
    if (Date.now() < suppressClickUntil.current || Math.abs(offsetRef.current) > 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <div
      className={cn('relative w-full max-w-full overflow-hidden', className)}
      aria-label={ariaLabel}
      onClickCapture={handleClickCapture}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={close}
    >
      <ActionRail side="left" actions={leftActions} visible={offset > 0} onDone={close} />
      <ActionRail side="right" actions={rightActions} visible={offset < 0} onDone={close} />
      <div
        className={cn(
          'relative z-10 touch-pan-y bg-surface transition-transform duration-200 ease-out motion-reduce:transition-none',
          dragging && 'transition-none',
          contentClassName
        )}
        style={{ transform: `translate3d(${offset}px, 0, 0)` }}
      >
        {children}
      </div>
    </div>
  );
}

function ActionRail({ side, actions, visible, onDone }: { side: 'left' | 'right'; actions: SwipeAction[]; visible: boolean; onDone: () => void }) {
  if (!actions.length) return null;
  return (
    <div
      className={cn(
        'absolute inset-y-0 z-0 flex items-stretch gap-1 p-1 md:hidden',
        side === 'left' ? 'left-0 justify-start' : 'right-0 justify-end',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      aria-hidden={!visible}
    >
      {actions.map((action) => (
        <button
          key={action.key}
          data-swipe-action
          type="button"
          aria-label={action.label}
          title={action.label}
          onClick={() => {
            action.onAction();
            onDone();
          }}
          className={cn(
            'grid min-w-[4.25rem] place-items-center rounded-eh border px-3 text-xs font-black text-cream transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow',
            action.tone === 'danger' && 'border-coral/40 bg-coral text-canvas',
            action.tone === 'primary' && 'border-yellow/40 bg-yellow text-canvas',
            action.tone === 'success' && 'border-teal/40 bg-teal text-canvas',
            (!action.tone || action.tone === 'default') && 'border-bone/15 bg-surface text-cream'
          )}
        >
          <span className="grid gap-1 place-items-center">
            {action.icon}
            <span className="max-w-[4.5rem] truncate">{action.label}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
