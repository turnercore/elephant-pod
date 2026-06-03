import { LuGithub as Github, LuLogOut as LogOut, LuRefreshCw as RefreshCw, LuServer as Server } from 'react-icons/lu';
import { useState } from 'react';
import type { AppSettings } from '@/types/domain';
import { syncNow } from '@/lib/sync/syncEngine';
import { clearServerSession, isServerSessionExpired, resolveBrowserServerUrl, type ServerSession } from '@/lib/sync/serverAuth';
import { isHostedWebRuntime } from '@/lib/runtime';
import { IconButton } from '../ui/IconButton';

export function SyncPanel({
  settings,
  onRefresh,
  serverSession,
  onSessionChange,
  onSignIn,
  serverConnectionOk = false
}: {
  settings: AppSettings;
  onRefresh: () => void;
  serverSession: ServerSession | null;
  onSessionChange: (next: ServerSession | null) => void;
  onSignIn: () => void;
  serverConnectionOk?: boolean;
}) {
  const [status, setStatus] = useState('');
  const serverUrl = resolveBrowserServerUrl(settings.serverUrl);
  const hasServer = Boolean(serverUrl);
  const sessionExpired = isServerSessionExpired(serverSession);
  const hasSession = Boolean(serverSession && !sessionExpired);
  const hostedWebRuntime = isHostedWebRuntime();
  const derivedStatus = hasSession ? 'Sync is active while signed in.' : hostedWebRuntime ? 'Sign in to use this hosted web app.' : 'Local-only mode is ready.';

  async function login() {
    onSignIn();
  }

  async function logout() {
    if (!serverUrl) return;
    clearServerSession(serverUrl);
    onSessionChange(null);
    setStatus('Signed out. Local data remains on this device.');
  }

  async function runSync() {
    if (!hasSession) {
      setStatus(sessionExpired ? 'Your GitHub session expired. Sign in again before syncing.' : 'Sign in with GitHub before syncing.');
      return;
    }
    const result = await syncNow(serverUrl, serverSession?.accessToken);
    setStatus(result.message);
    onRefresh();
  }

  return (
    <div className="grid gap-2 rounded-eh border border-bone/15 bg-canvas/30 p-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Server size={16} className="shrink-0 text-yellow" aria-hidden />
          <span className="truncate font-bold text-cream">
            {hasServer ? (hasSession ? 'Signed in' : sessionExpired ? 'Expired' : serverConnectionOk ? 'Server found' : 'Test server') : 'No server'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label={hasSession ? 'Sign in with GitHub (already signed in)' : 'Sign in with GitHub'} onClick={login} active={hasSession} disabled={!hasServer || hasSession} className="h-9 w-9">
            <Github size={16} aria-hidden />
          </IconButton>
          <IconButton
            label={hasSession ? 'Sync local data with server' : 'Sign in before syncing'}
            onClick={runSync}
            disabled={!hasServer || !hasSession}
            className="h-9 w-9"
          >
            <RefreshCw size={16} aria-hidden />
          </IconButton>
          <IconButton label="Sign out" onClick={logout} disabled={!hasSession} className="h-9 w-9">
            <LogOut size={16} aria-hidden />
          </IconButton>
        </div>
      </div>
      <p className="truncate text-xs text-yellow" role="status">{status || derivedStatus}</p>
    </div>
  );
}
