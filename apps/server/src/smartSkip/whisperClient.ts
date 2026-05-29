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
  const response = await fetch(`${input.config.whisperBaseUrl.replace(/\/$/, '')}/v1/transcribe`, {
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
