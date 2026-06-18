import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { queryDatabase, withDatabaseTransaction } from './database.js';

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

export async function handleAppleSignIn(req: Request, res: Response) {
  const parsed = appleSignInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Apple sign-in request.', details: parsed.error.flatten() });
    return;
  }

  try {
    const claims = await verifyAppleIdentityToken(parsed.data.identityToken);
    const session = await createAccountSession(claims);
    res.status(201).json(session);
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : 'Apple sign-in failed.' });
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
  await ensureAuthSchema();
  const rows = await queryDatabase<{
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
  await queryDatabase('update public.daisy_accounts set last_seen_at = now() where id = $1', [row.account_id]);
  return {
    userId: row.account_id,
    email: row.email,
    username: 'DaisyPod Apple Account',
    accessToken: token
  };
}

export async function verifyAppleIdentityToken(identityToken: string): Promise<AppleClaims> {
  const [encodedHeader, encodedPayload, encodedSignature] = identityToken.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('Invalid Apple identity token.');

  const header = JSON.parse(base64urlDecode(encodedHeader).toString('utf8')) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Apple identity token.');

  const claims = JSON.parse(base64urlDecode(encodedPayload).toString('utf8')) as AppleClaims;
  const key = (await fetchAppleKeys()).find((candidate) => candidate.kid === header.kid);
  if (!key) throw new Error('Apple identity token key is not recognized.');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const publicKey = crypto.createPublicKey({ key: key as crypto.JsonWebKey, format: 'jwk' });
  if (!verifier.verify(publicKey, base64urlDecode(encodedSignature))) {
    throw new Error('Apple identity token signature is invalid.');
  }

  validateAppleClaims(claims);
  return claims;
}

async function createAccountSession(claims: AppleClaims) {
  const accessToken = crypto.randomBytes(sessionTokenBytes).toString('base64url');
  const tokenHash = hashToken(accessToken);
  await ensureAuthSchema();
  const rows = await withDatabaseTransaction<DaisySessionRow[]>(async (query) => {
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
    const sessions = await query<DaisySessionRow>(
      `insert into public.daisy_sessions (account_id, token_hash, last_seen_at)
        values ($1, $2, now())
        returning id as session_id, account_id, $3::text as email, created_at::text`,
      [account.id, tokenHash, account.email]
    );
    return sessions;
  });
  const session = rows?.[0];
  if (!session) throw new Error('Apple sign-in needs the server database.');
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
  await ensureAuthSchema();
  await queryDatabase(
    'update public.daisy_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null',
    [hashToken(token)]
  );
}

async function ensureAuthSchema() {
  await queryDatabase('create extension if not exists pgcrypto');
  await queryDatabase(`
    create table if not exists public.daisy_accounts (
      id uuid primary key default gen_random_uuid(),
      apple_sub text not null unique,
      email text,
      email_verified boolean,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_seen_at timestamptz
    )`);
  await queryDatabase(`
    create table if not exists public.daisy_sessions (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null references public.daisy_accounts(id) on delete cascade,
      token_hash text not null unique,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz,
      revoked_at timestamptz
    )`);
  await queryDatabase('create index if not exists idx_daisy_sessions_account on public.daisy_sessions(account_id, created_at desc)');
}

async function fetchAppleKeys(): Promise<AppleJwk[]> {
  const response = await fetch(appleJwksUrl, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Unable to fetch Apple identity keys.');
  const payload = await response.json() as { keys?: AppleJwk[] };
  return payload.keys ?? [];
}

function validateAppleClaims(claims: AppleClaims) {
  if (claims.iss !== appleIssuer) throw new Error('Apple identity token issuer is invalid.');
  const expectedAudience = process.env.APPLE_SIGN_IN_AUDIENCE || process.env.APPLE_BUNDLE_ID || defaultAppleAudience;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expectedAudience)) throw new Error('Apple identity token audience is invalid.');
  if (!claims.sub) throw new Error('Apple identity token subject is missing.');
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSec) throw new Error('Apple identity token has expired.');
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
