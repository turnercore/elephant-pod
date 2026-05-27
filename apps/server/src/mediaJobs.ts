import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ServerClip, SilenceJob } from './types.js';

export interface MediaJobOptions {
  dataDir: string;
  publicUrl: string;
  ffmpegPath?: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxClipSeconds?: number;
}

const runningSilenceJobs = new Map<string, SilenceJob>();

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

function runFfmpeg(binary: string, args: string[], timeoutMs: number): Promise<void> {
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
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 180);
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}
