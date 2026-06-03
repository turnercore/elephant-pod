import type { AppSettings, ListeningStats, Podcast } from '@/types/domain';
import type { ServerSession } from '@/lib/sync/serverAuth';
import { Panel } from '@/components/ui/Panel';
import { SettingsPanel } from '@/components/Settings/SettingsPanel';
import { SyncPanel } from '@/components/Sync/SyncPanel';

export function SettingsPage({
  settings,
  listeningStats,
  onSettingsChange,
  onRefresh,
  serverSession,
  onSessionChange,
  onTestServer,
  serverTestStatus,
  serverConnectionOk,
  onSignIn,
  showServerControls = true,
  canUseSmartSkip = false
}: {
  settings: AppSettings;
  listeningStats?: ListeningStats | null;
  feeds: Podcast[];
  onSettingsChange: (settings: AppSettings) => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onExportOpml: () => void;
  onImportOpml: (file: File) => void;
  onRefresh: () => void;
  serverSession: ServerSession | null;
  onSessionChange: (next: ServerSession | null) => void;
  onTestServer?: (serverUrl?: string) => void;
  serverTestStatus?: string;
  serverConnectionOk?: boolean;
  onSignIn: () => void;
  showServerControls?: boolean;
  canUseSilenceShortening?: boolean;
  canUseSmartSkip?: boolean;
}) {
  return (
    <Panel title="Settings" className="h-full">
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto px-2 pb-6 md:px-5">
        <div className="mx-auto grid w-full max-w-5xl gap-0">
          <SettingsPanel
            settings={settings}
            stats={listeningStats}
            onChange={onSettingsChange}
            onTestServer={onTestServer}
            serverTestStatus={serverTestStatus}
            showServerControls={showServerControls}
            canUseSmartSkip={canUseSmartSkip}
          />

          <section className="grid gap-3 border-b border-bone/15 py-5">
            <h3 className="eh-title text-sm text-yellow">Sync</h3>
            <SyncPanel
              settings={settings}
              onRefresh={onRefresh}
              serverSession={serverSession}
              onSessionChange={onSessionChange}
              onSignIn={onSignIn}
              serverConnectionOk={serverConnectionOk}
            />
          </section>

        </div>
      </div>
    </Panel>
  );
}
