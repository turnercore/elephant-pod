import type { EpisodeWithState, SilenceMap } from '@/types/domain';
import { nowIso } from '../dates';
import { getReadySilenceMap, getSilenceMapForEpisode, saveSilenceMap } from '../storage/repository';

export async function getCachedReadySilenceMap(episode: EpisodeWithState): Promise<SilenceMap | null> {
  return getReadySilenceMap(episode.id, episode.audioUrl);
}

export async function requestServerSilenceMap(episode: EpisodeWithState, serverUrl?: string, accessToken?: string | null): Promise<SilenceMap | null> {
  const base = serverUrl?.replace(/\/$/, '');
  if (!base || !accessToken) return null;

  const response = await fetch(`${base}/api/audio/silence-maps`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ episodeId: episode.id, audioUrl: episode.audioUrl })
  });
  if (!response.ok) return null;
  const map = normalizeSilenceMap(await response.json(), episode);
  if (!map) return null;
  await saveSilenceMap({ ...map, lastRequestedAt: nowIso(), lastCheckedAt: nowIso() });
  return map;
}

export async function pollServerSilenceMap(map: SilenceMap, serverUrl?: string, accessToken?: string | null): Promise<SilenceMap | null> {
  const base = serverUrl?.replace(/\/$/, '');
  if (!base || !accessToken) return null;

  const response = await fetch(`${base}/api/audio/silence-maps/${encodeURIComponent(map.id)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  const next = normalizeSilenceMap(await response.json(), map, true);
  if (!next) return null;
  await saveSilenceMap({ ...next, lastRequestedAt: map.lastRequestedAt, lastCheckedAt: nowIso() });
  return next;
}

export async function ensureServerSilenceMap(episode: EpisodeWithState, serverUrl?: string, accessToken?: string | null): Promise<SilenceMap | null> {
  const cached = await getSilenceMapForEpisode(episode.id, episode.audioUrl);
  if (cached?.status === 'ready' || cached?.status === 'failed') return cached;
  if (cached && shouldPoll(cached)) return pollServerSilenceMap(cached, serverUrl, accessToken);
  if (cached) return cached;
  return requestServerSilenceMap(episode, serverUrl, accessToken);
}

export async function prefetchServerSilenceMaps(episodes: EpisodeWithState[], serverUrl?: string, accessToken?: string | null): Promise<number> {
  if (!serverUrl || !accessToken) return 0;
  let count = 0;
  for (const episode of episodes) {
    const map = await ensureServerSilenceMap(episode, serverUrl, accessToken).catch(() => null);
    if (map) count += 1;
  }
  return count;
}

function normalizeSilenceMap(raw: unknown, fallback: Pick<SilenceMap, 'id' | 'episodeId' | 'audioUrl'> | EpisodeWithState, preferFallbackEpisodeId = false): SilenceMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = stringValue(record.id) || stringValue(record.jobId) || ('id' in fallback ? fallback.id : '');
  const fallbackEpisodeId = 'episodeId' in fallback ? fallback.episodeId : fallback.id;
  const episodeId = preferFallbackEpisodeId ? fallbackEpisodeId : stringValue(record.episodeId) || fallbackEpisodeId;
  const audioUrl = stringValue(record.audioUrl) || fallback.audioUrl;
  const status = statusValue(record.status);
  if (!id || !episodeId || !audioUrl || !status) return null;
  const updatedAt = stringValue(record.updatedAt) || nowIso();
  return {
    id,
    episodeId,
    audioUrl,
    status,
    segments: Array.isArray(record.segments) ? record.segments.map(normalizeSegment).filter((segment) => segment !== null) : [],
    durationSec: numberValue(record.durationSec),
    thresholdDb: numberValue(record.thresholdDb) ?? -42,
    minimumSilenceSec: numberValue(record.minimumSilenceSec) ?? 0.7,
    retainedSilenceSec: numberValue(record.retainedSilenceSec) ?? 0.25,
    analyzerVersion: stringValue(record.analyzerVersion) || 'v1',
    error: stringValue(record.error) || undefined,
    createdAt: stringValue(record.createdAt) || updatedAt,
    updatedAt
  };
}

function normalizeSegment(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const silenceStartSec = numberValue(record.silenceStartSec);
  const silenceEndSec = numberValue(record.silenceEndSec);
  const skipFromSec = numberValue(record.skipFromSec);
  const skipToSec = numberValue(record.skipToSec);
  const retainedSilenceSec = numberValue(record.retainedSilenceSec);
  if ([silenceStartSec, silenceEndSec, skipFromSec, skipToSec, retainedSilenceSec].some((value) => value === undefined)) return null;
  if (skipToSec! <= skipFromSec!) return null;
  return { silenceStartSec: silenceStartSec!, silenceEndSec: silenceEndSec!, skipFromSec: skipFromSec!, skipToSec: skipToSec!, retainedSilenceSec: retainedSilenceSec! };
}

function shouldPoll(map: SilenceMap): boolean {
  if (map.status !== 'queued' && map.status !== 'processing') return false;
  if (!map.lastCheckedAt) return true;
  return Date.now() - new Date(map.lastCheckedAt).getTime() > 10_000;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function statusValue(value: unknown): SilenceMap['status'] | null {
  return value === 'queued' || value === 'processing' || value === 'ready' || value === 'failed' ? value : null;
}
