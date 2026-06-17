import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';

type PodcastIndexAuthDate = string;

const podcastIndexBaseUrl = 'https://api.podcastindex.org/api/1.0';
const podcastIndexPublicBaseUrl = 'https://api.podcastindex.org';
const maxSearchResults = 25;
const maxBrowseResults = 50;

const podcastIndexSearchSchema = z.object({
  q: z.string().trim().min(2, 'A search term of at least 2 characters is required.').max(128, 'Search term is too long.'),
  max: z.coerce
    .number()
    .int()
    .min(1, 'max must be at least 1.')
    .max(maxSearchResults, `max cannot exceed ${maxSearchResults}.`)
    .default(maxSearchResults)
});

const podcastIndexBrowseSchema = z
  .object({
    type: z.enum(['recent', 'trending', 'categories']).default('recent'),
    max: z.coerce.number().int().min(1).max(maxBrowseResults).default(20)
  });

type PodcastIndexFeedShape = {
  id: string;
  title: string;
  author?: string;
  description?: string;
  imageUrl?: string;
  feedUrl: string;
  websiteUrl?: string;
  episodeCount?: number;
  categories: string[];
  lastUpdateTime?: number;
  explicit: boolean;
};

type PodcastIndexBrowseResponse =
  | {
      type: 'categories';
      items: string[];
    }
  | {
      type: 'feeds';
      items: PodcastIndexFeedShape[];
      max: number;
      total?: number | null;
    };

const missingCredentialsError = 'Server PodcastIndex credentials are not configured.';
const missingConfigHint =
  'Set PODCASTINDEX_API_KEY, PODCASTINDEX_API_SECRET, and PODCASTINDEX_USER_AGENT in the server environment.';

function readStringEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getPodcastIndexConfig() {
  const apiKey = readStringEnv('PODCASTINDEX_API_KEY');
  const apiSecret = readStringEnv('PODCASTINDEX_API_SECRET');
  const userAgent = readStringEnv('PODCASTINDEX_USER_AGENT') || 'daisypod/0.4.0';
  if (!hasRealValue(apiKey) || !hasRealValue(apiSecret)) {
    return null;
  }

  return { apiKey: apiKey!, apiSecret: apiSecret!, userAgent };
}

function hasRealValue(value?: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !/^(CHANGE_ME|REPLACE_ME|TODO|PLACEHOLDER)/i.test(trimmed);
}

function computeAuthHeader(apiKey: string, apiSecret: string, date: PodcastIndexAuthDate) {
  const token = `${apiKey}${apiSecret}${date}`;
  return crypto.createHash('sha1').update(token).digest('hex');
}

function toString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'explicit';
  }
  return false;
}

function categoriesFrom(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    const raw = value
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object') {
          const rec = entry as Record<string, unknown>;
          return toString(rec.name) || toString(rec.title) || toString(rec.category) || toString(rec.titleName);
        }
        return undefined;
      })
      .filter((entry): entry is string => Boolean(entry));
    return [...new Set(raw)];
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return [
      toString(rec.name),
      toString(rec.title),
      toString(rec.category),
      toString(rec.genre),
      toString(rec.titleName)
    ]
      .filter((entry): entry is string => Boolean(entry))
      .filter((entry) => entry.trim().length > 0);
  }

  return [];
}

function normalizeLastUpdateTime(value: unknown): number | undefined {
  const candidate = toNumber(value);
  if (candidate === undefined) return undefined;
  if (candidate > 1_000_000_000_000) return Math.floor(candidate / 1000);
  return candidate;
}

function normalizeFeed(row: Record<string, unknown>): PodcastIndexFeedShape | null {
  const feedUrl = toString(row.feedUrl) || toString(row.feedUrlRaw) || toString(row.url) || toString(row.originalUrl) || toString(row.feed) || toString(row.feed_url);
  if (!feedUrl) return null;
  const title = toString(row.title) || toString(row.name) || feedUrl;
  const id = toString(row.id) || toString(row.feedId) || toString(row.feed_id) || `${crypto.createHash('sha1').update(feedUrl).digest('hex')}`;
  return {
    id,
    title,
    author: toString(row.author) || toString(row.authorName) || toString(row.author_name),
    description: toString(row.description) || toString(row.summary) || toString(row.itunesSummary),
    imageUrl: toString(row.imageUrl) || toString(row.image) || toString(row.itunesImage) || toString(row.artwork),
    feedUrl,
    websiteUrl: toString(row.websiteUrl) || toString(row.website) || toString(row.website_url),
    episodeCount: toNumber(row.episodeCount) || toNumber(row.episode_count) || toNumber(row.episodecount),
    categories: categoriesFrom(row.categories),
    lastUpdateTime: normalizeLastUpdateTime(row.lastUpdateTime) || normalizeLastUpdateTime(row.lastUpdateTimeMs),
    explicit: toBoolean(row.explicit)
  };
}

function toSafeErrorMessage(context: string, status: number, statusText: string): string {
  return `${context}: upstream request failed with ${status} ${statusText}.`;
}

async function callPodcastIndex<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const config = getPodcastIndexConfig();
  if (!config) {
    throw new Error('MISSING_CREDENTIALS');
  }

  const authDate = `${Math.floor(Date.now() / 1000)}`;
  const query = new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((next, [key, value]) => {
      next[key] = String(value);
      return next;
    }, {})
  );
  const endpoint = `${podcastIndexBaseUrl}${path}${query.toString() ? `?${query}` : ''}`;
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': config.userAgent,
      'X-Auth-Date': authDate,
      'X-Auth-Key': config.apiKey,
      Authorization: computeAuthHeader(config.apiKey, config.apiSecret, authDate)
    }
  });

  if (!response.ok) {
    const statusText = response.statusText || 'Unknown';
    throw new Error(`UPSTREAM_${response.status}: ${toSafeErrorMessage('PodcastIndex', response.status, statusText)}`);
  }

  const payload = (await response.json()) as T;
  return payload;
}

async function callPodcastIndexPublicSearch<T>(term: string): Promise<T> {
  const query = new URLSearchParams({ term });
  const endpoint = `${podcastIndexPublicBaseUrl}/search?${query}`;
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': readStringEnv('PODCASTINDEX_USER_AGENT') || 'daisypod/0.4.0'
    }
  });

  if (!response.ok) {
    const statusText = response.statusText || 'Unknown';
    throw new Error(`UPSTREAM_${response.status}: ${toSafeErrorMessage('PodcastIndex', response.status, statusText)}`);
  }

  return (await response.json()) as T;
}

async function handlePodcastIndexSearch(req: Request, res: Response) {
  const parsed = podcastIndexSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid PodcastIndex search request.', details: parsed.error.flatten() });
    return;
  }

  try {
    const data = getPodcastIndexConfig()
      ? await callPodcastIndex<{ [key: string]: unknown }>(`/search/byterm`, {
          q: parsed.data.q,
          max: parsed.data.max
        })
      : await callPodcastIndexPublicSearch<{ [key: string]: unknown }>(parsed.data.q);
    const raw = toRecordArray(data.feeds) || toRecordArray(data.results) || toRecordArray(data.items) || toRecordArray(data.data);
    const feeds = raw.map(normalizeFeed).filter((podcast): podcast is PodcastIndexFeedShape => podcast !== null).slice(0, parsed.data.max);

    res.json({
      items: feeds,
      max: parsed.data.max,
      total: toNumber((data as { count?: unknown }).count) ?? feeds.length
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'MISSING_CREDENTIALS') {
      res.status(503).json({ error: `${missingCredentialsError} ${missingConfigHint}` });
      return;
    }

    if (error instanceof Error && error.message.startsWith('UPSTREAM_')) {
      res.status(502).json({ error: error.message.replace(/^UPSTREAM_\d+:\s*/, '') });
      return;
    }

    res.status(502).json({ error: 'PodcastIndex search failed. Please retry shortly.' });
  }
}

async function handlePodcastIndexBrowse(req: Request, res: Response) {
  const parsed = podcastIndexBrowseSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid PodcastIndex browse request.', details: parsed.error.flatten() });
    return;
  }

  try {
    const query = parsed.data;
    if (query.type === 'categories') {
      const data = await callPodcastIndex<Record<string, unknown>>('/categories/list', {});
      const raw = toUnknownArray(data.feeds) || toUnknownArray(data.categories) || toUnknownArray(data.items) || toUnknownArray(data.data);
      const categories = raw
        .map((entry) => {
          if (typeof entry === 'string') return entry.trim();
          if (entry && typeof entry === 'object') {
            const rec = entry as Record<string, unknown>;
            return toString(rec.name) || toString(rec.category) || toString(rec.title);
          }
          return undefined;
        })
        .filter((entry): entry is string => Boolean(entry));
      res.json({
        type: 'categories',
        items: [...new Set(categories)]
      } satisfies PodcastIndexBrowseResponse);
      return;
    }

    const path = query.type === 'recent' ? '/recent/feeds' : '/podcasts/trending';
    const data = await callPodcastIndex<{ [key: string]: unknown }>(path, {
      max: query.type === 'recent' || query.type === 'trending' ? query.max : 10
    });
    const raw = toRecordArray(data.feeds) || toRecordArray(data.results) || toRecordArray(data.items) || toRecordArray(data.data);
    const feeds = raw.map(normalizeFeed).filter((podcast): podcast is PodcastIndexFeedShape => podcast !== null);
    const response: PodcastIndexBrowseResponse = {
      type: 'feeds',
      items: feeds,
      max: query.max,
      total: toNumber((data as { count?: unknown }).count)
    };
    res.json(response);
  } catch (error) {
    if (error instanceof Error && error.message === 'MISSING_CREDENTIALS') {
      res.status(503).json({ error: `${missingCredentialsError} ${missingConfigHint}` });
      return;
    }

    if (error instanceof Error && error.message.startsWith('UPSTREAM_')) {
      res.status(502).json({ error: error.message.replace(/^UPSTREAM_\d+:\s*/, '') });
      return;
    }

    res.status(502).json({ error: 'PodcastIndex browse request failed. Please retry shortly.' });
  }
}

function toUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return toUnknownArray(value).filter(
    (entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry)
  );
}

export const podcastIndexSearchHandler = handlePodcastIndexSearch;
export const podcastIndexBrowseHandler = handlePodcastIndexBrowse;
