import type { EpisodeWithState } from '@/types/domain';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  const api = await import('@tauri-apps/api/core');
  return api.invoke<T>(command, args);
}

export async function toTauriAssetUrl(path: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const api = await import('@tauri-apps/api/core');
  return api.convertFileSrc(path);
}

export interface NativeDownloadRequest {
  episodeId: string;
  audioUrl: string;
  fileName: string;
}

export interface NativeDownloadResult {
  episodeId: string;
  path: string;
  bytes: number;
  mimeType?: string;
  downloadedAt: string;
}

export interface NativeStorageStats {
  bytes: number;
  files: number;
}

export interface NativeMediaMetadata {
  episodeId: string;
  sourceUrl: string;
  title: string;
  podcastTitle: string;
  artworkUrl?: string;
  durationSec?: number;
  playbackRate: number;
}

export interface NativePlaybackState {
  episodeId?: string;
  playing: boolean;
  positionSec: number;
  durationSec?: number;
  playbackRate: number;
}

export interface NativeSilenceOptions {
  enabled: boolean;
  thresholdDb: number;
  minimumDurationSec: number;
  boostRate: number;
}

export type NativeMediaCommand =
  | { command: 'play' }
  | { command: 'pause' }
  | { command: 'toggle' }
  | { command: 'skip-forward'; seconds?: number }
  | { command: 'skip-back'; seconds?: number }
  | { command: 'seek'; seconds: number }
  | { command: 'ended' };

export function safeEpisodeFileName(episode: EpisodeWithState): string {
  const title = `${episode.podcastTitle} - ${episode.title}`
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || episode.id;
  const urlExtension = (() => {
    try {
      const pathname = new URL(episode.audioUrl).pathname;
      const match = pathname.match(/\.(mp3|m4a|aac|ogg|opus|wav|flac)(?:$|\?)/i);
      return match?.[1]?.toLowerCase();
    } catch {
      return undefined;
    }
  })();
  return `${title}.${urlExtension || 'mp3'}`;
}

export async function nativeDownloadEpisode(request: NativeDownloadRequest): Promise<NativeDownloadResult | null> {
  return invokeNative<NativeDownloadResult>('download_episode', { request });
}

export async function nativeDeleteEpisode(episodeId: string): Promise<boolean> {
  const result = await invokeNative<boolean>('delete_downloaded_episode', { episodeId });
  return result ?? false;
}

export async function nativeDownloadedPath(episodeId: string): Promise<string | null> {
  return invokeNative<string>('downloaded_episode_path', { episodeId });
}

export async function nativeDownloadedUrl(episodeId: string): Promise<string | null> {
  const path = await nativeDownloadedPath(episodeId);
  if (!path) return null;
  return toTauriAssetUrl(path);
}

export async function nativeStorageStats(): Promise<NativeStorageStats | null> {
  return invokeNative<NativeStorageStats>('download_storage_stats');
}

export async function nativePruneDownloads(maxBytes: number): Promise<string[] | null> {
  return invokeNative<string[]>('prune_downloads', { maxBytes });
}

export async function nativePrepareAudio(metadata: NativeMediaMetadata): Promise<void> {
  await invokeNative('native_audio_prepare', { metadata });
}

export async function nativePlaybackState(state: NativePlaybackState): Promise<void> {
  await invokeNative('native_audio_set_playback_state', { state });
}

export async function nativeClearAudioSession(): Promise<void> {
  await invokeNative('native_audio_clear_session');
}

export async function nativeSetSilenceShortening(options: NativeSilenceOptions): Promise<void> {
  await invokeNative('native_audio_set_silence_shortening', { options });
}

export async function listenNativeMediaCommands(handler: (command: NativeMediaCommand) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const events = await import('@tauri-apps/api/event');
  const unlisten = await events.listen<NativeMediaCommand>('elephant-ears://media-command', (event) => handler(event.payload));
  return unlisten;
}

// Backward-compatible aliases used by the storage cache layer.
export async function nativeDeleteDownloadedEpisode(episodeId: string, _path?: string): Promise<boolean> {
  return nativeDeleteEpisode(episodeId);
}

export async function nativeResolveDownloadUrl(path?: string): Promise<string | null> {
  if (!path) return null;
  return toTauriAssetUrl(path);
}
