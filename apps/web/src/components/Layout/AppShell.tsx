import type { PropsWithChildren, ReactNode } from 'react';
import type { SectionKey } from '@/types/domain';
import { NavigationRail } from './NavigationRail';

export function AppShell({ active, onSelect, children, player }: PropsWithChildren<{ active: SectionKey; onSelect: (key: SectionKey) => void; player: ReactNode }>) {
  return (
    <div className="flex h-screen max-h-screen overflow-hidden">
      <NavigationRail active={active} onSelect={onSelect} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden p-3 md:p-5">{children}</div>
        {player}
      </main>
    </div>
  );
}
