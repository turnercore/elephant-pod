import { segmenterResponseSchema } from './schemas.js';
import type { SmartSkipConfig } from './config.js';
import type { SmartSkipMediaVersion } from './mediaVersion.js';
import type { SilenceBoundary, SmartSkipProcessRequest, SmartSkipTranscript } from './types.js';
import { SMART_SKIP_SEGMENTER_INSTRUCTIONS } from './prompt.js';

export async function segmentWithCodex(input: {
  config: SmartSkipConfig;
  request: SmartSkipProcessRequest;
  mediaVersion: SmartSkipMediaVersion;
  transcript: SmartSkipTranscript;
  silenceMap: SilenceBoundary[];
}) {
  if (!input.config.segmenterBaseUrl) throw new Error('SMART_SKIP_SEGMENTER_BASE_URL is not configured.');
  const response = await fetch(`${input.config.segmenterBaseUrl.replace(/\/$/, '')}/v1/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      episode: {
        episodeId: input.request.episodeId,
        podcastId: input.request.podcastId,
        podcastTitle: input.request.podcastTitle,
        episodeTitle: input.request.episodeTitle,
        description: input.request.description,
        durationMs: input.mediaVersion.durationMs,
        chapters: input.request.chapters || []
      },
      mediaVersion: {
        mediaVersionId: input.mediaVersion.id,
        audioUrl: input.mediaVersion.audioUrl
      },
      transcript: input.transcript,
      silenceMap: input.silenceMap,
      instructions: {
        text: SMART_SKIP_SEGMENTER_INSTRUCTIONS,
        preferFalseNegatives: true,
        detect: ['ad', 'sponsorship', 'network_promo', 'self_promo', 'intro', 'outro']
      },
      model: input.config.segmenterModel
    })
  });
  if (!response.ok) throw new Error(`Segmenter request failed with ${response.status}`);
  const parsed = segmenterResponseSchema.parse(await response.json());
  return parsed.segments.map((segment) => ({ ...segment, source: 'codex_segmenter' as const }));
}
