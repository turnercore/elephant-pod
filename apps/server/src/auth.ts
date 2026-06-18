import type { NextFunction, Request, Response } from 'express';
import { getBearerSessionAuthContext } from './appleAuth.js';

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

type ServerServiceAccessOptions = {
  allowNativeHeaders?: boolean;
};

export function requireServerServiceAccess(options: ServerServiceAccessOptions = {}) {
  const allowNativeHeaders = options.allowNativeHeaders ?? false;
  return async function handleServerServiceAccess(req: Request, res: Response, next: NextFunction) {
    const sessionContext = await getBearerSessionAuthContext(req);
    if (sessionContext) {
      res.locals.serverAuthContext = sessionContext;
      next();
      return;
    }

    if (!allowNativeHeaders || !isNativeIOSServiceRequest(req)) {
      res.status(401).json({ error: 'Sign in with Apple is required.' });
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
    && req.header('x-daisypod-native-account')?.toLowerCase() === 'icloud';
}
