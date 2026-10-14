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

/**
 * Where uploaded originals live.
 *
 * An explicit UPLOAD_DIR is honoured as given. Without one, the default is
 * anchored to THIS PACKAGE's root rather than process.cwd(), because cwd
 * differs depending on how the server was started:
 *
 *   npm run dev -w server   (tsx src/index.ts)   -> <repo>/server/uploads
 *   node dist/index.js      (from server/)       -> <repo>/server/uploads
 *   node server/dist/index.js (from repo root)   -> <repo>/uploads   <-- was
 *
 * That last case silently created a second, empty uploads directory: the
 * database listed sources whose PDFs were not on disk, and the file route
 * correctly answered FILE_MISSING. Anchoring to the package root makes the
 * location independent of the launch directory.
 */
function serverPackageRoot(): string {
  // __dirname is <pkg>/src/config or <pkg>/dist/config depending on src vs dist,
  // so the package root is always two levels up.
  return path.resolve(__dirname, '..', '..');
}

function resolveUploadDir(): string {
  const explicit = process.env.UPLOAD_DIR;
  if (explicit && explicit !== '') return path.resolve(process.cwd(), explicit);
  return path.join(serverPackageRoot(), 'uploads');
}

const NODE_ENV = str('NODE_ENV', 'development');
// Keep MONGODB_URI as the canonical name, but accept MONGODB_URL for existing
// Render environments that were configured with that variable name.
const mongoUri = str('MONGODB_URI') || str('MONGODB_URL');
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

  MONGODB_URI: mongoUri,
  MONGODB_DB: str('MONGODB_DB', 'studymind'),

  JWT_SECRET: str('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  JWT_EXPIRES_IN: str('JWT_EXPIRES_IN', '7d'),
  BCRYPT_COST: num('BCRYPT_COST', 12),

  GEMINI_API_KEY: geminiKey,
  GEMINI_MODEL: str('GEMINI_MODEL', 'gemini-2.0-flash'),
  GEMINI_EMBED_MODEL: str('GEMINI_EMBED_MODEL', 'gemini-embedding-001'),
  provider,

  UPLOAD_DIR: resolveUploadDir(),
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