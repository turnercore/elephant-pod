import type { NextFunction, Request, Response } from 'express';
import { getServerSupabaseWithMode, getServerSupabaseConfig } from './supabase.js';

const authErrorMap = {
  missingConfig: 'Server auth is unavailable. Set SUPABASE_URL and SUPABASE_ANON_KEY in the server environment.',
  missingProviderConfig:
    'Server auth provider is unavailable. Set GOTRUE_EXTERNAL_GITHUB_ENABLED=true, GOTRUE_EXTERNAL_GITHUB_CLIENT_ID, GOTRUE_EXTERNAL_GITHUB_SECRET, and GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI in the server environment.',
  missingToken: 'Missing Authorization: Bearer <access token> header.',
  invalidToken: 'Invalid or expired access token.',
  authExchangeFailed: 'Unable to complete GitHub sign-in exchange.'
};

export type ServerAuthContext = {
  userId: string;
  email?: string | null;
  username?: string | null;
  accessToken: string;
};

export function getServerAuthConfig() {
  const base = getServerSupabaseConfig();
  const isConfigured = Boolean(base.supabaseUrl && base.hasAnonKey);
  const hasProvider = Boolean(base.hasGitHubProvider);
  const message = isConfigured ? (hasProvider ? null : authErrorMap.missingProviderConfig) : authErrorMap.missingConfig;

  return {
    isConfigured,
    provider: 'github',
    hasServiceRole: base.hasServiceRoleKey,
    hasProvider,
    callbackPath: '/api/auth/github/callback',
    message
  };
}

function ensureServerAuthClient() {
  const client = getServerSupabaseWithMode('anon');
  if (!client) {
    return { client: null as null, error: authErrorMap.missingConfig };
  }
  return { client, error: null as null | string };
}

export function getAuthContext(res: Response): ServerAuthContext | null {
  const maybeContext = (res.locals?.serverAuthContext ?? null) as ServerAuthContext | null;
  return maybeContext && maybeContext.userId ? maybeContext : null;
}

export function requireBearerAuth() {
  return async function handleAuth(req: Request, res: Response, next: NextFunction) {
    const authorization = req.header('Authorization') || req.header('authorization');
    const [, token] = /^Bearer\s+(.+)$/i.exec(authorization || '') || [];

    if (!token) {
      res.status(401).json({ error: authErrorMap.missingToken });
      return;
    }

    const apiTokenContext = getApiTokenAuthContext(token);
    if (apiTokenContext) {
      res.locals.serverAuthContext = apiTokenContext;
      next();
      return;
    }

    const { client, error } = ensureServerAuthClient();
    if (!client) {
      res.status(503).json({ error });
      return;
    }

    const { data, error: authError } = await client.auth.getUser(token);
    if (authError || !data?.user?.id) {
      res.status(401).json({ error: authErrorMap.invalidToken });
      return;
    }

    res.locals.serverAuthContext = {
      userId: data.user.id,
      email: data.user.email,
      username: deriveUsername(data.user),
      accessToken: token
    };
    next();
  };
}

function getApiTokenAuthContext(token: string): ServerAuthContext | null {
  const configured = readStringEnv('SERVER_API_TOKEN') || readStringEnv('ADMIN_API_TOKEN');
  if (!configured || configured !== token) return null;
  return {
    userId: 'server-api-token',
    email: null,
    username: 'Server API Token',
    accessToken: token
  };
}

function readStringEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function getAuthSession(req: Request, res: Response) {
  if (!req.header('authorization')) {
    res.status(401).json({ authenticated: false, error: authErrorMap.missingToken });
    return;
  }

  const { client, error } = ensureServerAuthClient();
  if (!client) {
    res.status(503).json({ error });
    return;
  }

  const context = getAuthContext(res);
  if (context) {
    res.json({
      authenticated: true,
      user: { id: context.userId, email: context.email ?? null, username: context.username ?? null, accessToken: context.accessToken }
    });
    return;
  }

  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data, error: authError } = await client.auth.getUser(token);
  if (authError || !data?.user?.id) {
    res.status(401).json({ authenticated: false, error: authErrorMap.invalidToken });
    return;
  }

  res.json({
    authenticated: true,
    user: { id: data.user.id, email: data.user.email, username: deriveUsername(data.user), accessToken: token }
  });
}

function deriveUsername(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }): string | null {
  const metadata = user.user_metadata ?? {};
  const candidates = [metadata.user_name, metadata.preferred_username, metadata.name, metadata.full_name, user.email];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function deriveCallbackUrl(serverPublicUrl: string) {
  const normalized = serverPublicUrl.endsWith('/') ? serverPublicUrl.slice(0, -1) : serverPublicUrl;
  return `${normalized}/api/auth/github/callback`;
}

function getServerCallbackBase(req: Request) {
  if (process.env.SERVER_PUBLIC_URL) return process.env.SERVER_PUBLIC_URL;
  const forwardedProtocol = req.get('x-forwarded-proto');
  const host = req.get('x-forwarded-host') || req.get('host');
  const scheme = forwardedProtocol || req.protocol || 'http';
  return host ? `${scheme}://${host}` : 'http://localhost:8787';
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '[::1]' || normalized === '::1' || normalized === '0.0.0.0' || normalized.startsWith('127.');
}

function normalizeOAuthReturnTo(requestedReturnTo: string, serverPublicUrl: string) {
  if (!requestedReturnTo) return '';

  try {
    const requested = new URL(requestedReturnTo);
    if (requested.protocol === 'tauri:' && requested.hostname === 'localhost') {
      return requested.toString();
    }
    if (requested.protocol === 'elephant-pod:' && requested.hostname === 'auth') {
      return requested.toString();
    }
    if (!['http:', 'https:'].includes(requested.protocol)) return '';

    const publicBase = new URL(serverPublicUrl);
    if (isLoopbackHostname(requested.hostname) || requested.origin === publicBase.origin) {
      return requested.toString();
    }

    return '';
  } catch {
    return '';
  }
}

function renderImplicitCallbackBridge(returnTo: string) {
  const returnToJson = JSON.stringify(returnTo);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Completing sign in...</title>
</head>
<body>
  <p>Completing sign in...</p>
  <script>
    (function () {
      var returnTo = ${returnToJson};
      var hashParams = new URLSearchParams(window.location.hash.slice(1));
      var searchParams = new URLSearchParams(window.location.search);
      var accessToken = hashParams.get('access_token') || searchParams.get('access_token');
      if (!accessToken || !returnTo) {
        document.body.textContent = 'Missing authorization code.';
        return;
      }

      var target = new URL(returnTo);
      ['access_token', 'refresh_token', 'expires_at', 'expires_in', 'token_type'].forEach(function (key) {
        var value = hashParams.get(key) || searchParams.get(key);
        if (value) target.searchParams.set(key, value);
      });
      window.location.replace(target.toString());
    })();
  </script>
</body>
</html>`;
}

export async function githubStartHandler(req: Request, res: Response) {
  const serverAuth = getServerAuthConfig();

  if (!serverAuth.isConfigured) {
    res.status(503).json({
      error: authErrorMap.missingConfig,
      ...serverAuth
    });
    return;
  }
  if (!serverAuth.hasProvider) {
    res.status(503).json({
      error: authErrorMap.missingProviderConfig,
      ...serverAuth
    });
    return;
  }

  const { client, error } = ensureServerAuthClient();
  if (!client) {
    res.status(503).json({ error });
    return;
  }

  const serverPublicUrl = getServerCallbackBase(req);
  const requestedReturnTo = firstQueryParam(req.query.returnTo || req.body?.returnTo).trim();
  const returnTo = normalizeOAuthReturnTo(requestedReturnTo, serverPublicUrl);
  const callbackUrl = returnTo
    ? `${deriveCallbackUrl(serverPublicUrl)}?returnTo=${encodeURIComponent(returnTo)}`
    : deriveCallbackUrl(serverPublicUrl);

  const { data, error: startError } = await client.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: callbackUrl,
      skipBrowserRedirect: true
    }
  });

  if (startError || !data?.url) {
    res.status(502).json({
      error: `Failed to create GitHub OAuth URL: ${startError?.message ?? 'empty authorization URL'}`
    });
    return;
  }

  res.json({
    authUrl: data.url,
    authorizationUrl: data.url,
    provider: 'github',
    callbackUrl,
    returnTo: returnTo || null,
    method: requestedReturnTo ? 'implicit-client-callback' : 'server-callback'
  });
}

function firstQueryParam(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.length > 0 ? firstQueryParam(value[0]) : '';
  }
  if (typeof value === 'object') return '';
  return '';
}

export async function githubCallbackHandler(req: Request, res: Response) {
  const {
    code,
    error: queryError,
    access_token: accessToken,
    refresh_token: refreshToken,
    returnTo: queryReturnTo,
    error_description: errorDescription,
    error_code: errorCode
  } = req.query;
  const requestedReturnTo = firstQueryParam(queryReturnTo).trim();
  const returnTo = normalizeOAuthReturnTo(requestedReturnTo, getServerCallbackBase(req));
  const callbackError = firstQueryParam(queryError);
  if (callbackError.length > 0) {
    res.status(400).json({
      error: `GitHub callback error: ${callbackError}`,
      details: firstQueryParam(errorDescription) || firstQueryParam(errorCode) || 'auth_error'
    });
    return;
  }

  const authCode = firstQueryParam(code).trim();
  if (authCode.length === 0) {
    const token = firstQueryParam(accessToken);
    if (typeof token === 'string' && token.length > 0) {
      const { client } = ensureServerAuthClient();
      if (!client) {
        res.status(503).json({ error: authErrorMap.missingConfig });
        return;
      }

      const { data, error: tokenError } = await client.auth.getUser(token);
      if (tokenError || !data?.user?.id) {
        res.status(401).json({ error: authErrorMap.invalidToken, details: authErrorMap.authExchangeFailed });
        return;
      }

      const response = {
        provider: 'github',
        user: { id: data.user.id, email: data.user.email, username: deriveUsername(data.user) },
        session: {
          access_token: token,
          refresh_token: firstQueryParam(refreshToken),
          expires_in: null,
          token_type: 'bearer'
        },
        flow: 'implicit'
      };
      if (returnTo) {
        res.redirect(302, buildClientReturnUrl(returnTo, response.session));
        return;
      }
      res.json(response);
      return;
    }

    if (returnTo) {
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(renderImplicitCallbackBridge(returnTo));
      return;
    }

    res.status(400).json({
      error: 'Missing authorization code.',
      message: 'If this callback receives an implicit-flow token, append access_token and refresh_token as query params.',
      action: 'POST that token payload to your app auth/session bootstrap path.'
    });
    return;
  }

  const { client, error } = ensureServerAuthClient();
  if (!client) {
    res.status(503).json({ error });
    return;
  }

  const { data, error: exchangeError } = await client.auth.exchangeCodeForSession(authCode);
  if (exchangeError || !data?.session?.user) {
    res.status(401).json({
      error: authErrorMap.authExchangeFailed,
      details: exchangeError?.message ?? 'No session returned from Supabase.',
      action: 'Use the authorizationUrl returned by /api/auth/github/start with a browser callback and pass tokens back to the client.'
    });
    return;
  }

  const response = {
    provider: 'github',
    flow: 'pkce-server',
    user: {
      id: data.session.user.id,
      email: data.session.user.email,
      username: deriveUsername(data.session.user)
    },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      token_type: data.session.token_type,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at
    }
  };
  if (returnTo) {
    res.redirect(302, buildClientReturnUrl(returnTo, response.session));
    return;
  }
  res.json(response);
}

function buildClientReturnUrl(returnTo: string, session: { access_token: string; refresh_token?: string | null; expires_at?: number | null; expires_in?: number | null }) {
  const url = new URL(returnTo);
  url.searchParams.set('access_token', session.access_token);
  if (session.refresh_token) url.searchParams.set('refresh_token', session.refresh_token);
  if (typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)) {
    url.searchParams.set('expires_at', String(session.expires_at));
  }
  if (typeof session.expires_in === 'number' && Number.isFinite(session.expires_in)) {
    url.searchParams.set('expires_in', String(session.expires_in));
  }
  url.searchParams.set('token_type', 'bearer');
  return url.toString();
}
