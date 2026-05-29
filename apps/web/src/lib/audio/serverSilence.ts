import type { AppSettings, EpisodeWithState } from '@/types/domain';

interface SilenceJobResponse {
  jobId: string;
  status: 'queued' | 'rendering' | 'ready' | 'failed';
  audioUrl?: string;
  error?: string;
}

export async function maybePrepareServerSilenceShortenedUrl(episode: EpisodeWithState, settings: AppSettings): Promise<string | null> {
  const serverUrl = settings.serverUrl?.replace(/\/$/, '');
  if (!serverUrl || !settings.silenceShortening) return null;

  const response = await fetch(`${serverUrl}/api/audio/silence-shortening-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      episodeId: episode.id,
      audioUrl: episode.audioUrl,
      thresholdDb: settings.silenceThresholdDb ?? -42,
      minimumDurationSec: settings.silenceMinimumDurationSec ?? 0.35,
      bitRate: '96k'
    })
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as SilenceJobResponse;
  return payload.status === 'ready' && payload.audioUrl ? payload.audioUrl : null;
}
