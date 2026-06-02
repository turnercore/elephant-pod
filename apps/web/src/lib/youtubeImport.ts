import type { ParsedFeedResult } from '@/types/domain';
import { normalizeServerUrl } from './sync/serverAuth';

export interface ServerCapabilities {
  youtubeImport: {
    enabled: boolean;
  };
}

export async function fetchServerCapabilities(serverUrl?: string): Promise<ServerCapabilities> {
  const base = normalizeServerUrl(serverUrl || '');
  if (!base) return { youtubeImport: { enabled: false } };
  const response = await fetch(`${base}/api/capabilities`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return { youtubeImport: { enabled: false } };
  const payload = (await response.json().catch(() => null)) as Partial<ServerCapabilities> | null;
  return { youtubeImport: { enabled: Boolean(payload?.youtubeImport?.enabled) } };
}

export async function importYoutubeSource(serverUrl: string, accessToken: string, url: string): Promise<ParsedFeedResult> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new Error('Server URL is not configured.');
  const response = await fetch(`${base}/api/youtube/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    },
    body: JSON.stringify({ url })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `YouTube import failed: ${response.status}`);
  }
  return (await response.json()) as ParsedFeedResult;
}

export interface YoutubeExtractionResult {
  episodeId: string;
  sourceUrl: string;
  extractionStatus: 'queued' | 'processing' | 'ready' | 'failed';
  audioReady: boolean;
}

export async function extractYoutubeEpisode(serverUrl: string, accessToken: string, episodeId: string, sourceUrl: string): Promise<YoutubeExtractionResult> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new Error('Server URL is not configured.');
  const response = await fetch(`${base}/api/youtube/episodes/${encodeURIComponent(episodeId)}/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    },
    body: JSON.stringify({ sourceUrl })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `YouTube extraction failed: ${response.status}`);
  }
  return (await response.json()) as YoutubeExtractionResult;
}
