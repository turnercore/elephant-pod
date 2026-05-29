import crypto from 'node:crypto';
import type { SmartSkipConfig } from './config.js';
import { createMediaVersion } from './mediaVersion.js';
import { processRequestSchema } from './schemas.js';
import { createSegmentMap } from './segmentMap.js';
import { fetchSponsorBlockSegments, extractYouTubeVideoId } from './sponsorBlock.js';
import { refineSegments } from './boundaryRefiner.js';
import { generateSmartSkipSilenceMap } from './silenceMap.js';
import { segmentWithCodex } from './segmenterClient.js';
import { transcribeWithWhisper } from './whisperClient.js';
import { getLatestSegmentMap, upsertJob, upsertMediaVersion, upsertSegmentMap, upsertTranscript } from './storage.js';
import type { SmartSkipJob, SmartSkipProcessRequest, SmartSkipSegment, TranscriptSegment } from './types.js';

export const priorityByReason: Record<NonNullable<SmartSkipProcessRequest['priority']>, number> = {
  nowPlaying: 100,
  queue: 90,
  inbox: 70,
  proactiveActiveUser: 50,
  backlog: 20
};

const running = new Set<string>();

export async function createOrGetSmartSkipJob(raw: unknown, config: SmartSkipConfig): Promise<{ job: SmartSkipJob; segmentMap: Awaited<ReturnType<typeof getLatestSegmentMap>> }> {
  const request = processRequestSchema.parse(raw);
  const mediaVersion = createMediaVersion(request);
  const existingMap = await getLatestSegmentMap(request.episodeId, request.audioUrl);
  const jobId = `ssk_job_${hash(`${request.episodeId}|${mediaVersion.id}`)}`;
  const now = new Date().toISOString();
  const job: SmartSkipJob = {
    id: jobId,
    episodeLocalId: request.episodeId,
    mediaVersionId: mediaVersion.id,
    priority: priorityByReason[request.priority || 'queue'],
    status: existingMap?.status === 'ready' ? 'ready' : config.enabled ? 'queued' : 'failed',
    stage: existingMap?.status === 'ready' ? 'ready' : config.enabled ? 'queued' : 'disabled',
    request,
    error: config.enabled ? undefined : 'Smart Skip is disabled on this server.',
    attempts: 0,
    createdAt: now,
    updatedAt: now
  };
  await upsertMediaVersion(mediaVersion);
  await upsertJob(job);
  if (config.enabled && existingMap?.status !== 'ready' && !running.has(job.id)) {
    running.add(job.id);
    void processSmartSkipJob(job, config).finally(() => running.delete(job.id));
  }
  return { job, segmentMap: existingMap };
}

export async function processSmartSkipJob(job: SmartSkipJob, config: SmartSkipConfig): Promise<SmartSkipJob> {
  let next = { ...job, status: 'processing' as const, stage: 'media-version', attempts: job.attempts + 1, updatedAt: new Date().toISOString() };
  await upsertJob(next);
  try {
    const mediaVersion = createMediaVersion(next.request);
    await upsertMediaVersion(mediaVersion);
    const silence = await generateSmartSkipSilenceMap(next.request, { dataDir: config.dataDir, publicUrl: config.publicUrl, ffmpegPath: config.ffmpegPath });
    const durationMs = mediaVersion.durationMs || silence.durationMs;
    const youtubeId = extractYouTubeVideoId(next.request);
    const sponsorSegments = youtubeId ? await fetchSponsorBlockSegments(youtubeId).catch(() => []) : [];
    let candidateSegments: Omit<SmartSkipSegment, 'id'>[] = sponsorSegments;
    let transcriptSegments: TranscriptSegment[] = [];
    if (candidateSegments.length === 0 || !hasHighConfidenceUsable(candidateSegments)) {
      next = { ...next, stage: 'transcribing', updatedAt: new Date().toISOString() };
      await upsertJob(next);
      const transcript = await transcribeWithWhisper({ config, mediaVersion });
      await upsertTranscript(transcript);
      transcriptSegments = transcript.segments;
      next = { ...next, stage: 'segmenting', updatedAt: new Date().toISOString() };
      await upsertJob(next);
      candidateSegments = await segmentWithCodex({ config, request: next.request, mediaVersion, transcript, silenceMap: silence.boundaries });
    }
    const refined = refineSegments({
      episodeId: next.request.episodeId,
      mediaVersionId: mediaVersion.id,
      durationMs,
      segments: [
        ...candidateSegments,
        ...silence.boundaries.map((boundary) => ({
          type: 'silence' as const,
          startMs: boundary.startMs,
          endMs: boundary.endMs,
          confidence: 1,
          action: 'auto_skip' as const,
          source: 'silence_detector' as const,
          label: 'Silence'
        }))
      ],
      transcriptSegments,
      silenceMap: silence.boundaries
    });
    const map = createSegmentMap({
      episodeId: next.request.episodeId,
      podcastId: next.request.podcastId,
      mediaVersionId: mediaVersion.id,
      audioUrl: next.request.audioUrl,
      durationMs,
      segments: refined
    });
    await upsertSegmentMap(map);
    const ready = { ...next, status: 'ready' as const, stage: 'ready', updatedAt: new Date().toISOString() };
    await upsertJob(ready);
    return ready;
  } catch (error) {
    const failed = { ...next, status: 'failed' as const, stage: 'failed', error: error instanceof Error ? error.message : 'Smart Skip processing failed.', updatedAt: new Date().toISOString() };
    await upsertJob(failed);
    return failed;
  }
}

function hasHighConfidenceUsable(segments: Omit<SmartSkipSegment, 'id'>[]): boolean {
  return segments.some((segment) => segment.action === 'auto_skip' && segment.confidence >= 0.92);
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}
