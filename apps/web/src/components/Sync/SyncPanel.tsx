import { Github, LogOut, RefreshCw, Server } from 'lucide-react';
import { useState } from 'react';
import type { AppSettings } from '@/types/domain';
import { syncNow } from '@/lib/sync/syncEngine';
import { startGithubSignIn, clearServerSession, isServerSessionExpired, resolveBrowserServerUrl, type ServerSession } from '@/lib/sync/serverAuth';
import { isHostedWebRuntime } from '@/lib/runtime';
import { Button } from '../ui/Button';

export function SyncPanel({
  settings,
  onRefresh,
  serverSession,
  onSessionChange
}: {
  settings: AppSettings;
  onRefresh: () => void;
  serverSession: ServerSession | null;
  onSessionChange: (next: ServerSession | null) => void;
}) {
  const [status, setStatus] = useState('');
  const serverUrl = resolveBrowserServerUrl(settings.serverUrl);
  const hasServer = Boolean(serverUrl);
  const sessionExpired = isServerSessionExpired(serverSession);
  const hasSession = Boolean(serverSession && !sessionExpired);
  const hostedWebRuntime = isHostedWebRuntime();
  const derivedStatus = hasSession ? 'Sync is active while signed in.' : hostedWebRuntime ? 'Sign in to use this hosted web app.' : 'Local-only mode is ready.';

  async function login() {
    if (!serverUrl) {
      setStatus('Add a server URL in Playback + Automation settings.');
      return;
    }
    try {
      setStatus('Opening GitHub sign-in flow...');
      await startGithubSignIn(serverUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not start GitHub sign-in.');
    }
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
    <div className="grid gap-4">
      <div className="rounded-eh border border-bone/15 bg-canvas/30 p-4">
        <div className="mb-3 flex items-center gap-2 text-yellow">
          <Server size={18} aria-hidden />
          <h3 className="eh-title text-sm">Optional Sync Server</h3>
        </div>
        <p className="text-sm leading-6 text-bone">
          {hostedWebRuntime
            ? 'This hosted web app uses its own server for sign-in, search, public clips, and sync.'
            : 'Sign-in is optional. Without it, the app uses only local IndexedDB. With a configured server URL and GitHub session, subscriptions, queue, settings, progress, played state, and clips sync automatically through the app server.'}
        </p>
      </div>
      <div className="grid gap-2 rounded-eh border border-bone/15 bg-canvas/30 p-4">
        <div className="text-sm">
          <span className="font-bold">Server auth</span>
          <span className="ml-2 text-bone">
            {hasServer ? (hasSession ? 'Signed in with GitHub. Sync is active.' : sessionExpired ? 'Session expired. Sign in again to unlock sync/search.' : 'No active session. Sign in to unlock sync/search.') : 'Set the server URL first.'}
          </span>
        </div>
        <div className="grid gap-2 md:grid-cols-[auto_auto_auto]">
          <Button onClick={login} variant="primary" disabled={!hasServer || hasSession} aria-label={hasSession ? 'Sign in with GitHub (already signed in)' : 'Sign in with GitHub'}>
            <Github size={16} aria-hidden />
            Sign in with GitHub
          </Button>
          <Button
            onClick={runSync}
            disabled={!hasServer || !hasSession}
            aria-label={hasSession ? 'Sync local data with server' : 'Sign in before syncing'}
          >
            <RefreshCw size={16} aria-hidden /> Sync now
          </Button>
          <Button onClick={logout} disabled={!hasSession}>
            <LogOut size={16} aria-hidden /> Sign out
          </Button>
        </div>
      </div>
      <p className="text-sm text-yellow" role="status">{status || derivedStatus}</p>
    </div>
  );
}
