import type { PropsWithChildren, ReactNode } from 'react';
import type { SectionKey } from '@/types/domain';
import type { ServerSession } from '@/lib/sync/serverAuth';
import { BackNavigationProvider } from './BackNavigationContext';
import { MobileNavigationRail, NavigationRail } from './NavigationRail';

export function AppShell({
  active,
  onSelect,
  children,
  player,
  serverUrl,
  serverSession,
  onSignIn,
  onSignOut,
  canGoBack,
  onBack
}: PropsWithChildren<{
  active: SectionKey;
  onSelect: (key: SectionKey) => void;
  player: ReactNode;
  serverUrl?: string;
  serverSession: ServerSession | null;
  onSignIn: () => void;
  onSignOut: () => void;
  canGoBack?: boolean;
  onBack?: () => void;
}>) {
  return (
    <BackNavigationProvider value={{ canGoBack: Boolean(canGoBack), onBack }}>
    <div className="flex h-screen max-h-screen flex-col overflow-hidden">
      <MobileNavigationRail active={active} onSelect={onSelect} serverUrl={serverUrl} serverSession={serverSession} onSignIn={onSignIn} onSignOut={onSignOut} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <NavigationRail active={active} onSelect={onSelect} serverUrl={serverUrl} serverSession={serverSession} onSignIn={onSignIn} onSignOut={onSignOut} />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden p-3 md:p-5">{children}</div>
        </main>
      </div>
      {player}
    </div>
    </BackNavigationProvider>
  );
}
