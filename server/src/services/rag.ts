import { Unit } from '../models/Unit.js';
import { Source } from '../models/Source.js';
import { Topic } from '../models/Topic.js';
import { getAIProvider } from '../ai/provider.js';
import { safeCosineSimilarity, localEmbed } from '../utils/embedding.js';
import {
  activeSpace,
  groundingThresholds,
  type VectorSpace,
} from '../utils/vectorSpace.js';
import { contentWords } from '../utils/text.js';
import { env } from '../config/env.js';

/**
 * ============================================================================
 * Retrieval + grounded generation
 * ============================================================================
 * Two guards make hallucination structurally hard rather than merely unlikely:
 *
 *  1. SIMILARITY GATE — if the best retrieved excerpt is below
 *     GROUNDING_SIMILARITY_THRESHOLD we request a separate general-knowledge
 *     answer; it is never blended with cited material.
 *
 *  2. CITATION AUDIT — after generation, every cited unit ID is checked against
 *     the set actually retrieved. Citations that reference a unit we did not
 *     retrieve are stripped and counted. A hallucinated citation is a hard
 *     failure signal, so it can never reach the UI.
 *
 * Both are measurable, which is what the evaluation harness scores.
 */

export interface RetrievedUnit {
  unitId: string;
  sourceId: string;
  text: string;
  similarity: number;
  location: { page?: number; slide?: number; startSec?: number; endSec?: number };
  kind: string;
  sourceTitle: string;
  sourceType: string;
}

export interface Citation {
  unitId: string;
  sourceId: string;
  sourceTitle: string;
  label: string;
  excerpt: string;
  location: RetrievedUnit['location'];
}

export type GroundingStatus = 'full' | 'partial' | 'outside_material';

export interface RetrievedContext {
  unitId: string;
  sourceTitle: string;
  /** FULL unit text. Never the 240-char display excerpt. */
  text: string;
  similarity: number;
  location: RetrievedUnit['location'];
}

export interface TutorAnswer {
  /** Present only when includeContexts was requested. Evaluation-only. */
  retrievedContexts?: RetrievedContext[];
  answer: string;
  citations: Citation[];
  groundingStatus: GroundingStatus;
  outsideKnowledge: string | null;
  language: 'en' | 'hi';
  topSimilarity: number;
  lexicalOverlap: number;
  audit: { citedRequested: number; citedVerified: number; stripped: number; declined: boolean };
}

/* ----------------------------- retrieval ------------------------------ */

export interface RetrievalScope {
  sourceIds?: string[];
  topicIds?: string[];
  question: string;
  topK?: number;
}

/**
 * Vector search over the user's units, filtered by scope.
 *
 * We compute similarity in-process rather than pushing $vectorSearch to Atlas so
 * the exact same code path works against a local MongoDB. Once MONGODB_URI
 * points at Atlas the Unit.embedding index is available and this can be swapped
 * for a native vector index without changing any caller.
 */
export async function retrieveUnits(userId: string, scope: RetrievalScope): Promise<RetrievedUnit[]> {
  const topK = scope.topK ?? env.RETRIEVAL_TOP_K;
  const filter: Record<string, unknown> = { userId };

  if (scope.sourceIds?.length) filter.sourceId = { $in: scope.sourceIds };
  if (scope.topicIds?.length) filter.topicIds = { $in: scope.topicIds };

  const units = await Unit.find(filter)
    .select('text location embedding embeddingProvider embeddingDim sourceId kind figureDescription')
    .lean();

  if (!units.length) return [];

  // Embed the QUERY with the active provider — the same space the units were
  // written in. Previously this used localEmbed() unconditionally, which
  // compared a 256-dim hashing vector against 768-dim Gemini vectors and
  // silently returned noise.
  const ai = getAIProvider();
  let space: VectorSpace = activeSpace();
  let qVec: number[] | null = null;
  try {
    const [qv] = await ai.embed([scope.question]);
    if (qv?.length) {
      qVec = qv;
      // Trust the returned vector's length over the configured default: it is
      // the ground truth for what actually got stored.
      space = { provider: space.provider, dim: qv.length };
    }
  } catch (err) {
    console.warn('[retrieval] query embedding failed', (err as Error).message);
  }

  // Fall back to the local space only if the active provider IS local.
  if (!qVec) {
    if (space.provider !== 'local') {
      console.warn('[retrieval] no query vector and active provider is not local; refusing to retrieve');
      return [];
    }
    qVec = localEmbed(scope.question);
    space = { provider: 'local', dim: qVec.length };
  }

  // NEVER compare across spaces. Units stored by a different provider (or with a
  // different dimensionality) are excluded rather than scored.
  const compatible = units.filter((u: any) => {
    const vec = u.embedding as number[] | undefined;
    if (!vec?.length) return false;
    if (u.embeddingProvider && u.embeddingProvider !== space.provider) return false;
    if (u.embeddingDim != null && Number(u.embeddingDim) !== space.dim) return false;
    // Legacy units written before this field existed: accept only if the
    // dimension already matches the active space.
    return vec.length === space.dim;
  });

  const excluded = units.length - compatible.length;
  if (excluded > 0) {
    console.warn(
      `[retrieval] excluded ${excluded}/${units.length} unit(s) not in the active ` +
        `${space.provider}/${space.dim}-dim space. Run scripts/reembed.ts to migrate them.`
    );
  }

  const scored = compatible.map((u: any) => ({
    u,
    sim: safeCosineSimilarity(qVec, u.embedding as number[]),
  }));
  scored.sort((a, b) => b.sim - a.sim);

  const top = scored.slice(0, topK);
  const sourceIds = [...new Set(top.map((s: any) => String(s.u.sourceId)))];
  const sources = await Source.find({ _id: { $in: sourceIds } })
    .select('title type')
    .lean();
  const sourceMap = new Map(sources.map((s: any) => [String(s._id), s]));

  return top.map(({ u, sim }: any) => {
    const src = sourceMap.get(String(u.sourceId));
    return {
      unitId: String(u._id),
      sourceId: String(u.sourceId),
      text: (u.figureDescription ?? u.text) as string,
      similarity: Number(sim.toFixed(4)),
      location: u.location ?? {},
      kind: u.kind,
      sourceTitle: src?.title ?? 'Unknown source',
      sourceType: src?.type ?? 'text',
    };
  });
}

export function lexicalOverlap(question: string, hits: RetrievedUnit[]): number {
  const q = new Set(contentWords(question));
  if (!q.size || !hits.length) return 0;
  const bag = new Set(hits.slice(0, 3).flatMap((h) => contentWords(h.text)));
  let hit = 0;
  for (const t of q) if (bag.has(t)) hit++;
  return Number((hit / q.size).toFixed(4));
}

/**
 * IDF-weighted question coverage over the retrieved excerpts.
 *
 * Plain coverage counts ANY shared content word, which measures two different
 * things at once. Measured on test set v2, unweighted coverage produced BOTH
 * failure modes at once:
 *   - false accepts: "What is a TLB shootdown...?" matched on the single
 *     ubiquitous term "TLB" even though shootdowns are nowhere in the material.
 *   - false declines: paraphrased questions ("Why do pointer-heavy loops suffer
 *     more than arithmetic-heavy ones?") share few literal words with the
 *     source, so coverage stayed below threshold despite being fully answerable.
 *
 * Weighting each question term by how RARE it is across the retrieved set fixes
 * both without loosening the gate: matching on "pointer" or "chasing" (which
 * appear in one passage) counts for far more than matching "TLB" (which appears
 * in most of them). The gate still requires real topical contact; it just stops
 * rewarding generic vocabulary.
 *
 * `df` is the number of retrieved units containing the term, so a term in every
 * unit scores ~0 and a term in exactly one scores high.
 */
export function idfWeightedOverlap(question: string, hits: RetrievedUnit[]): number {
  const terms = [...new Set(contentWords(question))];
  if (!terms.length || !hits.length) return 0;

  const docs = hits.slice(0, 5).map((h) => new Set(contentWords(h.text)));
  const N = docs.length;
  if (!N) return 0;

  let matchedWeight = 0;
  let totalWeight = 0;

  for (const t of terms) {
    const df = docs.reduce((n, d) => n + (d.has(t) ? 1 : 0), 0);
    // Smoothed IDF; a term in every retrieved unit contributes ~0.
    const weight = Math.log((N + 1) / (df + 0.5));
    totalWeight += weight;
    if (df > 0) matchedWeight += weight;
  }

  if (totalWeight <= 0) return 0;
  return Number((matchedWeight / totalWeight).toFixed(4));
}

/** Grounding decision: either signal is sufficient to attempt an answer. */
export function isGrounded(topSimilarity: number, overlap: number): boolean {
  const t = groundingThresholds();
  // With an uncalibrated Gemini space both thresholds are +Infinity, so neither
  // signal passes accidentally. Failing closed is the safe direction.
  return topSimilarity >= t.similarity || overlap >= t.lexical;
}

/* --------------------------- answer synthesis -------------------------- */

export async function answerQuestion(
  userId: string,
  question: string,
  opts: { scope?: { sourceIds?: string[]; topicIds?: string[] }; language?: 'en' | 'hi'; answerStyle?: 'quick' | 'deep'; studyLevel?: string } = {}
): Promise<TutorAnswer> {
  const language: 'en' | 'hi' = opts.language === 'hi' ? 'hi' : 'en';
  const topK = env.RETRIEVAL_TOP_K;

  const hits = await retrieveUnits(userId, {
    question,
    topK,
    sourceIds: opts.scope?.sourceIds,
    topicIds: opts.scope?.topicIds,
  });

  const audit = { citedRequested: 0, citedVerified: 0, stripped: 0, declined: false };

  // Uses the calibrated, unweighted coverage signal. The citation audit below
  // remains unchanged and applies only to answers grounded in retrieved units.
  const overlap = lexicalOverlap(question, hits);
  const ai = getAIProvider();
  if (!hits.length || !isGrounded(hits[0].similarity, overlap)) {
    const common = {
      citations: [] as Citation[],
      groundingStatus: 'outside_material' as GroundingStatus,
      language,
      topSimilarity: hits[0]?.similarity ?? 0,
      lexicalOverlap: overlap,
      audit,
    };
    if (ai.name === 'local') {
      return {
        ...common,
        answer: language === 'hi'
          ? 'यह प्रश्न अपलोड की गई सामग्री में नहीं है। सामान्य ज्ञान के उत्तर के लिए ऑनलाइन AI प्रदाता चाहिए; ऑफ़लाइन मोड केवल आपकी सामग्री से जवाब देता है।'
          : "That isn't in your uploaded material. General-knowledge answers need the online AI provider; offline mode can only answer from your sources.",
        outsideKnowledge: null,
      };
    }
    try {
      const outsideKnowledge = await ai.generalAnswer({
        question,
        language,
        answerStyle: opts.answerStyle,
        studyLevel: opts.studyLevel,
      });
      if (outsideKnowledge?.trim()) {
        return { ...common, answer: '', outsideKnowledge: outsideKnowledge.trim() };
      }
    } catch (err) {
      console.warn('[tutor] generalAnswer failed', (err as Error).message);
    }
    return {
      ...common,
      answer: language === 'hi'
        ? 'सामान्य उत्तर अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें या अपनी सामग्री से जुड़ा प्रश्न पूछें।'
        : 'I could not fetch a general answer just now. Try again in a moment, or ask about your uploaded material.',
      outsideKnowledge: null,
    };
  }


  interface TutorJson {
    answer?: string;
    citedUnitIds?: string[];
    groundingStatus?: GroundingStatus;
    outsideKnowledge?: string | null;
  }

  let parsed: TutorJson;
  try {
    const draft = await ai.groundedAnswer({
      question,
      excerpts: hits.map((h) => ({ unitId: h.unitId, text: h.text })),
      language,
      answerStyle: opts.answerStyle,
      studyLevel: opts.studyLevel,
    });
    parsed = {
      answer: draft.answer,
      citedUnitIds: draft.citedUnitIds,
      groundingStatus: draft.groundingStatus,
      outsideKnowledge: draft.outsideKnowledge,
    };
  } catch (err) {
    // A provider fault must not take the endpoint down: fall back to the best
    // retrieved text directly. Still grounded, still cited, still honest.
    console.warn('[tutor] groundedAnswer failed, falling back to extractive', (err as Error).message);
    parsed = {
      answer: hits.slice(0, 3).map((h) => h.text).join(' '),
      citedUnitIds: hits.slice(0, 3).map((h) => h.unitId),
      groundingStatus: 'partial',
      outsideKnowledge: null,
    };
  }

  // ---- CITATION AUDIT: drop anything not in the retrieved set -------------
  const retrievedIds = new Set(hits.map((h) => h.unitId));
  const requested = Array.isArray(parsed.citedUnitIds) ? parsed.citedUnitIds : [];
  audit.citedRequested = requested.length;

  const verified = requested.filter((id) => retrievedIds.has(String(id)));
  audit.stripped = requested.length - verified.length;
  audit.citedVerified = verified.length;

  const citations: Citation[] = verified
    .map((id) => hits.find((h) => h.unitId === String(id)))
    .filter((h): h is RetrievedUnit => Boolean(h))
    .map((h) => ({
      unitId: h.unitId,
      sourceId: h.sourceId,
      sourceTitle: h.sourceTitle,
      label: formatCitation(h),
      excerpt: h.text.slice(0, 240),
      location: h.location,
    }));

  let status: GroundingStatus = parsed.groundingStatus ?? 'partial';
  if (!['full', 'partial', 'outside_material'].includes(status)) status = 'partial';
  // A "full" claim with zero surviving citations is not credible.
  if (status === 'full' && citations.length === 0) status = 'partial';
  // The similarity gate already ran, so an outside_material verdict here is honest.
  if (status === 'outside_material') audit.declined = true;

  let answer = (parsed.answer ?? '').trim();
  if (!answer) {
    answer = hits
      .slice(0, 3)
      .map((h) => h.text)
      .join(' ');
  }

  return {
    answer,
    citations,
    groundingStatus: status,
    outsideKnowledge: parsed.outsideKnowledge ?? null,
    language,
    topSimilarity: hits[0].similarity,
    lexicalOverlap: overlap,
    audit,
  };
}

/** "Lecture 3 · 14:22" / "Textbook p.87" / "Slide 12" */
export function formatCitation(unit: RetrievedUnit): string {
  const { location: loc, sourceTitle, sourceType } = unit;
  if (loc.startSec !== undefined && loc.startSec !== null) {
    return `${sourceTitle} · ${formatTimestamp(loc.startSec)}`;
  }
  if (loc.slide !== undefined && loc.slide !== null) return `${sourceTitle} · Slide ${loc.slide}`;
  if (loc.page !== undefined && loc.page !== null) {
    const p = `p.${loc.page}`;
    return sourceType === 'image' ? `${sourceTitle} · Figure` : `${sourceTitle} · ${p}`;
  }
  return sourceTitle;
}

export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** True when the question shares almost no vocabulary with any retrieved unit. */
export function looksOffMaterial(question: string, hits: RetrievedUnit[]): boolean {
  if (!hits.length) return true;
  return !isGrounded(hits[0].similarity, lexicalOverlap(question, hits));
}

export { Topic };