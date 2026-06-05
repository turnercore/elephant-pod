import type { EpisodeWithState } from '@/types/domain';
import type { SmartSkipSegmentMap } from './types';
import { saveSmartSkipRequestStatus, saveSmartSkipSegmentMap, type SmartSkipRequestStatus } from './cache';

export async function requestSmartSkipProcessing(episode: EpisodeWithState, serverUrl?: string, accessToken?: string | null, reason: 'nowPlaying' | 'queue' | 'inbox' | 'proactiveActiveUser' | 'backlog' = 'queue'): Promise<SmartSkipSegmentMap | null> {
  const base = serverUrl?.replace(/\/$/, '');
  if (!base || !accessToken) return null;
  const response = await fetch(`${base}/api/smart-skip/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      episodeId: episode.id,
      podcastId: episode.podcastId,
      podcastTitle: episode.podcastTitle,
      episodeTitle: episode.title,
      description: episode.description,
      audioUrl: episode.audioUrl,
      websiteUrl: episode.websiteUrl,
      guid: episode.guid,
      durationSec: episode.durationSec,
      publishedAt: episode.publishedAt,
      chapters: episode.chapters,
      priority: reason
    })
  });
  if (!response.ok) return null;
  const payload = await response.json() as { jobId?: string; status?: string; segmentMap?: unknown; error?: string | null };
  const map = normalizeSegmentMap(payload.segmentMap);
  if (map) await saveSmartSkipSegmentMap(map);
  else await saveSmartSkipRequestStatus(episode, normalizeRequestStatus(payload.status, response.status), { jobId: payload.jobId, reason, error: payload.error });
  return map;
}

export async function fetchSmartSkipSegmentMap(episode: EpisodeWithState, serverUrl?: string, accessToken?: string | null): Promise<SmartSkipSegmentMap | null> {
  const base = serverUrl?.replace(/\/$/, '');
  if (!base || !accessToken) return null;
  const url = new URL(`${base}/api/smart-skip/episodes/${encodeURIComponent(episode.id)}/segment-map`);
  url.searchParams.set('audioUrl', episode.audioUrl);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  const payload = await response.json() as { status?: string; segmentMap?: unknown };
  const map = normalizeSegmentMap(payload.segmentMap);
  if (map) await saveSmartSkipSegmentMap(map);
  else if (payload.status && payload.status !== 'missing') await saveSmartSkipRequestStatus(episode, normalizeRequestStatus(payload.status, response.status));
  return map;
}

function normalizeSegmentMap(raw: unknown): SmartSkipSegmentMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as SmartSkipSegmentMap;
  if (record.schemaVersion !== 'elephant.smart-skip.v1' || record.status !== 'ready' || !Array.isArray(record.segments)) return null;
  return record;
}

function normalizeRequestStatus(status: string | undefined, httpStatus: number): SmartSkipRequestStatus {
  if (status === 'queued' || status === 'processing' || status === 'ready' || status === 'failed' || status === 'stale' || status === 'missing') return status;
  if (httpStatus === 202) return 'queued';
  return 'processing';
}
