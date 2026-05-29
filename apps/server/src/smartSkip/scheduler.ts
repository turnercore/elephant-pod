import type { SmartSkipConfig } from './config.js';

export function startSmartSkipScheduler(config: SmartSkipConfig, runOnce: () => void): void {
  if (!config.enabled || !config.proactiveEnabled) return;
  const intervalMs = Math.max(1, Math.floor(24 / Math.max(1, config.proactiveRunsPerDay))) * 60 * 60 * 1000;
  setInterval(runOnce, intervalMs).unref();
}
