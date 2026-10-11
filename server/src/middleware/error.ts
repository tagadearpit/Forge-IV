import type { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

/** Uniform error envelope: every failure returns { error: { code, message } }. */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' },
  });
}

/**
 * Terminal error handler. Anything thrown that is not an ApiError is treated as
 * an unexpected fault and logged, but the client still receives a structured
 * JSON body rather than a stack trace or a blank response.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
    return;
  }

  const anyErr = err as { code?: string; message?: string; status?: number; name?: string };

  // An invalid :id param surfaces as a mongoose CastError. That is a client
  // mistake, not a server fault — returning 500 here made a typo'd URL look
  // like a crash.
  if (anyErr?.name === 'CastError') {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'That identifier is not valid.' },
    });
    return;
  }

  // Multer surfaces upload problems with a `code` property.
  if (anyErr?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      error: { code: 'FILE_TOO_LARGE', message: 'That file exceeds the maximum upload size.' },
    });
    return;
  }
  if (typeof anyErr?.code === 'string' && anyErr.code.startsWith('LIMIT_')) {
    res.status(400).json({
      error: { code: anyErr.code, message: 'That upload was rejected. Try a different file.' },
    });
    return;
  }

  console.error('[unhandled]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
    },
  });
}

/** Wraps an async handler so rejected promises reach the error handler. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => any>(
  fn: T
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Validates and REPLACES req.body with the parsed (coerced, stripped) value. */
export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      next(
        new ApiError(
          422,
          'VALIDATION_ERROR',
          fieldErrors._ ?? 'Some fields need attention.',
          { fieldErrors }
        )
      );
      return;
    }
    req.body = result.data;
    next();
  };
}