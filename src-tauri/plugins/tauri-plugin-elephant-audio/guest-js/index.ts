import { invoke } from '@tauri-apps/api/core';

export interface PrepareRequest {
  episodeId: string;
  url: string;
  title: string;
  podcastTitle: string;
  artworkUrl?: string;
  startSec: number;
  playbackRate: number;
}

export interface NowPlayingRequest {
  episodeId: string;
  title: string;
  podcastTitle: string;
  artworkUrl?: string;
  durationSec?: number;
  elapsedSec: number;
  playbackRate: number;
  playing: boolean;
}

export function prepare(request: PrepareRequest) {
  return invoke('plugin:elephant-audio|prepare', request as unknown as Record<string, unknown>);
}

export function nowPlaying(payload: NowPlayingRequest) {
  return invoke('plugin:elephant-audio|now_playing', { payload });
}

export function play() { return invoke('plugin:elephant-audio|play'); }
export function pause() { return invoke('plugin:elephant-audio|pause'); }
export function stop() { return invoke('plugin:elephant-audio|stop'); }
export function seek(seconds: number) { return invoke('plugin:elephant-audio|seek', { seconds }); }
export function setRate(playbackRate: number) { return invoke('plugin:elephant-audio|set_rate', { playbackRate }); }
export function status() { return invoke('plugin:elephant-audio|status'); }
export function capabilities() { return invoke('plugin:elephant-audio|capabilities'); }
