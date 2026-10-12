import { env } from '../config/env.js';
import { EMBEDDING_DIM } from './embedding.js';

/**
 * ============================================================================
 * Vector-space descriptor
 * ============================================================================
 * Embeddings are only comparable within the space that produced them. This
 * module is the single place that answers "which space are we in?" and "what
 * similarity threshold applies to it?", so no service has to guess.
 *
 * The failure this exists to prevent: `retrieveUnits()` embedding the query
 * with the LOCAL hashing vectoriser while the stored units carried Gemini
 * vectors. cosineSimilarity compared the first 256 of 768 unrelated
 * components and returned noise, so retrieval silently returned garbage
 * instead of failing.
 */

export type EmbeddingProvider = 'gemini' | 'local';

/** Dimension the local hashing vectoriser emits. */
export const LOCAL_EMBEDDING_DIM = EMBEDDING_DIM;

/** Dimension `text-embedding-004` emits. */
export const GEMINI_EMBEDDING_DIM = 768;

export interface VectorSpace {
  provider: EmbeddingProvider;
  dim: number;
}

let cached: VectorSpace | null = null;

/** The space the currently-active provider embeds into. */
export function activeSpace(): VectorSpace {
  if (cached) return cached;
  cached =
    env.provider === 'gemini'
      ? { provider: 'gemini', dim: GEMINI_EMBEDDING_DIM }
      : { provider: 'local', dim: LOCAL_EMBEDDING_DIM };
  return cached;
}

/** Test seam: forces the active space. */
export function __setActiveSpace(space: VectorSpace | null): void {
  cached = space;
}

/**
 * Grounding thresholds are provider-specific: the hashing vectoriser produces a
 * different similarity distribution from Gemini's, so one shared number cannot
 * be correct for both. Legacy `GROUNDING_SIMILARITY_THRESHOLD` is honoured as an
 * override for backward compatibility.
 */
export function groundingThresholds(): {
  similarity: number;
  lexical: number;
  /** True when the value came from the legacy fallback rather than the per-provider setting. */
  fromLegacyFallback: boolean;
} {
  const legacy = numOrNull(env.GROUNDING_SIMILARITY_THRESHOLD_LEGACY ?? env.GROUNDING_SIMILARITY_THRESHOLD);

  // Branch on the ACTIVE SPACE, not the static env value: the active space is
  // the single source of truth (and is what tests can override).
  if (activeSpace().provider === 'gemini') {
    const sim = numOrNull(process.env.GROUNDING_SIMILARITY_THRESHOLD_GEMINI);
    const lex = numOrNull(process.env.GROUNDING_LEXICAL_THRESHOLD_GEMINI);
    if (sim === null) {
      // No Gemini calibration has been run. The local value is NOT a valid
      // substitute: the two spaces have different score distributions. Fail
      // closed (refuse) rather than answer with an uncalibrated gate.
      return { similarity: Number.POSITIVE_INFINITY, lexical: Number.POSITIVE_INFINITY, fromLegacyFallback: false };
    }
    return { similarity: sim, lexical: lex ?? 0, fromLegacyFallback: false };
  }

  const sim = numOrNull(process.env.GROUNDING_SIMILARITY_THRESHOLD_LOCAL);
  const lex = numOrNull(process.env.GROUNDING_LEXICAL_THRESHOLD_LOCAL);
  if (sim !== null) return { similarity: sim, lexical: lex ?? 0.55, fromLegacyFallback: false };
  if (legacy !== null) return { similarity: legacy, lexical: 0.55, fromLegacyFallback: true };
  return { similarity: 0.17, lexical: 0.55, fromLegacyFallback: false };
}

/** Calibration status, surfaced in /api/health and the eval results. */
export function groundingCalibrationStatus(): Record<string, unknown> {
  const geminiSet = numOrNull(process.env.GROUNDING_SIMILARITY_THRESHOLD_GEMINI) !== null;
  return {
    activeProvider: activeSpace().provider,
    activeSpace: activeSpace(),
    localCalibrated: numOrNull(process.env.GROUNDING_SIMILARITY_THRESHOLD_LOCAL) !== null || legacy() !== null,
    geminiCalibrated: geminiSet,
    note: geminiSet
      ? 'Gemini thresholds calibrated via scripts/calibrate_grounding.ts'
      : 'Gemini thresholds NOT calibrated. Run scripts/calibrate_grounding.ts with GEMINI_API_KEY set.',
  };
}

function legacy(): number | null {
  return numOrNull(env.GROUNDING_SIMILARITY_THRESHOLD_LEGACY ?? env.GROUNDING_SIMILARITY_THRESHOLD);
}

function numOrNull(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}