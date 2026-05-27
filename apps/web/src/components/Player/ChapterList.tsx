import { ListTree } from 'lucide-react';
import type { Chapter } from '@/types/domain';
import { formatDuration } from '@/lib/dates';
import { EmptyState } from '../EmptyState';

export function ChapterList({ chapters, currentTime, onSeek }: { chapters: Chapter[]; currentTime: number; onSeek: (seconds: number) => void }) {
  if (!chapters.length) {
    return (
      <EmptyState icon={<ListTree size={24} aria-hidden />} title="No chapters">
        This episode has no chapter metadata yet.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-2">
      {chapters.map((chapter, index) => {
        const next = chapters[index + 1];
        const active = currentTime >= chapter.startsAt && (!next || currentTime < next.startsAt);
        return (
          <button
            key={chapter.id}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSeek(chapter.startsAt)}
            className="flex items-center justify-between gap-3 rounded-eh border border-bone/15 bg-canvas/30 px-3 py-2 text-left transition hover:border-yellow/40"
          >
            <span className={active ? 'font-bold text-yellow' : 'text-cream'}>{chapter.title}</span>
            <span className="text-xs text-bone">{formatDuration(chapter.startsAt)}</span>
          </button>
        );
      })}
    </div>
  );
}
