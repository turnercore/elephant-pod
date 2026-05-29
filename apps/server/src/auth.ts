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
    if (!['http:', 'https:'].includes(requested.protocol)) return '';

    const publicBase = new URL(serverPublicUrl);
    if (isLoopbackHostname(requested.hostname) && !isLoopbackHostname(publicBase.hostname)) {
      requested.protocol = publicBase.protocol;
      requested.host = publicBase.host;
      return requested.toString();
    }

    return requested.toString();
  } catch {
    return '';
  }
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
  const callbackUrl = normalizeOAuthReturnTo(requestedReturnTo, serverPublicUrl) || deriveCallbackUrl(serverPublicUrl);

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
    error_description: errorDescription,
    error_code: errorCode
  } = req.query;
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

      res.json({
        provider: 'github',
        user: { id: data.user.id, email: data.user.email, username: deriveUsername(data.user) },
        session: {
          access_token: token,
          refresh_token: firstQueryParam(refreshToken),
          expires_in: null,
          token_type: 'bearer'
        },
        flow: 'implicit'
      });
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

  res.json({
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
  });
}
