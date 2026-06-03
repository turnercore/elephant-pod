import { isHostedWebRuntime } from '@/lib/runtime';
import { isTauriRuntime } from '@/lib/native/tauriBridge';

const AUTH_STORAGE_KEY = 'elephant-pod-server-auth';
const NATIVE_AUTH_CALLBACK_URL = 'elephant-pod://auth/callback';

export interface ServerSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userId?: string;
  email?: string;
  username?: string;
  updatedAt: string;
}

type AuthStorage = Record<string, ServerSession>;

const TOKEN_PARAM_KEYS = ['access_token', 'accessToken', 'token', 'session_token', 'ee_access_token'];
const CALLBACK_NOISE_KEYS = [
  'provider_token',
  'provider_refresh_token',
  'code',
  'error',
  'error_description',
  'error_code',
  'sb',
  'state',
  'token_type',
  'type',
  'refresh_token',
  'refreshToken',
  'expires_at',
  'expiresAt',
  'expires_in',
  'expiresIn'
];

export function normalizeServerUrl(input?: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `${isLocalServerHost(trimmed) ? 'http' : 'https'}://${trimmed}`;
  try {
    const url = new URL(withScheme);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function isLocalServerHost(input: string): boolean {
  const host = input.split('/')[0]?.split(':')[0]?.toLowerCase() || '';
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]' || host === '::1';
}

export function resolveBrowserServerUrl(configuredUrl?: string): string {
  const configured = normalizeServerUrl(configuredUrl);
  if (typeof window === 'undefined') return configured;

  const currentOrigin = window.location.origin;
  if (isHostedWebRuntime()) {
    return currentOrigin;
  }

  return configured;
}

export function isServerSessionExpired(session: ServerSession | null, skewSeconds = 60): boolean {
  if (!session?.expiresAt) return false;
  return session.expiresAt <= Math.floor(Date.now() / 1000) + skewSeconds;
}

export function loadServerSession(serverUrl?: string): ServerSession | null {
  if (!serverUrl) return null;
  const url = normalizeServerUrl(serverUrl);
  if (!url) return null;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AuthStorage) : null;
    const session = normalizeSession(parsed?.[url]);
    if (!session) return null;
    if (isServerSessionExpired(session)) {
      clearServerSession(url);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveServerSession(serverUrl: string, session: ServerSession): void {
  const url = normalizeServerUrl(serverUrl);
  if (!url) return;
  const normalized = normalizeSession(session);
  if (!normalized) return;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AuthStorage) : {};
    parsed[url] = normalized;
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Intentionally ignore storage failures; auth can continue for this session.
  }
}

export function clearServerSession(serverUrl: string): void {
  const url = normalizeServerUrl(serverUrl);
  if (!url) return;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AuthStorage) : null;
    if (!parsed?.[url]) return;
    delete parsed[url];
    if (Object.keys(parsed).length > 0) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(parsed));
    } else {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures to keep sign-out UX non-blocking.
  }
}

export function consumeAuthTokenFromCallback(): ServerSession | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);

  const searchParams = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(url.hash.slice(1));

  const session = sessionFromParams(searchParams) || sessionFromParams(hashParams);
  if (!session && !hasCallbackNoise(searchParams, hashParams)) return null;

  for (const key of [...TOKEN_PARAM_KEYS, ...CALLBACK_NOISE_KEYS]) {
    searchParams.delete(key);
    searchParams.delete(key.toLowerCase());
    hashParams.delete(key);
    hashParams.delete(key.toLowerCase());
  }

  const nextSearch = searchParams.toString();
  const nextHash = hashParams.toString();
  const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash ? `#${nextHash}` : ''}`;
  window.history.replaceState({}, '', nextUrl);

  return session;
}

export function readAuthSessionFromUrl(rawUrl: string): ServerSession | null {
  try {
    const url = new URL(rawUrl);
    return sessionFromParams(url.searchParams) || sessionFromParams(new URLSearchParams(url.hash.slice(1)));
  } catch {
    return null;
  }
}

export async function startGithubSignIn(serverUrl: string): Promise<void> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new Error('Server URL is required.');

  const returnTo = isTauriRuntime() ? NATIVE_AUTH_CALLBACK_URL : `${window.location.origin}${window.location.pathname}`;
  const startUrl = `${base}/api/auth/github/start`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(startUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo }),
      signal: controller.signal
    });
    window.clearTimeout(timer);

    if (response.ok) {
      const data = await response.json();
      const authUrl = selectAuthUrl(data);
      if (authUrl) {
        await openAuthUrl(authUrl);
        return;
      }
      throw new Error('Auth server did not return a GitHub authorization URL.');
    }
    const text = await response.text().catch(() => '');
    throw new Error(text || `Auth server responded with ${response.status}.`);
  } catch (error) {
    window.clearTimeout(timer);
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('GitHub sign-in timed out while contacting the app server.');
    if (error instanceof Error) throw error;
    throw new Error('Could not start GitHub sign-in.');
  }
}

async function openAuthUrl(authUrl: string): Promise<void> {
  if (isTauriRuntime()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(authUrl);
    return;
  }
  window.location.assign(authUrl);
}

export async function fetchServerSessionProfile(serverUrl: string, accessToken: string): Promise<Pick<ServerSession, 'userId' | 'email' | 'username'> | null> {
  const base = normalizeServerUrl(serverUrl);
  if (!base || !accessToken) return null;

  const response = await fetch(`${base}/api/auth/session`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;

  const body = await response.json().catch(() => null) as { user?: Record<string, unknown> } | null;
  const user = body?.user;
  if (!user) return null;

  const userId = stringValue(user.id);
  const email = stringValue(user.email);
  const username = stringValue(user.username) || usernameFromEmail(email);
  return { userId, email, username };
}

export async function testServerConnection(serverUrl: string): Promise<string> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new Error('Server URL is required.');

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${base}/api/health`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Server responded with ${response.status}.`);
    return 'Server connection found.';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Server connection timed out.');
    if (error instanceof Error) throw error;
    throw new Error('Server connection failed.');
  } finally {
    window.clearTimeout(timer);
  }
}

function getTokenFromParams(params: URLSearchParams): string | null {
  for (const key of TOKEN_PARAM_KEYS) {
    const token = params.get(key);
    if (token?.trim()) return token.trim();
  }
  return null;
}

function sessionFromParams(params: URLSearchParams): ServerSession | null {
  const accessToken = getTokenFromParams(params);
  if (!accessToken) return null;
  const expiresAt = numberParam(params, 'expires_at') || numberParam(params, 'expiresAt') || expiresAtFromDuration(numberParam(params, 'expires_in') || numberParam(params, 'expiresIn'));
  return {
    accessToken,
    refreshToken: params.get('refresh_token') || params.get('refreshToken') || undefined,
    expiresAt,
    updatedAt: new Date().toISOString()
  };
}

function normalizeSession(value: unknown): ServerSession | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const accessToken = typeof record.accessToken === 'string' ? record.accessToken.trim() : '';
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: typeof record.refreshToken === 'string' && record.refreshToken.trim() ? record.refreshToken.trim() : undefined,
    expiresAt: typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt) ? record.expiresAt : undefined,
    userId: typeof record.userId === 'string' && record.userId.trim() ? record.userId.trim() : undefined,
    email: typeof record.email === 'string' && record.email.trim() ? record.email.trim() : undefined,
    username: typeof record.username === 'string' && record.username.trim() ? record.username.trim() : undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString()
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function usernameFromEmail(email?: string): string | undefined {
  if (!email) return undefined;
  const [name] = email.split('@');
  return name || undefined;
}

function numberParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function expiresAtFromDuration(expiresIn?: number): number | undefined {
  if (!expiresIn) return undefined;
  return Math.floor(Date.now() / 1000) + expiresIn;
}

function selectAuthUrl(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const candidates = [record.authUrl, record.authorizationUrl, record.url, record.redirectUrl, record.startUrl];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function hasCallbackNoise(searchParams: URLSearchParams, hashParams: URLSearchParams): boolean {
  return CALLBACK_NOISE_KEYS.some((key) => searchParams.has(key) || searchParams.has(key.toLowerCase()) || hashParams.has(key) || hashParams.has(key.toLowerCase()));
}
