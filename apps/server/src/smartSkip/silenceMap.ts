import { createOrGetSilenceMapJob, getSilenceMapJob, type MediaJobOptions } from '../mediaJobs.js';
import type { SilenceBoundary, SmartSkipProcessRequest } from './types.js';

export async function generateSmartSkipSilenceMap(request: SmartSkipProcessRequest, options: MediaJobOptions): Promise<{ durationMs?: number; boundaries: SilenceBoundary[] }> {
  const job = await createOrGetSilenceMapJob({ episodeId: request.episodeId, audioUrl: request.audioUrl }, options);
  let ready = job;
  if (job.status === 'queued' || job.status === 'processing') {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      ready = (await getSilenceMapJob(job.id, options)) || ready;
      if (ready.status === 'ready' || ready.status === 'failed') break;
    }
  }
  return {
    durationMs: ready.durationSec ? Math.round(ready.durationSec * 1000) : undefined,
    boundaries: ready.status === 'ready'
      ? ready.segments.map((segment) => ({
        startMs: Math.round(segment.silenceStartSec * 1000),
        endMs: Math.round(segment.silenceEndSec * 1000)
      }))
      : []
  };
}
