import type { EpisodeWithState } from '@/types/domain';
import type { SmartSkipSegmentMap } from './types';

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
  const payload = await response.json() as { segmentMap?: unknown };
  return normalizeSegmentMap(payload.segmentMap);
}

export async function fetchSmartSkipSegmentMap(episode: EpisodeWithState, serverUrl?: string, accessToken?: string | null): Promise<SmartSkipSegmentMap | null> {
  const base = serverUrl?.replace(/\/$/, '');
  if (!base || !accessToken) return null;
  const url = new URL(`${base}/api/smart-skip/episodes/${encodeURIComponent(episode.id)}/segment-map`);
  url.searchParams.set('audioUrl', episode.audioUrl);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  const payload = await response.json() as { segmentMap?: unknown };
  return normalizeSegmentMap(payload.segmentMap);
}

export async function sendSmartSkipFeedback(input: {
  serverUrl?: string;
  accessToken?: string | null;
  episodeId: string;
  mediaVersionId?: string;
  segmentId?: string;
  feedbackType: 'false_positive' | 'false_negative' | 'bad_boundary' | 'undo' | 'confirmation';
  actualStartMs?: number;
  actualEndMs?: number;
}): Promise<void> {
  const base = input.serverUrl?.replace(/\/$/, '');
  if (!base || !input.accessToken) return;
  await fetch(`${base}/api/smart-skip/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.accessToken}` },
    body: JSON.stringify(input)
  }).catch(() => undefined);
}

function normalizeSegmentMap(raw: unknown): SmartSkipSegmentMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as SmartSkipSegmentMap;
  if (record.schemaVersion !== 'elephant.smart-skip.v1' || record.status !== 'ready' || !Array.isArray(record.segments)) return null;
  return record;
}
