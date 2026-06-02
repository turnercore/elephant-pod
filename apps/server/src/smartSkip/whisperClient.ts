import { whisperResponseSchema } from './schemas.js';
import type { SmartSkipConfig } from './config.js';
import type { SmartSkipMediaVersion } from './mediaVersion.js';
import type { SmartSkipTranscript } from './types.js';

export async function transcribeWithWhisper(input: {
  config: SmartSkipConfig;
  mediaVersion: SmartSkipMediaVersion;
  language?: string;
}): Promise<SmartSkipTranscript> {
  if (!input.config.whisperBaseUrl) throw new Error('SMART_SKIP_WHISPER_BASE_URL is not configured.');
  const whisperBaseUrl = input.config.whisperBaseUrl.replace(/\/$/, '');
  if (input.config.whisperFormat === 'openai') return transcribeWithOpenAiCompatibleWhisper(input, whisperBaseUrl);

  const response = await fetch(`${whisperBaseUrl}/v1/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaVersionId: input.mediaVersion.id,
      audioUrl: input.mediaVersion.publicAudioUrl || input.mediaVersion.audioUrl,
      model: input.config.whisperModel,
      language: input.language || 'en',
      wordTimestamps: true,
      vadFilter: true
    })
  });
  if (!response.ok) throw new Error(`Whisper request failed with ${response.status}`);
  return whisperResponseSchema.parse(await response.json());
}

async function transcribeWithOpenAiCompatibleWhisper(input: {
  config: SmartSkipConfig;
  mediaVersion: SmartSkipMediaVersion;
  language?: string;
}, whisperBaseUrl: string): Promise<SmartSkipTranscript> {
  const audioUrl = input.mediaVersion.publicAudioUrl || input.mediaVersion.audioUrl;
  const audio = await fetch(audioUrl);
  if (!audio.ok) throw new Error(`Smart Skip audio fetch failed with ${audio.status}`);

  const form = new FormData();
  form.append('file', await audio.blob(), fileNameForAudioUrl(audioUrl));
  form.append('model', input.config.whisperModel || 'whisper-1');
  form.append('language', input.language || 'en');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  const response = await fetch(`${whisperBaseUrl}/v1/audio/transcriptions`, {
    method: 'POST',
    body: form
  });
  if (!response.ok) throw new Error(`Whisper request failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return normalizeOpenAiWhisperResponse(input.mediaVersion.id, await response.json());
}

function normalizeOpenAiWhisperResponse(mediaVersionId: string, value: unknown): SmartSkipTranscript {
  const body = value as {
    model?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ start?: number; end?: number; text?: string }>;
  };
  const segments = (body.segments || [])
    .map((segment) => ({
      startMs: secondsToMs(segment.start),
      endMs: secondsToMs(segment.end),
      text: String(segment.text || '').trim()
    }))
    .filter((segment) => segment.text && segment.endMs > segment.startMs);

  return whisperResponseSchema.parse({
    mediaVersionId,
    provider: 'whisper',
    model: body.model,
    language: body.language,
    durationMs: body.duration ? secondsToMs(body.duration) : undefined,
    segments
  });
}

function secondsToMs(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0) * 1000));
}

function fileNameForAudioUrl(value: string): string {
  try {
    const url = new URL(value);
    const name = url.pathname.split('/').filter(Boolean).pop();
    return name || 'episode.mp3';
  } catch {
    return 'episode.mp3';
  }
}
