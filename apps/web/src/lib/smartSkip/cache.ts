import type { EpisodeWithState } from '@/types/domain';
import { nowIso } from '../dates';
import { db } from '../storage/db';
import type { SmartSkipSegmentMap } from './types';

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
    cachedAt: timestamp,
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
