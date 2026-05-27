export interface SilenceShortenerOptions {
  normalRate: number;
  silenceThreshold?: number;
  boostRate?: number;
}

export interface SilenceShortenerHandle {
  supported: boolean;
  stop: () => void;
}

export function attachSilenceShortener(audio: HTMLAudioElement, options: SilenceShortenerOptions): SilenceShortenerHandle {
  const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return { supported: false, stop: () => undefined };

  const normalRate = options.normalRate;
  const threshold = options.silenceThreshold ?? 0.018;
  const silenceRate = Math.min(Math.max(options.boostRate ?? normalRate + 0.65, normalRate), 3);

  let raf = 0;
  let context: AudioContext | null = null;
  try {
    context = new AudioContextCtor();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    analyser.connect(context.destination);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) {
        const centered = value - 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / buffer.length) / 128;
      if (!audio.paused) audio.playbackRate = rms < threshold ? silenceRate : normalRate;
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    return { supported: false, stop: () => undefined };
  }

  return {
    supported: true,
    stop: () => {
      cancelAnimationFrame(raf);
      audio.playbackRate = normalRate;
      void context?.close();
    }
  };
}
