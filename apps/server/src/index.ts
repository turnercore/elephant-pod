import cors from 'cors';
import { config as loadDotenv } from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ClipStore, clipHtml, parseClipPayload } from './clips.js';
import { createOrGetSilenceJob, createOrGetSilenceMapJob, getSilenceJob, getSilenceMapJob, renderClipFile } from './mediaJobs.js';
import { parseRemoteFeed } from './rss.js';
import { requireServerServiceAccess } from './auth.js';
import { handleAppleSignIn, handleSession, handleSignOut } from './appleAuth.js';
import { podcastIndexBrowseHandler, podcastIndexSearchHandler } from './podcastIndex.js';
import { upsertPublicClip } from './database.js';
import { readSmartSkipConfig } from './smartSkip/config.js';
import { startSmartSkipQueue } from './smartSkip/jobs.js';
import { registerSmartSkipRoutes } from './smartSkip/routes.js';
import { startSmartSkipScheduler } from './smartSkip/scheduler.js';
import { handleYoutubeAudio, handleYoutubeEnrich, handleYoutubeExtract, handleYoutubeFeed, handleYoutubeImport, handleYoutubeRefresh, isYoutubeImportConfigured } from './youtubeImport.js';
import { readServerMaxJobs, serverJobLimiter } from './serverJobs.js';
import { buildServerCapabilities } from './capabilities.js';

loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
loadDotenv();

const app = express();
const port = Number(process.env.PORT || 8787);
const publicUrl = (process.env.SERVER_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');
const rawClipStoreDir = process.env.CLIP_STORE_DIR || path.join(process.cwd(), '.data', 'clips');
const rawMediaDataDir = process.env.MEDIA_STORE_DIR || path.join(process.cwd(), '.data', 'media');
const clipStoreDir = path.isAbsolute(rawClipStoreDir) ? rawClipStoreDir : path.join(process.cwd(), rawClipStoreDir);
const mediaDataDir = path.isAbsolute(rawMediaDataDir) ? rawMediaDataDir : path.join(process.cwd(), rawMediaDataDir);
const clipStore = new ClipStore(clipStoreDir);
const smartSkipConfig = readSmartSkipConfig({ dataDir: mediaDataDir, publicUrl, ffmpegPath: process.env.FFMPEG_PATH });
const serverServiceAccess = requireServerServiceAccess();
const discoveryServiceAccess = requireServerServiceAccess({ allowNativeHeaders: true });

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'daisypod',
    time: new Date().toISOString(),
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    serverJobs: {
      max: readServerMaxJobs(),
      active: serverJobLimiter.activeCount(),
      queued: serverJobLimiter.queuedCount()
    },
    smartSkip: { enabled: smartSkipConfig.enabled }
  });
});

app.get('/api/capabilities', (_req, res) => {
  res.json(buildServerCapabilities({
    youtubeImportEnabled: isYoutubeImportConfigured(),
    smartSkipEnabled: smartSkipConfig.enabled
  }));
});

app.post('/api/auth/apple', (req, res) => void handleAppleSignIn(req, res));
app.get('/api/auth/session', (req, res) => void handleSession(req, res));
app.post('/api/auth/sign-out', (req, res) => void handleSignOut(req, res));

app.get('/api/rss/parse', async (req, res) => {
  try {
    const url = String(req.query.url || '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      res.status(400).json({ error: 'A valid http(s) feed URL is required.' });
      return;
    }
    const result = await parseRemoteFeed(url);
    res.json(result);
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Unable to parse feed.' });
  }
});

app.get('/api/youtube/feed.xml', (req, res) => void handleYoutubeFeed(req, res, { publicUrl, dataDir: mediaDataDir }));

app.post('/api/clips', serverServiceAccess, async (req, res) => {
  try {
    const clip = parseClipPayload(req.body);
    const renderFlag = process.env.CLIP_RENDER_ENABLED ?? process.env.CLIP_RENDERING ?? 'true';
    const renderEnabled = !['false', '0', 'off'].includes(renderFlag.toLowerCase());
    const publicClip = {
      ...clip,
      publicUrl: `${publicUrl}/clip/${encodeURIComponent(clip.id)}`,
      renderStatus: renderEnabled ? 'pending' as const : 'time-range-only' as const,
      renderError: renderEnabled ? clip.renderError : 'Rendering is disabled.'
    };
    await clipStore.put(publicClip);

    if (renderEnabled) {
      void renderClipFile(publicClip, {
        dataDir: clipStoreDir,
        publicUrl,
        ffmpegPath: process.env.FFMPEG_PATH,
        enabled: true
      })
        .then(async (patch) => {
          const updated = await clipStore.patch(publicClip.id, patch);
          if (updated) await upsertPublicClip(updated);
        })
        .catch(async (error: unknown) => {
          const updated = await clipStore.patch(publicClip.id, {
            renderStatus: 'failed',
            renderError: error instanceof Error ? error.message : 'Clip render failed.'
          });
          if (updated) await upsertPublicClip(updated);
        });
    }

    await upsertPublicClip(publicClip);
    res.status(201).json({
      id: publicClip.id,
      publicUrl: publicClip.publicUrl,
      renderedAudioUrl: publicClip.renderedAudioUrl,
      renderedUrl: publicClip.renderedAudioUrl,
      renderedVideoUrl: publicClip.renderedVideoUrl,
      renderStatus: publicClip.renderStatus,
      renderError: publicClip.renderError,
      fileSizeBytes: publicClip.fileSizeBytes
    });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Invalid clip payload.' });
  }
});

app.get('/api/clips/:id', async (req, res) => {
  const clip = await clipStore.get(req.params.id);
  if (!clip) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }
  res.json(clip);
});

app.get('/clip/:id', async (req, res) => {
  const clip = await clipStore.get(req.params.id);
  if (!clip) {
    res.status(404).send('Clip not found.');
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.send(clipHtml(clip));
});

app.get('/media/clips/:id.mp3', async (req, res) => {
  const file = path.join(clipStoreDir, 'rendered', `${req.params.id}.mp3`);
  res.sendFile(file, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: 'Rendered clip not found.' });
  });
});

const silenceJobSchema = z.object({
  episodeId: z.string().min(1),
  audioUrl: z.string().url(),
  thresholdDb: z.number().min(-90).max(-10).default(-42),
  minimumDurationSec: z.number().min(0.1).max(3).default(0.35),
  bitRate: z.string().regex(/^\d{2,3}k$/).default('96k')
});

const silenceMapSchema = z.object({
  episodeId: z.string().min(1),
  audioUrl: z.string().url()
});

app.post('/api/audio/silence-shortening-jobs', serverServiceAccess, async (req, res) => {
  try {
    const input = silenceJobSchema.parse(req.body);
    const job = await createOrGetSilenceJob(input, { dataDir: mediaDataDir, publicUrl, ffmpegPath: process.env.FFMPEG_PATH });
    res.status(job.status === 'ready' ? 200 : 202).json({ jobId: job.jobId, status: job.status, audioUrl: job.publicAudioUrl, error: job.error });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Invalid silence-shortening request.' });
  }
});

app.post('/api/audio/silence-maps', serverServiceAccess, async (req, res) => {
  try {
    const input = silenceMapSchema.parse(req.body);
    const job = await createOrGetSilenceMapJob(input, { dataDir: mediaDataDir, publicUrl, ffmpegPath: process.env.FFMPEG_PATH });
    res.status(job.status === 'ready' ? 200 : 202).json(job);
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Invalid silence-map request.' });
  }
});

app.get('/api/audio/silence-maps/:id', serverServiceAccess, async (req, res) => {
  const job = await getSilenceMapJob(String(req.params.id), { dataDir: mediaDataDir, publicUrl, ffmpegPath: process.env.FFMPEG_PATH });
  if (!job) {
    res.status(404).json({ error: 'Silence map not found.' });
    return;
  }
  res.json(job);
});

app.get('/api/audio/silence-shortening-jobs/:id', (req, res) => {
  const job = getSilenceJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Silence-shortening job not found or server was restarted before completion.' });
    return;
  }
  res.json({ jobId: job.jobId, status: job.status, audioUrl: job.publicAudioUrl, error: job.error });
});

app.get('/media/silence/:id.mp3', (req, res) => {
  const job = getSilenceJob(req.params.id);
  const file = job?.outputPath || path.join(mediaDataDir, 'silence', `${req.params.id}.mp3`);
  res.sendFile(file, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: 'Silence-shortened audio not found.' });
  });
});

app.get('/media/youtube/:id.mp3', (req, res) => {
  void handleYoutubeAudio(req, res).catch((error: unknown) => {
    if (!res.headersSent) res.status(502).json({ error: error instanceof Error ? error.message : 'YouTube audio lookup failed.' });
  });
});

app.get('/media/youtube-thumbnails/:file', (req, res) => {
  const fileName = path.basename(String(req.params.file));
  const file = path.join(mediaDataDir, 'youtube-thumbnails', fileName);
  res.sendFile(file, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: 'YouTube thumbnail not found.' });
  });
});

registerSmartSkipRoutes(app, smartSkipConfig, serverServiceAccess);
startSmartSkipQueue(smartSkipConfig);
startSmartSkipScheduler(smartSkipConfig, () => {
  console.log('Smart Skip proactive scheduler is configured; active-user discovery is a documented V1 follow-up.');
});

app.get('/api/podcast-index/search', discoveryServiceAccess, podcastIndexSearchHandler);
app.get('/api/podcast-index/browse', discoveryServiceAccess, podcastIndexBrowseHandler);
app.post('/api/youtube/import', serverServiceAccess, (req, res) => void handleYoutubeImport(req, res, { publicUrl, dataDir: mediaDataDir }));
app.post('/api/youtube/sources/:id/refresh', serverServiceAccess, (req, res) => void handleYoutubeRefresh(req, res, { publicUrl, dataDir: mediaDataDir }));
app.post('/api/youtube/episodes/:id/enrich', serverServiceAccess, (req, res) => void handleYoutubeEnrich(req, res, { publicUrl, dataDir: mediaDataDir }));
app.post('/api/youtube/episodes/:id/extract', serverServiceAccess, (req, res) => void handleYoutubeExtract(req, res, { publicUrl, dataDir: mediaDataDir }));

app.listen(port, () => {
  console.log(`DaisyPod server listening on ${publicUrl}`);
});
