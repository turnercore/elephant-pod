import type { SilenceBoundary, SmartSkipSegment, TranscriptSegment } from './types.js';
import { stableSegmentId } from './segmentMap.js';

const MAX_LENGTH_MS: Partial<Record<SmartSkipSegment['type'], number>> = {
  ad: 5 * 60_000,
  sponsorship: 5 * 60_000,
  network_promo: 3 * 60_000,
  intro: 5 * 60_000
};

export function refineSegments(input: {
  episodeId: string;
  mediaVersionId: string;
  durationMs?: number;
  segments: Omit<SmartSkipSegment, 'id'>[];
  transcriptSegments?: TranscriptSegment[];
  silenceMap?: SilenceBoundary[];
}): SmartSkipSegment[] {
  const refined: SmartSkipSegment[] = [];
  for (const raw of input.segments) {
    const originalStartMs = raw.startMs;
    const originalEndMs = raw.endMs;
    let startMs = Math.max(0, raw.startMs);
    let endMs = Math.max(0, raw.endMs);
    if (input.durationMs) {
      startMs = Math.min(startMs, input.durationMs);
      endMs = Math.min(endMs, input.durationMs);
    }
    const transcriptSnapped = snapToTranscript({ startMs, endMs }, input.transcriptSegments || []);
    startMs = transcriptSnapped.startMs;
    endMs = transcriptSnapped.endMs;
    const silenceSnapped = snapToSilence({ startMs, endMs }, input.silenceMap || []);
    startMs = silenceSnapped.startMs;
    endMs = silenceSnapped.endMs;
    if (endMs - startMs < 1000) continue;
    if (!isAllowedLength(raw.type, startMs, endMs, input.durationMs, raw.action)) continue;
    const action = raw.action === 'auto_skip' && raw.confidence < 0.92 ? 'soft_skip' : raw.action;
    refined.push({
      ...raw,
      id: stableSegmentId(input.episodeId, input.mediaVersionId, { ...raw, startMs, endMs }),
      startMs,
      endMs,
      action,
      source: raw.source === 'boundary_refiner' ? raw.source : raw.source,
      originalStartMs: originalStartMs === startMs ? raw.originalStartMs : originalStartMs,
      originalEndMs: originalEndMs === endMs ? raw.originalEndMs : originalEndMs
    });
  }
  return mergeAdjacent(refined, input.episodeId, input.mediaVersionId);
}

function snapToTranscript(range: { startMs: number; endMs: number }, transcript: TranscriptSegment[]) {
  if (!transcript.length) return range;
  const start = nearest(range.startMs, transcript.flatMap((segment) => [segment.startMs, segment.endMs]));
  const end = nearest(range.endMs, transcript.flatMap((segment) => [segment.startMs, segment.endMs]));
  return end > start ? { startMs: start, endMs: end } : range;
}

function snapToSilence(range: { startMs: number; endMs: number }, silenceMap: SilenceBoundary[]) {
  if (!silenceMap.length) return range;
  const boundaries = silenceMap.flatMap((segment) => [segment.startMs, segment.endMs]);
  const start = nearest(range.startMs, boundaries, 5000);
  const end = nearest(range.endMs, boundaries, 5000);
  return end > start ? { startMs: start, endMs: end } : range;
}

function nearest(value: number, candidates: number[], maxDistance = Number.POSITIVE_INFINITY): number {
  let best = value;
  let bestDistance = maxDistance;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function isAllowedLength(type: SmartSkipSegment['type'], startMs: number, endMs: number, durationMs: number | undefined, action: SmartSkipSegment['action']) {
  if (action !== 'auto_skip') return true;
  if (type === 'outro' && durationMs && startMs >= durationMs - 10 * 60_000) return true;
  const max = MAX_LENGTH_MS[type];
  return !max || endMs - startMs <= max;
}

function mergeAdjacent(segments: SmartSkipSegment[], episodeId: string, mediaVersionId: string): SmartSkipSegment[] {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: SmartSkipSegment[] = [];
  for (const segment of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.type !== segment.type || segment.startMs - previous.endMs >= 2500) {
      merged.push({ ...segment });
      continue;
    }
    previous.endMs = Math.max(previous.endMs, segment.endMs);
    previous.confidence = Math.min(previous.confidence, segment.confidence);
    previous.evidence = [...new Set([...(previous.evidence || []), ...(segment.evidence || [])])];
    previous.id = stableSegmentId(episodeId, mediaVersionId, previous);
  }
  return merged;
}
