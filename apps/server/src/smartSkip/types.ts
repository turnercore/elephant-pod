export type SmartSkipSegmentType =
  | 'ad'
  | 'sponsorship'
  | 'network_promo'
  | 'self_promo'
  | 'intro'
  | 'outro'
  | 'silence';

export type SmartSkipAction = 'auto_skip' | 'soft_skip' | 'label_only' | 'do_not_skip';

export type SmartSkipSource =
  | 'rss_metadata'
  | 'whisper_transcript'
  | 'codex_segmenter'
  | 'silence_detector'
  | 'boundary_refiner'
  | 'ensemble';

export interface SmartSkipSegment {
  id: string;
  type: SmartSkipSegmentType;
  subtype?: string;
  startMs: number;
  endMs: number;
  confidence: number;
  action: SmartSkipAction;
  source: SmartSkipSource;
  label: string;
  evidence?: string[];
  originalStartMs?: number;
  originalEndMs?: number;
}

export interface SmartSkipSegmentMap {
  schemaVersion: 'elephant.smart-skip.v1';
  episodeId: string;
  podcastId?: string;
  mediaVersionId: string;
  audioUrl: string;
  durationMs?: number;
  generatedAt: string;
  status: 'processing' | 'ready' | 'failed' | 'stale';
  segments: SmartSkipSegment[];
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  speaker?: string | null;
  text: string;
}

export interface SmartSkipTranscript {
  mediaVersionId: string;
  provider: string;
  model?: string;
  language?: string;
  durationMs?: number;
  segments: TranscriptSegment[];
}

export interface SilenceBoundary {
  startMs: number;
  endMs: number;
}

export interface SmartSkipSilenceBoundary extends SilenceBoundary {
  silenceStartMs: number;
  silenceEndMs: number;
}

export interface SmartSkipProcessRequest {
  episodeId: string;
  podcastId?: string;
  podcastTitle?: string;
  episodeTitle?: string;
  description?: string;
  audioUrl: string;
  websiteUrl?: string;
  guid?: string;
  durationSec?: number;
  publishedAt?: string;
  chapters?: Array<{ id?: string; title: string; startsAt: number; url?: string }>;
  priority?: 'nowPlaying' | 'queue' | 'inbox' | 'proactiveActiveUser' | 'backlog';
}

export interface SmartSkipJob {
  id: string;
  episodeLocalId: string;
  mediaVersionId?: string;
  priority: number;
  status: 'queued' | 'leased' | 'processing' | 'ready' | 'failed' | 'cancelled';
  stage?: string;
  request: SmartSkipProcessRequest;
  error?: string;
  attempts: number;
  lockedAt?: string;
  lockedUntil?: string;
  workerId?: string;
  nextAttemptAt?: string;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type SmartSkipExternalTaskKind = 'segmenter_batch';

export type SmartSkipExternalTaskStatus =
  | 'submitted'
  | 'validating'
  | 'in_progress'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface SmartSkipExternalTask {
  id: string;
  jobId: string;
  kind: SmartSkipExternalTaskKind;
  provider: string;
  externalId: string;
  status: SmartSkipExternalTaskStatus;
  inputFileId?: string;
  outputFileId?: string;
  errorFileId?: string;
  resultJson?: unknown;
  error?: string;
  submittedAt?: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  createdAt: string;
  updatedAt: string;
}
