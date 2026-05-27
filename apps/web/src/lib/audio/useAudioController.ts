import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { AppSettings, EpisodeWithState } from '@/types/domain';
import { getCachedEpisodeUrl } from '../storage/cache';
import { isTauriRuntime, listenNativeMediaCommands, nativeClearAudioSession, nativePlaybackState, nativeSetSilenceShortening } from '../native/tauriBridge';
import { getNativeAudioStatus, pauseNativeAudio, playNativeAudio, prepareNativeAudio, seekNativeAudio, setNativeAudioRate, stopNativeAudio } from '../native/nativeAudio';
import { maybePrepareServerSilenceShortenedUrl } from './serverSilence';
import { attachSilenceShortener, type SilenceShortenerHandle } from './silenceShortener';

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

export function useAudioController(settings: AppSettings): AudioController {
  const audioRef = useRef<HTMLAudioElement>(null);
  const shortenerRef = useRef<SilenceShortenerHandle | null>(null);
  const nativeActiveRef = useRef(false);
  const [nativeActive, setNativeActive] = useState(false);
  const [current, setCurrent] = useState<EpisodeWithState | null>(null);
  const currentRef = useRef<EpisodeWithState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [silenceSupported, setSilenceSupported] = useState(false);

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
    const audio = audioRef.current;
    if (audio) audio.playbackRate = settings.playbackRate;

    shortenerRef.current?.stop();
    shortenerRef.current = null;

    const silenceMode = settings.silenceShorteningMode || 'web-audio';
    if (audio && !nativeActiveRef.current && settings.silenceShortening && silenceMode === 'web-audio') {
      const handle = attachSilenceShortener(audio, {
        normalRate: settings.playbackRate,
        silenceThreshold: settings.silenceThreshold,
        boostRate: settings.silenceBoostRate
      });
      shortenerRef.current = handle;
      setSilenceSupported(handle.supported);
    } else {
      setSilenceSupported(settings.silenceShortening && (silenceMode === 'server-ffmpeg' || silenceMode === 'native'));
    }

    if (nativeActiveRef.current) void setNativeAudioRate(settings.playbackRate);

    if (isTauriRuntime()) {
      void nativeSetSilenceShortening({
        enabled: Boolean(settings.silenceShortening && silenceMode === 'native'),
        thresholdDb: settings.silenceThresholdDb ?? -42,
        minimumDurationSec: settings.silenceMinimumDurationSec ?? (settings.silenceMinMs / 1000),
        boostRate: settings.silenceBoostRate ?? 2.15
      });
    }
  }, [settings.playbackRate, settings.silenceBoostRate, settings.silenceMinMs, settings.silenceMinimumDurationSec, settings.silenceShortening, settings.silenceShorteningMode, settings.silenceThreshold, settings.silenceThresholdDb]);

  useEffect(() => {
    applyPlaybackSettings();
    return () => shortenerRef.current?.stop();
  }, [applyPlaybackSettings]);

  const resolveEpisodeUrl = useCallback(
    async (episode: EpisodeWithState) => {
      const shortened = await maybePrepareServerSilenceShortenedUrl(episode, settings).catch(() => null);
      if (shortened) return shortened;
      return getCachedEpisodeUrl(episode);
    },
    [settings]
  );

  const setNativeActiveFlag = useCallback((active: boolean) => {
    nativeActiveRef.current = active;
    setNativeActive(active);
  }, []);

  const playEpisode = useCallback(
    async (episode: EpisodeWithState) => {
      const audio = audioRef.current;
      const previous = currentRef.current;
      const wasSameEpisode = previous?.id === episode.id;
      const startSec = wasSameEpisode
        ? Math.max(0, currentTimeRef.current - settings.resumeRewindSec)
        : episode.state.progressSec || 0;

      setCurrent(episode);

      if (settings.nativeAudioPreferred && isTauriRuntime()) {
        if (wasSameEpisode && nativeActiveRef.current) {
          await seekNativeAudio(startSec);
          const nativePlaying = await playNativeAudio();
          setCurrentTime(startSec);
          setIsPlaying(nativePlaying);
          return;
        }

        const sourceUrl = await resolveEpisodeUrl(episode);
        const prepared = await prepareNativeAudio(episode, sourceUrl, startSec, settings.playbackRate);
        if (prepared) {
          if (audio && !audio.paused) audio.pause();
          shortenerRef.current?.stop();
          shortenerRef.current = null;
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
      } else if (audio.currentTime > settings.resumeRewindSec) {
        audio.currentTime = startSec;
      }
      applyPlaybackSettings();
      await audio.play();
      setIsPlaying(true);
    },
    [applyPlaybackSettings, resolveEpisodeUrl, setNativeActiveFlag, settings.nativeAudioPreferred, settings.playbackRate, settings.resumeRewindSec]
  );

  const toggle = useCallback(async () => {
    if (nativeActiveRef.current) {
      if (isPlayingRef.current) {
        await pauseNativeAudio();
        setIsPlaying(false);
      } else {
        const target = currentTimeRef.current > settings.resumeRewindSec ? Math.max(0, currentTimeRef.current - settings.resumeRewindSec) : currentTimeRef.current;
        if (target !== currentTimeRef.current) {
          await seekNativeAudio(target);
          setCurrentTime(target);
        }
        const nativePlaying = await playNativeAudio();
        setIsPlaying(nativePlaying);
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (audio.currentTime > settings.resumeRewindSec) {
        audio.currentTime = Math.max(0, audio.currentTime - settings.resumeRewindSec);
      }
      await audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
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
      void nativeClearAudioSession();
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
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
        setCurrentTime(status.positionSec || 0);
        currentTimeRef.current = status.positionSec || 0;
        setDuration(status.durationSec || currentRef.current?.durationSec || 0);
        setIsPlaying(status.playing);
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [nativeActive]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (nativeActiveRef.current) return;
      setCurrentTime(audio.currentTime);
      void nativePlaybackState({
        episodeId: currentRef.current?.id,
        playing: !audio.paused,
        positionSec: audio.currentTime,
        durationSec: Number.isFinite(audio.duration) ? audio.duration : currentRef.current?.durationSec,
        playbackRate: audio.playbackRate
      });
    };
    const onDuration = () => {
      if (!nativeActiveRef.current) setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onPause = () => {
      if (nativeActiveRef.current) return;
      setIsPlaying(false);
      onTime();
    };
    const onPlay = () => {
      if (nativeActiveRef.current) return;
      setIsPlaying(true);
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
  }, []);

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
