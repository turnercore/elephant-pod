import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { z } from 'zod';
import { ClipStore, clipHtml, parseClipPayload } from './clips.js';
import { createOrGetSilenceJob, getSilenceJob, renderClipFile } from './mediaJobs.js';
import { parseRemoteFeed } from './rss.js';
import { githubCallbackHandler, githubStartHandler, getServerAuthConfig, getAuthSession, requireBearerAuth } from './auth.js';
import { podcastIndexBrowseHandler, podcastIndexSearchHandler } from './podcastIndex.js';
import { syncHandler } from './sync.js';
import { publishClipToSupabase } from './supabase.js';

const app = express();
const port = Number(process.env.PORT || 8787);
const publicUrl = (process.env.SERVER_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');
const rawClipStoreDir = process.env.CLIP_STORE_DIR || path.join(process.cwd(), '.data', 'clips');
const rawMediaDataDir = process.env.MEDIA_STORE_DIR || path.join(process.cwd(), '.data', 'media');
const clipStoreDir = path.isAbsolute(rawClipStoreDir) ? rawClipStoreDir : path.join(process.cwd(), rawClipStoreDir);
const mediaDataDir = path.isAbsolute(rawMediaDataDir) ? rawMediaDataDir : path.join(process.cwd(), rawMediaDataDir);
const clipStore = new ClipStore(clipStoreDir);

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'elephant-ears', time: new Date().toISOString(), ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg' });
});

app.get('/api/auth/config', (_req, res) => {
  const config = getServerAuthConfig();
  if (!config.isConfigured) {
    res.status(503).json(config);
    return;
  }
  res.json(config);
});

app.get('/api/auth/session', getAuthSession);

app.get('/api/auth/github/start', githubStartHandler);
app.post('/api/auth/github/start', githubStartHandler);
app.get('/api/auth/github/callback', githubCallbackHandler);

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

app.post('/api/clips', async (req, res) => {
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
          if (updated) await publishClipToSupabase(updated);
        })
        .catch(async (error: unknown) => {
          const updated = await clipStore.patch(publicClip.id, {
            renderStatus: 'failed',
            renderError: error instanceof Error ? error.message : 'Clip render failed.'
          });
          if (updated) await publishClipToSupabase(updated);
        });
    }

    await publishClipToSupabase(publicClip);
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

app.post('/api/audio/silence-shortening-jobs', async (req, res) => {
  try {
    const input = silenceJobSchema.parse(req.body);
    const job = await createOrGetSilenceJob(input, { dataDir: mediaDataDir, publicUrl, ffmpegPath: process.env.FFMPEG_PATH });
    res.status(job.status === 'ready' ? 200 : 202).json({ jobId: job.jobId, status: job.status, audioUrl: job.publicAudioUrl, error: job.error });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Invalid silence-shortening request.' });
  }
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

app.post('/api/sync', requireBearerAuth(), syncHandler);
app.get('/api/podcast-index/search', requireBearerAuth(), podcastIndexSearchHandler);
app.get('/api/podcast-index/browse', requireBearerAuth(), podcastIndexBrowseHandler);

const webDist = process.env.WEB_DIST;
if (webDist) {
  const absolute = path.isAbsolute(webDist) ? webDist : path.join(process.cwd(), webDist);
  app.use(express.static(absolute));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/clip/') || req.path.startsWith('/media/')) return next();
    res.sendFile(path.join(absolute, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Elephant Ears server listening on ${publicUrl}`);
});
