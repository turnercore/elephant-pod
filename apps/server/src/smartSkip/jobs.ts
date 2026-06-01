import crypto from 'node:crypto';
import type { SmartSkipConfig } from './config.js';
import { createMediaVersion } from './mediaVersion.js';
import { processRequestSchema } from './schemas.js';
import { createSegmentMap } from './segmentMap.js';
import { refineSegments } from './boundaryRefiner.js';
import { generateSmartSkipSilenceMap } from './silenceMap.js';
import { checkSegmentBatch, parseSegmenterSegments, segmentWithCodex, submitSegmentBatch } from './segmenterClient.js';
import { transcribeWithWhisper } from './whisperClient.js';
import { claimNextJob, getExternalTaskForJob, getJob, getLatestSegmentMap, getTranscript, heartbeatJob, recoverStaleJobs, upsertExternalTask, upsertJob, upsertMediaVersion, upsertSegmentMap, upsertTranscript } from './storage.js';
import type { SmartSkipExternalTask, SmartSkipJob, SmartSkipProcessRequest, SmartSkipSegment } from './types.js';

export const priorityByReason: Record<NonNullable<SmartSkipProcessRequest['priority']>, number> = {
  nowPlaying: 100,
  queue: 90,
  inbox: 70,
  proactiveActiveUser: 50,
  backlog: 20
};

let queueStarted = false;

export async function createOrGetSmartSkipJob(raw: unknown, config: SmartSkipConfig): Promise<{ job: SmartSkipJob; segmentMap: Awaited<ReturnType<typeof getLatestSegmentMap>> }> {
  const request = processRequestSchema.parse(raw);
  const mediaVersion = createMediaVersion(request);
  const existingMap = await getLatestSegmentMap(request.episodeId, request.audioUrl);
  const jobId = `ssk_job_${hash(`${request.episodeId}|${mediaVersion.id}`)}`;
  const existingJob = await getJob(jobId);
  if (existingMap?.status !== 'ready' && existingJob && ['queued', 'leased', 'processing'].includes(existingJob.status)) {
    return { job: existingJob, segmentMap: existingMap };
  }
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
  return { job, segmentMap: existingMap };
}

export function startSmartSkipQueue(config: SmartSkipConfig): void {
  if (!config.enabled || queueStarted) return;
  queueStarted = true;
  const workerId = `ssk_worker_${process.pid}_${crypto.randomUUID()}`;
  const running = new Set<Promise<void>>();
  const tick = () => {
    void recoverStaleJobs().catch((error) => console.error('Smart Skip stale job recovery failed', error));
    while (running.size < config.processingConcurrency) {
      const task = claimAndProcess(workerId, config)
        .catch((error) => console.error('Smart Skip worker failed', error))
        .finally(() => running.delete(task));
      running.add(task);
    }
  };
  tick();
  setInterval(tick, 5000).unref();
}

async function claimAndProcess(workerId: string, config: SmartSkipConfig): Promise<void> {
  const job = await claimNextJob(workerId);
  if (!job) return;
  await processSmartSkipJob(job, config, workerId);
}

export async function processSmartSkipJob(job: SmartSkipJob, config: SmartSkipConfig, workerId = job.workerId): Promise<SmartSkipJob> {
  let next = { ...job, status: 'processing' as const, stage: 'media-version', attempts: job.attempts + 1, nextAttemptAt: undefined, updatedAt: new Date().toISOString() };
  await upsertJob(next);
  try {
    await updateStage(next, workerId, 'media-version');
    const mediaVersion = createMediaVersion(next.request);
    await upsertMediaVersion(mediaVersion);
    await updateStage(next, workerId, 'silence-map');
    const silence = await generateSmartSkipSilenceMap(next.request, { dataDir: config.dataDir, publicUrl: config.publicUrl, ffmpegPath: config.ffmpegPath });
    await updateStage(next, workerId, 'transcribing');
    const transcript = (await getTranscript(mediaVersion.id)) || await transcribeWithWhisper({ config, mediaVersion });
    await upsertTranscript(transcript);
    await updateStage(next, workerId, 'segmenting');
    const candidateSegments: Omit<SmartSkipSegment, 'id'>[] = config.segmenterBatchEnabled
      ? await segmentWithBatch({ job: next, config, request: next.request, mediaVersion, transcript, silenceMap: silence.boundaries })
      : await segmentWithCodex({ config, request: next.request, mediaVersion, transcript, silenceMap: silence.boundaries });
    if (next.stage === 'waiting-for-segment-batch') return next;
    await updateStage(next, workerId, 'refining');
    const durationMs = mediaVersion.durationMs || transcript.durationMs || silence.durationMs;
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
      transcriptSegments: transcript.segments,
      silenceMap: silence.boundaries
    });
    await updateStage(next, workerId, 'storing-map');
    const map = createSegmentMap({
      episodeId: next.request.episodeId,
      podcastId: next.request.podcastId,
      mediaVersionId: mediaVersion.id,
      audioUrl: next.request.audioUrl,
      durationMs,
      segments: refined
    });
    await upsertSegmentMap(map);
    const ready = { ...next, status: 'ready' as const, stage: 'ready', workerId: undefined, lockedAt: undefined, lockedUntil: undefined, nextAttemptAt: undefined, updatedAt: new Date().toISOString() };
    await upsertJob(ready);
    return ready;
  } catch (error) {
    const failed = { ...next, status: 'failed' as const, stage: 'failed', workerId: undefined, lockedAt: undefined, lockedUntil: undefined, nextAttemptAt: undefined, error: error instanceof Error ? error.message : 'Smart Skip processing failed.', updatedAt: new Date().toISOString() };
    await upsertJob(failed);
    return failed;
  }
}

async function segmentWithBatch(input: {
  job: SmartSkipJob;
  config: SmartSkipConfig;
  request: SmartSkipProcessRequest;
  mediaVersion: ReturnType<typeof createMediaVersion>;
  transcript: Awaited<ReturnType<typeof transcribeWithWhisper>>;
  silenceMap: Awaited<ReturnType<typeof generateSmartSkipSilenceMap>>['boundaries'];
}): Promise<Omit<SmartSkipSegment, 'id'>[]> {
  const existing = await getExternalTaskForJob(input.job.id, 'segmenter_batch');
  if (existing) {
    if (existing.status === 'completed' && existing.resultJson) return parseSegmenterSegments(existing.resultJson);
    if (isTerminalExternalTask(existing)) throw new Error(existing.error || `Segmenter batch ${existing.externalId} ended with status ${existing.status}.`);
    const checked = await checkSegmentBatch({ config: input.config, externalId: existing.externalId });
    const updated = externalTaskFromBatchResponse(input.job.id, checked, input.config, existing);
    await upsertExternalTask(updated);
    if (updated.status === 'completed' && updated.resultJson) return parseSegmenterSegments(updated.resultJson);
    if (isTerminalExternalTask(updated)) throw new Error(updated.error || `Segmenter batch ${updated.externalId} ended with status ${updated.status}.`);
    await releaseForBatchRecheck(input.job, input.config, updated);
    return [];
  }

  const submitted = await submitSegmentBatch({
    config: input.config,
    request: input.request,
    mediaVersion: input.mediaVersion,
    transcript: input.transcript,
    silenceMap: input.silenceMap,
    customId: input.job.id
  });
  const task = externalTaskFromBatchResponse(input.job.id, submitted, input.config);
  await upsertExternalTask(task);
  if (task.status === 'completed' && task.resultJson) return parseSegmenterSegments(task.resultJson);
  if (isTerminalExternalTask(task)) throw new Error(task.error || `Segmenter batch ${task.externalId} ended with status ${task.status}.`);
  await releaseForBatchRecheck(input.job, input.config, task);
  return [];
}

async function releaseForBatchRecheck(job: SmartSkipJob, config: SmartSkipConfig, task: SmartSkipExternalTask): Promise<void> {
  const nextCheckAt = task.nextCheckAt || new Date(Date.now() + config.segmenterBatchCheckIntervalHours * 60 * 60_000).toISOString();
  const waiting: SmartSkipJob = {
    ...job,
    status: 'queued',
    stage: 'waiting-for-segment-batch',
    workerId: undefined,
    lockedAt: undefined,
    lockedUntil: undefined,
    nextAttemptAt: nextCheckAt,
    updatedAt: new Date().toISOString()
  };
  Object.assign(job, waiting);
  await upsertJob(waiting);
}

function externalTaskFromBatchResponse(jobId: string, response: Awaited<ReturnType<typeof submitSegmentBatch>>, config: SmartSkipConfig, existing?: SmartSkipExternalTask): SmartSkipExternalTask {
  const now = new Date().toISOString();
  const nextCheckAt = response.status === 'completed' || isTerminalBatchStatus(response.status)
    ? undefined
    : new Date(Date.now() + config.segmenterBatchCheckIntervalHours * 60 * 60_000).toISOString();
  return {
    id: existing?.id || `ssk_ext_${hash(`${jobId}|segmenter_batch`)}`,
    jobId,
    kind: 'segmenter_batch',
    provider: response.provider || existing?.provider || 'openai',
    externalId: response.externalId,
    status: response.status,
    inputFileId: response.inputFileId || existing?.inputFileId,
    outputFileId: response.outputFileId || existing?.outputFileId,
    errorFileId: response.errorFileId || existing?.errorFileId,
    resultJson: response.result === undefined ? existing?.resultJson : response.result,
    error: response.error || existing?.error,
    submittedAt: existing?.submittedAt || now,
    lastCheckedAt: existing ? now : undefined,
    nextCheckAt,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

function isTerminalExternalTask(task: SmartSkipExternalTask): boolean {
  return isTerminalBatchStatus(task.status);
}

function isTerminalBatchStatus(status: SmartSkipExternalTask['status']): boolean {
  return status === 'failed' || status === 'expired' || status === 'cancelled';
}

async function updateStage(job: SmartSkipJob, workerId: string | undefined, stage: string): Promise<void> {
  job.stage = stage;
  job.status = 'processing';
  job.updatedAt = new Date().toISOString();
  if (workerId) {
    await heartbeatJob(job.id, workerId, stage);
    return;
  }
  await upsertJob(job);
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}
