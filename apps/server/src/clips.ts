import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { ServerClip } from './types.js';

const clipSchema = z.object({
  id: z.string().optional(),
  episodeId: z.string(),
  podcastTitle: z.string(),
  episodeTitle: z.string(),
  sourceAudioUrl: z.string().url(),
  startSec: z.number().min(0),
  endSec: z.number().min(1),
  title: z.string().min(1),
  note: z.string().optional(),
  publicUrl: z.string().url().optional(),
  renderedAudioUrl: z.string().url().optional(),
  renderedVideoUrl: z.string().url().optional(),
  renderStatus: z.enum(['local-only', 'pending', 'queued', 'rendering', 'ready', 'rendered', 'failed', 'range-link', 'time-range-only']).optional(),
  renderError: z.string().optional(),
  fileSizeBytes: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export function parseClipPayload(payload: unknown): ServerClip {
  const parsed = clipSchema.parse(payload);
  const id = parsed.id || `clip_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  return {
    id,
    episodeId: parsed.episodeId,
    podcastTitle: parsed.podcastTitle,
    episodeTitle: parsed.episodeTitle,
    sourceAudioUrl: parsed.sourceAudioUrl,
    startSec: parsed.startSec,
    endSec: Math.max(parsed.startSec + 1, parsed.endSec),
    title: parsed.title,
    note: parsed.note,
    publicUrl: parsed.publicUrl,
    renderedAudioUrl: parsed.renderedAudioUrl,
    renderedVideoUrl: parsed.renderedVideoUrl,
    renderStatus: parsed.renderStatus || 'pending',
    renderError: parsed.renderError,
    fileSizeBytes: parsed.fileSizeBytes,
    createdAt: parsed.createdAt || now,
    updatedAt: parsed.updatedAt || now
  };
}

export class ClipStore {
  constructor(private readonly dir: string) {}

  private async filePath(id: string) {
    await fs.mkdir(this.dir, { recursive: true });
    return path.join(this.dir, `${id}.json`);
  }

  async put(clip: ServerClip): Promise<ServerClip> {
    await fs.writeFile(await this.filePath(clip.id), JSON.stringify(clip, null, 2), 'utf-8');
    return clip;
  }

  async patch(id: string, patch: Partial<ServerClip>): Promise<ServerClip | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.put(next);
    return next;
  }

  async get(id: string): Promise<ServerClip | null> {
    try {
      const content = await fs.readFile(await this.filePath(id), 'utf-8');
      return JSON.parse(content) as ServerClip;
    } catch {
      return null;
    }
  }
}

export function clipHtml(clip: ServerClip): string {
  const safeTitle = escapeHtml(clip.title);
  const note = clip.note ? `<p>${escapeHtml(clip.note)}</p>` : '';
  const audioSrc = clip.renderStatus === 'ready' && clip.renderedAudioUrl ? clip.renderedAudioUrl : `${clip.sourceAudioUrl}#t=${clip.startSec},${clip.endSec}`;
  const renderLine = clip.renderStatus === 'ready'
    ? 'Rendered MP3 excerpt.'
    : clip.renderStatus === 'failed'
      ? `Rendered file failed; using source time range fallback. ${clip.renderError ? escapeHtml(clip.renderError) : ''}`
      : 'Rendered file is pending; this page can play the source episode range in the meantime.';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle} · Elephant Ears</title>
  <meta property="og:title" content="${safeTitle} · Elephant Ears" />
  <meta property="og:description" content="${escapeHtml(clip.podcastTitle)} · ${escapeHtml(clip.episodeTitle)}" />
  <style>
    :root { color-scheme: dark; --canvas:#131014; --cream:#FFFBE5; --surface:#2C2430; --bone:#C2C5BB; --yellow:#FFE66E; --coral:#ED6A5A; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--canvas); color:var(--cream); font-family: system-ui, sans-serif; }
    main { width:min(720px, calc(100vw - 32px)); border:1px solid color-mix(in srgb, var(--bone) 20%, transparent); background:var(--surface); border-radius:6px; padding:24px; }
    h1 { margin:0 0 8px; text-transform:uppercase; letter-spacing:.06em; }
    p { color:var(--bone); line-height:1.6; }
    audio { width:100%; margin-top:16px; }
    .tag { display:inline-block; color:var(--yellow); font-weight:800; text-transform:uppercase; letter-spacing:.06em; font-size:12px; }
    a { color:var(--yellow); }
  </style>
</head>
<body>
  <main>
    <span class="tag">Elephant Ears Clip</span>
    <h1>${safeTitle}</h1>
    <p>${escapeHtml(clip.podcastTitle)} · ${escapeHtml(clip.episodeTitle)}</p>
    ${note}
    <audio controls preload="metadata" src="${escapeHtml(audioSrc)}"></audio>
    <p>${escapeHtml(renderLine)}</p>
  </main>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
