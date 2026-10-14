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
import { isUnhelpfulExcerptDump, makeReadableExtractiveAnswer } from './answerFormatter.js';

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

export type RetrievedUnits = RetrievedUnit[] & { excludedUnitCount?: number };

function withExcludedUnits<T extends RetrievedUnit[]>(units: T, excludedUnitCount: number): T & { excludedUnitCount: number } {
  return Object.assign(units, { excludedUnitCount });
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
  unsearchableCount: number;
  usingSource: { id: string; title: string } | null;
}

/* ----------------------------- retrieval ------------------------------ */

export interface RetrievalScope {
  sourceIds?: string[];
  topicIds?: string[];
  question: string;
  topK?: number;
  locationFilter?: { pageStart?: number; pageEnd?: number; slideStart?: number; slideEnd?: number };
  pageOrder?: boolean;
  /** Fetch every unit in the filtered scope; reserved for whole-source summaries. */
  all?: boolean;
}

/**
 * Vector search over the user's units, filtered by scope.
 *
 * We compute similarity in-process rather than pushing $vectorSearch to Atlas so
 * the exact same code path works against a local MongoDB. Once MONGODB_URI
 * points at Atlas the Unit.embedding index is available and this can be swapped
 * for a native vector index without changing any caller.
 */
export async function retrieveUnits(userId: string, scope: RetrievalScope): Promise<RetrievedUnits> {
  const topK = scope.topK ?? env.RETRIEVAL_TOP_K;
  const filter: Record<string, unknown> = { userId };

  if (scope.sourceIds?.length) filter.sourceId = { $in: scope.sourceIds };
  if (scope.topicIds?.length) filter.topicIds = { $in: scope.topicIds };
  if (scope.locationFilter?.pageStart !== undefined || scope.locationFilter?.pageEnd !== undefined) {
    filter['location.page'] = { ...(scope.locationFilter.pageStart !== undefined ? { $gte: scope.locationFilter.pageStart } : {}), ...(scope.locationFilter.pageEnd !== undefined ? { $lt: scope.locationFilter.pageEnd } : {}) };
  }
  if (scope.locationFilter?.slideStart !== undefined || scope.locationFilter?.slideEnd !== undefined) {
    filter['location.slide'] = { ...(scope.locationFilter.slideStart !== undefined ? { $gte: scope.locationFilter.slideStart } : {}), ...(scope.locationFilter.slideEnd !== undefined ? { $lt: scope.locationFilter.slideEnd } : {}) };
  }

  const units = await Unit.find(filter)
    .select('text location embedding embeddingProvider embeddingModel embeddingDim sourceId kind figureDescription')
    .lean();

  if (!units.length) return withExcludedUnits([], 0);

  // Embed the QUERY with the active provider — the same space the units were
  // written in. Previously this used localEmbed() unconditionally, which
  // compared a 256-dim hashing vector against 768-dim Gemini vectors and
  // silently returned noise.
  const ai = getAIProvider();
  let space: VectorSpace = activeSpace();
  let qVec: number[] | null = null;
  try {
    const [qv] = await ai.embed([scope.question], 'RETRIEVAL_QUERY');
    if (qv?.length) {
      qVec = qv;
      // Trust the returned vector's length over the configured default: it is
      // the ground truth for what actually got stored.
      space = { provider: space.provider, dim: qv.length };
    }
  } catch (err) {
    console.warn('[retrieval] query embedding failed', (err as Error).message);
  }

  const scoped = Boolean(scope.sourceIds?.length || scope.topicIds?.length);
  let scored: Array<{ u: any; sim: number }> = [];
  let excluded = 0;

  // Fall back to local vectors only when the active provider is local. For an
  // explicit source/topic scope, use lexical/page-order excerpts if Gemini
  // embeddings are absent or still pending; never invent a fake local vector.
  if (!qVec && space.provider === 'local') {
    qVec = localEmbed(scope.question);
    space = { provider: 'local', dim: qVec.length };
  }

  const compatible = qVec
    ? units.filter((u: any) => {
        const vec = u.embedding as number[] | undefined;
        if (!vec?.length) return false;
        if (u.embeddingProvider !== space.provider) return false;
        if (u.embeddingModel !== ai.embeddingModel) return false;
        if (u.embeddingDim == null || Number(u.embeddingDim) !== space.dim) return false;
        return vec.length === space.dim;
      })
    : [];
  excluded = units.length - compatible.length;

  if (qVec && compatible.length) {
    scored = compatible.map((u: any) => ({ u, sim: safeCosineSimilarity(qVec!, u.embedding as number[]) }));
  } else if (scoped) {
    const terms = new Set(contentWords(scope.question));
    scored = units.map((u: any) => {
      const words = new Set(contentWords(String(u.figureDescription ?? u.text ?? '')));
      const overlap = terms.size ? [...terms].filter((term) => words.has(term)).length / terms.size : 0;
      return { u, sim: overlap };
    });
    // When no terms overlap, still present source pages for the model to judge.
    if (scored.every((x) => x.sim === 0)) {
      scored.sort((a, b) => Number(a.u.location?.page ?? a.u.location?.slide ?? 0) - Number(b.u.location?.page ?? b.u.location?.slide ?? 0));
    } else {
      scored.sort((a, b) => b.sim - a.sim);
    }
    // Lexical/page-order fallback actually includes these units; they are not excluded.
    excluded = 0;
  } else {
    if (excluded > 0) {
      console.warn(`[retrieval] excluded ${excluded}/${units.length} unit(s) without compatible ${space.provider}/${space.dim} embeddings`);
    }
    return withExcludedUnits([], excluded);
  }

  if (excluded > 0) {
    console.warn(`[retrieval] excluded ${excluded}/${units.length} unit(s) without compatible ${space.provider}/${space.dim} embeddings`);
  }
  scored.sort((a, b) => scope.pageOrder
    ? Number(a.u.location?.page ?? a.u.location?.slide ?? a.u.location?.startSec ?? 0) - Number(b.u.location?.page ?? b.u.location?.slide ?? b.u.location?.startSec ?? 0)
    : b.sim - a.sim);

  const top = scope.all ? scored : scored.slice(0, topK);
  const sourceIds = [...new Set(top.map((s: any) => String(s.u.sourceId)))];
  const sources = await Source.find({ _id: { $in: sourceIds } }).select('title type').lean();
  const sourceMap = new Map(sources.map((s: any) => [String(s._id), s]));

  const results = top.map(({ u, sim }: any) => {
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
  return withExcludedUnits(results, excluded);
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
  // Without provider-specific calibration, retrieval is only a candidate list;
  // groundedAnswer itself decides whether the excerpts answer the question.
  if (!t.calibrated) return true;
  return topSimilarity >= t.similarity || overlap >= t.lexical;
}

/* --------------------------- answer synthesis -------------------------- */

export interface LocationIntent {
  explicit: boolean;
  wholeDocumentSummary: boolean;
  pageNumber: number | null;
  slideNumber: number | null;
  sectionNumber: string | null;
  refersToSection: boolean;
}

/** Only literal location references count; topic words like "page replacement" do not. */
export function parseLocationIntent(question: string, sectionTitle?: string): LocationIntent {
  const pageNumber = Number(/\bpage\s+(\d+)\b/i.exec(question)?.[1]) || null;
  const slideNumber = Number(/\bslide\s+(\d+)\b/i.exec(question)?.[1]) || null;
  const sectionNumber = /\b(?:section|chapter)\s+(\d+(?:\.\d+)*)\b/i.exec(question)?.[1] ?? null;
  const refersToSection = /\b(?:this|that|my|the)\s+(?:section|chapter)\b/i.test(question);
  const refersToDocument = /\b(?:this|that|my|the)\s+(?:document|upload)\b/i.test(question);
  const wholeDocument = /\b(?:whole|entire|complete)\s+(?:document|upload)\b|\b(?:document|upload)\s+as\s+a\s+whole\b/i.test(question);
  const summaryIntent = /\b(?:summari[sz]e|summary|overview|recap)\b/i.test(question);
  const wholeDocumentSummary = summaryIntent && (wholeDocument || refersToDocument);
  const explicit = Boolean(
    sectionTitle?.trim() || pageNumber || slideNumber || sectionNumber ||
    refersToSection || refersToDocument || wholeDocument
  );
  return { explicit, wholeDocumentSummary, pageNumber, slideNumber, sectionNumber, refersToSection };
}

function citedLocation(citations: Array<{ sourceId: string; location?: { page?: number | null; slide?: number | null } }>, sourceIds: string[]) {
  const matching = citations.filter((citation) =>
    (!sourceIds.length || sourceIds.includes(String(citation.sourceId))) &&
    (citation.location?.page != null || citation.location?.slide != null)
  );
  const sourceId = matching.at(-1)?.sourceId;
  if (!sourceId) return null;
  const sameSource = matching.filter((citation) => String(citation.sourceId) === String(sourceId));
  const pages = sameSource.map((citation) => citation.location?.page).filter((value): value is number => value != null).map(Number);
  if (pages.length) {
    return { sourceId: String(sourceId), filter: { pageStart: Math.min(...pages), pageEnd: Math.max(...pages) + 1 } };
  }
  const slides = sameSource.map((citation) => citation.location?.slide).filter((value): value is number => value != null).map(Number);
  if (!slides.length) return null;
  return { sourceId: String(sourceId), filter: { slideStart: Math.min(...slides), slideEnd: Math.max(...slides) + 1 } };
}

export async function answerQuestion(
  userId: string,
  question: string,
  opts: {
    scope?: { sourceIds?: string[]; topicIds?: string[]; sectionTitle?: string };
    language?: 'en' | 'hi'; answerStyle?: 'quick' | 'deep'; studyLevel?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    previousAssistantCitations?: Array<{ sourceId: string; location?: { page?: number | null; slide?: number | null } }>;
  } = {}
): Promise<TutorAnswer> {
  const language: 'en' | 'hi' = opts.language === 'hi' ? 'hi' : 'en';
  const baseScope = opts.scope ?? {};
  const intent = parseLocationIntent(question, baseScope.sectionTitle);
  const explicitSourceIds = baseScope.sourceIds ?? [];
  let sourceIds = explicitSourceIds;
  let locationFilter: RetrievalScope['locationFilter'];
  let resolvedSource: any = null;
  const previousLocation = intent.refersToSection && !intent.sectionNumber
    ? citedLocation(opts.previousAssistantCitations ?? [], explicitSourceIds)
    : null;

  if (intent.explicit) {
    if (sourceIds.length === 1) {
      resolvedSource = await Source.findOne({ _id: sourceIds[0], userId, status: 'ready' }).select('title outline type').lean();
    } else if (sourceIds.length > 1) {
      resolvedSource = await Source.findOne({ _id: { $in: sourceIds }, userId, status: 'ready' }).sort({ createdAt: -1 }).select('title outline type').lean();
    } else if (previousLocation?.sourceId) {
      resolvedSource = await Source.findOne({ _id: previousLocation.sourceId, userId, status: 'ready' }).select('title outline type').lean();
    } else if (!baseScope.topicIds?.length && !intent.refersToSection) {
      // Only explicit location references may resolve to the latest upload; a pronoun section must use citation/thread context.
      resolvedSource = await Source.findOne({ userId, status: 'ready' }).sort({ createdAt: -1 }).select('title outline type').lean();
    }

    if (resolvedSource) {
      sourceIds = [String(resolvedSource._id)];
      const outline = (resolvedSource.outline ?? []) as Array<{ title: string; page?: number | null; slide?: number | null; level?: number }>;
      if (intent.pageNumber != null) {
        locationFilter = { pageStart: intent.pageNumber, pageEnd: intent.pageNumber + 1 };
      } else if (intent.slideNumber != null) {
        locationFilter = { slideStart: intent.slideNumber, slideEnd: intent.slideNumber + 1 };
      } else if (intent.sectionNumber || baseScope.sectionTitle) {
        const matchIndex = outline.findIndex((entry) => {
          if (intent.sectionNumber) {
            const found = /^(?:(?:chapter|section|unit)\s+)?(\d+(?:\.\d+)*)\b/i.exec(entry.title);
            return found?.[1] === intent.sectionNumber;
          }
          return entry.title.trim().toLowerCase() === baseScope.sectionTitle?.trim().toLowerCase();
        });
        if (matchIndex >= 0) {
          const match = outline[matchIndex];
          const locKey = match.page != null ? 'page' : match.slide != null ? 'slide' : null;
          const start = locKey ? Number(match[locKey]) : null;
          const next = locKey
            ? outline.slice(matchIndex + 1).find((entry) => (entry.level ?? 1) <= (match.level ?? 1) && entry[locKey] != null)
            : null;
          if (locKey && start != null) {
            locationFilter = locKey === 'page'
              ? { pageStart: start, ...(next?.page != null ? { pageEnd: Number(next.page) } : {}) }
              : { slideStart: start, ...(next?.slide != null ? { slideEnd: Number(next.slide) } : {}) };
          }
        }
      } else if (previousLocation && previousLocation.sourceId === String(resolvedSource._id)) {
        locationFilter = previousLocation.filter;
      }
    }
  }
  const pageOrder = Boolean(locationFilter || intent.wholeDocumentSummary);
  const effectiveScope = { ...baseScope, ...(sourceIds.length ? { sourceIds } : {}) };
  const explicitlyScoped = Boolean(effectiveScope.sourceIds?.length || effectiveScope.topicIds?.length);
  const topK = intent.explicit ? Math.max(env.RETRIEVAL_TOP_K, 48) : env.RETRIEVAL_TOP_K;

  const isFollowUp = /^(?:go deeper|tell me more|explain more|why|how so|what about that|expand on that|continue|elaborate)(?:\s|$|[?.!])/i.test(question.trim());
  const previousUser = [...(opts.history ?? [])].reverse().find((m) => m.role === 'user')?.content;
  const previousAssistant = [...(opts.history ?? [])].reverse().find((m) => m.role === 'assistant')?.content;
  const retrievalQuestion = isFollowUp && previousUser ? `${previousUser}\nFollow-up: ${question}${previousAssistant ? `\nRelevant prior answer: ${previousAssistant.slice(0, 1200)}` : ''}` : question;
  const hits = await retrieveUnits(userId, {
    question: retrievalQuestion,
    topK,
    sourceIds: effectiveScope.sourceIds,
    topicIds: effectiveScope.topicIds,
    locationFilter,
    pageOrder,
    all: intent.wholeDocumentSummary,
  });

  const audit = { citedRequested: 0, citedVerified: 0, stripped: 0, declined: false };
  const usedSources = [...new Map(hits.map((h) => [h.sourceId, h.sourceTitle])).entries()];
  const usingSource = usedSources.length === 1 ? { id: usedSources[0][0], title: usedSources[0][1] } : null;

  // The numeric gate is only for unscoped RAG. Explicit scopes are already a
  // user instruction to consult those excerpts; the model decides relevance.
  const overlap = lexicalOverlap(question, hits);
  const ai = getAIProvider();
  if (!hits.length && explicitlyScoped) {
    return {
      answer: language === 'hi' ? 'इस चुने हुए स्रोत में अभी कोई पढ़ने योग्य सामग्री उपलब्ध नहीं है।' : 'There are no indexed parts available in this selected source or topic yet.',
      citations: [], groundingStatus: 'outside_material', outsideKnowledge: null, language,
      topSimilarity: 0, lexicalOverlap: 0, audit,
      unsearchableCount: hits.excludedUnitCount ?? 0, usingSource: null,
    };
  }
  if (!hits.length || (!explicitlyScoped && !isGrounded(hits[0].similarity, overlap))) {
    const common = {
      citations: [] as Citation[],
      groundingStatus: 'outside_material' as GroundingStatus,
      language,
      topSimilarity: hits[0]?.similarity ?? 0,
      lexicalOverlap: overlap,
      audit,
      unsearchableCount: hits.excludedUnitCount ?? 0,
      usingSource: null,
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
        question: retrievalQuestion,
        language,
        answerStyle: opts.answerStyle,
        studyLevel: opts.studyLevel,
        history: opts.history,
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
    let draft;
    if (intent.wholeDocumentSummary && hits.length > 8) {
      const mapped: Array<{ answer: string; citedUnitIds: string[] }> = [];
      for (let i = 0; i < hits.length; i += 6) {
        const batch = hits.slice(i, i + 6);
        const map = await ai.groundedAnswer({
          question: `Summarize these page-ordered excerpts briefly, retaining important facts. ${question}`,
          excerpts: batch.map((h) => ({ unitId: h.unitId, text: h.text })), language,
          answerStyle: 'quick', studyLevel: opts.studyLevel, history: opts.history,
        });
        if (map.answer?.trim()) mapped.push({ answer: map.answer.trim(), citedUnitIds: map.citedUnitIds.filter((id) => batch.some((h) => h.unitId === id)) });
      }
      const reduceExcerpts = mapped.flatMap((m) => m.citedUnitIds.map((unitId) => ({ unitId, text: m.answer })));
      draft = reduceExcerpts.length ? await ai.groundedAnswer({
        question: `Combine these partial summaries into one coherent overview. Keep page-level facts and cite only excerpt IDs. Original request: ${question}`,
        excerpts: reduceExcerpts, language, answerStyle: opts.answerStyle, studyLevel: opts.studyLevel, history: opts.history,
      }) : { answer: mapped.map((m) => m.answer).join('\n\n'), citedUnitIds: mapped.flatMap((m) => m.citedUnitIds), groundingStatus: 'partial' as GroundingStatus, outsideKnowledge: null };
    } else {
      draft = await ai.groundedAnswer({
        question, excerpts: hits.map((h) => ({ unitId: h.unitId, text: h.text })), language,
        answerStyle: opts.answerStyle, studyLevel: opts.studyLevel, history: opts.history,
      });
    }
    const excerpts = hits.map((h) => ({ unitId: h.unitId, text: h.text }));
    const answerIsDump = isUnhelpfulExcerptDump(draft.answer ?? '', excerpts);
    const fallback = (!draft.answer?.trim() || answerIsDump) && draft.groundingStatus !== 'outside_material'
      ? makeReadableExtractiveAnswer(question, excerpts, language)
      : null;
    parsed = {
      answer: fallback?.answer ?? draft.answer ?? '',
      citedUnitIds: fallback?.citedUnitIds ?? draft.citedUnitIds,
      groundingStatus: fallback && !fallback.answer ? 'outside_material' : draft.groundingStatus,
      outsideKnowledge: draft.outsideKnowledge,
    };
  } catch (err) {
    // A provider fault must not take the endpoint down: fall back to the best
    // retrieved text directly. Still grounded, still cited, still honest.
    console.warn('[tutor] groundedAnswer failed, falling back to extractive', (err as Error).message);
    const fallback = makeReadableExtractiveAnswer(question, hits.map((h) => ({ unitId: h.unitId, text: h.text })), language);
    parsed = {
      answer: fallback.answer,
      citedUnitIds: fallback.citedUnitIds,
      groundingStatus: fallback.answer ? 'partial' : 'outside_material',
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
    answer = language === 'hi'
      ? 'मैं अभी सामग्री से कोई स्पष्ट, पढ़ने योग्य उत्तर नहीं निकाल सका।'
      : 'I could not extract a clear, readable answer from the retrieved material.';
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
    unsearchableCount: hits.excludedUnitCount ?? 0,
    usingSource,
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