import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requireServerServiceAccess } from './auth.js';
import { __authTestHooks, handleAppleSignIn } from './appleAuth.js';

describe('native iOS service access', () => {
  it('rejects protected native service requests without an Apple account session', async () => {
    const result = await invokeServerServiceAccess({
      'x-daisypod-client': 'ios',
      'x-daisypod-native-account': 'icloud'
    });

    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.json, { error: 'Sign in with Apple is required.' });
  });

  it('can allow discovery requests with native headers', async () => {
    const result = await invokeDiscoveryServiceAccess({
      'x-daisypod-client': 'ios',
      'x-daisypod-native-account': 'icloud'
    });

    assert.equal(result.nextCalled, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.locals.serverAuthContext.userId, '00000000-0000-4000-8000-000000000002');
  });

  it('rejects retired elephant header names', async () => {
    const result = await invokeServerServiceAccess({
      'x-elephant-client': 'ios',
      'x-elephant-native-account': 'icloud'
    });

    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.json, { error: 'Sign in with Apple is required.' });
  });

  it('rejects bearer-only requests instead of accepting legacy product login', async () => {
    const result = await invokeServerServiceAccess({
      authorization: 'Bearer old-session-token'
    });

    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.json, { error: 'Sign in with Apple is required.' });
  });

  it('does not run auth schema DDL while checking bearer sessions', async () => {
    const sqlStatements: string[] = [];
    const restore = __authTestHooks.setDependencies({
      queryDatabase: async <T = Record<string, unknown>>(sql: string): Promise<T[] | null> => {
        sqlStatements.push(sql);
        return [];
      }
    });

    try {
      const result = await invokeServerServiceAccess({
        authorization: 'Bearer old-session-token'
      });

      assert.equal(result.nextCalled, false);
      assert.equal(result.statusCode, 401);
      assert.deepEqual(result.json, { error: 'Sign in with Apple is required.' });
      assert.equal(sqlStatements.length, 1);
      assert.match(sqlStatements[0], /update public\.daisy_sessions/);
      assert.doesNotMatch(sqlStatements.join('\n'), /\bcreate\s+(extension|table|index)\b/i);
    } finally {
      restore();
    }
  });

  it('reports the typed database error when Apple sign-in cannot create a session', async () => {
    const restore = __authTestHooks.setDependencies({
      verifyAppleIdentityToken: async () => ({
        iss: 'https://appleid.apple.com',
        aud: 'com.elephanthand.daisypod',
        exp: Math.floor(Date.now() / 1000) + 300,
        sub: 'apple-test-sub',
        email: 'listener@example.com',
        email_verified: true
      }),
      withDatabaseTransaction: async () => null
    });

    try {
      const result = await invokeAppleSignIn({
        identityToken: 'test.identity.token.value'
      });

      assert.equal(result.statusCode, 503);
      assert.deepEqual(result.json, {
        error: 'Apple sign-in needs the server database.',
        code: 'server_database_unavailable',
        details: undefined
      });
    } finally {
      restore();
    }
  });
});

async function invokeServerServiceAccess(headers: Record<string, string | undefined>) {
  return invokeMiddleware(requireServerServiceAccess(), headers);
}

async function invokeDiscoveryServiceAccess(headers: Record<string, string | undefined>) {
  return invokeMiddleware(requireServerServiceAccess({ allowNativeHeaders: true }), headers);
}

async function invokeMiddleware(
  middleware: ReturnType<typeof requireServerServiceAccess>,
  headers: Record<string, string | undefined>
) {
  let statusCode = 200;
  let json: unknown = null;
  let nextCalled = false;
  const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const req = {
    header(name: string) {
      return normalizedHeaders[name.toLowerCase()] ?? headers[name];
    }
  };
  const res = {
    locals: {} as Record<string, any>,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      json = value;
      return this;
    }
  };

  await middleware(req as any, res as any, () => {
    nextCalled = true;
  });

  return { statusCode, json, nextCalled, locals: res.locals };
}

async function invokeAppleSignIn(body: Record<string, unknown>) {
  let statusCode = 200;
  let json: unknown = null;
  const req = { body };
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      json = value;
      return this;
    }
  };

  await handleAppleSignIn(req as any, res as any);

  return { statusCode, json };
}
