import { segmenterResponseSchema } from './schemas.js';
import type { SmartSkipConfig } from './config.js';
import type { SmartSkipMediaVersion } from './mediaVersion.js';
import type { SilenceBoundary, SmartSkipExternalTask, SmartSkipProcessRequest, SmartSkipTranscript } from './types.js';
import { SMART_SKIP_SEGMENTER_INSTRUCTIONS } from './prompt.js';

interface SegmenterInput {
  config: SmartSkipConfig;
  request: SmartSkipProcessRequest;
  mediaVersion: SmartSkipMediaVersion;
  transcript: SmartSkipTranscript;
  silenceMap: SilenceBoundary[];
}

interface SegmenterBatchResponse {
  provider?: string;
  externalId: string;
  status: SmartSkipExternalTask['status'];
  inputFileId?: string;
  outputFileId?: string;
  errorFileId?: string;
  result?: unknown;
  error?: string;
}

export type SegmenterUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  raw?: unknown;
};

export async function segmentWithCodex(input: SegmenterInput) {
  return (await segmentWithCodexResult(input)).segments;
}

export async function segmentWithCodexResult(input: SegmenterInput): Promise<{
  segments: ReturnType<typeof parseSegmenterSegments>;
  usage?: SegmenterUsage;
}> {
  if (!input.config.segmenterBaseUrl) throw new Error('SMART_SKIP_SEGMENTER_BASE_URL is not configured.');
  const response = await fetch(`${input.config.segmenterBaseUrl.replace(/\/$/, '')}/v1/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSegmenterPayload(input))
  });
  if (!response.ok) throw new Error(`Segmenter request failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const parsed = segmenterResponseSchema.parse(await response.json());
  return {
    segments: parsed.segments.map((segment) => ({ ...segment, source: 'codex_segmenter' as const })),
    usage: parsed.usage
  };
}

export async function submitSegmentBatch(input: SegmenterInput & { customId: string }): Promise<SegmenterBatchResponse> {
  if (!input.config.segmenterBaseUrl) throw new Error('SMART_SKIP_SEGMENTER_BASE_URL is not configured.');
  const response = await fetch(`${input.config.segmenterBaseUrl.replace(/\/$/, '')}/v1/segment-batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customId: input.customId,
      request: buildSegmenterPayload(input)
    })
  });
  if (!response.ok) throw new Error(`Segmenter batch submission failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return parseBatchResponse(await response.json());
}

export async function checkSegmentBatch(input: { config: SmartSkipConfig; externalId: string }): Promise<SegmenterBatchResponse> {
  if (!input.config.segmenterBaseUrl) throw new Error('SMART_SKIP_SEGMENTER_BASE_URL is not configured.');
  const response = await fetch(`${input.config.segmenterBaseUrl.replace(/\/$/, '')}/v1/segment-batches/${encodeURIComponent(input.externalId)}`);
  if (!response.ok) throw new Error(`Segmenter batch check failed with ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return parseBatchResponse(await response.json());
}

export function parseSegmenterSegments(result: unknown) {
  const parsed = segmenterResponseSchema.parse(result);
  return parsed.segments.map((segment) => ({ ...segment, source: 'codex_segmenter' as const }));
}

function buildSegmenterPayload(input: SegmenterInput) {
  return {
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
  };
}

function parseBatchResponse(value: unknown): SegmenterBatchResponse {
  const response = value as SegmenterBatchResponse;
  if (!response || typeof response.externalId !== 'string') throw new Error('Segmenter batch response did not include externalId.');
  return {
    provider: response.provider || 'openai',
    externalId: response.externalId,
    status: response.status,
    inputFileId: response.inputFileId,
    outputFileId: response.outputFileId,
    errorFileId: response.errorFileId,
    result: response.result,
    error: response.error
  };
}
