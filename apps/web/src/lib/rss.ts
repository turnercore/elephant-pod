import { XMLParser } from 'fast-xml-parser';
import type { Episode, ParsedFeedResult, Podcast } from '@/types/domain';
import { nowIso } from './dates';
import { stableId } from './ids';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  trimValues: true
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return text(record['#cdata'] || record['#text'] || record['@_href'] || record['@_url']);
  }
  return '';
}

function imageFrom(value: unknown): string {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = imageFrom(entry);
      if (resolved) return resolved;
    }
    return '';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return text(record['@_href'] || record['@_url'] || record.url || record.link);
  }
  return text(value);
}

function parseDuration(raw: unknown): number | undefined {
  const value = text(raw);
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return undefined;
}

function parsePositiveNumber(raw: unknown): number | undefined {
  const value = text(raw);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseRssXml(xml: string, feedUrl: string): ParsedFeedResult {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = ((parsed.rss as Record<string, unknown> | undefined)?.channel || (parsed.feed as Record<string, unknown> | undefined)) as
    | Record<string, unknown>
    | undefined;
  if (!channel) throw new Error('Could not find RSS channel or Atom feed root.');

  const title = text(channel.title) || feedUrl;
  const image = channel.image as Record<string, unknown> | undefined;
  const imageUrl = text(image?.url) || imageFrom(channel['itunes:image']) || imageFrom(channel['media:thumbnail']) || imageFrom(channel['media:content']);
  const podcastId = stableId(feedUrl, 'feed');
  const timestamp = nowIso();

  const podcast: Podcast = {
    id: podcastId,
    title,
    author: text(channel['itunes:author']) || text(channel.author),
    description: text(channel.description || channel.subtitle || channel.summary),
    imageUrl,
    feedUrl,
    websiteUrl: text(channel.link),
    tags: [],
    sourceType: 'rss',
    sourceUrl: feedUrl,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastRefreshedAt: timestamp
  };

  const items = asArray((channel.item || channel.entry) as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const episodes: Episode[] = items.map((item, index) => {
    const enclosure = item.enclosure as Record<string, unknown> | undefined;
    const atomLink = asArray(item.link as Record<string, unknown> | Record<string, unknown>[] | undefined).find(
      (link) => link['@_rel'] === 'enclosure' || link['@_type']?.toString().startsWith('audio/')
    );
    const guid = text(item.guid || item.id) || `${feedUrl}#${index}`;
    const audioUrl = text(enclosure?.['@_url'] || atomLink?.['@_href']);
    return {
      id: stableId(`${feedUrl}:${guid}`, 'ep'),
      podcastId,
      podcastTitle: title,
      title: text(item.title || item['itunes:title']) || `Episode ${index + 1}`,
      description: text(item.description || item['content:encoded'] || item.summary),
      audioUrl,
      websiteUrl: text(item.link),
      imageUrl: imageFrom(item['itunes:image']) || imageFrom(item['media:thumbnail']) || imageFrom(item['media:content']),
      publishedAt: text(item.pubDate || item.published || item.updated) || timestamp,
      durationSec: parseDuration(item['itunes:duration']),
      seasonNumber: parsePositiveNumber(item['itunes:season']),
      episodeNumber: parsePositiveNumber(item['itunes:episode']),
      explicit: text(item['itunes:explicit']).toLowerCase() === 'yes',
      chapters: [],
      guid,
      enclosureLength: Number(enclosure?.['@_length'] || 0) || undefined,
      sourceType: 'rss' as const,
      sourceUrl: feedUrl,
      extractionStatus: 'none' as const,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }).filter((ep) => ep.audioUrl);

  return { podcast, episodes };
}

export async function fetchFeedThroughServer(feedUrl: string, serverUrl?: string): Promise<ParsedFeedResult> {
  const base = serverUrl || import.meta.env.VITE_API_BASE_URL || '';
  if (base) {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/rss/parse?url=${encodeURIComponent(feedUrl)}`);
    if (!response.ok) throw new Error(`RSS proxy failed: ${response.status}`);
    return (await response.json()) as ParsedFeedResult;
  }

  const response = await fetch(feedUrl);
  if (!response.ok) throw new Error(`Feed fetch failed: ${response.status}`);
  return parseRssXml(await response.text(), feedUrl);
}
