import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { requireServerServiceAccess } from './auth.js';

const originalServerNativeAppToken = process.env.SERVER_NATIVE_APP_TOKEN;
const originalNativeAppToken = process.env.NATIVE_APP_TOKEN;

afterEach(() => {
  restoreEnv('SERVER_NATIVE_APP_TOKEN', originalServerNativeAppToken);
  restoreEnv('NATIVE_APP_TOKEN', originalNativeAppToken);
});

describe('native iOS service access', () => {
  it('accepts iOS service requests that pass the native service header contract', async () => {
    const result = await invokeServerServiceAccess({
      'x-daisypod-client': 'ios',
      'x-daisypod-native-account': 'icloud'
    });

    assert.equal(result.nextCalled, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.locals.serverAuthContext.userId, '00000000-0000-4000-8000-000000000002');
    assert.equal(result.locals.serverAuthContext.username, 'DaisyPod Native App');
  });

  it('rejects native-looking service requests when the configured app token is missing', async () => {
    process.env.SERVER_NATIVE_APP_TOKEN = 'private-native-token';

    const result = await invokeServerServiceAccess({
      'x-daisypod-client': 'ios',
      'x-daisypod-native-account': 'icloud'
    });

    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.json, { error: 'Native iOS app access is required.' });
  });

  it('rejects native-looking service requests when the configured app token is wrong', async () => {
    process.env.SERVER_NATIVE_APP_TOKEN = 'private-native-token';

    const result = await invokeServerServiceAccess({
      'x-daisypod-client': 'ios',
      'x-daisypod-native-account': 'icloud',
      'x-daisypod-app-token': 'wrong-token'
    });

    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.json, { error: 'Native iOS app access is required.' });
  });

  it('accepts native service requests with the configured app token', async () => {
    process.env.SERVER_NATIVE_APP_TOKEN = 'private-native-token';

    const result = await invokeServerServiceAccess({
      'x-daisypod-client': 'ios',
      'x-daisypod-native-account': 'icloud',
      'x-daisypod-app-token': 'private-native-token'
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
    assert.deepEqual(result.json, { error: 'Native iOS app access is required.' });
  });

  it('rejects bearer-only requests instead of accepting legacy product login', async () => {
    const result = await invokeServerServiceAccess({
      authorization: 'Bearer old-session-token'
    });

    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.json, { error: 'Native iOS app access is required.' });
  });
});

async function invokeServerServiceAccess(headers: Record<string, string | undefined>) {
  return invokeMiddleware(requireServerServiceAccess(), headers);
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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
