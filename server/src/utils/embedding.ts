import crypto from 'node:crypto';
import { contentWords, normalizeForFingerprint } from './text';

export const EMBEDDING_DIM = 256;

/**
 * Deterministic local embedding.
 *
 * This is a hashing vectoriser (the "hashing trick"): word and character-trigram
 * features are hashed into a fixed-width space with signed buckets and L2
 * normalised. It is NOT a learned semantic model, and we do not claim it is —
 * but it produces genuine cosine similarity over lexical overlap, which is
 * enough for the retrieval, dedupe and grounding-threshold mechanics to be
 * exercised for real when no embedding API is configured.
 *
 * With GEMINI_API_KEY set, `embed()` routes to text-embedding-004 instead and
 * this is only used for the duplicate-topic merge heuristic.
 */
export function localEmbed(input: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const text = (input || '').toLowerCase();
  if (!text.trim()) return vec;

  const words = contentWords(text);

  // Unigram bucket with a modest boost, so dominant terms dominate the vector.
  for (const w of words) {
    const h = hash(w);
    const idx = h % EMBEDDING_DIM;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    vec[idx] += sign * (1 + Math.min(w.length, 12) / 12);
  }

  // Bigrams capture a little word order ("neural network" vs "network neural").
  for (let i = 0; i < words.length - 1; i++) {
    const bg = `${words[i]}_${words[i + 1]}`;
    const h = hash(bg);
    const idx = h % EMBEDDING_DIM;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    vec[idx] += sign * 0.75;
  }

  // Character trigrams give partial-credit matching for morphological variants
  // (mitosis / mitotic) that exact word hashing would miss.
  const compact = text.replace(/[^a-z0-9]/g, ' ');
  for (let i = 0; i < compact.length - 3; i++) {
    const tri = compact.slice(i, i + 3);
    if (tri.trim().length < 3) continue;
    const h = hash(tri);
    const idx = h % EMBEDDING_DIM;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    vec[idx] += sign * 0.25;
  }

  return l2Normalize(vec);
}

export function localEmbedBatch(inputs: string[]): number[][] {
  return inputs.map(localEmbed);
}

export function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  if (sumSq === 0) return vec;
  const norm = Math.sqrt(sumSq);
  return vec.map((v) => v / norm);
}

/**
 * Cosine similarity between two vectors that MUST live in the same space.
 *
 * This function deliberately THROWS on a length mismatch. The previous version
 * compared only `min(a.length, b.length)` components, which silently produced
 * meaningless numbers when a 768-dim Gemini vector met a 256-dim hashing vector
 * — the dot product was over unrelated coordinates, so retrieval silently
 * degraded instead of failing loudly. A length mismatch here is always a bug,
 * and callers are expected to filter by dimension BEFORE calling.
 *
 * Use `sameSpace()` to check compatibility, or `safeCosineSimilarity` where a
 * mismatched vector should be treated as "no similarity" rather than fatal.
 */
export function cosineSimilarity(a: number[] | undefined | null, b: number[] | undefined | null): number {
  if (!a || !b) throw new Error('cosineSimilarity: one vector is missing');
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimension mismatch (${a.length} vs ${b.length}). ` +
        `Vectors from different embedding spaces are not comparable.`
    );
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** True when two vectors are safe to compare. */
export function sameSpace(
  a: number[] | undefined | null,
  b: number[] | undefined | null
): boolean {
  return Boolean(a && b && a.length > 0 && a.length === b.length);
}

/**
 * Like `cosineSimilarity`, but a dimension mismatch yields 0 ("no similarity")
 * instead of throwing. For ranking loops over heterogeneous stored data where a
 * single bad vector must not abort the whole request.
 */
export function safeCosineSimilarity(
  a: number[] | undefined | null,
  b: number[] | undefined | null
): number {
  if (!sameSpace(a, b)) return 0;
  return cosineSimilarity(a as number[], b as number[]);
}

/** Stable, order-independent fingerprint for exact/near-exact question dedupe. */
export function fingerprint(text: string): string {
  const normalised = normalizeForFingerprint(text);
  const tokens = normalised.split(' ').filter(Boolean).sort();
  // Jaccard-friendly: sorted token set joined, so word order does not matter.
  return crypto.createHash('sha256').update(tokens.join(' ')).digest('hex').slice(0, 32);
}

function hash(str: string): number {
  // FNV-1a 32-bit — fast, well-distributed, and stable across processes
  // (unlike Math.random or object key ordering).
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}