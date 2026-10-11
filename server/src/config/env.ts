import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config(); // never throw if .env is absent (Replit injects env directly)

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const NODE_ENV = str('NODE_ENV', 'development');
const geminiKey = str('GEMINI_API_KEY');
const forced = str('AI_PROVIDER').toLowerCase();

/**
 * Provider selection order:
 *   1. explicit AI_PROVIDER override
 *   2. gemini when GEMINI_API_KEY is present
 *   3. local deterministic provider (offline, no fabricated answers)
 */
const provider: 'gemini' | 'local' =
  forced === 'gemini' || forced === 'local'
    ? forced
    : geminiKey
      ? 'gemini'
      : 'local';

export const env = {
  NODE_ENV,
  isProd: NODE_ENV === 'production',
  PORT: num('PORT', 3001),
  CLIENT_ORIGIN: str('CLIENT_ORIGIN', 'http://localhost:3000'),

  MONGODB_URI: str('MONGODB_URI'),
  MONGODB_DB: str('MONGODB_DB', 'studymind'),

  JWT_SECRET: str('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  JWT_EXPIRES_IN: str('JWT_EXPIRES_IN', '7d'),
  BCRYPT_COST: num('BCRYPT_COST', 12),

  GEMINI_API_KEY: geminiKey,
  GEMINI_MODEL: str('GEMINI_MODEL', 'gemini-2.0-flash'),
  GEMINI_EMBED_MODEL: str('GEMINI_EMBED_MODEL', 'text-embedding-004'),
  provider,

  UPLOAD_DIR: path.resolve(process.cwd(), str('UPLOAD_DIR', 'uploads')),
  MAX_UPLOAD_MB: num('MAX_UPLOAD_MB', 100),

  RETRIEVAL_TOP_K: num('RETRIEVAL_TOP_K', 8),
  // Grounding gate: grounded if EITHER signal passes. See services/rag.ts and
  // utils/vectorSpace.ts for the methodology.
  //
  // Thresholds are PER PROVIDER because the local hashing vectoriser and Gemini
  // produce different similarity distributions — one shared number cannot be
  // correct for both. GROUNDING_SIMILARITY_THRESHOLD is retained as a legacy
  // override for backward compatibility with older .env files.
  GROUNDING_SIMILARITY_THRESHOLD: str('GROUNDING_SIMILARITY_THRESHOLD'),
  GROUNDING_SIMILARITY_THRESHOLD_LEGACY: str('GROUNDING_SIMILARITY_THRESHOLD_LEGACY'),
  GROUNDING_LEXICAL_THRESHOLD: str('GROUNDING_LEXICAL_THRESHOLD'),
} as const;

/**
 * Production refuses to boot with a weak signing key. A predictable JWT secret
 * lets anyone mint tokens for any user, so this fails fast rather than
 * degrading quietly.
 */
if (env.isProd) {
  const secret = env.JWT_SECRET;
  const weak =
    secret === 'dev-only-insecure-secret-change-me' ||
    /change-?me/i.test(secret) ||
    secret.length < 32;
  if (weak) {
    throw new Error(
      'JWT_SECRET is not acceptable in production. It must NOT be the dev default, ' +
        'must not contain "change-me", and must be at least 32 characters. ' +
        'Generate one with: openssl rand -hex 32'
    );
  }
}