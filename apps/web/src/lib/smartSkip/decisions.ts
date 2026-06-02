import type { ResolvedSmartSkipSettings, SmartSkipSegment, SmartSkipSegmentMap, SmartSkipSegmentType } from './types';

export function findAutoSkipTarget(input: {
  currentTimeSec: number;
  durationSec: number;
  segmentMap: SmartSkipSegmentMap | null;
  settings: ResolvedSmartSkipSettings;
  suppressedSegmentIds: Set<string>;
}): { segment: SmartSkipSegment; seekToSec: number } | null {
  if (!input.settings.enabled || input.segmentMap?.status !== 'ready') return null;
  const nowMs = Math.round(input.currentTimeSec * 1000);
  const durationMs = input.durationSec > 0 ? Math.round(input.durationSec * 1000) : input.segmentMap.durationMs;
  for (const segment of input.segmentMap.segments) {
    if (input.suppressedSegmentIds.has(segment.id)) continue;
    if (segment.action !== 'auto_skip' && !(segment.action === 'soft_skip' && input.settings.softSkips)) continue;
    if (!isTypeEnabled(segment.type, input.settings)) continue;
    if (nowMs < segment.startMs || nowMs >= segment.endMs - 50) continue;
    const seekToSec = Math.max(input.currentTimeSec, segment.endMs / 1000);
    if (durationMs && seekToSec * 1000 > durationMs + 1000) continue;
    return { segment, seekToSec };
  }
  return null;
}

export function resolveSegmentTypeSetting(type: SmartSkipSegmentType, settings: ResolvedSmartSkipSettings): boolean {
  return isTypeEnabled(type, settings);
}

function isTypeEnabled(type: SmartSkipSegmentType, settings: ResolvedSmartSkipSettings): boolean {
  if (type === 'ad') return settings.ads;
  if (type === 'sponsorship') return settings.sponsors;
  if (type === 'intro') return settings.intros;
  if (type === 'outro') return settings.outros;
  if (type === 'network_promo') return settings.networkPromos;
  if (type === 'self_promo') return settings.selfPromos;
  if (type === 'silence') return settings.silence;
  return false;
}
