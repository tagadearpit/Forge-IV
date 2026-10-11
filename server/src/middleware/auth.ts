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
