import { createOrGetSilenceMapJob, getSilenceMapJob, type MediaJobOptions } from '../mediaJobs.js';
import type { SmartSkipProcessRequest, SmartSkipSilenceBoundary } from './types.js';

export async function generateSmartSkipSilenceMap(request: SmartSkipProcessRequest, options: MediaJobOptions): Promise<{ durationMs?: number; boundaries: SmartSkipSilenceBoundary[] }> {
  const job = await createOrGetSilenceMapJob({ episodeId: request.episodeId, audioUrl: request.audioUrl }, options);
  let ready = job;
  if (job.status === 'queued' || job.status === 'processing') {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      ready = (await getSilenceMapJob(job.id, options)) || ready;
      if (ready.status === 'ready' || ready.status === 'failed') break;
    }
  }
  if (ready.status === 'failed') throw new Error(ready.error || 'Smart Skip silence-map generation failed.');
  if (ready.status !== 'ready') throw new Error('Smart Skip silence-map generation did not finish before the lease window.');
  return {
    durationMs: ready.durationSec ? Math.round(ready.durationSec * 1000) : undefined,
    boundaries: ready.status === 'ready'
      ? ready.segments.map((segment) => ({
        startMs: Math.round(segment.skipFromSec * 1000),
        endMs: Math.round(segment.skipToSec * 1000),
        silenceStartMs: Math.round(segment.silenceStartSec * 1000),
        silenceEndMs: Math.round(segment.silenceEndSec * 1000)
      }))
      : []
  };
}
