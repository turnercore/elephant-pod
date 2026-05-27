import { Archive, Download, Inbox, ListMusic, Search, Settings, Waves } from 'lucide-react';
import type { SectionKey } from '@/types/domain';
import { cn } from '@/lib/cn';
import { IconButton } from '../ui/IconButton';
import { BrandMark } from './BrandMark';

const items: Array<{ key: SectionKey; label: string; icon: typeof Inbox }> = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'queue', label: 'Queue', icon: ListMusic },
  { key: 'library', label: 'Library', icon: Archive },
  { key: 'search', label: 'Search', icon: Search },
  { key: 'downloads', label: 'Downloads', icon: Download },
  { key: 'settings', label: 'Settings', icon: Settings }
];

export function NavigationRail({ active, onSelect }: { active: SectionKey; onSelect: (key: SectionKey) => void }) {
  return (
    <aside className="flex h-full w-[76px] shrink-0 flex-col items-center gap-4 border-r border-bone/15 bg-canvas/70 p-3 md:w-[230px] md:items-stretch">
      <BrandMark />
      <nav className="mt-3 grid gap-2" aria-label="Primary">
        {items.map((item) => {
          const Icon = item.icon;
          const activeItem = active === item.key;
          return (
            <button
              key={item.key}
              aria-label={item.label}
              aria-current={activeItem ? 'page' : undefined}
              onClick={() => onSelect(item.key)}
              className={cn(
                'flex h-11 items-center justify-center gap-3 rounded-eh border border-transparent px-3 text-sm font-black uppercase tracking-[0.06em] text-bone transition hover:border-yellow/30 hover:text-yellow md:justify-start',
                activeItem && 'border-yellow/60 bg-yellow text-canvas hover:text-canvas'
              )}
            >
              <Icon size={20} aria-hidden />
              <span className="hidden md:inline">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="mt-auto hidden rounded-eh border border-bone/15 bg-surface/70 p-3 md:block">
        <div className="mb-2 flex items-center gap-2 text-yellow">
          <Waves size={16} aria-hidden />
          <span className="eh-title text-xs">Local first</span>
        </div>
        <p className="text-xs leading-5 text-bone">Listen without an account. Add a server only when sync and public clips matter.</p>
      </div>
      <div className="mt-auto md:hidden">
        <IconButton label="Local-first mode" disabled>
          <Waves size={18} aria-hidden />
        </IconButton>
      </div>
    </aside>
  );
}
