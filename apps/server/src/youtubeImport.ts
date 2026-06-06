import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { serverJobLimiter } from './serverJobs.js';

type PodcastSourceType = 'youtube-channel' | 'youtube-playlist' | 'youtube-ad-hoc';
type YoutubeSourceKind = 'video' | 'playlist' | 'channel' | 'unknown';
type YoutubeImportOptions = { publicUrl: string; dataDir?: string; ytDlpRunner?: YtDlpRunner; forceRefresh?: boolean };
type YtDlpRunner = (url: string) => Promise<Record<string, unknown>[]>;

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

const enrichSchema = z.object({
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
const defaultYoutubeMetadataLimit = 500;
const youtubeAudioJobs = new Map<string, Promise<void>>();

export function isYoutubeImportConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !['false', '0', 'off'].includes(String(env.YOUTUBE_IMPORT_ENABLED ?? 'true').toLowerCase());
}

export async function handleYoutubeImport(req: Request, res: Response, options: YoutubeImportOptions) {
  if (!isYoutubeImportConfigured()) {
    res.status(503).json({ error: 'YouTube import is disabled on this server.' });
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
    res.status(503).json({ error: 'YouTube import is disabled on this server.' });
    return;
  }
  const url = typeof req.body?.url === 'string' ? req.body.url : '';
  if (!url) {
    res.status(400).json({ error: 'A source URL is required.' });
    return;
  }
  try {
    const imported = await importYoutubeMetadata(url, { ...options, forceRefresh: true });
    res.status(200).json(imported);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'YouTube refresh failed.' });
  }
}

export async function handleYoutubeExtract(req: Request, res: Response, options: YoutubeImportOptions) {
  if (!isYoutubeImportConfigured()) {
    res.status(503).json({ error: 'YouTube audio extraction is disabled on this server.' });
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
    if (kind !== 'video') throw new Error('Only YouTube episode URLs can be extracted.');
    if (isYoutubeShortsUrl(sourceUrl)) throw new Error('YouTube Shorts are not imported as podcast episodes.');
    const episodeId = String(req.params.id);
    if (await youtubeAudioFileExists(episodeId, options)) {
      await updateStoredEpisodeEnrichment(episodeId, { extractionStatus: 'ready', updatedAt: new Date().toISOString() }, options);
      res.status(200).json({ episodeId, sourceUrl, extractionStatus: 'ready', audioReady: true });
      return;
    }
    const job = queueYoutubeAudioDownload(episodeId, sourceUrl, options);
    res.status(202).json({
      episodeId,
      sourceUrl,
      extractionStatus: 'processing',
      audioReady: false
    });
    void job;
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'YouTube extraction failed.' });
  }
}

export async function handleYoutubeEnrich(req: Request, res: Response, options: YoutubeImportOptions) {
  const parsed = enrichSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid YouTube episode source URL is required.', details: parsed.error.flatten() });
    return;
  }
  try {
    const sourceUrl = normalizeUrl(parsed.data.sourceUrl);
    if (isYoutubeShortsUrl(sourceUrl)) throw new Error('YouTube Shorts are not imported as podcast episodes.');
    const patch = await enrichYoutubeEpisodeMetadata(sourceUrl, options);
    if (options.dataDir) {
      await cacheEpisodeEnrichment(patch.id, patch, options);
      await updateStoredEpisodeEnrichment(patch.id, patch, options);
    }
    res.status(200).json({ episodeId: patch.id, patch });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'YouTube episode enrichment failed.' });
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
  const options = { publicUrl: '', dataDir: resolveMediaDataDir() };
  const file = youtubeAudioPath(episodeId, options);
  if (await youtubeAudioFileExists(episodeId, options)) {
    res.sendFile(file, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: 'YouTube audio file is not available.' });
    });
    return;
  }
  const sourceUrl = await findStoredEpisodeSourceUrl(episodeId, options);
  if (!sourceUrl) {
    res.status(404).json({ error: 'YouTube audio extraction is not ready yet.' });
    return;
  }
  queueYoutubeAudioDownload(episodeId, sourceUrl, options);
  res.status(202).json({ error: 'YouTube audio is being prepared on the server.', episodeId, extractionStatus: 'processing' });
}

export async function importYoutubeMetadata(sourceUrl: string, options: YoutubeImportOptions, fetchImpl: typeof fetch = fetch): Promise<ParsedYoutubeImport> {
  const normalizedUrl = normalizeUrl(sourceUrl);
  const kind = classifyYoutubeUrl(normalizedUrl);
  if (!kind) throw new Error('Only YouTube video, playlist, channel, and podcast playlist URLs are supported.');
  if (isYoutubeShortsUrl(normalizedUrl)) throw new Error('YouTube Shorts are not imported as podcast episodes.');
  if (!options.forceRefresh) {
    const canonicalSourceUrl = await resolveCanonicalYoutubeSourceUrl(normalizedUrl, kind, fetchImpl).catch(() => null);
    const stored = canonicalSourceUrl ? await readStoredYoutubeImport(canonicalSourceUrl, options) : null;
    if (stored) {
      return refreshStoredExtractionStatuses(stored, options);
    }
  }

  const metadata = await fetchYoutubeMetadata(normalizedUrl, kind, options, fetchImpl);
  const imported = buildImportResult(normalizedUrl, kind, metadata, options.publicUrl);
  const enriched = await mergeCachedEpisodeEnrichment(imported, options);
  const withStored = await mergeStoredYoutubeImport(enriched, options);
  const cached = await cacheImportThumbnails(withStored, options, fetchImpl);
  const withStatuses = await refreshStoredExtractionStatuses(cached, options);
  await writeStoredYoutubeImport(withStatuses, options);
  return withStatuses;
}

type YoutubeMetadata = {
  title?: string;
  author?: string;
  description?: string;
  imageUrl?: string;
  canonicalSourceUrl?: string;
  channelId?: string;
  playlistId?: string;
  entries: Record<string, unknown>[];
};

async function fetchYoutubeMetadata(sourceUrl: string, kind: YoutubeSourceKind, options: YoutubeImportOptions, fetchImpl: typeof fetch): Promise<YoutubeMetadata> {
  if (kind === 'playlist') {
    const playlistId = new URL(sourceUrl).searchParams.get('list') || sourceUrl.split('/').filter(Boolean).pop();
    if (!playlistId) throw new Error('Could not find the YouTube playlist id.');
    const metadata = parseYoutubeFeed(await fetchText(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`, fetchImpl), { playlistId });
    const canonicalSourceUrl = canonicalPlaylistUrl(playlistId);
    const expanded = await expandWithYtDlpFlatMetadata({ ...metadata, canonicalSourceUrl }, canonicalSourceUrl, options);
    return omitYoutubeShorts(expanded, fetchImpl);
  }

  if (kind === 'channel') {
    const channelId = await resolveChannelId(sourceUrl, fetchImpl);
    const metadata = parseYoutubeFeed(await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, fetchImpl), { channelId });
    const canonicalSourceUrl = canonicalChannelUrl(channelId);
    const expanded = await expandWithYtDlpFlatMetadata({ ...metadata, canonicalSourceUrl }, canonicalSourceUrl, options);
    return omitYoutubeShorts(expanded, fetchImpl);
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
  if (channelId) {
    const canonicalSourceUrl = canonicalChannelUrl(channelId);
    const channelMetadata = await fetchChannelMetadata(channelId, fetchImpl);
    if (channelMetadata) {
      const expanded = await expandWithYtDlpFlatMetadata({ ...channelMetadata, canonicalSourceUrl, channelId }, canonicalSourceUrl, options);
      return omitYoutubeShorts(ensureMetadataIncludesEntry(expanded, videoEntry), fetchImpl);
    }
  }
  return {
    title: firstString((oembed as Record<string, unknown>).author_name) || 'YouTube Channel',
    author: firstString((oembed as Record<string, unknown>).author_name),
    imageUrl: firstString((oembed as Record<string, unknown>).thumbnail_url) || match(videoHtml, /<meta property="og:image" content="([^"]+)"/),
    canonicalSourceUrl: channelId ? canonicalChannelUrl(channelId) : sourceUrl,
    channelId,
    entries: [videoEntry]
  };
}

async function resolveCanonicalYoutubeSourceUrl(sourceUrl: string, kind: YoutubeSourceKind, fetchImpl: typeof fetch): Promise<string> {
  if (kind === 'playlist') {
    const playlistId = new URL(sourceUrl).searchParams.get('list') || sourceUrl.split('/').filter(Boolean).pop();
    if (!playlistId) throw new Error('Could not find the YouTube playlist id.');
    return canonicalPlaylistUrl(playlistId);
  }
  if (kind === 'channel') {
    return canonicalChannelUrl(await resolveChannelId(sourceUrl, fetchImpl));
  }
  if (kind === 'video') {
    const html = await fetchText(sourceUrl, fetchImpl).catch(() => '');
    const channelId = firstString(match(html, /"channelId":"([^"]+)"/), match(html, /"externalId":"([^"]+)"/));
    return channelId ? canonicalChannelUrl(channelId) : sourceUrl;
  }
  return sourceUrl;
}

async function fetchChannelMetadata(channelId: string, fetchImpl: typeof fetch): Promise<YoutubeMetadata | null> {
  try {
    return parseYoutubeFeed(await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, fetchImpl), { channelId });
  } catch {
    return null;
  }
}

async function expandWithYtDlpFlatMetadata(metadata: YoutubeMetadata, sourceUrl: string, options: YoutubeImportOptions): Promise<YoutubeMetadata> {
  const runner = options.ytDlpRunner || runYtDlpFlatPlaylist;
  const rows = await runner(sourceUrl).catch(() => []);
  if (!rows.length) return metadata;
  const rssByVideoId = new Map<string, Record<string, unknown>>();
  for (const entry of metadata.entries) {
    const key = firstString(entry.videoId, entry.video_id, entry.id, entry.url);
    if (key) rssByVideoId.set(key, entry);
  }
  const entries = uniqueByExternalId(rows.map((row) => {
    const videoId = firstString(row.id, row.video_id, row.videoId, row.url);
    const rss = videoId ? rssByVideoId.get(videoId) : undefined;
    return normalizeYtDlpFlatEntry(row, rss);
  }));
  if (!entries.length) return metadata;
  return { ...metadata, entries };
}

function ensureMetadataIncludesEntry(metadata: YoutubeMetadata, entry: Record<string, unknown>): YoutubeMetadata {
  const entryId = firstString(entry.id, entry.videoId, entry.video_id, entry.url);
  if (!entryId) return metadata;
  const existing = metadata.entries.some((candidate) => firstString(candidate.id, candidate.videoId, candidate.video_id, candidate.url) === entryId);
  if (existing) return metadata;
  return { ...metadata, entries: uniqueByExternalId([entry, ...metadata.entries]) };
}

async function runYtDlpFlatPlaylist(sourceUrl: string): Promise<Record<string, unknown>[]> {
  const executable = process.env.YTDLP_PATH?.trim() || 'yt-dlp';
  const limit = Math.max(1, Number(process.env.YOUTUBE_METADATA_MAX_ENTRIES || defaultYoutubeMetadataLimit) || defaultYoutubeMetadataLimit);
  const args = [
    '--flat-playlist',
    '--dump-json',
    '--ignore-errors',
    '--no-warnings',
    '--playlist-items',
    `1:${limit}`,
    sourceUrl
  ];
  return serverJobLimiter.run('youtube-metadata', () => runYtDlpJsonLines(executable, args, 'yt-dlp metadata crawl'));
}

function parseYtDlpJsonLines(output: string): Record<string, unknown>[] {
  const rows = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter((row): row is Record<string, unknown> => Boolean(row));
  return rows.flatMap((row) => {
    const entries = asArray(row.entries).filter(isRecord);
    return entries.length ? entries : [row];
  });
}

async function runYtDlpJsonLines(executable: string, args: string[], label: string): Promise<Record<string, unknown>[]> {
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  const rows = parseYtDlpJsonLines(stdout);
  if (rows.length) return rows;
  if (exitCode && exitCode !== 0) throw new Error(stderr.trim() || `${label} failed with ${exitCode}.`);
  return [];
}

function normalizeYtDlpFlatEntry(row: Record<string, unknown>, rss?: Record<string, unknown>): Record<string, unknown> {
  const videoId = firstString(row.id, row.video_id, row.videoId, rss?.id, rss?.videoId);
  const sourceUrl = firstString(row.url, row.webpage_url, row.webpageUrl, row.original_url, rss?.url) || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined);
  return {
    ...rss,
    ...row,
    id: videoId || stableId(sourceUrl || JSON.stringify(row), 'yt_ep'),
    videoId,
    url: sourceUrl,
    title: firstString(row.title, rss?.title),
    description: firstString(row.description, row.summary, rss?.description, rss?.summary),
    thumbnail: smallYoutubeThumbnail(videoId) || firstString(row.thumbnail, row.thumbnail_url, rss?.thumbnail, rss?.thumbnail_url),
    publishedAt: normalizeYtDlpDate(firstString(row.timestamp, row.release_timestamp, row.upload_date, row.modified_date, rss?.publishedAt, rss?.published)),
    duration: positiveNumber(row.duration, row.durationSec, rss?.duration, rss?.durationSec),
    channel: firstString(row.channel, row.uploader, rss?.channel)
  };
}

async function enrichYoutubeEpisodeMetadata(sourceUrl: string, options: YoutubeImportOptions): Promise<Partial<ParsedYoutubeImport['episodes'][number]> & { id: string }> {
  const runner = options.ytDlpRunner || runYtDlpEpisode;
  const rows = await runner(sourceUrl);
  const row = rows[0];
  if (!row) throw new Error('yt-dlp returned no episode metadata.');
  const normalized = normalizeYtDlpFlatEntry(row);
  const episodeSourceUrl = firstString(normalized.url, sourceUrl) || sourceUrl;
  const externalEpisodeId = firstString(normalized.id, normalized.video_id, normalized.videoId) || stableId(episodeSourceUrl, 'yt_ep');
  const episodeId = stableId(`youtube:${externalEpisodeId}:${episodeSourceUrl}`, 'ep');
  return {
    id: episodeId,
    title: firstString(normalized.title),
    description: firstString(normalized.description, row.full_description),
    websiteUrl: episodeSourceUrl,
    imageUrl: smallYoutubeThumbnail(externalEpisodeId) || firstString(normalized.thumbnail, row.thumbnail, row.thumbnail_url),
    publishedAt: firstString(normalized.publishedAt),
    durationSec: positiveNumber(normalized.duration, row.duration, row.durationSec),
    sourceUrl: episodeSourceUrl,
    externalId: externalEpisodeId,
    updatedAt: new Date().toISOString()
  };
}

async function runYtDlpEpisode(sourceUrl: string): Promise<Record<string, unknown>[]> {
  const executable = process.env.YTDLP_PATH?.trim() || 'yt-dlp';
  const args = [
    '--dump-json',
    '--skip-download',
    '--ignore-errors',
    '--no-warnings',
    sourceUrl
  ];
  return serverJobLimiter.run('youtube-metadata', () => runYtDlpJsonLines(executable, args, 'yt-dlp episode enrichment'));
}

function queueYoutubeAudioDownload(episodeId: string, sourceUrl: string, options: YoutubeImportOptions): Promise<void> {
  const existing = youtubeAudioJobs.get(episodeId);
  if (existing) return existing;
  const job = updateStoredEpisodeEnrichment(episodeId, { extractionStatus: 'processing', updatedAt: new Date().toISOString() }, options)
    .then(() => downloadYoutubeAudio(episodeId, sourceUrl, options))
    .then(async () => {
      await updateStoredEpisodeEnrichment(episodeId, { extractionStatus: 'ready', updatedAt: new Date().toISOString() }, options);
    })
    .catch(async (error: unknown) => {
      await updateStoredEpisodeEnrichment(episodeId, { extractionStatus: 'failed', updatedAt: new Date().toISOString() }, options);
      console.error('YouTube audio extraction failed', { episodeId, error: error instanceof Error ? error.message : error });
    })
    .finally(() => {
      youtubeAudioJobs.delete(episodeId);
    });
  youtubeAudioJobs.set(episodeId, job);
  return job;
}

async function downloadYoutubeAudio(episodeId: string, sourceUrl: string, options: YoutubeImportOptions): Promise<void> {
  const executable = process.env.YTDLP_PATH?.trim() || 'yt-dlp';
  const outputPath = youtubeAudioPath(episodeId, options);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const args = [
    '--no-playlist',
    '--extract-audio',
    '--audio-format',
    'mp3',
    '--audio-quality',
    process.env.YOUTUBE_AUDIO_QUALITY || '0',
    '--output',
    outputPath.replace(/\.mp3$/, '.%(ext)s'),
    sourceUrl
  ];
  await serverJobLimiter.run('youtube-audio', async () => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    if (exitCode && exitCode !== 0) throw new Error(stderr.trim() || `yt-dlp audio download failed with ${exitCode}.`);
    if (!(await youtubeAudioFileExists(episodeId, options))) throw new Error('yt-dlp finished but the expected audio file was not written.');
  });
}

async function youtubeAudioFileExists(episodeId: string, options: YoutubeImportOptions): Promise<boolean> {
  try {
    const stat = await fs.stat(youtubeAudioPath(episodeId, options));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function youtubeAudioPath(episodeId: string, options: YoutubeImportOptions): string {
  return path.join(options.dataDir || resolveMediaDataDir(), 'youtube-audio', `${safeFileId(episodeId)}.mp3`);
}

function resolveMediaDataDir(): string {
  const raw = process.env.MEDIA_STORE_DIR || path.join(process.cwd(), '.data', 'media');
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

async function findStoredEpisodeSourceUrl(episodeId: string, options: YoutubeImportOptions): Promise<string | null> {
  if (!options.dataDir) return null;
  const dir = path.join(options.dataDir, 'youtube-feeds');
  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return null;
  }
  for (const fileName of files.filter((file) => file.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(dir, fileName), 'utf8');
      const parsed = JSON.parse(raw) as ParsedYoutubeImport;
      const episode = parsed.episodes.find((item) => item.id === episodeId);
      if (episode?.sourceUrl) return episode.sourceUrl;
      if (episode?.websiteUrl) return episode.websiteUrl;
    } catch {
      // Ignore corrupt source files; the explicit extract endpoint can still recover with a source URL.
    }
  }
  return null;
}

async function mergeCachedEpisodeEnrichment(imported: ParsedYoutubeImport, options: YoutubeImportOptions): Promise<ParsedYoutubeImport> {
  if (!options.dataDir) return imported;
  const episodes = [];
  for (const episode of imported.episodes) {
    const cached = await readEpisodeEnrichment(episode.id, options);
    episodes.push(cached ? { ...episode, ...cached, id: episode.id, podcastId: episode.podcastId, podcastTitle: episode.podcastTitle, audioUrl: episode.audioUrl, sourceType: 'youtube' as const } : episode);
  }
  return { ...imported, episodes };
}

async function mergeStoredYoutubeImport(imported: ParsedYoutubeImport, options: YoutubeImportOptions): Promise<ParsedYoutubeImport> {
  const stored = await readStoredYoutubeImport(imported.podcast.sourceUrl, options);
  if (!stored) return imported;
  const currentById = new Map(imported.episodes.map((episode) => [episode.id, episode]));
  const storedById = new Map(stored.episodes.map((episode) => [episode.id, episode]));
  const episodeIds = new Set([...storedById.keys(), ...currentById.keys()]);
  const episodes = [...episodeIds]
    .map((episodeId) => mergeYoutubeEpisode(storedById.get(episodeId), currentById.get(episodeId)))
    .filter((episode): episode is ParsedYoutubeImport['episodes'][number] => Boolean(episode))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return {
    podcast: {
      ...stored.podcast,
      ...imported.podcast,
      description: imported.podcast.description || stored.podcast.description,
      imageUrl: imported.podcast.imageUrl || stored.podcast.imageUrl,
      tags: [...new Set([...(stored.podcast.tags || []), ...(imported.podcast.tags || [])])],
      createdAt: stored.podcast.createdAt || imported.podcast.createdAt
    },
    episodes
  };
}

function mergeYoutubeEpisode(stored?: ParsedYoutubeImport['episodes'][number], current?: ParsedYoutubeImport['episodes'][number]): ParsedYoutubeImport['episodes'][number] | null {
  if (!stored) return current || null;
  if (!current) return stored;
  return {
    ...stored,
    ...current,
    title: current.title || stored.title,
    description: richerText(current.description, stored.description),
    imageUrl: current.imageUrl || stored.imageUrl,
    publishedAt: current.publishedAt || stored.publishedAt,
    durationSec: current.durationSec || stored.durationSec,
    enclosureLength: current.enclosureLength || stored.enclosureLength,
    extractionStatus: current.extractionStatus === 'ready' || stored.extractionStatus === 'ready' ? 'ready' : current.extractionStatus || stored.extractionStatus,
    createdAt: stored.createdAt || current.createdAt,
    updatedAt: current.updatedAt || stored.updatedAt
  };
}

function richerText(current?: string, stored?: string): string | undefined {
  if (!current) return stored;
  if (!stored) return current;
  return current.length >= stored.length ? current : stored;
}

async function refreshStoredExtractionStatuses(imported: ParsedYoutubeImport, options: YoutubeImportOptions): Promise<ParsedYoutubeImport> {
  return {
    ...imported,
    episodes: await Promise.all(imported.episodes.map(async (episode) => {
      if (!(await youtubeAudioFileExists(episode.id, options))) return episode;
      return {
        ...episode,
        extractionStatus: 'ready'
      };
    }))
  };
}

async function readStoredYoutubeImport(sourceUrl: string, options: YoutubeImportOptions): Promise<ParsedYoutubeImport | null> {
  if (!options.dataDir) return null;
  try {
    const raw = await fs.readFile(storedYoutubeImportPath(sourceUrl, options), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.podcast) || !Array.isArray(parsed.episodes)) return null;
    return parsed as ParsedYoutubeImport;
  } catch {
    return null;
  }
}

async function writeStoredYoutubeImport(imported: ParsedYoutubeImport, options: YoutubeImportOptions): Promise<void> {
  if (!options.dataDir || !imported.podcast.sourceUrl) return;
  const file = storedYoutubeImportPath(imported.podcast.sourceUrl, options);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(imported, null, 2));
}

function storedYoutubeImportPath(sourceUrl: string, options: YoutubeImportOptions): string {
  return path.join(options.dataDir || '', 'youtube-feeds', `${stableId(sourceUrl, 'ysrc')}.json`);
}

async function cacheEpisodeEnrichment(episodeId: string, patch: Partial<ParsedYoutubeImport['episodes'][number]>, options: YoutubeImportOptions): Promise<void> {
  if (!options.dataDir) return;
  const dir = path.join(options.dataDir, 'youtube-enriched');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${safeFileId(episodeId)}.json`), JSON.stringify(patch, null, 2));
}

async function updateStoredEpisodeEnrichment(episodeId: string, patch: Partial<ParsedYoutubeImport['episodes'][number]>, options: YoutubeImportOptions): Promise<void> {
  if (!options.dataDir) return;
  const dir = path.join(options.dataDir, 'youtube-feeds');
  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const fileName of files.filter((file) => file.endsWith('.json'))) {
    const file = path.join(dir, fileName);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as ParsedYoutubeImport;
      const episodeIndex = parsed.episodes.findIndex((episode) => episode.id === episodeId);
      if (episodeIndex === -1) continue;
      parsed.episodes[episodeIndex] = mergeYoutubeEpisode(parsed.episodes[episodeIndex], patch as ParsedYoutubeImport['episodes'][number]) || parsed.episodes[episodeIndex];
      await fs.writeFile(file, JSON.stringify(parsed, null, 2));
    } catch {
      // Keep enrichment best-effort; a corrupt feed file should not block the episode page.
    }
  }
}

async function readEpisodeEnrichment(episodeId: string, options: YoutubeImportOptions): Promise<Partial<ParsedYoutubeImport['episodes'][number]> | null> {
  if (!options.dataDir) return null;
  try {
    const raw = await fs.readFile(path.join(options.dataDir, 'youtube-enriched', `${safeFileId(episodeId)}.json`), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed as Partial<ParsedYoutubeImport['episodes'][number]> : null;
  } catch {
    return null;
  }
}

function safeFileId(input: string): string {
  return input.replace(/[^A-Za-z0-9_-]/g, '_');
}

function normalizeYtDlpDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`;
  if (/^\d+$/.test(value)) return new Date(Number(value) * 1000).toISOString();
  return value;
}

function buildImportResult(sourceUrl: string, kind: YoutubeSourceKind, metadata: YoutubeMetadata, publicUrl: string): ParsedYoutubeImport {
  const now = new Date().toISOString();
  const externalSourceId = metadata.playlistId || metadata.channelId || stableId(sourceUrl, 'yt_src');
  const sourceType: PodcastSourceType = kind === 'channel' || (kind === 'video' && metadata.channelId) ? 'youtube-channel' : kind === 'playlist' ? 'youtube-playlist' : 'youtube-ad-hoc';
  const canonicalSourceUrl = metadata.canonicalSourceUrl || sourceUrl;
  const podcastTitle = metadata.title || youtubeSourceTitle(kind);
  const podcastId = stableId(`${sourceType}:${externalSourceId}:${canonicalSourceUrl}`, 'feed');
  const feedUrl = `${publicUrl}/api/youtube/feed.xml?url=${encodeURIComponent(canonicalSourceUrl)}`;

  return {
    podcast: {
      id: podcastId,
      title: podcastTitle,
      author: metadata.author,
      description: metadata.description || `Synthetic podcast feed for a YouTube ${sourceType === 'youtube-channel' ? 'channel' : kind}.`,
      imageUrl: metadata.imageUrl,
      feedUrl,
      websiteUrl: canonicalSourceUrl,
      tags: ['YouTube'],
      sourceType,
      sourceUrl: canonicalSourceUrl,
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
        extractionStatus: 'none' as const,
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
  const allowHtmlProbe = metadata.entries.length <= 25;
  for (const entry of metadata.entries) {
    if (!(await isYoutubeShortEntry(entry, fetchImpl, allowHtmlProbe))) entries.push(entry);
  }
  return { ...metadata, entries };
}

async function isYoutubeShortEntry(entry: Record<string, unknown>, fetchImpl: typeof fetch, allowHtmlProbe = true): Promise<boolean> {
  const sourceUrl = firstString(entry.url, entry.webpage_url, entry.webpageUrl, entry.original_url);
  if (sourceUrl && isYoutubeShortsUrl(sourceUrl)) return true;
  const duration = positiveNumber(entry.duration, entry.durationSec);
  if (duration !== undefined && duration <= 61) return true;
  const title = firstString(entry.title, entry.name) || '';
  const description = firstString(entry.description, entry.summary) || '';
  if (/(^|\s)#shorts?\b/i.test(`${title} ${description}`)) return true;
  if (!allowHtmlProbe) return false;
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

function canonicalChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
}

function canonicalPlaylistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
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

function stableId(input: string, prefix: string): string {
  return `${prefix}_${crypto.createHash('sha1').update(input).digest('hex').slice(0, 18)}`;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
