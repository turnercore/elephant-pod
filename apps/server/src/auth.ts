import type { NextFunction, Request, Response } from 'express';

const nativeServiceUserId = '00000000-0000-4000-8000-000000000002';

export type ServerAuthContext = {
  userId: string;
  email?: string | null;
  username?: string | null;
  accessToken: string;
};

export function getAuthContext(res: Response): ServerAuthContext | null {
  const maybeContext = (res.locals?.serverAuthContext ?? null) as ServerAuthContext | null;
  return maybeContext && maybeContext.userId ? maybeContext : null;
}

export function requireServerServiceAccess() {
  return function handleServerServiceAccess(req: Request, res: Response, next: NextFunction) {
    if (!isNativeIOSServiceRequest(req)) {
      res.status(401).json({ error: 'Native iOS app access is required.' });
      return;
    }

    res.locals.serverAuthContext = {
      userId: nativeServiceUserId,
      email: null,
      username: 'DaisyPod Native App',
      accessToken: 'native-ios'
    };
    next();
  };
}

function isNativeIOSServiceRequest(req: Request) {
  return req.header('x-daisypod-client')?.toLowerCase() === 'ios'
    && req.header('x-daisypod-native-account')?.toLowerCase() === 'icloud'
    && hasNativeAppAccess(req);
}

function hasNativeAppAccess(req: Request) {
  const configured = readStringEnv('SERVER_NATIVE_APP_TOKEN') || readStringEnv('NATIVE_APP_TOKEN');
  if (!configured) return true;
  return req.header('x-daisypod-app-token') === configured;
}

function readStringEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
