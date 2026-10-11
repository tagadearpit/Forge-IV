import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './error';

export interface AuthedRequest extends Request {
  userId?: string;
}

interface TokenPayload {
  sub: string;
  email: string;
}

export function signToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export interface FileTokenPayload {
  sub: string;
  sid: string;
  purpose: 'file';
}

/**
 * Short-lived, narrowly-scoped token for <iframe>/<video>/<audio> src URLs.
 *
 * Browsers cannot attach an Authorization header to those tags, so the viewer
 * needs a token in the query string. Using the long-lived login JWT there would
 * leak a 7-day credential into browser history, Referer headers and server
 * logs. This token:
 *   - expires in 5 minutes
 *   - carries purpose:'file' and is rejected by every non-file route
 *   - is bound to one source id (sid), so it cannot fetch another source
 */
export function signFileToken(userId: string, sourceId: string, ttlSeconds = 300): string {
  return jwt.sign({ sub: userId, sid: sourceId, purpose: 'file' }, env.JWT_SECRET, {
    expiresIn: ttlSeconds,
  } as jwt.SignOptions);
}

/** Verifies a file token. Returns the payload, or null if invalid/expired/mis-scoped. */
export function verifyFileToken(
  token: string | undefined,
  sourceId: string
): FileTokenPayload | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as Partial<FileTokenPayload>;
    if (payload.purpose !== 'file') return null;
    if (!payload.sub || !payload.sid) return null;
    // Bound to exactly one source.
    if (String(payload.sid) !== String(sourceId)) return null;
    return { sub: payload.sub, sid: payload.sid, purpose: 'file' };
  } catch {
    return null;
  }
}

/**
 * Requires a valid `Authorization: Bearer <token>` header.
 * Missing / malformed / expired all resolve to a clear 401 so the client can
 * redirect to /login instead of rendering a broken page.
 */
export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new ApiError(401, 'NO_TOKEN', 'You need to be logged in to do that.'));
    return;
  }
  const token = header.slice(7).trim();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    if (!payload?.sub) throw new Error('missing subject');
    req.userId = payload.sub;
    next();
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    next(
      new ApiError(
        401,
        expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        expired
          ? 'Your session expired. Please log in again.'
          : 'Your session is invalid. Please log in again.'
      )
    );
  }
}
