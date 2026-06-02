import { z } from 'zod';

export const segmentTypeSchema = z.enum(['ad', 'sponsorship', 'network_promo', 'self_promo', 'intro', 'outro', 'silence']);
export const segmentActionSchema = z.enum(['auto_skip', 'soft_skip', 'label_only', 'do_not_skip']);
export const segmentSourceSchema = z.enum([
  'rss_metadata',
  'whisper_transcript',
  'codex_segmenter',
  'silence_detector',
  'boundary_refiner',
  'ensemble'
]);

export const smartSkipSegmentSchema = z.object({
  id: z.string().min(1),
  type: segmentTypeSchema,
  subtype: z.string().optional(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  action: segmentActionSchema,
  source: segmentSourceSchema,
  label: z.string().min(1),
  evidence: z.array(z.string()).optional(),
  originalStartMs: z.number().int().min(0).optional(),
  originalEndMs: z.number().int().min(0).optional()
}).refine((segment) => segment.endMs > segment.startMs, { message: 'endMs must be greater than startMs' });

export const smartSkipSegmentMapSchema = z.object({
  schemaVersion: z.literal('elephant.smart-skip.v1'),
  episodeId: z.string().min(1),
  podcastId: z.string().optional(),
  mediaVersionId: z.string().min(1),
  audioUrl: z.string().url(),
  durationMs: z.number().int().positive().optional(),
  generatedAt: z.string().datetime(),
  status: z.enum(['processing', 'ready', 'failed', 'stale']),
  segments: z.array(smartSkipSegmentSchema)
});

export const processRequestSchema = z.object({
  episodeId: z.string().min(1),
  podcastId: z.string().optional(),
  podcastTitle: z.string().optional(),
  episodeTitle: z.string().optional(),
  description: z.string().optional(),
  audioUrl: z.string().url(),
  websiteUrl: z.string().url().optional(),
  guid: z.string().optional(),
  durationSec: z.number().positive().optional(),
  publishedAt: z.string().optional(),
  chapters: z.array(z.object({
    id: z.string().optional(),
    title: z.string(),
    startsAt: z.number().min(0),
    url: z.string().optional()
  })).default([]),
  priority: z.enum(['nowPlaying', 'queue', 'inbox', 'proactiveActiveUser', 'backlog']).default('queue')
});

export const whisperResponseSchema = z.object({
  mediaVersionId: z.string().min(1),
  provider: z.string().default('whisper'),
  model: z.string().optional(),
  language: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
  segments: z.array(z.object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    speaker: z.string().nullable().optional(),
    text: z.string()
  }).refine((segment) => segment.endMs > segment.startMs, { message: 'Transcript segment endMs must be greater than startMs' }))
});

export const segmenterResponseSchema = z.object({
  segments: z.array(z.object({
    type: segmentTypeSchema.exclude(['silence']),
    subtype: z.string().optional(),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    confidence: z.number().min(0).max(1),
    action: segmentActionSchema.default('auto_skip'),
    label: z.string().min(1),
    evidence: z.array(z.string()).default([])
  }).refine((segment) => segment.endMs > segment.startMs, { message: 'Segment endMs must be greater than startMs' })),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    raw: z.unknown().optional()
  }).optional()
});
