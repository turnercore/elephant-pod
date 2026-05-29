import { Download, FileDown, FileUp, Upload } from 'lucide-react';
import type { AppSettings, ListeningStats, Podcast } from '@/types/domain';
import type { ServerSession } from '@/lib/sync/serverAuth';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { SettingsPanel } from '@/components/Settings/SettingsPanel';
import { SyncPanel } from '@/components/Sync/SyncPanel';

export function SettingsPage({
  settings,
  listeningStats,
  feeds,
  onSettingsChange,
  onExportJson,
  onImportJson,
  onExportOpml,
  onImportOpml,
  onRefresh,
  serverSession,
  onSessionChange,
  onTestServer,
  serverTestStatus,
  serverConnectionOk,
  onSignIn,
  showServerControls = true,
  canUseSilenceShortening = false
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
  onTestServer?: () => void;
  serverTestStatus?: string;
  serverConnectionOk?: boolean;
  onSignIn: () => void;
  showServerControls?: boolean;
  canUseSilenceShortening?: boolean;
}) {
  return (
    <Panel title="Settings" className="h-full">
      <div className="scrollbar-soft min-h-0 flex-1 overflow-auto px-4 pb-6 md:px-5">
        <div className="mx-auto grid w-full max-w-5xl gap-0">
          <SettingsPanel
            settings={settings}
            stats={listeningStats}
            onChange={onSettingsChange}
            onTestServer={onTestServer}
            serverTestStatus={serverTestStatus}
            showServerControls={showServerControls}
            canUseSilenceShortening={canUseSilenceShortening}
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

          <section className="grid gap-3 py-5">
            <div>
              <h3 className="eh-title text-sm text-yellow">Import / Export / Backup</h3>
              <p className="mt-2 text-sm text-bone">{feeds.length} subscriptions. Use OPML for subscriptions and JSON for full local backup.</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Button onClick={onExportOpml}><FileDown size={16} aria-hidden /> Export OPML</Button>
              <label className="inline-flex">
                <input className="sr-only" type="file" accept=".opml,.xml" onChange={(event) => event.target.files?.[0] && onImportOpml(event.target.files[0])} />
                <span className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-eh border border-bone/20 bg-surface px-4 text-xs font-black uppercase tracking-[0.06em] text-cream hover:text-yellow">
                  <FileUp size={16} aria-hidden /> Import OPML
                </span>
              </label>
              <Button onClick={onExportJson}><Download size={16} aria-hidden /> Export JSON</Button>
              <label className="inline-flex">
                <input className="sr-only" type="file" accept=".json" onChange={(event) => event.target.files?.[0] && onImportJson(event.target.files[0])} />
                <span className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-eh border border-bone/20 bg-surface px-4 text-xs font-black uppercase tracking-[0.06em] text-cream hover:text-yellow">
                  <Upload size={16} aria-hidden /> Import JSON
                </span>
              </label>
            </div>
          </section>
        </div>
      </div>
    </Panel>
  );
}
