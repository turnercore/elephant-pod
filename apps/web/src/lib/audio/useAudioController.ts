import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { AppSettings, EpisodeWithState, PodcastPreference } from '@/types/domain';
import { getCachedEpisodeUrl } from '../storage/cache';
import { isTauriRuntime, listenNativeMediaCommands, nativeClearAudioSession, nativePlaybackState, nativeSetSilenceShortening } from '../native/tauriBridge';
import { getNativeAudioStatus, pauseNativeAudio, playNativeAudio, prepareNativeAudio, seekNativeAudio, setNativeAudioRate, stopNativeAudio } from '../native/nativeAudio';
import { ensureServerSilenceMap, getCachedReadySilenceMap } from './silenceMaps';
import { shouldUseNativeAudio } from '../runtime';
import type { SilenceMap } from '@/types/domain';

const RESUME_REWIND_AFTER_MS = 30_000;

export interface AudioController {
  audioRef: RefObject<HTMLAudioElement | null>;
  current: EpisodeWithState | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  setVolume: (value: number) => void;
  playEpisode: (episode: EpisodeWithState) => Promise<void>;
  toggle: () => Promise<void>;
  seek: (seconds: number) => void;
  skipBy: (seconds: number) => void;
  stop: () => void;
  silenceSupported: boolean;
}

export function useAudioController(settings: AppSettings, podcastPreferences: PodcastPreference[] = [], episodeSilenceOverrides: Record<string, boolean> = {}, serverAccessToken?: string | null): AudioController {
  const audioRef = useRef<HTMLAudioElement>(null);
  const nativeActiveRef = useRef(false);
  const [nativeActive, setNativeActive] = useState(false);
  const [current, setCurrent] = useState<EpisodeWithState | null>(null);
  const currentRef = useRef<EpisodeWithState | null>(null);
  const silenceMapRef = useRef<SilenceMap | null>(null);
  const lastSilenceSkipRef = useRef<{ episodeId: string; skipFromSec: number; skippedAtMs: number } | null>(null);
  const outroCompletedEpisodeRef = useRef<string | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [silenceSupported, setSilenceSupported] = useState(false);

  const effectiveSettings = useCallback(() => {
    const preference = podcastPreferences.find((item) => item.podcastId === currentRef.current?.podcastId);
    return {
      ...settings,
      playbackRate: preference?.playbackRate ?? settings.playbackRate,
      skipForwardSec: preference?.skipForwardSec ?? settings.skipForwardSec,
      skipBackSec: preference?.skipBackSec ?? settings.skipBackSec,
      skipIntroSec: preference?.skipIntroSec ?? 0,
      skipOutroSec: preference?.skipOutroSec ?? 0,
      silenceShortening: currentRef.current?.id && episodeSilenceOverrides[currentRef.current.id] !== undefined
        ? episodeSilenceOverrides[currentRef.current.id]
        : preference?.silenceShortening ?? settings.silenceShortening
    };
  }, [episodeSilenceOverrides, podcastPreferences, settings]);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const applyPlaybackSettings = useCallback(() => {
    const resolved = effectiveSettings();
    const audio = audioRef.current;
    if (audio) audio.playbackRate = resolved.playbackRate;

    setSilenceSupported(Boolean(resolved.silenceShortening && (nativeActiveRef.current || silenceMapRef.current?.status === 'ready')));

    if (nativeActiveRef.current) void setNativeAudioRate(resolved.playbackRate);

    if (shouldUseNativeAudio()) {
      void nativeSetSilenceShortening({
        enabled: Boolean(resolved.silenceShortening),
        thresholdDb: resolved.silenceThresholdDb ?? -42,
        minimumDurationSec: resolved.silenceMinimumDurationSec ?? (resolved.silenceMinMs / 1000),
        boostRate: resolved.silenceBoostRate ?? 2.15
      });
    }
  }, [effectiveSettings]);

  useEffect(() => {
    applyPlaybackSettings();
  }, [applyPlaybackSettings]);

  const resolveEpisodeUrl = useCallback(
    async (episode: EpisodeWithState) => {
      return getCachedEpisodeUrl(episode);
    },
    []
  );

  const refreshSilenceMap = useCallback(async (episode: EpisodeWithState) => {
    const resolved = effectiveSettings();
    if (!resolved.silenceShortening || !resolved.serverUrl || !serverAccessToken) {
      silenceMapRef.current = null;
      setSilenceSupported(false);
      return null;
    }
    const cached = await getCachedReadySilenceMap(episode);
    if (cached) {
      silenceMapRef.current = cached;
      setSilenceSupported(cached.segments.length > 0);
      return cached;
    }
    const map = await ensureServerSilenceMap(episode, resolved.serverUrl, serverAccessToken);
    silenceMapRef.current = map?.status === 'ready' ? map : null;
    setSilenceSupported(Boolean(map?.status === 'ready' && map.segments.length > 0));
    return map;
  }, [effectiveSettings, serverAccessToken]);

  const setNativeActiveFlag = useCallback((active: boolean) => {
    nativeActiveRef.current = active;
    setNativeActive(active);
  }, []);

  const playEpisode = useCallback(
    async (episode: EpisodeWithState) => {
      const audio = audioRef.current;
      const resolved = effectiveSettings();
      const previous = currentRef.current;
      const wasSameEpisode = previous?.id === episode.id;
      if (!wasSameEpisode) outroCompletedEpisodeRef.current = null;
      const introOffset = Math.max(0, resolved.skipIntroSec ?? 0);
      const progressSec = episode.state.progressSec || 0;
      const shouldRewindSameEpisode = !isPlayingRef.current && shouldResumeRewind(pausedAtRef.current);
      const startSec = wasSameEpisode
        ? shouldRewindSameEpisode
          ? Math.max(0, currentTimeRef.current - resolved.resumeRewindSec)
          : currentTimeRef.current
        : Math.max(progressSec > 0 ? Math.max(0, progressSec - resolved.resumeRewindSec) : 0, introOffset);

      setCurrent(episode);
      silenceMapRef.current = null;
      lastSilenceSkipRef.current = null;
      pausedAtRef.current = null;
      void refreshSilenceMap(episode);

      if (shouldUseNativeAudio() && resolved.nativeAudioPreferred) {
        if (wasSameEpisode && nativeActiveRef.current) {
          await seekNativeAudio(startSec);
          const nativePlaying = await playNativeAudio();
          setCurrentTime(startSec);
          setIsPlaying(nativePlaying);
          return;
        }

        const sourceUrl = await resolveEpisodeUrl(episode);
        const prepared = await prepareNativeAudio(episode, sourceUrl, startSec, resolved.playbackRate);
        if (prepared) {
          if (audio && !audio.paused) audio.pause();
          setNativeActiveFlag(true);
          setCurrentTime(startSec);
          setDuration(episode.durationSec || 0);
          const nativePlaying = await playNativeAudio();
          setIsPlaying(nativePlaying);
          return;
        }
      }

      setNativeActiveFlag(false);
      if (!audio) return;
      if (!wasSameEpisode || !audio.src) {
        audio.src = await resolveEpisodeUrl(episode);
        audio.currentTime = startSec;
      } else if (audio.currentTime > resolved.resumeRewindSec) {
        audio.currentTime = startSec;
      }
      applyPlaybackSettings();
      await audio.play();
      setIsPlaying(true);
    },
    [applyPlaybackSettings, effectiveSettings, refreshSilenceMap, resolveEpisodeUrl, setNativeActiveFlag]
  );

  const toggle = useCallback(async () => {
    if (nativeActiveRef.current) {
      if (isPlayingRef.current) {
        await pauseNativeAudio();
        setIsPlaying(false);
        pausedAtRef.current = Date.now();
      } else {
        const target = shouldResumeRewind(pausedAtRef.current) && currentTimeRef.current > settings.resumeRewindSec ? Math.max(0, currentTimeRef.current - settings.resumeRewindSec) : currentTimeRef.current;
        if (target !== currentTimeRef.current) {
          await seekNativeAudio(target);
          setCurrentTime(target);
        }
        const nativePlaying = await playNativeAudio();
        setIsPlaying(nativePlaying);
        pausedAtRef.current = null;
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (shouldResumeRewind(pausedAtRef.current) && audio.currentTime > settings.resumeRewindSec) {
        audio.currentTime = Math.max(0, audio.currentTime - settings.resumeRewindSec);
      }
      await audio.play();
      setIsPlaying(true);
      pausedAtRef.current = null;
    } else {
      audio.pause();
      setIsPlaying(false);
      pausedAtRef.current = Date.now();
    }
  }, [settings.resumeRewindSec]);

  const seek = useCallback((seconds: number) => {
    const next = Math.max(0, Math.min(seconds, duration || seconds));
    if (nativeActiveRef.current) {
      setCurrentTime(next);
      void seekNativeAudio(next).then((status) => {
        if (!status) return;
        setCurrentTime(status.positionSec ?? next);
        setDuration(status.durationSec ?? duration);
        setIsPlaying(status.playing);
      });
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
    setCurrentTime(audio.currentTime);
  }, [duration]);

  const skipBy = useCallback((seconds: number) => {
    if (nativeActiveRef.current) {
      seek(currentTimeRef.current + seconds);
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    seek(audio.currentTime + seconds);
  }, [seek]);

  const stop = useCallback(() => {
    if (nativeActiveRef.current) {
      void stopNativeAudio();
      setNativeActiveFlag(false);
      setIsPlaying(false);
      pausedAtRef.current = Date.now();
      void nativeClearAudioSession();
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    pausedAtRef.current = Date.now();
    void nativeClearAudioSession();
  }, [setNativeActiveFlag]);

  const setVolume = useCallback((value: number) => {
    const audio = audioRef.current;
    const clamped = Math.max(0, Math.min(1, value));
    if (audio) audio.volume = clamped;
    setVolumeState(clamped);
  }, []);

  useEffect(() => {
    if (!nativeActive) return;
    const timer = window.setInterval(() => {
      void getNativeAudioStatus().then((status) => {
        if (!status) return;
        const positionSec = status.positionSec || 0;
        const durationSec = status.durationSec || currentRef.current?.durationSec || 0;
        const skipped = maybeSkipSilenceSegment(positionSec, (target) => {
          setCurrentTime(target);
          currentTimeRef.current = target;
          void seekNativeAudio(target);
        }, currentRef.current, silenceMapRef.current, lastSilenceSkipRef);
        if (skipped) return;
        setCurrentTime(positionSec);
        currentTimeRef.current = positionSec;
        setDuration(durationSec);
        setIsPlaying(status.playing);
        const skipOutroSec = Math.max(0, effectiveSettings().skipOutroSec ?? 0);
        const currentEpisodeId = currentRef.current?.id;
        if (
          currentEpisodeId &&
          skipOutroSec > 0 &&
          durationSec > skipOutroSec + 1 &&
          positionSec >= durationSec - skipOutroSec &&
          outroCompletedEpisodeRef.current !== currentEpisodeId
        ) {
          outroCompletedEpisodeRef.current = currentEpisodeId;
          setCurrentTime(durationSec);
          currentTimeRef.current = durationSec;
          setIsPlaying(false);
          void stopNativeAudio();
          audioRef.current?.dispatchEvent(new Event('ended'));
        }
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [effectiveSettings, nativeActive]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (nativeActiveRef.current) return;
      setCurrentTime(audio.currentTime);
      maybeSkipSilenceSegment(audio.currentTime, (target) => {
        audio.currentTime = target;
        setCurrentTime(target);
        currentTimeRef.current = target;
      }, currentRef.current, silenceMapRef.current, lastSilenceSkipRef);
      const resolved = effectiveSettings();
      const currentEpisodeId = currentRef.current?.id;
      const durationSec = Number.isFinite(audio.duration) ? audio.duration : currentRef.current?.durationSec || 0;
      const skipOutroSec = Math.max(0, resolved.skipOutroSec ?? 0);
      if (
        currentEpisodeId &&
        skipOutroSec > 0 &&
        durationSec > skipOutroSec + 1 &&
        audio.currentTime >= durationSec - skipOutroSec &&
        outroCompletedEpisodeRef.current !== currentEpisodeId
      ) {
        outroCompletedEpisodeRef.current = currentEpisodeId;
        audio.currentTime = durationSec;
        audio.pause();
        setCurrentTime(durationSec);
        audio.dispatchEvent(new Event('ended'));
        return;
      }
      void nativePlaybackState({
        episodeId: currentRef.current?.id,
        playing: !audio.paused,
        positionSec: audio.currentTime,
        durationSec,
        playbackRate: audio.playbackRate
      });
    };
    const onDuration = () => {
      if (!nativeActiveRef.current) setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onPause = () => {
      if (nativeActiveRef.current) return;
      setIsPlaying(false);
      pausedAtRef.current = Date.now();
      onTime();
    };
    const onPlay = () => {
      if (nativeActiveRef.current) return;
      setIsPlaying(true);
      pausedAtRef.current = null;
      onTime();
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('play', onPlay);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('play', onPlay);
    };
  }, [effectiveSettings]);

  useEffect(() => {
    const episode = currentRef.current;
    if (!episode) return;
    const resolved = effectiveSettings();
    if (!resolved.silenceShortening || !resolved.serverUrl || !serverAccessToken) return;
    const timer = window.setInterval(() => {
      void refreshSilenceMap(episode);
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [effectiveSettings, refreshSilenceMap, serverAccessToken, current?.id]);

  useEffect(() => {
    void listenNativeMediaCommands((command) => {
      if (command.command === 'play' || command.command === 'toggle') void toggle();
      if (command.command === 'pause') {
        if (nativeActiveRef.current) void pauseNativeAudio().then(() => setIsPlaying(false));
        else {
          audioRef.current?.pause();
          setIsPlaying(false);
        }
      }
      if (command.command === 'skip-forward') skipBy(command.seconds ?? settings.skipForwardSec);
      if (command.command === 'skip-back') skipBy(-(command.seconds ?? settings.skipBackSec));
      if (command.command === 'seek') seek(command.seconds);
    });
  }, [seek, settings.skipBackSec, settings.skipForwardSec, skipBy, toggle]);

  return { audioRef, current, isPlaying, currentTime, duration, volume, setVolume, playEpisode, toggle, seek, skipBy, stop, silenceSupported };
}

function maybeSkipSilenceSegment(
  positionSec: number,
  seekTo: (targetSec: number) => void,
  episode: EpisodeWithState | null,
  map: SilenceMap | null,
  lastSkipRef: MutableRefObject<{ episodeId: string; skipFromSec: number; skippedAtMs: number } | null>
): boolean {
  if (!episode || map?.status !== 'ready') return false;
  const segment = map.segments.find((candidate) => positionSec >= candidate.skipFromSec && positionSec < candidate.skipToSec - 0.05);
  if (!segment) return false;
  const last = lastSkipRef.current;
  if (last && last.episodeId === episode.id && last.skipFromSec === segment.skipFromSec && Date.now() - last.skippedAtMs < 1500) return false;
  lastSkipRef.current = { episodeId: episode.id, skipFromSec: segment.skipFromSec, skippedAtMs: Date.now() };
  seekTo(segment.skipToSec);
  return true;
}

function shouldResumeRewind(pausedAt: number | null): boolean {
  return !pausedAt || Date.now() - pausedAt >= RESUME_REWIND_AFTER_MS;
}
