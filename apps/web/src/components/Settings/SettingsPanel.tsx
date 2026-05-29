import { Server } from 'lucide-react';
import type { AppSettings, ListeningStats, SortDirection } from '@/types/domain';
import type { PropsWithChildren } from 'react';
import { Select, Input } from '../ui/Input';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';

export function SettingsPanel({
  settings,
  stats,
  onChange,
  onTestServer,
  serverTestStatus,
  showServerControls = true
}: {
  settings: AppSettings;
  stats?: ListeningStats | null;
  onChange: (settings: AppSettings) => void;
  onTestServer?: () => void;
  serverTestStatus?: string;
  showServerControls?: boolean;
}) {
  const thresholdDb = settings.silenceThresholdDb ?? -42;
  const boostRate = settings.silenceBoostRate ?? 2.15;
  const minSilence = settings.silenceMinimumDurationSec ?? 0.35;
  const topPodcasts = Object.values(stats?.byPodcast || {}).sort((a, b) => b.listeningSec - a.listeningSec).slice(0, 3);

  return (
    <div className="grid gap-5">
      <SettingsSection title="Playback">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 rounded-eh border border-bone/15 bg-canvas/30 p-3">
            <span className="text-sm font-bold">Skip forward</span>
            <Select value={settings.skipForwardSec} onChange={(event) => onChange({ ...settings, skipForwardSec: Number(event.target.value) })}>
              {[10, 15, 30, 60].map((value) => <option key={value} value={value}>{value}s</option>)}
            </Select>
          </label>
          <label className="grid gap-2 rounded-eh border border-bone/15 bg-canvas/30 p-3">
            <span className="text-sm font-bold">Skip back</span>
            <Select value={settings.skipBackSec} onChange={(event) => onChange({ ...settings, skipBackSec: Number(event.target.value) })}>
              {[10, 15, 30, 60].map((value) => <option key={value} value={value}>{value}s</option>)}
            </Select>
          </label>
        </div>
        <Slider
          label="Resume rewind"
          valueLabel={`${settings.resumeRewindSec}s`}
          min={0}
          max={30}
          step={1}
          value={settings.resumeRewindSec}
          onChange={(event) => onChange({ ...settings, resumeRewindSec: Number(event.currentTarget.value) })}
        />
        <Slider
          label="Feed refresh interval"
          valueLabel={`${Math.round(settings.refreshIntervalMinutes / 60)}h`}
          min={60}
          max={1440}
          step={60}
          value={settings.refreshIntervalMinutes}
          onChange={(event) => onChange({ ...settings, refreshIntervalMinutes: Number(event.currentTarget.value) })}
        />
        <Switch label="Auto play next" checked={settings.autoPlayNext} onCheckedChange={(checked) => onChange({ ...settings, autoPlayNext: checked })} description="Continue through the queue without asking." />
        <label className="grid gap-2 rounded-eh border border-bone/15 bg-canvas/30 p-3">
          <span className="text-sm font-bold">Inbox order</span>
          <Select value={settings.inboxSortDirection || 'newest'} onChange={(event) => onChange({ ...settings, inboxSortDirection: event.target.value as SortDirection })}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </Select>
        </label>
      </SettingsSection>

      <SettingsSection title="Downloads">
        <Slider
          label="Storage cap"
          valueLabel={`${settings.storageCapMb} MB`}
          min={256}
          max={20480}
          step={256}
          value={settings.storageCapMb}
          onChange={(event) => onChange({ ...settings, storageCapMb: Number(event.currentTarget.value) })}
        />
        <Switch label="Auto-download queued episodes" checked={settings.autoDownload} onCheckedChange={(checked) => onChange({ ...settings, autoDownload: checked })} description="Uses Tauri filesystem downloads in native builds. Browser auto-download only attempts same-origin media." />
        <Switch label="Auto-download inbox episodes" checked={Boolean(settings.autoDownloadInbox)} onCheckedChange={(checked) => onChange({ ...settings, autoDownloadInbox: checked })} description="Downloads inbox triage items after queued items. Dismissed inbox downloads are removed unless favorited." />
        <Switch label="Download only over Wi-Fi" checked={settings.downloadOnlyWifi} onCheckedChange={(checked) => onChange({ ...settings, downloadOnlyWifi: checked })} description="Manual downloads can still be attempted." />
        <Switch label="Delete after listen" checked={settings.autoDeleteAfterListen} onCheckedChange={(checked) => onChange({ ...settings, autoDeleteAfterListen: checked })} description="Deletes non-favorite downloads once they are no longer in Inbox or Queue." />
      </SettingsSection>

      <SettingsSection title="Profile Stats">
        <div className="grid gap-2 md:grid-cols-2">
          <Stat label="Time listened" value={formatStatTime(stats?.listeningSec || 0)} />
          <Stat label="Podcast time heard" value={formatStatTime(stats?.contentSec || 0)} />
          <Stat label="Saved by speed" value={formatStatTime(stats?.speedSavedSec || 0)} />
          <Stat label="Saved by silence" value={formatStatTime(stats?.silenceSavedSec || 0)} />
        </div>
        {topPodcasts.length ? (
          <div className="grid gap-2">
            {topPodcasts.map((podcast) => (
              <div key={podcast.podcastId} className="rounded-eh border border-bone/15 bg-canvas/30 p-3">
                <div className="text-sm font-black text-cream">{podcast.podcastTitle}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-[0.06em] text-bone">
                  {formatStatTime(podcast.listeningSec)} listened · {formatStatTime(podcast.speedSavedSec + podcast.silenceSavedSec)} saved
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-eh border border-bone/15 bg-canvas/30 p-3 text-sm text-bone">Listening stats start recording while playback is active.</p>
        )}
      </SettingsSection>

      <SettingsSection title="Silence Shortening">
        <Switch label="Silence shortening" checked={settings.silenceShortening} onCheckedChange={(checked) => onChange({ ...settings, silenceShortening: checked })} description="Automatically uses the best available runtime path." />
        <Slider
          label="Silence threshold"
          valueLabel={`${thresholdDb} dB`}
          min={-70}
          max={-25}
          step={1}
          value={thresholdDb}
          onChange={(event) => onChange({ ...settings, silenceThresholdDb: Number(event.currentTarget.value) })}
        />
        <Slider
          label="Minimum silence span"
          valueLabel={`${minSilence.toFixed(2)}s`}
          min={0.1}
          max={2}
          step={0.05}
          value={minSilence}
          onChange={(event) => onChange({ ...settings, silenceMinimumDurationSec: Number(event.currentTarget.value) })}
        />
        <Slider
          label="Silence boost rate"
          valueLabel={`${boostRate.toFixed(2)}x`}
          min={1.25}
          max={3}
          step={0.05}
          value={boostRate}
          onChange={(event) => onChange({ ...settings, silenceBoostRate: Number(event.currentTarget.value) })}
        />
      </SettingsSection>

      {showServerControls ? (
        <SettingsSection title="Server">
          <label className="grid gap-2 rounded-eh border border-bone/15 bg-canvas/30 p-3">
            <span className="text-sm font-bold">App server URL</span>
            <Input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={settings.serverUrl || ''}
              onChange={(event) => onChange({ ...settings, serverUrl: event.target.value })}
              placeholder="https://ears.example.com"
              aria-label="App server URL"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 rounded-eh border border-bone/15 bg-canvas/30 p-3">
            <Button onClick={onTestServer} disabled={!settings.serverUrl?.trim()} aria-label="Test app server connection">
              <Server size={16} aria-hidden />
              Test server
            </Button>
            <p className="min-w-0 flex-1 text-sm text-bone" role="status">{serverTestStatus || 'No server connection tested.'}</p>
          </div>
        </SettingsSection>
      ) : null}
    </div>
  );
}

function SettingsSection({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <section className="grid gap-3 border-b border-bone/15 py-5 first:pt-5">
      <h3 className="eh-title text-sm text-yellow">{title}</h3>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-eh border border-bone/15 bg-canvas/30 p-3">
      <div className="text-xs font-black uppercase tracking-[0.08em] text-bone">{label}</div>
      <div className="mt-1 text-lg font-black text-yellow">{value}</div>
    </div>
  );
}

function formatStatTime(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${rounded}s`;
}
