import crypto from 'node:crypto';
import type { SmartSkipSegment, SmartSkipSegmentMap } from './types.js';

export function createSegmentMap(input: {
  episodeId: string;
  podcastId?: string;
  mediaVersionId: string;
  audioUrl: string;
  durationMs?: number;
  status?: SmartSkipSegmentMap['status'];
  segments: SmartSkipSegment[];
}): SmartSkipSegmentMap {
  const sorted = [...input.segments]
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((segment) => ({ ...segment, id: segment.id || stableSegmentId(input.episodeId, input.mediaVersionId, segment) }));
  return {
    schemaVersion: 'elephant.smart-skip.v1',
    episodeId: input.episodeId,
    podcastId: input.podcastId,
    mediaVersionId: input.mediaVersionId,
    audioUrl: input.audioUrl,
    durationMs: input.durationMs,
    generatedAt: new Date().toISOString(),
    status: input.status || 'ready',
    segments: sorted
  };
}

export function stableSegmentId(episodeId: string, mediaVersionId: string, segment: Pick<SmartSkipSegment, 'type' | 'startMs' | 'endMs' | 'source'>): string {
  const hash = crypto.createHash('sha256').update([episodeId, mediaVersionId, segment.type, segment.startMs, segment.endMs, segment.source].join('|')).digest('hex').slice(0, 24);
  return `ssk_seg_${hash}`;
}
