import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

const defaultMessage = 'PDF generation is limited to five reports per minute.';

/** A single shared limiter for both explicit PDF exports and tutor-chat PDFs. */
export function createPdfRateLimiter(options: { windowMs?: number; limit?: number } = {}) {
  const middleware = rateLimit({
    windowMs: options.windowMs ?? 60_000,
    limit: options.limit ?? 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: defaultMessage } }),
  });

  /** Apply the same Express limiter inside /ask only after deterministic PDF intent resolution. */
  const consume = (req: Request, res: Response): Promise<boolean> => new Promise((resolve, reject) => {
    let settled = false;
    const onFinish = () => {
      if (settled) return;
      settled = true;
      resolve(false);
    };
    res.once('finish', onFinish);
    middleware(req, res, (err?: unknown) => {
      if (settled) return;
      settled = true;
      res.off('finish', onFinish);
      if (err) reject(err);
      else resolve(true);
    });
  });

  return { middleware, consume };
}
