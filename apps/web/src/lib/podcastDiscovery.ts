import { normalizeServerUrl } from './sync/serverAuth';
import { stableId } from './ids';

export interface PodcastDiscoveryResult {
  id: string;
  title: string;
  author?: string;
  description?: string;
  imageUrl?: string;
  feedUrl: string;
}

export async function searchPodcastIndex(serverUrl: string, accessToken: string, query: string): Promise<PodcastDiscoveryResult[]> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new Error('Server URL is not configured.');
  const trimmed = query.trim();
  if (!trimmed) return [];

  const response = await fetch(`${base}/api/podcast-index/search?q=${encodeURIComponent(trimmed)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `Podcast search failed: ${response.status}`);
  }

  const body = (await response.json().catch(() => null)) as unknown;
  const parsedBody: Record<string, unknown> = isRecord(body) ? body : {};
  const dataPayload = isRecord(parsedBody.data) ? parsedBody.data : {};
  const rows = toArray(parsedBody.results || parsedBody.feeds || parsedBody.items || parsedBody.data || dataPayload.items).filter(isRecord);
  return rows
    .map((row) => normalizeDiscoveryRow(row))
    .filter((podcast): podcast is PodcastDiscoveryResult => podcast !== null)
    .slice(0, 60);
}

function normalizeDiscoveryRow(row: Record<string, unknown>): PodcastDiscoveryResult | null {
  const feedUrl = firstString(row.feedUrl, row.feed_url, row.feed);
  if (!feedUrl) return null;

  const title = firstString(row.title, row.name) || feedUrl;
  const author = firstString(row.author, row.author_name);
  const description = firstString(row.description, row.summary, row.itunesSummary);
  const imageUrl = firstString(row.imageUrl, row.image, row.itunesImage, row.artwork);
  const idSeed = `${title}|${feedUrl}`;

  return {
    id: stableId(idSeed, 'podcast'),
    title,
    author,
    description,
    imageUrl,
    feedUrl
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function toArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => isRecord(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
