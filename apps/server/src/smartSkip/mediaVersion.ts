import crypto from 'node:crypto';
import type { SmartSkipProcessRequest } from './types.js';

export interface SmartSkipMediaVersion {
  id: string;
  episodeLocalId: string;
  podcastLocalId?: string;
  audioUrl: string;
  audioUrlHash: string;
  durationMs?: number;
  publicAudioUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export function createMediaVersion(request: SmartSkipProcessRequest): SmartSkipMediaVersion {
  const audioUrlHash = hash(request.audioUrl);
  const now = new Date().toISOString();
  return {
    id: `ssk_mv_${hash(`${request.episodeId}|${audioUrlHash}`)}`,
    episodeLocalId: request.episodeId,
    podcastLocalId: request.podcastId,
    audioUrl: request.audioUrl,
    audioUrlHash,
    durationMs: request.durationSec ? Math.round(request.durationSec * 1000) : undefined,
    createdAt: now,
    updatedAt: now
  };
}

export function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}
