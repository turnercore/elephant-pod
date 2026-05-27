const AUTH_STORAGE_KEY = 'elephant-ears-server-auth';

export interface ServerSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  updatedAt: string;
}

type AuthStorage = Record<string, ServerSession>;

const TOKEN_PARAM_KEYS = ['access_token', 'accessToken', 'token', 'session_token', 'ee_access_token'];

export function normalizeServerUrl(input?: string): string {
  if (!input) return '';
  return input.replace(/\/$/, '');
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
  if (!session) return null;

  for (const key of [...TOKEN_PARAM_KEYS, 'refresh_token', 'refreshToken', 'expires_at', 'expiresAt', 'expires_in', 'expiresIn', 'token_type', 'type']) {
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

export async function startGithubSignIn(serverUrl: string): Promise<void> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new Error('Server URL is required.');

  const returnTo = `${window.location.origin}${window.location.pathname}`;
  const startUrl = `${base}/api/auth/github/start`;

  try {
    const response = await fetch(startUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo })
    });

    if (response.ok) {
      const data = await response.json();
      const authUrl = selectAuthUrl(data);
      if (authUrl) {
        window.location.assign(authUrl);
        return;
      }
    }
    const text = await response.text().catch(() => '');
    if (text) throw new Error(text);
  } catch {
    // Fall through to a GET fallback for older server builds.
  }

  window.location.assign(`${startUrl}?returnTo=${encodeURIComponent(returnTo)}`);
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
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString()
  };
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
