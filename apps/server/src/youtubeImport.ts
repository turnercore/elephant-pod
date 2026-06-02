import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

type PodcastSourceType = 'youtube-channel' | 'youtube-playlist' | 'youtube-ad-hoc';
type YoutubeSourceKind = 'video' | 'playlist' | 'channel' | 'unknown';
type YoutubeImportOptions = { publicUrl: string; dataDir?: string };

type ParsedYoutubeImport = {
  podcast: {
    id: string;
    title: string;
    author?: string;
    description?: string;
    imageUrl?: string;
    feedUrl: string;
    websiteUrl?: string;
    tags: string[];
    sourceType: PodcastSourceType;
    sourceUrl: string;
    externalId: string;
    createdAt: string;
    updatedAt: string;
    lastRefreshedAt: string;
  };
  episodes: Array<{
    id: string;
    podcastId: string;
    podcastTitle: string;
    title: string;
    description?: string;
    audioUrl: string;
    websiteUrl?: string;
    imageUrl?: string;
    publishedAt: string;
    durationSec?: number;
    explicit: boolean;
    chapters: unknown[];
    guid: string;
    enclosureLength?: number;
    sourceType: 'youtube';
    sourceUrl: string;
    externalId: string;
    extractionStatus: 'none' | 'queued' | 'processing' | 'ready' | 'failed';
    createdAt: string;
    updatedAt: string;
  }>;
};

const importSchema = z.object({
  url: z.string().url()
});

const extractSchema = z.object({
  sourceUrl: z.string().url()
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  trimValues: true
});
const maxThumbnailBytes = 1_000_000;

export function isYoutubeImportConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.METUBE_BASE_URL?.trim());
}

export async function handleYoutubeImport(req: Request, res: Response, options: YoutubeImportOptions) {
  if (!isYoutubeImportConfigured()) {
    res.status(503).json({ error: 'YouTube import is disabled because METUBE_BASE_URL is not configured.' });
    return;
  }

  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid YouTube URL is required.', details: parsed.error.flatten() });
    return;
  }

  try {
    const imported = await importYoutubeMetadata(parsed.data.url, options);
    res.status(201).json(imported);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'YouTube import failed.' });
  }
}

export async function handleYoutubeRefresh(req: Request, res: Response, options: YoutubeImportOptions) {
  if (!isYoutubeImportConfigured()) {
    res.status(503).json({ error: 'YouTube import is disabled because METUBE_BASE_URL is not configured.' });
    return;
  }
  const url = typeof req.body?.url === 'string' ? req.body.url : '';
  if (!url) {
    res.status(400).json({ error: 'A source URL is required.' });
    return;
  }
  try {
    const imported = await importYoutubeMetadata(url, options);
    res.status(200).json(imported);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'YouTube refresh failed.' });
  }
}

export async function handleYoutubeExtract(req: Request, res: Response) {
  if (!isYoutubeImportConfigured()) {
    res.status(503).json({ error: 'YouTube audio extraction is disabled because METUBE_BASE_URL is not configured.' });
    return;
  }
  const parsed = extractSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid YouTube episode source URL is required.', details: parsed.error.flatten() });
    return;
  }
  try {
    const sourceUrl = normalizeUrl(parsed.data.sourceUrl);
    const kind = classifyYoutubeUrl(sourceUrl);
    if (!kind) throw new Error('Only YouTube episode URLs can be extracted.');
    if (isYoutubeShortsUrl(sourceUrl)) throw new Error('YouTube Shorts are not imported as podcast episodes.');
    const before = await getMetubeHistory().catch(() => []);
    const existing = collectRelevantHistoryRows(before, sourceUrl)[0];
    if (!existing || statusFromRow(existing) === 'failed') await addToMetube(sourceUrl, 'video');
    const after = await getMetubeHistory().catch(() => before);
    const match = collectRelevantHistoryRows(after, sourceUrl)[0] || existing;
    res.status(202).json({
      episodeId: String(req.params.id),
      sourceUrl,
      extractionStatus: match ? statusFromRow(match) : 'queued',
      audioReady: Boolean(match && resolveMetubeAudioUrl(match))
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'YouTube extraction failed.' });
  }
}

export async function handleYoutubeFeed(req: Request, res: Response, options: YoutubeImportOptions) {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  if (!url) {
    res.status(400).send('A YouTube source URL is required.');
    return;
  }
  try {
    const imported = await importYoutubeMetadata(url, options);
    res.setHeader('content-type', 'application/rss+xml; charset=utf-8');
    res.send(toRssXml(imported));
  } catch (error) {
    res.status(422).send(error instanceof Error ? error.message : 'YouTube feed generation failed.');
  }
}

export async function handleYoutubeAudio(req: Request, res: Response) {
  if (!isYoutubeImportConfigured()) {
    res.status(404).json({ error: 'YouTube audio is not available.' });
    return;
  }
  const episodeId = String(req.params.id);
  const history = await getMetubeHistory();
  const match = findHistoryByEpisodeId(history, episodeId);
  if (!match) {
    res.status(404).json({ error: 'YouTube audio extraction is not ready yet.' });
    return;
  }
  const audioUrl = resolveMetubeAudioUrl(match);
  if (!audioUrl) {
    res.status(404).json({ error: 'YouTube audio file URL is not available yet.' });
    return;
  }
  res.redirect(audioUrl);
}

export async function importYoutubeMetadata(sourceUrl: string, options: YoutubeImportOptions, fetchImpl: typeof fetch = fetch): Promise<ParsedYoutubeImport> {
  const normalizedUrl = normalizeUrl(sourceUrl);
  const kind = classifyYoutubeUrl(normalizedUrl);
  if (!kind) throw new Error('Only YouTube video, playlist, channel, and podcast playlist URLs are supported.');
  if (isYoutubeShortsUrl(normalizedUrl)) throw new Error('YouTube Shorts are not imported as podcast episodes.');

  const metadata = await fetchYoutubeMetadata(normalizedUrl, kind, fetchImpl);
  const history = isYoutubeImportConfigured() ? await getMetubeHistory(fetchImpl).catch(() => []) : [];
  const imported = buildImportResult(normalizedUrl, kind, metadata, history, options.publicUrl);
  return cacheImportThumbnails(imported, options, fetchImpl);
}

export async function importFromMetube(sourceUrl: string, options: YoutubeImportOptions, fetchImpl: typeof fetch = fetch): Promise<ParsedYoutubeImport> {
  return importYoutubeMetadata(sourceUrl, options, fetchImpl);
}

function getMetubeBaseUrl(): string {
  const raw = process.env.METUBE_BASE_URL?.trim();
  if (!raw) throw new Error('METUBE_BASE_URL is not configured.');
  return raw.replace(/\/$/, '');
}

async function addToMetube(url: string, kind: YoutubeSourceKind, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${getMetubeBaseUrl()}/add`, {
    method: 'POST',
    headers: metubeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      url,
      quality: process.env.METUBE_AUDIO_QUALITY || 'audio',
      format: process.env.METUBE_AUDIO_FORMAT || 'mp3',
      playlist_strict_mode: kind === 'playlist',
      auto_start: true
    })
  });
  if (!response.ok) throw new Error(`MeTube add failed with ${response.status}.`);
  const payload = await response.json().catch(() => null) as { status?: string; msg?: string } | null;
  if (payload?.status === 'error') throw new Error(payload.msg || 'MeTube rejected the import.');
}

async function getMetubeHistory(fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>[]> {
  const response = await fetchImpl(`${getMetubeBaseUrl()}/history`, { headers: metubeHeaders() });
  if (!response.ok) throw new Error(`MeTube history failed with ${response.status}.`);
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const done = asArray(payload?.done);
  const queue = asArray(payload?.queue);
  const pending = asArray(payload?.pending);
  return [...done, ...queue, ...pending].filter(isRecord);
}

type YoutubeMetadata = {
  title?: string;
  author?: string;
  description?: string;
  imageUrl?: string;
  channelId?: string;
  playlistId?: string;
  entries: Record<string, unknown>[];
};

async function fetchYoutubeMetadata(sourceUrl: string, kind: YoutubeSourceKind, fetchImpl: typeof fetch): Promise<YoutubeMetadata> {
  if (kind === 'playlist') {
    const playlistId = new URL(sourceUrl).searchParams.get('list') || sourceUrl.split('/').filter(Boolean).pop();
    if (!playlistId) throw new Error('Could not find the YouTube playlist id.');
    return omitYoutubeShorts(parseYoutubeFeed(await fetchText(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`, fetchImpl), { playlistId }), fetchImpl);
  }

  if (kind === 'channel') {
    const channelId = await resolveChannelId(sourceUrl, fetchImpl);
    return omitYoutubeShorts(parseYoutubeFeed(await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, fetchImpl), { channelId }), fetchImpl);
  }

  const oembed = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(sourceUrl)}`, fetchImpl).catch(() => ({}));
  const videoHtml = await fetchText(sourceUrl, fetchImpl).catch(() => '');
  const channelId = firstString(match(videoHtml, /"channelId":"([^"]+)"/));
  const videoId = videoIdFromUrl(sourceUrl) || stableId(sourceUrl, 'yt_ep');
  const videoEntry = {
    id: videoId,
    url: sourceUrl,
    title: firstString((oembed as Record<string, unknown>).title) || match(videoHtml, /<meta property="og:title" content="([^"]+)"/) || 'YouTube episode',
    description: match(videoHtml, /<meta property="og:description" content="([^"]*)"/),
    thumbnail: smallYoutubeThumbnail(videoId) || firstString((oembed as Record<string, unknown>).thumbnail_url) || match(videoHtml, /<meta property="og:image" content="([^"]+)"/),
    publishedAt: match(videoHtml, /"publishDate":"([^"]+)"/),
    channel: firstString((oembed as Record<string, unknown>).author_name),
    channelId
  };
  if (await isYoutubeShortEntry(videoEntry, fetchImpl)) throw new Error('YouTube Shorts are not imported as podcast episodes.');
  return {
    title: firstString((oembed as Record<string, unknown>).author_name) || 'YouTube Channel',
    author: firstString((oembed as Record<string, unknown>).author_name),
    imageUrl: firstString((oembed as Record<string, unknown>).thumbnail_url) || match(videoHtml, /<meta property="og:image" content="([^"]+)"/),
    channelId,
    entries: [videoEntry]
  };
}

async function fetchChannelMetadata(channelId: string, fetchImpl: typeof fetch): Promise<YoutubeMetadata | null> {
  try {
    return parseYoutubeFeed(await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, fetchImpl), { channelId });
  } catch {
    return null;
  }
}

function buildImportResult(sourceUrl: string, kind: YoutubeSourceKind, metadata: YoutubeMetadata, historyRows: Record<string, unknown>[], publicUrl: string): ParsedYoutubeImport {
  const now = new Date().toISOString();
  const externalSourceId = metadata.playlistId || metadata.channelId || stableId(sourceUrl, 'yt_src');
  const sourceType: PodcastSourceType = kind === 'channel' ? 'youtube-channel' : kind === 'playlist' ? 'youtube-playlist' : 'youtube-ad-hoc';
  const podcastTitle = metadata.title || youtubeSourceTitle(kind);
  const podcastId = stableId(`${sourceType}:${externalSourceId}:${sourceUrl}`, 'feed');
  const feedUrl = `${publicUrl}/api/youtube/feed.xml?url=${encodeURIComponent(sourceUrl)}`;

  return {
    podcast: {
      id: podcastId,
      title: podcastTitle,
      author: metadata.author,
      description: metadata.description || `Synthetic podcast feed for a YouTube ${kind === 'video' ? 'channel' : kind}.`,
      imageUrl: metadata.imageUrl,
      feedUrl,
      websiteUrl: sourceUrl,
      tags: ['YouTube'],
      sourceType,
      sourceUrl,
      externalId: externalSourceId,
      createdAt: now,
      updatedAt: now,
      lastRefreshedAt: now
    },
    episodes: metadata.entries.map((row, index) => {
      const episodeSourceUrl = firstString(row.url, row.webpage_url, row.webpageUrl, row.original_url) || sourceUrl;
      const externalEpisodeId = firstString(row.id, row.video_id, row.videoId) || stableId(episodeSourceUrl, 'yt_ep');
      const episodeId = stableId(`youtube:${externalEpisodeId}:${episodeSourceUrl}`, 'ep');
      const title = firstString(row.title, row.name, row.filename, row.file) || (kind === 'video' ? 'YouTube episode' : `YouTube episode ${index + 1}`);
      const historyRow = findHistoryByEpisodeId(historyRows, episodeId);
      const ready = Boolean(historyRow && resolveMetubeAudioUrl(historyRow));
      return {
        id: episodeId,
        podcastId,
        podcastTitle,
        title,
        description: firstString(row.description, row.summary),
        audioUrl: `${publicUrl}/media/youtube/${encodeURIComponent(episodeId)}.mp3`,
        websiteUrl: episodeSourceUrl,
        imageUrl: smallYoutubeThumbnail(externalEpisodeId) || firstString(row.thumbnail, row.thumb, row.thumbnail_url, row.imageUrl),
        publishedAt: firstString(row.publishedAt, row.published, row.upload_date, row.timestamp, row.created, row.created_at) || now,
        durationSec: positiveNumber(row.duration, row.durationSec),
        explicit: false,
        chapters: [],
        guid: externalEpisodeId,
        enclosureLength: positiveNumber(row.filesize, row.filesize_approx, row.size),
        sourceType: 'youtube' as const,
        sourceUrl: episodeSourceUrl,
        externalId: externalEpisodeId,
        extractionStatus: ready ? 'ready' as const : historyRow ? statusFromRow(historyRow) : 'none' as const,
        createdAt: now,
        updatedAt: now
      };
    })
  };
}

function parseYoutubeFeed(xml: string, source: { channelId?: string; playlistId?: string }): YoutubeMetadata {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const feed = parsed.feed as Record<string, unknown> | undefined;
  if (!feed) throw new Error('Could not parse YouTube feed metadata.');
  const author = feed.author as Record<string, unknown> | undefined;
  const entries = asArray(feed.entry).filter(isRecord).map((entry) => {
    const media = entry['media:group'] as Record<string, unknown> | undefined;
    const link = asArray(entry.link).find(isRecord);
    return {
      id: firstString(entry['yt:videoId'], entry.id) || stableId(firstString(link?.['@_href']) || '', 'yt_ep'),
      videoId: firstString(entry['yt:videoId']),
      channelId: firstString(entry['yt:channelId'], source.channelId),
      url: firstString(link?.['@_href']) || (firstString(entry['yt:videoId']) ? `https://www.youtube.com/watch?v=${firstString(entry['yt:videoId'])}` : undefined),
      title: firstString(entry.title),
      description: firstString(media?.['media:description']),
      thumbnail: firstString((media?.['media:thumbnail'] as Record<string, unknown> | undefined)?.['@_url']),
      publishedAt: firstString(entry.published, entry.updated),
      channel: firstString(author?.name)
    };
  });
  return {
    title: firstString(feed.title) || 'YouTube Feed',
    author: firstString(author?.name),
    description: firstString(feed.subtitle),
    imageUrl: firstString((feed.logo as Record<string, unknown> | undefined)?.['#text'], feed.logo),
    channelId: source.channelId || firstString(entries[0]?.channelId),
    playlistId: source.playlistId,
    entries
  };
}

async function omitYoutubeShorts(metadata: YoutubeMetadata, fetchImpl: typeof fetch): Promise<YoutubeMetadata> {
  const entries = [];
  for (const entry of metadata.entries) {
    if (!(await isYoutubeShortEntry(entry, fetchImpl))) entries.push(entry);
  }
  return { ...metadata, entries };
}

async function isYoutubeShortEntry(entry: Record<string, unknown>, fetchImpl: typeof fetch): Promise<boolean> {
  const sourceUrl = firstString(entry.url, entry.webpage_url, entry.webpageUrl, entry.original_url);
  if (sourceUrl && isYoutubeShortsUrl(sourceUrl)) return true;
  const duration = positiveNumber(entry.duration, entry.durationSec);
  if (duration !== undefined && duration <= 61) return true;
  const title = firstString(entry.title, entry.name) || '';
  const description = firstString(entry.description, entry.summary) || '';
  if (/(^|\s)#shorts?\b/i.test(`${title} ${description}`)) return true;
  if (!sourceUrl) return false;
  const videoId = firstString(entry.videoId, entry.video_id, entry.id) || videoIdFromUrl(sourceUrl);
  if (!videoId) return false;
  const html = await fetchText(sourceUrl, fetchImpl).catch(() => '');
  return htmlIndicatesYoutubeShort(html, videoId);
}

function htmlIndicatesYoutubeShort(html: string, videoId: string): boolean {
  if (!html) return false;
  const escapedId = escapeRegExp(videoId);
  return new RegExp(`<link[^>]+rel=["']canonical["'][^>]+href=["']https?://www\\.youtube\\.com/shorts/${escapedId}["']`, 'i').test(html) ||
    new RegExp(`["']/shorts/${escapedId}(?:["'/?#&])`, 'i').test(html);
}

async function cacheImportThumbnails(imported: ParsedYoutubeImport, options: YoutubeImportOptions, fetchImpl: typeof fetch): Promise<ParsedYoutubeImport> {
  if (!options.dataDir) return imported;
  const firstEpisodeImage = imported.episodes.find((episode) => episode.imageUrl)?.imageUrl;
  const podcastImage = await cacheFirstThumbnailUrl([imported.podcast.imageUrl, firstEpisodeImage], options, fetchImpl);
  const episodes = [];
  for (const episode of imported.episodes) {
    episodes.push({
      ...episode,
      imageUrl: await cacheThumbnailUrl(episode.imageUrl, options, fetchImpl)
    });
  }
  return {
    ...imported,
    podcast: {
      ...imported.podcast,
      imageUrl: podcastImage
    },
    episodes
  };
}

async function cacheFirstThumbnailUrl(sourceUrls: Array<string | undefined>, options: YoutubeImportOptions, fetchImpl: typeof fetch): Promise<string | undefined> {
  for (const sourceUrl of sourceUrls) {
    const cached = await cacheThumbnailUrl(sourceUrl, options, fetchImpl);
    if (cached) return cached;
  }
  return undefined;
}

async function cacheThumbnailUrl(sourceUrl: string | undefined, options: YoutubeImportOptions, fetchImpl: typeof fetch): Promise<string | undefined> {
  if (!sourceUrl || !options.dataDir || sourceUrl.startsWith(`${options.publicUrl}/media/youtube-thumbnails/`)) return sourceUrl;
  try {
    const response = await fetchImpl(sourceUrl, { headers: { 'user-agent': 'ElephantPod/0.2 (+https://elephanthand.com)' } });
    if (!response.ok) return undefined;
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxThumbnailBytes) return undefined;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxThumbnailBytes) return undefined;
    const extension = thumbnailExtension(response.headers.get('content-type'), sourceUrl);
    const fileName = `${stableId(sourceUrl, 'thumb')}${extension}`;
    const thumbnailDir = path.join(options.dataDir, 'youtube-thumbnails');
    await fs.mkdir(thumbnailDir, { recursive: true });
    await fs.writeFile(path.join(thumbnailDir, fileName), buffer);
    return `${options.publicUrl}/media/youtube-thumbnails/${encodeURIComponent(fileName)}`;
  } catch {
    return undefined;
  }
}

function thumbnailExtension(contentType: string | null, sourceUrl: string): string {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase();
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/gif') return '.gif';
  const urlExtension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(urlExtension)) return urlExtension === '.jpeg' ? '.jpg' : urlExtension;
  return '.jpg';
}

function smallYoutubeThumbnail(videoId: string | undefined): string | undefined {
  if (!videoId || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return undefined;
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

function collectRelevantHistoryRows(rows: Record<string, unknown>[], sourceUrl: string): Record<string, unknown>[] {
  const normalized = normalizeUrl(sourceUrl);
  const sourceList = sourceUrlList(sourceUrl);
  const source = new URL(normalized);
  const sourcePlaylistId = source.searchParams.get('list');
  return rows.filter((row) => {
    if (sourcePlaylistId && firstString(row.playlist_id, row.playlistId) === sourcePlaylistId) return true;
    const candidates = sourceListFromRow(row);
    return candidates.some((candidate) => {
      if (candidate === normalized || sourceList.has(candidate)) return true;
      if (sourcePlaylistId) {
        const candidateUrl = new URL(candidate);
        return candidateUrl.searchParams.get('list') === sourcePlaylistId;
      }
      return false;
    });
  });
}

async function resolveChannelId(sourceUrl: string, fetchImpl: typeof fetch): Promise<string> {
  const url = new URL(sourceUrl);
  const channelMatch = url.pathname.match(/\/channel\/([^/?]+)/);
  if (channelMatch?.[1]) return channelMatch[1];
  const html = await fetchText(sourceUrl, fetchImpl);
  const rssHref = decodeHtml(firstString(match(html, /<link[^>]+type="application\/rss\+xml"[^>]+href="([^"]+)"/), match(html, /href="([^"]*feeds\/videos\.xml\?channel_id=[^"]+)"/)) || '');
  if (rssHref) {
    const rssUrl = new URL(rssHref);
    const channelId = rssUrl.searchParams.get('channel_id');
    if (channelId) return channelId;
  }
  const channelId = firstString(match(html, /"channelId":"([^"]+)"/), match(html, /"externalId":"([^"]+)"/));
  if (channelId) return channelId;
  throw new Error('Could not resolve YouTube channel id.');
}

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url, { headers: { 'user-agent': 'ElephantPod/0.2 (+https://elephanthand.com)' } });
  if (!response.ok) throw new Error(`YouTube metadata request failed with ${response.status}.`);
  return response.text();
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { 'user-agent': 'ElephantPod/0.2 (+https://elephanthand.com)' } });
  if (!response.ok) throw new Error(`YouTube metadata request failed with ${response.status}.`);
  return response.json();
}

function toRssXml(imported: ParsedYoutubeImport): string {
  const podcast = imported.podcast;
  const items = imported.episodes.map((episode) => `
    <item>
      <guid isPermaLink="false">${escapeXml(episode.guid)}</guid>
      <title>${escapeXml(episode.title)}</title>
      <link>${escapeXml(episode.websiteUrl || episode.sourceUrl)}</link>
      <description>${escapeXml(episode.description || '')}</description>
      <pubDate>${new Date(episode.publishedAt).toUTCString()}</pubDate>
      ${episode.imageUrl ? `<itunes:image href="${escapeXml(episode.imageUrl)}" />` : ''}
      <enclosure url="${escapeXml(episode.audioUrl)}" type="audio/mpeg" ${episode.enclosureLength ? `length="${episode.enclosureLength}"` : 'length="0"'} />
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${escapeXml(podcast.title)}</title>
    <link>${escapeXml(podcast.websiteUrl || podcast.sourceUrl)}</link>
    <description>${escapeXml(podcast.description || '')}</description>
    ${podcast.author ? `<itunes:author>${escapeXml(podcast.author)}</itunes:author>` : ''}
    ${podcast.imageUrl ? `<itunes:image href="${escapeXml(podcast.imageUrl)}" />` : ''}
    ${items}
  </channel>
</rss>`;
}

function videoIdFromUrl(sourceUrl: string): string | undefined {
  const url = new URL(sourceUrl);
  if (url.hostname.replace(/^www\./, '') === 'youtu.be') return url.pathname.replace(/^\//, '') || undefined;
  return url.searchParams.get('v') || undefined;
}

function uniqueByExternalId(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const unique: Record<string, unknown>[] = [];
  for (const row of rows) {
    const key = firstString(row.id, row.videoId, row.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function match(input: string, pattern: RegExp): string | undefined {
  const result = pattern.exec(input);
  return result?.[1] ? decodeHtml(result[1]) : undefined;
}

function decodeHtml(value: string): string {
  return value
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function findHistoryByEpisodeId(rows: Record<string, unknown>[], episodeId: string): Record<string, unknown> | null {
  return rows.find((row) => {
    for (const candidate of sourceListFromRow(row)) {
      const externalEpisodeId = firstString(row.id, row.video_id, row.videoId) || stableId(candidate, 'yt_ep');
      if (stableId(`youtube:${externalEpisodeId}:${candidate}`, 'ep') === episodeId) return true;
    }
    return false;
  }) || null;
}

function sourceListFromRow(row: Record<string, unknown>): string[] {
  return [row.url, row.webpage_url, row.webpageUrl, row.original_url]
    .map(firstString)
    .filter((value): value is string => Boolean(value))
    .map(safeNormalizeUrl)
    .filter((value): value is string => Boolean(value));
}

function sourceUrlList(sourceUrl: string): Set<string> {
  const normalized = normalizeUrl(sourceUrl);
  const url = new URL(normalized);
  const list = new Set([normalized]);
  const videoId = url.searchParams.get('v');
  if (videoId) list.add(normalizeUrl(`https://www.youtube.com/watch?v=${videoId}`));
  const playlistId = url.searchParams.get('list');
  if (playlistId) list.add(normalizeUrl(`https://www.youtube.com/playlist?list=${playlistId}`));
  return list;
}

function resolveMetubeAudioUrl(row: Record<string, unknown>): string | null {
  const direct = firstString(row.download_url, row.downloadUrl, row.url_public, row.public_url, row.audio_url);
  if (direct && /^https?:\/\//.test(direct)) return direct;
  const filename = firstString(row.filename, row.file, row.name, row.title);
  const folder = firstString(row.folder);
  const base = (process.env.METUBE_AUDIO_PUBLIC_BASE_URL || process.env.METUBE_PUBLIC_AUDIO_URL || '').trim().replace(/\/$/, '');
  if (base && filename) return `${base}/${encodeDownloadPath(folder ? `${folder}/${filename}` : filename)}`;
  return null;
}

function classifyYoutubeUrl(input: string): YoutubeSourceKind | null {
  const url = new URL(input);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return null;
  if (host === 'youtu.be') return 'video';
  if (url.searchParams.has('list') || url.pathname.startsWith('/playlist') || url.pathname.startsWith('/podcast/')) return 'playlist';
  if (url.pathname.startsWith('/watch') && url.searchParams.has('v')) return 'video';
  if (url.pathname.startsWith('/shorts/')) return 'video';
  if (url.pathname.startsWith('/channel/') || url.pathname.startsWith('/c/') || url.pathname.startsWith('/@')) return 'channel';
  return 'unknown';
}

function isYoutubeShortsUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.hostname.replace(/^www\./, '').toLowerCase().endsWith('youtube.com') && url.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}

function normalizeUrl(input: string): string {
  const url = new URL(input.trim());
  url.hash = '';
  return url.toString();
}

function safeNormalizeUrl(input: string): string | null {
  try {
    return normalizeUrl(input);
  } catch {
    return null;
  }
}

function stableId(input: string, prefix: string): string {
  return `${prefix}_${crypto.createHash('sha1').update(input).digest('hex').slice(0, 18)}`;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function metubeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = process.env.METUBE_API_TOKEN?.trim();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function encodeDownloadPath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function statusFromRow(row: Record<string, unknown>): 'queued' | 'processing' | 'ready' | 'failed' {
  const status = firstString(row.status, row.state)?.toLowerCase();
  if (status?.includes('fail') || status?.includes('error')) return 'failed';
  if (status?.includes('download') || status?.includes('process')) return 'processing';
  return 'queued';
}

function youtubeSourceTitle(kind: YoutubeSourceKind): string {
  if (kind === 'playlist') return 'YouTube Playlist';
  if (kind === 'channel') return 'YouTube Channel';
  return 'YouTube Imports';
}

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function positiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
