import { Scissors, Share2, X } from 'lucide-react';
import { useState } from 'react';
import type { Clip, EpisodeWithState } from '@/types/domain';
import { formatDuration, nowIso } from '@/lib/dates';
import { makeId } from '@/lib/ids';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { IconButton } from '../ui/IconButton';

interface ClipComposerProps {
  episode: EpisodeWithState | null;
  currentTime: number;
  serverUrl?: string;
  onClose: () => void;
  onSave: (clip: Clip) => Promise<Clip>;
}

export function ClipComposer({ episode, currentTime, serverUrl, onClose, onSave }: ClipComposerProps) {
  const [start, setStart] = useState(Math.max(0, Math.floor(currentTime) - 15));
  const [end, setEnd] = useState(Math.floor(currentTime) + 45);
  const [title, setTitle] = useState(episode ? `${episode.title} clip` : 'Podcast clip');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');

  if (!episode) return null;
  const activeEpisode = episode;

  async function save() {
    const now = nowIso();
    const clip: Clip = {
      id: makeId('clip'),
      episodeId: activeEpisode.id,
      podcastTitle: activeEpisode.podcastTitle,
      episodeTitle: activeEpisode.title,
      sourceAudioUrl: activeEpisode.audioUrl,
      startSec: Math.max(0, start),
      endSec: Math.max(start + 1, end),
      title,
      note,
      createdAt: now,
      renderStatus: serverUrl ? 'queued' : 'local-only',
      updatedAt: now
    };
    const saved = await onSave(clip);
    setStatus(saved.publicUrl ? `Public link ready${saved.renderStatus === 'ready' || saved.renderStatus === 'rendered' ? ' with rendered audio.' : saved.renderStatus === 'failed' || saved.renderStatus === 'range-link' || saved.renderStatus === 'time-range-only' ? ' with source-range fallback.' : ' and rendering is pending.'}` : 'Saved locally. Configure server sync for public links.');
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-canvas/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Create clip">
      <div className="eh-card w-full max-w-xl">
        <header className="flex items-center justify-between border-b border-bone/15 p-4">
          <div className="flex items-center gap-3">
            <Scissors className="text-yellow" aria-hidden />
            <div>
              <h2 className="eh-title text-lg">Create Clip</h2>
              <p className="text-sm text-bone">{activeEpisode.title}</p>
            </div>
          </div>
          <IconButton label="Close clip composer" onClick={onClose}>
            <X size={18} aria-hidden />
          </IconButton>
        </header>
        <div className="grid gap-4 p-4">
          <label className="grid gap-2">
            <span className="text-sm font-bold">Title</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-2">
              <span className="text-sm font-bold">Start ({formatDuration(start)})</span>
              <Input type="number" value={start} min={0} onChange={(event) => setStart(Number(event.target.value))} />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-bold">End ({formatDuration(end)})</span>
              <Input type="number" value={end} min={start + 1} onChange={(event) => setEnd(Number(event.target.value))} />
            </label>
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-bold">Note</span>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this moment matters" />
          </label>
          <div className="rounded-eh border border-bone/15 bg-canvas/35 p-3 text-sm text-bone">
            Public sharing uses the app server at <span className="font-bold text-cream">{serverUrl || 'not configured'}</span>. Server mode renders stable ffmpeg audio clips when CLIP_RENDER_ENABLED=true and falls back to a source time-range link when rendering fails.
          </div>
          <div className="flex justify-between gap-3">
            <p className="text-sm text-yellow" role="status">{status}</p>
            <Button variant="primary" onClick={save}>
              <Share2 size={16} aria-hidden /> Save clip
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
