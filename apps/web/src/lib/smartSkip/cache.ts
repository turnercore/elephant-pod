import type { EpisodeWithState } from '@/types/domain';
import { nowIso } from '../dates';
import { db } from '../storage/db';
import type { SmartSkipSegmentMap } from './types';

export type SmartSkipRequestStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'stale' | 'missing';

export async function getCachedSmartSkipSegmentMap(episode: EpisodeWithState): Promise<SmartSkipSegmentMap | null> {
  const entry = await db.smartSkipMaps.get(cacheKey(episode.id, episode.audioUrl));
  return normalizeCachedMap(entry?.map, episode);
}

export async function saveSmartSkipSegmentMap(map: SmartSkipSegmentMap): Promise<void> {
  if (map.status !== 'ready') return;
  const timestamp = nowIso();
  await db.smartSkipMaps.put({
    id: cacheKey(map.episodeId, map.audioUrl),
    episodeId: map.episodeId,
    audioUrl: map.audioUrl,
    map,
    status: 'ready',
    cachedAt: timestamp,
    updatedAt: timestamp
  });
}

export async function getSmartSkipRequestStatus(episode: EpisodeWithState): Promise<SmartSkipRequestStatus | null> {
  const entry = await db.smartSkipMaps.get(cacheKey(episode.id, episode.audioUrl));
  return entry?.status || null;
}

export async function saveSmartSkipRequestStatus(
  episode: EpisodeWithState,
  status: SmartSkipRequestStatus,
  details: { jobId?: string; reason?: string; error?: string | null } = {}
): Promise<void> {
  const id = cacheKey(episode.id, episode.audioUrl);
  const existing = await db.smartSkipMaps.get(id);
  if (existing?.status === 'ready' && status !== 'ready') return;
  const timestamp = nowIso();
  await db.smartSkipMaps.put({
    ...existing,
    id,
    episodeId: episode.id,
    audioUrl: episode.audioUrl,
    map: existing?.map ?? null,
    status,
    jobId: details.jobId ?? existing?.jobId,
    reason: details.reason ?? existing?.reason,
    error: details.error ?? null,
    lastRequestedAt: timestamp,
    cachedAt: existing?.cachedAt ?? timestamp,
    updatedAt: timestamp
  });
}

function cacheKey(episodeId: string, audioUrl: string): string {
  return `${episodeId}:${audioUrl}`;
}

function normalizeCachedMap(raw: unknown, episode: EpisodeWithState): SmartSkipSegmentMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const map = raw as SmartSkipSegmentMap;
  if (map.schemaVersion !== 'elephant.smart-skip.v1' || map.status !== 'ready' || map.episodeId !== episode.id || map.audioUrl !== episode.audioUrl || !Array.isArray(map.segments)) return null;
  return map;
}
