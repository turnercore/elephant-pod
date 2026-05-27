import { Download, FileDown, FileUp, Upload } from 'lucide-react';
import type { AppSettings, Podcast } from '@/types/domain';
import type { ServerSession } from '@/lib/sync/serverAuth';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SettingsPanel } from '@/components/Settings/SettingsPanel';
import { SyncPanel } from '@/components/Sync/SyncPanel';

export function SettingsPage({
  settings,
  feeds,
  onSettingsChange,
  onExportJson,
  onImportJson,
  onExportOpml,
  onImportOpml,
  onRefresh,
  serverSession,
  onSessionChange
}: {
  settings: AppSettings;
  feeds: Podcast[];
  onSettingsChange: (settings: AppSettings) => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onExportOpml: () => void;
  onImportOpml: (file: File) => void;
  onRefresh: () => void;
  serverSession: ServerSession | null;
  onSessionChange: (next: ServerSession | null) => void;
}) {
  return (
    <div className="grid h-full min-h-0 gap-4 overflow-hidden xl:grid-cols-[1fr_1fr]">
      <Panel title="Playback + Automation" kicker="Make the defaults disappear" className="min-h-0 overflow-hidden">
        <div className="scrollbar-soft overflow-auto p-4">
          <SettingsPanel settings={settings} onChange={onSettingsChange} />
        </div>
      </Panel>
      <Panel title="Sync + Portability" kicker="No lock-in. Account optional." className="min-h-0 overflow-hidden">
        <div className="scrollbar-soft overflow-auto p-4">
          <SyncPanel settings={settings} onChange={onSettingsChange} onRefresh={onRefresh} serverSession={serverSession} onSessionChange={onSessionChange} />
          <div className="mt-6 grid gap-3 rounded-eh border border-bone/15 bg-canvas/30 p-4">
            <h3 className="eh-title text-sm">Import / Export / Backup</h3>
            <p className="text-sm text-bone">{feeds.length} subscriptions. Use OPML for subscriptions and JSON for full local backup.</p>
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
          </div>
        </div>
      </Panel>
    </div>
  );
}
