import { XMLParser } from 'fast-xml-parser';
import crypto from 'node:crypto';

const MAX_EXTERNAL_CHAPTER_BYTES = 512 * 1024;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  trimValues: true
});

function stableId(input: string, prefix: string): string {
  return `${prefix}_${crypto.createHash('sha1').update(input).digest('hex').slice(0, 18)}`;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return text(record['#cdata'] || record['#text'] || record['@_href'] || record['@_url']);
  }
  return '';
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== '');
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

function parseChapterTime(raw: unknown): number | undefined {
  const value = text(raw);
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
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

function parseChapterElement(raw: unknown, index: number, feedUrl: string, guid: string) {
  if (!raw || typeof raw !== 'object') return undefined;
  const chapter = raw as Record<string, unknown>;
  const title = text(firstPresent(chapter['@_title'], chapter.title, chapter['psc:title'], chapter['podcast:title']));
  const startsAt = parseChapterTime(
    firstPresent(
      chapter['@_startTime'],
      chapter['@_start'],
      chapter['@_time'],
      chapter.startTime,
      chapter.start,
      chapter.time,
      chapter['psc:start'],
      chapter['podcast:start']
    )
  );
  if (!title || startsAt === undefined) return undefined;
  const url = text(firstPresent(chapter['@_url'], chapter['@_href'], chapter.url, chapter.link));
  return {
    id: stableId(`${feedUrl}:${guid}:chapter:${index}:${title}:${startsAt}`, 'ch'),
    title,
    startsAt,
    url: url || undefined
  };
}

function externalChapterUrl(item: Record<string, unknown>): string | undefined {
  for (const raw of asArray(item['podcast:chapters'] as unknown)) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const url = text(firstPresent(record['@_url'], record.url, record['@_href'], record.href));
    if (url) return url;
  }
  return undefined;
}

function parseChapters(item: Record<string, unknown>, feedUrl: string, guid: string) {
  const containers = [
    item['podcast:chapters'],
    item['psc:chapters'],
    item.chapters
  ];
  const rawChapters: unknown[] = [];
  for (const container of containers) {
    if (!container || typeof container !== 'object') continue;
    const record = container as Record<string, unknown>;
    rawChapters.push(...asArray(record['podcast:chapter'] as unknown), ...asArray(record['psc:chapter'] as unknown), ...asArray(record.chapter as unknown));
  }
  rawChapters.push(...asArray(item['podcast:chapter'] as unknown), ...asArray(item['psc:chapter'] as unknown));
  return rawChapters
    .map((chapter, index) => parseChapterElement(chapter, index, feedUrl, guid))
    .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter))
    .sort((a, b) => a.startsAt - b.startsAt);
}

function parseExternalChapterJson(raw: unknown, feedUrl: string, guid: string) {
  if (!raw || typeof raw !== 'object') return [];
  const payload = raw as Record<string, unknown>;
  const chapters = asArray((payload.chapters || payload.chapter) as unknown);
  return chapters
    .map((chapter, index) => parseChapterElement(chapter, index, feedUrl, guid))
    .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter))
    .sort((a, b) => a.startsAt - b.startsAt);
}

async function fetchExternalChapters(chapterUrl: string, feedUrl: string, guid: string, fetcher: typeof fetch = fetch) {
  const url = new URL(chapterUrl, feedUrl);
  if (!['http:', 'https:'].includes(url.protocol)) return [];
  const response = await fetcher(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'DaisyPod/0.4 (+https://elephanthand.com)'
    },
    redirect: 'follow'
  });
  if (!response.ok) return [];
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_EXTERNAL_CHAPTER_BYTES) return [];
  const textBody = await response.text();
  if (Buffer.byteLength(textBody, 'utf8') > MAX_EXTERNAL_CHAPTER_BYTES) return [];
  return parseExternalChapterJson(JSON.parse(textBody), feedUrl, guid);
}

export function parseFeedXml(xml: string, feedUrl: string) {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = ((parsed.rss as Record<string, unknown> | undefined)?.channel || (parsed.feed as Record<string, unknown> | undefined)) as
    | Record<string, unknown>
    | undefined;
  if (!channel) throw new Error('Could not parse RSS channel or Atom feed.');

  const title = text(channel.title) || feedUrl;
  const image = channel.image as Record<string, unknown> | undefined;
  const imageUrl = text(image?.url) || imageFrom(channel['itunes:image']) || imageFrom(channel['media:thumbnail']) || imageFrom(channel['media:content']);
  const podcastId = stableId(feedUrl, 'feed');
  const timestamp = new Date().toISOString();
  const podcast = {
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
  const externalChapterRefs: Array<{ episodeId: string; guid: string; url: string }> = [];
  const episodes = items.map((item, index) => {
    const enclosure = item.enclosure as Record<string, unknown> | undefined;
    const atomLink = asArray(item.link as Record<string, unknown> | Record<string, unknown>[] | undefined).find(
      (link) => link['@_rel'] === 'enclosure' || String(link['@_type'] || '').startsWith('audio/')
    );
    const guid = text(item.guid || item.id) || `${feedUrl}#${index}`;
    const audioUrl = text(enclosure?.['@_url'] || atomLink?.['@_href']);
    const episodeId = stableId(`${feedUrl}:${guid}`, 'ep');
    const chapters = parseChapters(item, feedUrl, guid);
    const chapterUrl = !chapters.length ? externalChapterUrl(item) : undefined;
    if (chapterUrl) externalChapterRefs.push({ episodeId, guid, url: chapterUrl });
    return {
      id: episodeId,
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
      chapters,
      guid,
      enclosureLength: Number(enclosure?.['@_length'] || 0) || undefined,
      sourceType: 'rss',
      sourceUrl: feedUrl,
      extractionStatus: 'none',
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }).filter((ep) => ep.audioUrl);

  return { podcast, episodes, externalChapterRefs };
}

export async function parseFeedXmlWithExternalChapters(xml: string, feedUrl: string, fetcher: typeof fetch = fetch) {
  const parsed = parseFeedXml(xml, feedUrl);
  const chapterMap = new Map<string, Awaited<ReturnType<typeof fetchExternalChapters>>>();
  await Promise.all(
    parsed.externalChapterRefs.map(async (ref) => {
      try {
        const chapters = await fetchExternalChapters(ref.url, feedUrl, ref.guid, fetcher);
        if (chapters.length) chapterMap.set(ref.episodeId, chapters);
      } catch {
        // External chapter metadata is optional; failed fetches should not break RSS import.
      }
    })
  );
  return {
    podcast: parsed.podcast,
    episodes: parsed.episodes.map((episode) => ({
      ...episode,
      chapters: episode.chapters.length ? episode.chapters : chapterMap.get(episode.id) || []
    }))
  };
}

export async function parseRemoteFeed(feedUrl: string) {
  const response = await fetch(feedUrl, {
    headers: {
      'user-agent': 'DaisyPod/0.4 (+https://elephanthand.com)'
    },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`Feed returned ${response.status}`);
  const xml = await response.text();
  return parseFeedXmlWithExternalChapters(xml, feedUrl);
}
