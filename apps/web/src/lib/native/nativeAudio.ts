import type { EpisodeWithState } from '@/types/domain';
import { invokeNative, isTauriRuntime } from './tauriBridge';

export interface NativeAudioCapabilities {
  available: boolean;
  backgroundPlayback: boolean;
  lockScreenControls: boolean;
  mediaSession: boolean;
  silenceShortening: boolean;
  reason?: string;
}

export interface NativeNowPlayingPayload {
  episodeId: string;
  title: string;
  podcastTitle: string;
  artworkUrl?: string;
  durationSec?: number;
  elapsedSec: number;
  playbackRate: number;
  playing: boolean;
}

export interface NativeAudioStatus {
  nativeAvailable: boolean;
  episodeId?: string;
  positionSec: number;
  durationSec?: number;
  playbackRate: number;
  playing: boolean;
  message?: string;
}

type AudioCommand = 'capabilities' | 'prepare' | 'play' | 'pause' | 'stop' | 'seek' | 'setRate' | 'status' | 'nowPlaying';

const pluginCommandMap: Record<AudioCommand, string> = {
  capabilities: 'capabilities',
  prepare: 'prepare',
  play: 'play',
  pause: 'pause',
  stop: 'stop',
  seek: 'seek',
  setRate: 'set_rate',
  status: 'status',
  nowPlaying: 'now_playing'
};

const coreCommandMap: Record<AudioCommand, string> = {
  capabilities: 'audio_capabilities',
  prepare: 'audio_prepare',
  play: 'audio_play',
  pause: 'audio_pause',
  stop: 'audio_stop',
  seek: 'audio_seek',
  setRate: 'audio_set_rate',
  status: 'audio_status',
  nowPlaying: 'audio_now_playing'
};

async function invokeAudio<T>(command: AudioCommand, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  try {
    const api = await import('@tauri-apps/api/core');
    return await api.invoke<T>(`plugin:elephant-audio|${pluginCommandMap[command]}`, args);
  } catch {
    // The plugin is optional while desktop/web builds keep using the app-level shims below.
  }
  return invokeNative<T>(coreCommandMap[command], args);
}

export async function getNativeAudioCapabilities(): Promise<NativeAudioCapabilities> {
  const fallback: NativeAudioCapabilities = {
    available: false,
    backgroundPlayback: false,
    lockScreenControls: false,
    mediaSession: false,
    silenceShortening: false,
    reason: isTauriRuntime() ? 'Native audio plugin not installed in this build.' : 'Web runtime.'
  };
  try {
    return (await invokeAudio<NativeAudioCapabilities>('capabilities')) || fallback;
  } catch {
    return fallback;
  }
}

export async function prepareNativeAudio(episode: EpisodeWithState, sourceUrl: string, startSec: number, playbackRate: number): Promise<boolean> {
  try {
    const result = await invokeAudio<boolean>('prepare', {
      episodeId: episode.id,
      url: sourceUrl,
      title: episode.title,
      podcastTitle: episode.podcastTitle,
      artworkUrl: episode.imageUrl,
      startSec,
      playbackRate
    });
    return Boolean(result);
  } catch {
    return false;
  }
}

export async function sendNativeNowPlaying(payload: NativeNowPlayingPayload): Promise<void> {
  try {
    await invokeAudio('nowPlaying', { payload });
  } catch {
    // Native integration is optional; web audio remains the fallback.
  }
}

export async function getNativeAudioStatus(): Promise<NativeAudioStatus | null> {
  try {
    return await invokeAudio<NativeAudioStatus>('status');
  } catch {
    return null;
  }
}

export async function pauseNativeAudio(): Promise<boolean> {
  try {
    return Boolean(await invokeAudio('pause'));
  } catch {
    return false;
  }
}

export async function playNativeAudio(): Promise<boolean> {
  try {
    return Boolean(await invokeAudio('play'));
  } catch {
    return false;
  }
}

export async function stopNativeAudio(): Promise<boolean> {
  try {
    return Boolean(await invokeAudio('stop'));
  } catch {
    return false;
  }
}

export async function seekNativeAudio(seconds: number): Promise<NativeAudioStatus | null> {
  try {
    return await invokeAudio<NativeAudioStatus>('seek', { seconds, positionSec: seconds });
  } catch {
    return null;
  }
}

export async function setNativeAudioRate(playbackRate: number): Promise<boolean> {
  try {
    return Boolean(await invokeAudio('setRate', { playbackRate, playback_rate: playbackRate }));
  } catch {
    return false;
  }
}
