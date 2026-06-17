export interface SmartSkipConfig {
  enabled: boolean;
  requireAuth: boolean;
  whisperBaseUrl?: string;
  whisperModel: string;
  whisperFormat: 'contract' | 'openai';
  segmenterBaseUrl?: string;
  segmenterModel: string;
  segmenterBatchEnabled: boolean;
  segmenterBatchCheckIntervalMinutes: number;
  proactiveEnabled: boolean;
  activeUserDays: number;
  proactiveRunsPerDay: number;
  maxProactiveEpisodesPerShow: number;
  maxBacklogPerUserPerDay: number;
  processingConcurrency: number;
  dataDir: string;
  publicUrl: string;
  ffmpegPath?: string;
}

export function readSmartSkipConfig(options: { dataDir: string; publicUrl: string; ffmpegPath?: string }): SmartSkipConfig {
  return {
    enabled: envBool('SMART_SKIP_ENABLED', false),
    requireAuth: envBool('SMART_SKIP_REQUIRE_AUTH', true),
    whisperBaseUrl: envString('SMART_SKIP_WHISPER_BASE_URL'),
    whisperModel: envString('SMART_SKIP_WHISPER_MODEL') || 'large-v3-turbo',
    whisperFormat: envWhisperFormat('SMART_SKIP_WHISPER_FORMAT'),
    segmenterBaseUrl: envString('SMART_SKIP_SEGMENTER_BASE_URL'),
    segmenterModel: envString('SMART_SKIP_SEGMENTER_MODEL') || 'gpt-5.4-mini',
    segmenterBatchEnabled: envBool('SMART_SKIP_SEGMENTER_BATCH_ENABLED', true),
    segmenterBatchCheckIntervalMinutes: Math.max(1, readSegmenterBatchCheckIntervalMinutes()),
    proactiveEnabled: envBool('SMART_SKIP_PROACTIVE_ENABLED', false),
    activeUserDays: envNumber('SMART_SKIP_ACTIVE_USER_DAYS', 30),
    proactiveRunsPerDay: envNumber('SMART_SKIP_PROACTIVE_RUNS_PER_DAY', 2),
    maxProactiveEpisodesPerShow: envNumber('SMART_SKIP_MAX_PROACTIVE_EPISODES_PER_SHOW', 3),
    maxBacklogPerUserPerDay: envNumber('SMART_SKIP_MAX_BACKLOG_PER_USER_PER_DAY', 25),
    processingConcurrency: Math.max(1, envNumber('SMART_SKIP_PROCESSING_CONCURRENCY', 1)),
    ...options
  };
}

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function envBool(name: string, fallback: boolean): boolean {
  const value = envString(name);
  if (!value) return fallback;
  return !['false', '0', 'off', 'no'].includes(value.toLowerCase());
}

function envWhisperFormat(name: string): SmartSkipConfig['whisperFormat'] {
  const value = envString(name)?.toLowerCase();
  return value === 'openai' || value === 'openai_audio' || value === 'multipart' ? 'openai' : 'contract';
}

function readSegmenterBatchCheckIntervalMinutes(): number {
  const minutes = envNumber('SMART_SKIP_SEGMENTER_BATCH_CHECK_INTERVAL_MINUTES', Number.NaN);
  if (Number.isFinite(minutes)) return minutes;
  return 720; // 12 hours
}

function envNumber(name: string, fallback: number): number {
  const value = Number(envString(name));
  return Number.isFinite(value) ? value : fallback;
}
