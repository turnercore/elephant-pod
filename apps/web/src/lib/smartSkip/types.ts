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

export interface ResolvedSmartSkipSettings {
  enabled: boolean;
  ads: boolean;
  sponsors: boolean;
  intros: boolean;
  outros: boolean;
  networkPromos: boolean;
  selfPromos: boolean;
  silence: boolean;
  softPrompt: boolean;
}

export interface SmartSkipEvent {
  segment: SmartSkipSegment;
  seekToSec: number;
  episodeId: string;
}
