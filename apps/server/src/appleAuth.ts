import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import * as database from './database.js';

const appleIssuer = 'https://appleid.apple.com';
const appleJwksUrl = 'https://appleid.apple.com/auth/keys';
const defaultAppleAudience = 'com.elephanthand.daisypod';
const sessionTokenBytes = 32;

type AppleJwk = Record<string, unknown> & {
  kid?: string;
  alg?: string;
};

type AppleClaims = {
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  sub: string;
  email?: string;
  email_verified?: string | boolean;
};

class AppleAuthError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, code: string, statusCode = 401, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppleAuthError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

type DaisySessionRow = {
  session_id: string;
  account_id: string;
  email: string | null;
  created_at: string;
};

export type AppleSessionAuthContext = {
  userId: string;
  email?: string | null;
  username?: string | null;
  accessToken: string;
};

const appleSignInSchema = z.object({
  identityToken: z.string().min(20),
  authorizationCode: z.string().optional()
});

type AuthDependencies = {
  queryDatabase: typeof database.queryDatabase;
  withDatabaseTransaction: typeof database.withDatabaseTransaction;
  verifyAppleIdentityToken: typeof verifyAppleIdentityToken;
};

const defaultAuthDependencies: AuthDependencies = {
  queryDatabase: database.queryDatabase,
  withDatabaseTransaction: database.withDatabaseTransaction,
  verifyAppleIdentityToken
};

const authDependencies: AuthDependencies = { ...defaultAuthDependencies };

export const __authTestHooks = {
  setDependencies(overrides: Partial<AuthDependencies>) {
    Object.assign(authDependencies, overrides);
    return () => {
      Object.assign(authDependencies, defaultAuthDependencies);
    };
  }
};

export async function handleAppleSignIn(req: Request, res: Response) {
  const parsed = appleSignInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Apple sign-in request.', details: parsed.error.flatten() });
    return;
  }

  try {
    const claims = await authDependencies.verifyAppleIdentityToken(parsed.data.identityToken);
    const session = await createAccountSession(claims);
    res.status(201).json(session);
  } catch (error) {
    if (error instanceof AppleAuthError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code, details: error.details });
      return;
    }
    console.error('Apple sign-in exchange failed:', error);
    res.status(500).json({ error: 'Apple sign-in server exchange failed.', code: 'server_exchange_failed' });
  }
}

function safeParseJwtSegment<T>(value: string, code: string): T {
  try {
    return JSON.parse(base64urlDecode(value).toString('utf8')) as T;
  } catch (error) {
    throw new AppleAuthError('Apple identity token could not be decoded.', code);
  }
}

export async function handleSession(req: Request, res: Response) {
  const auth = await getBearerSessionAuthContext(req);
  if (!auth) {
    res.status(401).json({ error: 'Sign in with Apple is required.' });
    return;
  }

  res.json({
    account: {
      id: auth.userId,
      email: auth.email ?? null
    }
  });
}

export async function handleSignOut(req: Request, res: Response) {
  const token = readBearerToken(req);
  if (token) {
    await revokeSession(token);
  }
  res.status(204).send();
}

export async function getBearerSessionAuthContext(req: Request): Promise<AppleSessionAuthContext | null> {
  const token = readBearerToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await authDependencies.queryDatabase<{
    session_id: string;
    account_id: string;
    email: string | null;
  }>(
    `update public.daisy_sessions session
      set last_seen_at = now()
      from public.daisy_accounts account
      where session.account_id = account.id
        and session.token_hash = $1
        and session.revoked_at is null
      returning session.id as session_id, account.id as account_id, account.email as email`,
    [tokenHash]
  );
  const row = rows?.[0];
  if (!row) return null;
  await authDependencies.queryDatabase('update public.daisy_accounts set last_seen_at = now() where id = $1', [row.account_id]);
  return {
    userId: row.account_id,
    email: row.email,
    username: 'DaisyPod Apple Account',
    accessToken: token
  };
}

export async function verifyAppleIdentityToken(identityToken: string): Promise<AppleClaims> {
  const [encodedHeader, encodedPayload, encodedSignature] = identityToken.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new AppleAuthError('Invalid Apple identity token.', 'invalid_identity_token');
  }

  const header = safeParseJwtSegment<{ alg?: string; kid?: string }>(encodedHeader, 'invalid_identity_token_header');
  if (header.alg !== 'RS256' || !header.kid) {
    throw new AppleAuthError('Unsupported Apple identity token.', 'unsupported_identity_token');
  }

  const claims = safeParseJwtSegment<AppleClaims>(encodedPayload, 'invalid_identity_token_payload');
  const key = (await fetchAppleKeys()).find((candidate) => candidate.kid === header.kid);
  if (!key) throw new AppleAuthError('Apple identity token key is not recognized.', 'unknown_identity_token_key');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const publicKey = crypto.createPublicKey({ key: key as crypto.JsonWebKey, format: 'jwk' });
  if (!verifier.verify(publicKey, base64urlDecode(encodedSignature))) {
    throw new AppleAuthError('Apple identity token signature is invalid.', 'invalid_identity_token_signature');
  }

  validateAppleClaims(claims);
  return claims;
}

async function createAccountSession(claims: AppleClaims) {
  const accessToken = crypto.randomBytes(sessionTokenBytes).toString('base64url');
  const tokenHash = hashToken(accessToken);
  let rows: DaisySessionRow[] | null;
  try {
    rows = await authDependencies.withDatabaseTransaction<DaisySessionRow[]>(async (query) => {
      const accounts = await query<{
        id: string;
        email: string | null;
      }>(
        `insert into public.daisy_accounts (apple_sub, email, email_verified, last_seen_at)
          values ($1, $2, $3, now())
          on conflict (apple_sub) do update set
            email = coalesce(excluded.email, public.daisy_accounts.email),
            email_verified = coalesce(excluded.email_verified, public.daisy_accounts.email_verified),
            updated_at = now(),
            last_seen_at = now()
          returning id, email`,
        [claims.sub, claims.email ?? null, parseEmailVerified(claims.email_verified)]
      );
      const account = accounts[0];
      if (!account) throw new Error('Missing DaisyPod account row.');
      const sessions = await query<DaisySessionRow>(
        `insert into public.daisy_sessions (account_id, token_hash, last_seen_at)
          values ($1, $2, now())
          returning id as session_id, account_id, $3::text as email, created_at`,
        [account.id, tokenHash, account.email]
      );
      return sessions;
    });
  } catch (error) {
    throw serverDatabaseUnavailableError();
  }
  const session = rows?.[0];
  if (!session) {
    throw serverDatabaseUnavailableError();
  }
  return {
    accessToken,
    account: {
      id: session.account_id,
      email: session.email
    },
    createdAt: session.created_at
  };
}

async function revokeSession(token: string) {
  await authDependencies.queryDatabase(
    'update public.daisy_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null',
    [hashToken(token)]
  );
}

function serverDatabaseUnavailableError() {
  return new AppleAuthError('Apple sign-in needs the server database.', 'server_database_unavailable', 503);
}

async function fetchAppleKeys(): Promise<AppleJwk[]> {
  const response = await fetch(appleJwksUrl, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new AppleAuthError('Unable to fetch Apple identity keys.', 'apple_keys_unavailable', 503);
  const payload = await response.json() as { keys?: AppleJwk[] };
  return payload.keys ?? [];
}

function validateAppleClaims(claims: AppleClaims) {
  if (claims.iss !== appleIssuer) throw new AppleAuthError('Apple identity token issuer is invalid.', 'invalid_identity_token_issuer');
  const expectedAudience = process.env.APPLE_SIGN_IN_AUDIENCE || process.env.APPLE_BUNDLE_ID || defaultAppleAudience;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expectedAudience)) {
    throw new AppleAuthError('Apple identity token audience is invalid.', 'invalid_identity_token_audience', 401, {
      expectedAudience,
      tokenAudience: audiences
    });
  }
  if (!claims.sub) throw new AppleAuthError('Apple identity token subject is missing.', 'missing_identity_token_subject');
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSec) {
    throw new AppleAuthError('Apple identity token has expired.', 'expired_identity_token');
  }
}

function parseEmailVerified(value: string | boolean | undefined) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return null;
}

function readBearerToken(req: Request) {
  const value = req.header('authorization') ?? '';
  const [type, token] = value.split(/\s+/, 2);
  return type?.toLowerCase() === 'bearer' && token ? token : null;
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function base64urlDecode(value: string) {
  return Buffer.from(value, 'base64url');
}
