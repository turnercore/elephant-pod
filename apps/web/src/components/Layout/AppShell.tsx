import type { PropsWithChildren, ReactNode } from 'react';
import { LuWifiOff as WifiOff } from 'react-icons/lu';
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
  onBack,
  offline,
  onReconnect,
  inboxCount = 0
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
  offline?: boolean;
  onReconnect?: () => void;
  inboxCount?: number;
}>) {
  return (
    <BackNavigationProvider value={{ canGoBack: Boolean(canGoBack), onBack }}>
      <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col overflow-hidden md:grid md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto]">
        <MobileNavigationRail active={active} onSelect={onSelect} serverUrl={serverUrl} serverSession={serverSession} onSignIn={onSignIn} onSignOut={onSignOut} inboxCount={inboxCount} />
        <NavigationRail active={active} onSelect={onSelect} serverUrl={serverUrl} serverSession={serverSession} onSignIn={onSignIn} onSignOut={onSignOut} inboxCount={inboxCount} />
        <main className="relative flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden md:col-start-2 md:row-start-1">
          {offline ? (
              <button
                type="button"
                onClick={onReconnect}
                className="absolute right-4 top-4 z-40 grid h-9 w-9 place-items-center rounded-eh border border-yellow/30 bg-canvas/90 text-yellow shadow-lg shadow-black/30 transition hover:bg-yellow/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow"
                aria-label="Offline. Try reconnecting"
                title="Offline"
              >
                <WifiOff size={14} aria-hidden />
              </button>
            ) : null}
          <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-hidden px-0 py-2 md:p-5">{children}</div>
        </main>
        <div className="shrink-0 md:col-start-2 md:row-start-2">
          {player}
        </div>
      </div>
    </BackNavigationProvider>
  );
}
