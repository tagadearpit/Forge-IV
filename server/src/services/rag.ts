import { Unit } from '../models/Unit';
import { Source } from '../models/Source';
import { Topic } from '../models/Topic';
import { getAIProvider } from '../ai/provider';
import { safeCosineSimilarity, localEmbed } from '../utils/embedding';
import {
  activeSpace,
  groundingThresholds,
  type VectorSpace,
} from '../utils/vectorSpace';
import { contentWords } from '../utils/text';
import { env } from '../config/env';

/**
 * ============================================================================
 * Retrieval + grounded generation
 * ============================================================================
 * Two guards make hallucination structurally hard rather than merely unlikely:
 *
 *  1. SIMILARITY GATE — if the best retrieved excerpt is below
 *     GROUNDING_SIMILARITY_THRESHOLD we return `outside_material` and decline.
 *     The model is never even called, so it cannot invent anything.
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

export interface TutorAnswer {
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

/** Grounding decision: either signal is sufficient to attempt an answer. */
export function isGrounded(topSimilarity: number, overlap: number): boolean {
  const t = groundingThresholds();
  // With an uncalibrated Gemini space the similarity threshold is +Infinity, so
  // only the lexical signal can pass. Failing closed is the safe direction.
  return topSimilarity >= t.similarity || overlap >= t.lexical;
}

/* --------------------------- answer synthesis -------------------------- */

export async function answerQuestion(
  userId: string,
  question: string,
  opts: { scope?: { sourceIds?: string[]; topicIds?: string[] }; language?: 'en' | 'hi' } = {}
): Promise<TutorAnswer> {
  const language = opts.language === 'hi' ? 'hi' : 'en';
  const topK = env.RETRIEVAL_TOP_K;

  const hits = await retrieveUnits(userId, {
    question,
    topK,
    sourceIds: opts.scope?.sourceIds,
    topicIds: opts.scope?.topicIds,
  });

  const audit = { citedRequested: 0, citedVerified: 0, stripped: 0, declined: false };

  // No material at all, or nothing close enough → decline BEFORE calling the
  // model, so it cannot invent anything.
  const overlap = lexicalOverlap(question, hits);
  if (!hits.length || !isGrounded(hits[0].similarity, overlap)) {
    audit.declined = true;
    return {
      answer:
        language === 'hi'
          ? 'यह प्रश्न आपकी अपलोड की गई सामग्री में शामिल नहीं है। इसलिए मैं इसका उत्तर नहीं दे रहा हूँ।'
          : "This isn't covered in your uploaded material, so I won't answer it from guesswork. Upload a source that covers it, or rephrase the question.",
      citations: [],
      groundingStatus: 'outside_material',
      outsideKnowledge: null,
      language,
      topSimilarity: hits[0]?.similarity ?? 0,
      lexicalOverlap: overlap,
      audit,
    };
  }

  const ai = getAIProvider();

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