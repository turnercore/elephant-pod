import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ServerClip, SilenceJob, SilenceMapJob, SilenceMapSegment } from './types.js';

export interface MediaJobOptions {
  dataDir: string;
  publicUrl: string;
  ffmpegPath?: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxClipSeconds?: number;
}

const runningSilenceJobs = new Map<string, SilenceJob>();
const runningSilenceMapJobs = new Map<string, SilenceMapJob>();

export async function renderClipFile(clip: ServerClip, options: MediaJobOptions): Promise<Partial<ServerClip>> {
  const renderFlag = process.env.CLIP_RENDER_ENABLED ?? process.env.CLIP_RENDERING ?? 'true';
  const enabled = options.enabled ?? !['false', '0', 'off'].includes(renderFlag.toLowerCase());
  if (!enabled) return { renderStatus: 'time-range-only', renderError: 'Rendering is disabled.' };

  const duration = Math.max(1, Math.min(clip.endSec - clip.startSec, options.maxClipSeconds || Number(process.env.CLIP_MAX_SECONDS || 180)));
  const renderDir = path.join(options.dataDir, 'rendered');
  await fs.mkdir(renderDir, { recursive: true });
  const outputPath = path.join(renderDir, `${safeFilePart(clip.id)}.mp3`);
  const ffmpeg = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';

  try {
    await runFfmpeg(
      ffmpeg,
      [
        '-hide_banner',
        '-y',
        '-ss',
        String(Math.max(0, clip.startSec)),
        '-i',
        clip.sourceAudioUrl,
        '-t',
        String(duration),
        '-vn',
        '-map_metadata',
        '-1',
        '-acodec',
        'libmp3lame',
        '-b:a',
        process.env.CLIP_AUDIO_BITRATE || '128k',
        outputPath
      ],
      options.timeoutMs || Number(process.env.CLIP_RENDER_TIMEOUT_MS || 120_000)
    );
    const stat = await fs.stat(outputPath);
    return {
      renderStatus: 'ready',
      renderedAudioUrl: `${options.publicUrl}/media/clips/${encodeURIComponent(clip.id)}.mp3`,
      fileSizeBytes: stat.size,
      renderError: undefined,
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      renderStatus: 'failed',
      renderError: error instanceof Error ? error.message : 'ffmpeg render failed.',
      updatedAt: new Date().toISOString()
    };
  }
}

export interface SilenceJobRequest {
  episodeId: string;
  audioUrl: string;
  thresholdDb: number;
  minimumDurationSec: number;
  bitRate?: string;
}

export async function createOrGetSilenceJob(request: SilenceJobRequest, options: MediaJobOptions): Promise<SilenceJob> {
  const enabled = process.env.SILENCE_RENDER_ENABLED !== 'false';
  const jobId = hash([request.episodeId, request.audioUrl, request.thresholdDb, request.minimumDurationSec, request.bitRate || '96k'].join('|'));
  const silenceDir = path.join(options.dataDir, 'silence');
  await fs.mkdir(silenceDir, { recursive: true });
  const outputPath = path.join(silenceDir, `${jobId}.mp3`);
  const publicAudioUrl = `${options.publicUrl}/media/silence/${encodeURIComponent(jobId)}.mp3`;

  try {
    await fs.access(outputPath);
    return {
      jobId,
      episodeId: request.episodeId,
      audioUrl: request.audioUrl,
      status: 'ready',
      outputPath,
      publicAudioUrl,
      thresholdDb: request.thresholdDb,
      minimumDurationSec: request.minimumDurationSec,
      bitRate: request.bitRate || '96k',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  } catch {
    // Not rendered yet.
  }

  const existing = runningSilenceJobs.get(jobId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const job: SilenceJob = {
    jobId,
    episodeId: request.episodeId,
    audioUrl: request.audioUrl,
    status: enabled ? 'queued' : 'failed',
    outputPath,
    publicAudioUrl: enabled ? undefined : undefined,
    thresholdDb: request.thresholdDb,
    minimumDurationSec: request.minimumDurationSec,
    bitRate: request.bitRate || '96k',
    error: enabled ? undefined : 'Silence rendering is disabled.',
    createdAt: now,
    updatedAt: now
  };
  runningSilenceJobs.set(jobId, job);

  if (enabled) {
    void renderSilenceJob(job, options).then((updated) => runningSilenceJobs.set(jobId, updated));
  }
  return job;
}

export function getSilenceJob(jobId: string): SilenceJob | null {
  return runningSilenceJobs.get(jobId) || null;
}

export interface SilenceMapRequest {
  episodeId: string;
  audioUrl: string;
}

export interface SilenceMapConfig {
  thresholdDb: number;
  minimumSilenceSec: number;
  retainedSilenceSec: number;
  analyzerVersion: string;
}

export function resolveSilenceMapConfig(env: NodeJS.ProcessEnv = process.env): SilenceMapConfig {
  const thresholdDb = envNumber(env.SILENCE_THRESHOLD_DB, -42, { min: -90, max: -10, name: 'SILENCE_THRESHOLD_DB' });
  const minimumSilenceSec = envNumber(env.SILENCE_MINIMUM_SEC, 0.7, { min: 0.1, max: 10, name: 'SILENCE_MINIMUM_SEC' });
  const retainedSilenceSec = envNumber(env.SILENCE_RETAINED_SEC, 0.25, { min: 0, max: 5, name: 'SILENCE_RETAINED_SEC' });
  const analyzerVersion = (env.SILENCE_ANALYZER_VERSION || 'v1').trim() || 'v1';
  return {
    thresholdDb,
    minimumSilenceSec,
    retainedSilenceSec: Math.min(retainedSilenceSec, Math.max(0, minimumSilenceSec - 0.01)),
    analyzerVersion
  };
}

export async function createOrGetSilenceMapJob(request: SilenceMapRequest, options: MediaJobOptions): Promise<SilenceMapJob> {
  const config = resolveSilenceMapConfig();
  const id = hash([request.audioUrl, config.thresholdDb, config.minimumSilenceSec, config.retainedSilenceSec, config.analyzerVersion].join('|'));
  const mapDir = path.join(options.dataDir, 'silence-maps');
  await fs.mkdir(mapDir, { recursive: true });
  const outputPath = path.join(mapDir, `${id}.json`);

  const persisted = await readSilenceMap(outputPath);
  if (persisted) return { ...persisted, episodeId: request.episodeId };

  const existing = runningSilenceMapJobs.get(id);
  if (existing) return { ...existing, episodeId: request.episodeId };

  const now = new Date().toISOString();
  const job: SilenceMapJob = {
    id,
    episodeId: request.episodeId,
    audioUrl: request.audioUrl,
    status: 'queued',
    segments: [],
    ...config,
    createdAt: now,
    updatedAt: now
  };
  runningSilenceMapJobs.set(id, job);
  void renderSilenceMapJob(job, outputPath, options).then((updated) => runningSilenceMapJobs.set(id, updated));
  return job;
}

export async function getSilenceMapJob(id: string, options: MediaJobOptions): Promise<SilenceMapJob | null> {
  const running = runningSilenceMapJobs.get(id);
  if (running) return running;
  const persisted = await readSilenceMap(path.join(options.dataDir, 'silence-maps', `${id}.json`));
  return persisted;
}

async function renderSilenceJob(job: SilenceJob, options: MediaJobOptions): Promise<SilenceJob> {
  const ffmpeg = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  const now = new Date().toISOString();
  const rendering = { ...job, status: 'rendering' as const, updatedAt: now };
  runningSilenceJobs.set(job.jobId, rendering);

  const filter = `silenceremove=stop_periods=-1:stop_duration=${job.minimumDurationSec}:stop_threshold=${job.thresholdDb}dB`;
  try {
    await runFfmpeg(
      ffmpeg,
      [
        '-hide_banner',
        '-y',
        '-i',
        job.audioUrl,
        '-vn',
        '-af',
        filter,
        '-map_metadata',
        '-1',
        '-acodec',
        'libmp3lame',
        '-b:a',
        job.bitRate,
        job.outputPath
      ],
      options.timeoutMs || Number(process.env.SILENCE_RENDER_TIMEOUT_MS || 900_000)
    );
    return { ...rendering, status: 'ready', publicAudioUrl: `${options.publicUrl}/media/silence/${encodeURIComponent(job.jobId)}.mp3`, updatedAt: new Date().toISOString() };
  } catch (error) {
    return { ...rendering, status: 'failed', error: error instanceof Error ? error.message : 'ffmpeg silence render failed.', updatedAt: new Date().toISOString() };
  }
}

async function renderSilenceMapJob(job: SilenceMapJob, outputPath: string, options: MediaJobOptions): Promise<SilenceMapJob> {
  const ffmpeg = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  const processing = { ...job, status: 'processing' as const, updatedAt: new Date().toISOString() };
  runningSilenceMapJobs.set(job.id, processing);

  try {
    const stderr = await runFfmpegForOutput(
      ffmpeg,
      [
        '-hide_banner',
        '-i',
        job.audioUrl,
        '-af',
        `silencedetect=noise=${job.thresholdDb}dB:d=${job.minimumSilenceSec}`,
        '-f',
        'null',
        '-'
      ],
      options.timeoutMs || Number(process.env.SILENCE_MAP_TIMEOUT_MS || 900_000)
    );
    const parsed = parseSilenceDetect(stderr, job.minimumSilenceSec, job.retainedSilenceSec);
    const ready: SilenceMapJob = {
      ...processing,
      status: 'ready',
      segments: parsed.segments,
      durationSec: parsed.durationSec,
      updatedAt: new Date().toISOString()
    };
    await writeSilenceMap(outputPath, ready);
    return ready;
  } catch (error) {
    const failed: SilenceMapJob = {
      ...processing,
      status: 'failed',
      error: error instanceof Error ? error.message : 'ffmpeg silence-map analysis failed.',
      updatedAt: new Date().toISOString()
    };
    await writeSilenceMap(outputPath, failed).catch(() => undefined);
    return failed;
  }
}

export function parseSilenceDetect(stderr: string, minimumSilenceSec: number, retainedSilenceSec: number): { segments: SilenceMapSegment[]; durationSec?: number } {
  const events: Array<{ type: 'start' | 'end'; value: number; duration?: number }> = [];
  const startPattern = /silence_start:\s*([0-9.]+)/g;
  const endPattern = /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g;
  const durationPattern = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = startPattern.exec(stderr))) {
    events.push({ type: 'start', value: Number(match[1]) });
  }
  while ((match = endPattern.exec(stderr))) {
    events.push({ type: 'end', value: Number(match[1]), duration: Number(match[2]) });
  }

  events.sort((a, b) => a.value - b.value || (a.type === 'start' ? -1 : 1));
  const segments: SilenceMapSegment[] = [];
  let openStart: number | null = null;
  for (const event of events) {
    if (event.type === 'start') {
      openStart = Number.isFinite(event.value) ? event.value : null;
      continue;
    }
    const silenceEndSec = event.value;
    const silenceStartSec = openStart ?? (event.duration ? silenceEndSec - event.duration : NaN);
    openStart = null;
    if (!Number.isFinite(silenceStartSec) || !Number.isFinite(silenceEndSec)) continue;
    const duration = silenceEndSec - silenceStartSec;
    if (duration < minimumSilenceSec) continue;
    const skipFromSec = roundSec(silenceStartSec + retainedSilenceSec);
    const skipToSec = roundSec(silenceEndSec);
    if (skipToSec <= skipFromSec) continue;
    segments.push({
      silenceStartSec: roundSec(silenceStartSec),
      silenceEndSec: skipToSec,
      skipFromSec,
      skipToSec,
      retainedSilenceSec: roundSec(retainedSilenceSec)
    });
  }

  let durationSec: number | undefined;
  while ((match = durationPattern.exec(stderr))) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if ([hours, minutes, seconds].every(Number.isFinite)) durationSec = roundSec(hours * 3600 + minutes * 60 + seconds);
  }

  return { segments: mergeSegments(segments), durationSec };
}

function mergeSegments(segments: SilenceMapSegment[]): SilenceMapSegment[] {
  const sorted = [...segments].sort((a, b) => a.skipFromSec - b.skipFromSec);
  const merged: SilenceMapSegment[] = [];
  for (const segment of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || segment.skipFromSec > previous.skipToSec) {
      merged.push(segment);
      continue;
    }
    previous.silenceEndSec = Math.max(previous.silenceEndSec, segment.silenceEndSec);
    previous.skipToSec = Math.max(previous.skipToSec, segment.skipToSec);
  }
  return merged;
}

async function readSilenceMap(outputPath: string): Promise<SilenceMapJob | null> {
  try {
    const content = await fs.readFile(outputPath, 'utf8');
    const parsed = JSON.parse(content) as SilenceMapJob;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSilenceMap(outputPath: string, job: SilenceMapJob): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(job, null, 2));
}

function runFfmpeg(binary: string, args: string[], timeoutMs: number): Promise<void> {
  return runFfmpegForOutput(binary, args, timeoutMs).then(() => undefined);
}

function runFfmpegForOutput(binary: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function envNumber(value: string | undefined, fallback: number, options: { min: number; max: number; name: string }): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= options.min && parsed <= options.max) return parsed;
  console.warn(`${options.name} must be a number between ${options.min} and ${options.max}; using default ${fallback}.`);
  return fallback;
}

function roundSec(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 180);
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}
