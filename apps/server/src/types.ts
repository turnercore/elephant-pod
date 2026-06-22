export const clipRenderStatuses = ['local-only', 'pending', 'queued', 'rendering', 'ready', 'rendered', 'failed', 'range-link', 'time-range-only'] as const;

export type ClipRenderStatus = typeof clipRenderStatuses[number];

export interface ServerClip {
  id: string;
  episodeId: string;
  podcastTitle: string;
  episodeTitle: string;
  sourceAudioUrl: string;
  startSec: number;
  endSec: number;
  title: string;
  note?: string;
  publicUrl?: string;
  renderedAudioUrl?: string;
  renderedVideoUrl?: string;
  renderStatus?: ClipRenderStatus;
  renderError?: string;
  fileSizeBytes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SilenceMapSegment {
  silenceStartSec: number;
  silenceEndSec: number;
  skipFromSec: number;
  skipToSec: number;
  retainedSilenceSec: number;
}

export interface SilenceMapJob {
  id: string;
  episodeId: string;
  audioUrl: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  segments: SilenceMapSegment[];
  durationSec?: number;
  thresholdDb: number;
  minimumSilenceSec: number;
  retainedSilenceSec: number;
  analyzerVersion: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
