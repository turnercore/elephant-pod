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
  onReconnect
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
}>) {
  return (
    <BackNavigationProvider value={{ canGoBack: Boolean(canGoBack), onBack }}>
    <div className="flex h-screen max-h-screen flex-col overflow-hidden">
      <MobileNavigationRail active={active} onSelect={onSelect} serverUrl={serverUrl} serverSession={serverSession} onSignIn={onSignIn} onSignOut={onSignOut} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <NavigationRail active={active} onSelect={onSelect} serverUrl={serverUrl} serverSession={serverSession} onSignIn={onSignIn} onSignOut={onSignOut} />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
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
          <div className="min-h-0 flex-1 overflow-hidden p-3 md:p-5">{children}</div>
        </main>
      </div>
      {player}
    </div>
    </BackNavigationProvider>
  );
}
