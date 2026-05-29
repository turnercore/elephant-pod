import { isTauriRuntime } from './native/tauriBridge';

export type AppRuntimeMode = 'native' | 'hosted-web' | 'local-web';

export function isLoopbackUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.hostname === 'localhost' || url.hostname === '0.0.0.0' || url.hostname.startsWith('127.');
  } catch {
    return false;
  }
}

export function getRuntimeMode(): AppRuntimeMode {
  if (isTauriRuntime()) return 'native';
  if (import.meta.env.VITE_RUNTIME_MODE === 'server') return 'hosted-web';
  if (typeof window !== 'undefined' && (window.location.protocol === 'http:' || window.location.protocol === 'https:') && !isLoopbackUrl(window.location.origin)) {
    return 'hosted-web';
  }
  return 'local-web';
}

export function isHostedWebRuntime(): boolean {
  return getRuntimeMode() === 'hosted-web';
}

export function shouldUseNativeAudio(): boolean {
  return isTauriRuntime();
}
