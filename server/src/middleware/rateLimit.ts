import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const json = (code: string, message: string) => ({ error: { code, message } });

/** Generous limiter for general API traffic. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json(json('RATE_LIMITED', 'Too many requests. Please slow down.')),
});

/**
 * Strict limiter on credential endpoints to blunt brute-force attempts.
 * Keyed by IP + submitted email so one attacker cannot lock out a whole NAT.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isProd ? 10 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = (req.body?.email ?? '').toString().toLowerCase().slice(0, 120);
    return `${req.ip}:${email}`;
  },
  handler: (_req, res) =>
    res
      .status(429)
      .json(json('AUTH_RATE_LIMITED', 'Too many attempts. Try again in a few minutes.')),
});

/** Ingestion and generation are expensive; cap them separately. */
export const heavyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res
      .status(429)
      .json(json('HEAVY_RATE_LIMITED', 'That is a lot of work at once. Please wait a moment.')),
});
