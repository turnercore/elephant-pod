export type ClipRenderStatus = 'local-only' | 'pending' | 'queued' | 'rendering' | 'ready' | 'rendered' | 'failed' | 'range-link' | 'time-range-only';

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

export interface SilenceJob {
  jobId: string;
  episodeId: string;
  audioUrl: string;
  status: 'queued' | 'rendering' | 'ready' | 'failed';
  outputPath: string;
  publicAudioUrl?: string;
  thresholdDb: number;
  minimumDurationSec: number;
  bitRate: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
