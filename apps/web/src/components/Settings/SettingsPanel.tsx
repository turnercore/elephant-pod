import type { AppSettings, SilenceShorteningMode } from '@/types/domain';
import { Select, Input } from '../ui/Input';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';

export function SettingsPanel({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const mode: SilenceShorteningMode = settings.silenceShorteningMode || 'web-audio';
  const thresholdDb = settings.silenceThresholdDb ?? -42;
  const boostRate = settings.silenceBoostRate ?? 2.15;
  const minSilence = settings.silenceMinimumDurationSec ?? 0.35;

  return (
    <div className="grid gap-4">
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
        label="Storage cap"
        valueLabel={`${settings.storageCapMb} MB`}
        min={256}
        max={20480}
        step={256}
        value={settings.storageCapMb}
        onChange={(event) => onChange({ ...settings, storageCapMb: Number(event.currentTarget.value) })}
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
      <Switch label="Use native audio when available" checked={Boolean(settings.nativeAudioPreferred)} onCheckedChange={(checked) => onChange({ ...settings, nativeAudioPreferred: checked })} description="Tauri mobile builds can hand playback to AVPlayer / Media3 instead of WebView audio." />
      <Switch label="Auto-download queued episodes" checked={settings.autoDownload} onCheckedChange={(checked) => onChange({ ...settings, autoDownload: checked })} description="Uses Tauri filesystem downloads in native builds and Cache Storage on web." />
      <Switch label="Download only over Wi‑Fi" checked={settings.downloadOnlyWifi} onCheckedChange={(checked) => onChange({ ...settings, downloadOnlyWifi: checked })} description="Manual downloads can still be attempted." />
      <Switch label="Delete after listen" checked={settings.autoDeleteAfterListen} onCheckedChange={(checked) => onChange({ ...settings, autoDeleteAfterListen: checked })} description="Favorites are protected from deletion." />
      <Switch label="Silence shortening" checked={settings.silenceShortening} onCheckedChange={(checked) => onChange({ ...settings, silenceShortening: checked, silenceShorteningMode: checked && mode === 'off' ? 'server-ffmpeg' : mode })} description="Uses native processing, server ffmpeg, or Web Audio depending on the runtime." />
      <div className="grid gap-3 rounded-eh border border-bone/15 bg-canvas/30 p-3">
        <label className="grid gap-2">
          <span className="text-sm font-bold">Silence shortening mode</span>
          <Select
            value={mode}
            onChange={(event) => onChange({ ...settings, silenceShorteningMode: event.target.value as SilenceShorteningMode, silenceShortening: event.target.value !== 'off' })}
          >
            <option value="server-ffmpeg">Server ffmpeg render</option>
            <option value="native">Native audio engine</option>
            <option value="web-audio">Web Audio fallback</option>
            <option value="off">Off</option>
          </Select>
        </label>
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
          valueLabel={`${boostRate.toFixed(2)}×`}
          min={1.25}
          max={3}
          step={0.05}
          value={boostRate}
          onChange={(event) => onChange({ ...settings, silenceBoostRate: Number(event.currentTarget.value) })}
        />
      </div>
      <label className="grid gap-2 rounded-eh border border-bone/15 bg-canvas/30 p-3">
        <span className="text-sm font-bold">App server URL</span>
        <Input value={settings.serverUrl || ''} onChange={(event) => onChange({ ...settings, serverUrl: event.target.value })} placeholder="https://ears.example.com" />
      </label>
    </div>
  );
}
