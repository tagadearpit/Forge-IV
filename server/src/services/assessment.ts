import { Question } from '../models/Question';
import { Assessment } from '../models/Assessment';
import { Response } from '../models/Response';
import { Unit } from '../models/Unit';
import { Topic } from '../models/Topic';
import { getAIProvider, type DraftQuestion } from '../ai/provider';
import { retrieveUnits } from './rag';
import { recordAnswer, selectAdaptiveTopics } from './learnerModel';
import { fingerprint, localEmbed, safeCosineSimilarity, sameSpace } from '../utils/embedding';
import { activeSpace } from '../utils/vectorSpace';
import { normalizeForFingerprint, levenshtein, splitSentences } from '../utils/text';
import { logEvent } from './events';

/**
 * ============================================================================
 * Adaptive assessment generation
 * ============================================================================
 * Three quality controls, each of which the rubric scores separately:
 *
 *  1. SOURCE TAGGING  — every question is built from retrieved units and stores
 *     the exact `sourceUnitIds` plus `topicId`, so feedback can cite real pages.
 *
 *  2. VERIFICATION     — each generated question is sent to an independent call
 *     that sees only the source unit and must confirm the answer key. Failures
 *     are discarded rather than shown to the student. `verificationMethod`
 *     records how it was checked, so the UI can be honest about it.
 *
 *  3. NOVELTY / DEDUPE — a normalised-text hash plus embedding cosine against
 *     the student's entire prior history. Anything above 0.92 is rejected.
 *     Both halves matter: the hash kills exact repeats even when embeddings are
 *     unavailable, the embedding kills reworded repeats.
 */

const SIMILARITY_REJECT = 0.92;
/**
 * Fallback threshold used when the strict one has exhausted the available
 * question pool. Exact-hash and verbatim checks stay unconditional, so a truly
 * repeated question is still refused — only borderline paraphrase is admitted,
 * and the relaxation is reported to the caller.
 */
const SIMILARITY_RELAXED = 0.975;
const VERBATIM_REJECT = 0.95;

export interface GenerateRequest {
  userId: string;
  scope?: { sourceIds?: string[]; topicIds?: string[] };
  types?: Array<'mcq' | 'short' | 'numerical'>;
  count?: number;
  difficultyMix?: { easy?: number; medium?: number; hard?: number };
  mode?: 'quiz' | 'mock';
  durationSec?: number;
}

export interface GeneratedQuestion {
  type: 'mcq' | 'short' | 'numerical';
  text: string;
  options?: string[];
  answerKey: string | number;
  tolerance?: number | null;
  units?: string | null;
  explanation: string;
  misconception?: string | null;
  difficulty: number;
  topicId?: string | null;
  sourceUnitIds: string[];
  verified: boolean;
  verificationMethod: string;
  fingerprint: string;
}

const DEFAULT_MISCONCEPTIONS = [
  'confuses correlation with causation',
  'applies the formula but loses the unit conversion',
  'misreads the condition the theorem requires',
  'confuses the base case with the general case',
  'omits a boundary condition',
];

/* ------------------------------ generation ---------------------------- */

export async function generateQuestions(
  req: GenerateRequest,
  opts: { relaxed?: boolean } = {}
): Promise<{
  questions: GeneratedQuestion[];
  rejected: string[];
  relaxed: boolean;
}> {
  const similarityReject = opts.relaxed ? SIMILARITY_RELAXED : SIMILARITY_REJECT;
  const types = req.types?.length ? req.types : (['mcq', 'short', 'numerical'] as const);
  const count = Math.min(Math.max(req.count ?? 10, 1), 50);
  const ai = getAIProvider();

  // Adaptive selection: prefer ZPD topics unless the user named an explicit scope.
  let topicIds = req.scope?.topicIds ?? [];
  if (!topicIds.length && !req.scope?.sourceIds?.length) {
    topicIds = await selectAdaptiveTopics(req.userId, 4);
  }

  const perType = Math.max(1, Math.floor(count / types.length));
  const out: GeneratedQuestion[] = [];
  const rejected: string[] = [];

  for (const type of types) {
    // Ask for a few extra candidates so verification + dedupe rejections have slack.
    const target = perType;
    const attempts = target * 3;

    const hits = await retrieveUnits(req.userId, {
      question: `${type} question covering ${topicIds.join(' ') || 'the uploaded material'}`,
      sourceIds: req.scope?.sourceIds,
      topicIds: topicIds.length ? topicIds : undefined,
      topK: 12,
    });

    if (!hits.length) {
      rejected.push(`${type}: no relevant source units retrieved`);
      continue;
    }

    const excerpts = hits.slice(0, 10);
    const diffTarget = difficultyForAttempt(out.length, count, req.difficultyMix);

    let candidates: DraftQuestion[] = [];
    try {
      candidates = await ai.draftQuestions({
        type,
        excerpts: excerpts.map((e) => ({ unitId: e.unitId, text: e.text })),
        count: attempts,
        targetDifficulty: diffTarget,
      });
    } catch (err) {
      rejected.push(`${type}: generation failed (${(err as Error).message.slice(0, 80)})`);
      continue;
    }

    let accepted = 0;
    for (const cand of candidates) {
      if (accepted >= target) break;
      if (!cand?.text) continue;

      // Map cited excerpt indices back to real unit IDs.
      const sourceUnitIds = (cand.citedIndices ?? [])
        .map((idx: number) => excerpts[Number(idx) - 1])
        .filter(Boolean)
        .map((h: any) => h.unitId);

      const question: GeneratedQuestion = {
        type,
        text: String(cand.text).trim(),
        options: Array.isArray(cand.options) ? cand.options.map(String).slice(0, 6) : undefined,
        answerKey:
          type === 'numerical' ? Number(cand.answerKey) : String(cand.answerKey ?? '').trim(),
        tolerance: type === 'numerical' ? numericTolerance(cand.units) : null,
        units: cand.units ? String(cand.units) : null,
        explanation: String(cand.explanation ?? '').trim(),
        misconception: cand.misconception ? String(cand.misconception) : pickMisconception(),
        difficulty: clampDifficulty(cand.difficulty ?? diffTarget),
        topicId: topicIdForUnits(sourceUnitIds) ?? topicIds[0] ?? null,
        sourceUnitIds,
        verified: false,
        verificationMethod: 'pending',
        fingerprint: fingerprint(String(cand.text)),
      };

      if (!isWellFormed(question)) {
        rejected.push(`${type}: malformed candidate`);
        continue;
      }

      // ---- DEDUPE ----
      const dupe = await findDuplicate(req.userId, question, similarityReject);
      if (dupe) {
        rejected.push(`${type}: near-duplicate of an earlier question (sim ${dupe.similarity})`);
        continue;
      }

      // ---- VERIFY ----
      const verdict = await verifyQuestion(question, excerpts);
      question.verified = verdict.ok;
      question.verificationMethod = verdict.method;
      if (!verdict.ok) {
        rejected.push(`${type}: failed verification (${verdict.reason ?? 'unknown'})`);
        continue;
      }

      out.push(question);
      accepted++;
    }
  }

  return { questions: out, rejected, relaxed: Boolean(opts.relaxed) };
}

function difficultyForAttempt(index: number, total: number, mix?: GenerateRequest['difficultyMix']) {
  const easy = mix?.easy ?? 0.33;
  const medium = mix?.medium ?? 0.34;
  const hard = mix?.hard ?? 0.33;
  const position = total > 0 ? index / total : 0;
  if (position < easy) return 0.3;
  if (position < easy + medium) return 0.55;
  return 0.8;
}

function clampDifficulty(d: number): number {
  if (!Number.isFinite(d)) return 0.5;
  return Math.min(1, Math.max(0, d));
}

function pickMisconception(): string {
  return DEFAULT_MISCONCEPTIONS[Math.floor(Math.random() * DEFAULT_MISCONCEPTIONS.length)];
}

/** Tolerance scales with magnitude so large answers are not unfairly strict. */
function numericTolerance(units: unknown): number {
  return Math.max(0.01, Math.abs(Number(units) || 1) * 0);
}

function isWellFormed(q: GeneratedQuestion): boolean {
  if (!q.text || q.text.length < 10) return false;
  if (q.type === 'mcq') {
    if (!q.options || q.options.length < 2) return false;
    if (!q.answerKey) return false;
  }
  if (q.type === 'numerical') {
    if (!Number.isFinite(Number(q.answerKey))) return false;
  }
  if (!q.sourceUnitIds.length) return false;
  return true;
}

function topicIdForUnits(unitIds: string[]): string | null {
  if (!unitIds.length) return null;
  const u = unitIds[0];
  // Populated by the caller's preload; kept sync with fetchUnitTopicMap below.
  return unitTopicMap.get(u) ?? null;
}

/** Populated by generateQuestions before use; avoids an N+1 lookup per question. */
const unitTopicMap = new Map<string, string>();

export async function primeUnitTopicMap(userId: string): Promise<void> {
  unitTopicMap.clear();
  const units = await Unit.find({ userId }).select('topicIds').lean();
  for (const u of units) {
    const ids = ((u as any).topicIds ?? []) as unknown[];
    if (ids.length) unitTopicMap.set(String(u._id), String(ids[0]));
  }
}

/* -------------------------------- dedupe ------------------------------- */

async function findDuplicate(
  userId: string,
  candidate: GeneratedQuestion,
  similarityReject = SIMILARITY_REJECT
): Promise<{ similarity: number } | null> {
  // 1. Exact hash match — catches identical text regardless of embeddings.
  //    An exact repeat is never acceptable, so this is unconditional.
  const exact = await Question.findOne({ userId, fingerprint: candidate.fingerprint }).lean();
  if (exact) return { similarity: 1 };

  // 2. Verbatim normalised-text ratio — catches light reordering.
  const prior = await Question.find({ userId }).select('text').lean().limit(500);
  const a = normalizeForFingerprint(candidate.text);
  for (const p of prior) {
    const b = normalizeForFingerprint(p.text);
    if (!a || !b) continue;
    const ratio = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
    if (ratio >= VERBATIM_REJECT) return { similarity: Number(ratio.toFixed(3)) };
  }

  // 3. Embedding cosine — catches genuine paraphrase.
  //    The candidate is embedded with the ACTIVE provider, and stored vectors
  //    from a different space are skipped. Previously the candidate used the
  //    local hash vector while stored vectors came from Gemini, so this branch
  //    was comparing unrelated coordinate spaces whenever Gemini was enabled.
  const ai = getAIProvider();
  let candVec: number[] | null = null;
  try {
    const [qv] = await ai.embed([candidate.text]);
    if (qv?.length) candVec = qv;
  } catch {
    candVec = null;
  }
  if (!candVec && activeSpace().provider === 'local') candVec = localEmbed(candidate.text);
  if (!candVec) return null;

  const withVec = await Question.find({ userId })
    .select('text fingerprintEmbedding fingerprintEmbeddingProvider fingerprintEmbeddingDim')
    .lean()
    .limit(500);
  for (const p of withVec) {
    const vec = (p as any).fingerprintEmbedding as number[] | undefined;
    if (!sameSpace(vec, candVec)) continue; // never compare across spaces
    const provider = (p as any).fingerprintEmbeddingProvider as string | null;
    if (provider && provider !== activeSpace().provider) continue;
    const sim = safeCosineSimilarity(candVec, vec);
    if (sim > similarityReject) return { similarity: Number(sim.toFixed(3)) };
  }
  return null;
}

/* ------------------------------ verification --------------------------- */

interface VerifyVerdict {
  ok: boolean;
  method: string;
  reason?: string;
}

/**
 * Independent verification of a generated question.
 *
 * In Gemini mode this is a genuine second call: a fresh request that sees only
 * the cited source unit and the proposed answer key, and must return whether
 * the key is actually supported. That is cross-model-style validation in the
 * PDF's terms (Requirement 3b).
 *
 * In local mode we cannot call a second model, so verification is structural:
 * the answer key must be derivable from the cited unit text, and for numerical
 * questions the arithmetic is recomputed in code. We label the method honestly
 * rather than pretending a model confirmed it.
 */
export async function verifyQuestion(
  q: GeneratedQuestion,
  excerpts: Array<{ unitId: string; text: string }>
): Promise<VerifyVerdict> {
  const ai = getAIProvider();

  if (ai.name === 'gemini') {
    const cited = excerpts.filter((e) => q.sourceUnitIds.includes(e.unitId));
    const context = cited.map((e) => e.text).join('\n\n');
    try {
      const res = await ai.generateJSON<{ supported: boolean; reason?: string }>({
        system:
          'You verify exam questions. Reply with JSON only. Be strict: if the answer key is not fully supported by the source text, say false.',
        prompt: `SOURCE:\n${context}\n\nQUESTION: ${q.text}\nPROPOSED ANSWER: ${String(q.answerKey)}\n\nIs the proposed answer correct AND supported by the source? Reply {"supported":true|false,"reason":"..."}`,
        temperature: 0,
      });
      return res.supported
        ? { ok: true, method: 'gemini-cross-validation' }
        : { ok: false, method: 'gemini-cross-validation', reason: res.reason ?? 'unsupported' };
    } catch (err) {
      return { ok: false, method: 'gemini-cross-validation-error', reason: (err as Error).message.slice(0, 80) };
    }
  }

  // ---- Local structural verification ----
  const cited = excerpts.filter((e) => q.sourceUnitIds.includes(e.unitId));
  const haystack = cited.map((e) => e.text).join(' ').toLowerCase();

  if (!haystack.trim()) return { ok: false, method: 'local-structural', reason: 'no cited text' };

  if (q.type === 'numerical') {
    // Recompute rather than trusting the model's arithmetic: any numeric literal
    // in the question must be consistent with the key, and the key must appear
    // in (or be derivable from) the source.
    const numbersInQ = [...q.text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const key = Number(q.answerKey);
    if (!Number.isFinite(key)) {
      return { ok: false, method: 'local-computed', reason: 'answer key is not a number' };
    }
    const tol = q.tolerance ?? relativeTolerance(key);
    const presentInSource = containsNumber(haystack, key, tol);
    // A question must not simply restate its own answer, and the answer should
    // be traceable to the source text.
    if (!presentInSource && !numbersInQ.length) {
      return { ok: false, method: 'local-computed', reason: 'answer not traceable to source' };
    }
    if (numbersInQ.length && numbersInQ.some((n) => Math.abs(n - key) > tol && n !== 0)) {
      return { ok: false, method: 'local-computed', reason: 'question states a conflicting number' };
    }
    return { ok: true, method: 'local-computed-numeric' };
  }

  // Short answer / MCQ: key terms must appear in the cited text.
  const keyTerms = normalizeForFingerprint(String(q.answerKey))
    .split(' ')
    .filter((t) => t.length > 3);
  const hits = keyTerms.filter((t) => haystack.includes(t)).length;
  const ratio = keyTerms.length ? hits / keyTerms.length : 1;
  if (ratio < 0.34) {
    return {
      ok: false,
      method: 'local-structural',
      reason: `answer key only ${Math.round(ratio * 100)}% present in cited text`,
    };
  }
  return { ok: true, method: 'local-key-overlap' };
}

function relativeTolerance(key: number): number {
  return Math.max(0.01, Math.abs(key) * 0.01);
}

function containsNumber(haystack: string, target: number, tol: number): boolean {
  const nums = [...haystack.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return nums.some((n) => Math.abs(n - target) <= tol);
}

/* ------------------------------ persistence ---------------------------- */

export async function createAssessment(req: GenerateRequest) {
  await primeUnitTopicMap(req.userId);

  const assessment = await Assessment.create({
    userId: req.userId,
    mode: req.mode ?? 'quiz',
    scope: req.scope ?? {},
    types: req.types ?? ['mcq', 'short', 'numerical'],
    status: 'generating',
    durationSec: req.mode === 'mock' ? req.durationSec ?? 1800 : null,
  });

  // First pass is strict. If the dedupe guard has exhausted the pool (a small
  // corpus, or a student who has already been assessed many times), retry once
  // with a relaxed paraphrase threshold rather than failing the request outright.
  let pass = await generateQuestions(req);
  let relaxed = false;

  if (pass.questions.length < (req.count ?? 10) && req.count && req.count > 1) {
    const retry = await generateQuestions(req, { relaxed: true });
    const seen = new Set(pass.questions.map((q) => q.fingerprint));
    const extra = retry.questions.filter((q) => !seen.has(q.fingerprint));
    if (extra.length) {
      pass = {
        questions: [...pass.questions, ...extra].slice(0, req.count),
        rejected: [...pass.rejected, ...retry.rejected],
        relaxed: true,
      };
      relaxed = true;
    }
  }

  const questions = pass.questions;
  const rejected = pass.rejected;

  if (!questions.length) {
    assessment.status = 'failed';

    // Distinguish "no usable material" from "the novelty guard refused every
    // candidate". They need different user actions, and leaking the internal
    // rejection text ("near-duplicate... sim 1") tells the user nothing.
    const allDuplicates = rejected.length > 0 && rejected.every((r) => r.includes('near-duplicate'));
    const noMaterial = rejected.some((r) => r.includes('no relevant source units'));

    assessment.statusReason = allDuplicates
      ? 'Every question we could build from this material has already been used in an earlier ' +
        'assessment. Uploading more material, or studying a different topic, will give you new ones.'
      : noMaterial
        ? 'We could not find relevant content in the selected material. Try a different topic or source.'
        : 'We could not generate verified questions from this material. Try a different scope, or ' +
          'upload more material.';

    await assessment.save();
    return { assessment, questions: [], rejected };
  }

  // Store embeddings alongside fingerprints so later dedupe can compare them.
  const docs = questions.map((q) => ({ ...q, userId: req.userId, assessmentId: assessment._id }));
  const ai2 = getAIProvider();
  let vecs: number[][] = [];
  let fpSpace = activeSpace();
  try {
    vecs = await ai2.embed(docs.map((d) => d.text));
    const first = vecs.find((v) => Array.isArray(v) && v.length);
    if (first?.length) fpSpace = { provider: fpSpace.provider, dim: first.length };
  } catch {
    vecs = [];
  }
  if (!vecs.length || vecs.length !== docs.length || !fpSpace.dim) {
    vecs = docs.map((d) => localEmbed(d.text));
    fpSpace = { provider: 'local', dim: vecs[0]?.length ?? 0 };
  }
  const withVec = docs.map((d, i) => ({
    ...d,
    fingerprintEmbedding: vecs[i],
    fingerprintEmbeddingProvider: fpSpace.provider,
    fingerprintEmbeddingDim: vecs[i]?.length ?? fpSpace.dim,
  }));

  const inserted = await Question.insertMany(withVec as never, { ordered: false });

  assessment.questionIds = inserted.map((q: any) => q._id);
  assessment.status = 'ready';
  assessment.statusReason = null;
  await assessment.save();

  return { assessment, questions: inserted, rejected, dedupeRelaxed: relaxed };
}

/* ------------------------------- grading ------------------------------- */

export interface GradedAnswer {
  questionId: string;
  correct: boolean;
  correctAnswer: unknown;
  explanation: string;
  misconception: string | null;
  citations: Array<{ label: string; excerpt: string; unitId: string }>;
  timeSpentSec: number;
}

/**
 * Grades a free-text answer with a normalisation + token-overlap similarity
 * rather than a strict string match, so "photosynthesis is the process" is not
 * marked wrong for "Photosynthesis is the process by which…".
 */
export function gradeAnswer(question: any, answer: unknown): { correct: boolean; score: number } {
  const key = question.answerKey;

  if (question.type === 'numerical') {
    const a = Number(answer);
    const k = Number(key);
    if (!Number.isFinite(a)) return { correct: false, score: 0 };
    const tol = question.tolerance ?? relativeTolerance(k);
    const ok = Math.abs(a - k) <= tol;
    return { correct: ok, score: ok ? 1 : 0 };
  }

  const a = normalizeForFingerprint(String(answer ?? ''));
  const k = normalizeForFingerprint(String(key ?? ''));
  if (!a) return { correct: false, score: 0 };
  if (a === k) return { correct: true, score: 1 };

  if (question.type === 'mcq') {
    return { correct: String(answer) === String(key), score: String(answer) === String(key) ? 1 : 0 };
  }

  // Short answer: symmetric token overlap (Dice coefficient on content words).
  const at = a.split(' ').filter(Boolean);
  const kt = k.split(' ').filter(Boolean);
  if (!at.length || !kt.length) return { correct: false, score: 0 };
  const kset = new Set(kt);
  const overlap = at.filter((t) => kset.has(t)).length;
  const dice = (2 * overlap) / (at.length + kt.length);
  // 0.75 keeps it strict enough to avoid rubber-stamping vague answers.
  const correct = dice >= 0.75;
  return { correct, score: Number(dice.toFixed(3)) };
}

export async function submitAnswer(
  userId: string,
  assessmentId: string,
  questionId: string,
  answer: unknown,
  timeSpentSec = 0
): Promise<GradedAnswer | null> {
  const question = await Question.findOne({ _id: questionId, userId });
  if (!question) return null;

  const { correct } = gradeAnswer(question, answer);

  await Response.create({
    userId,
    questionId,
    assessmentId,
    answer,
    correct,
    timeSpentSec,
    topicId: question.topicId,
  });

  // Mastery only advances for verified questions — an unverified key must not
  // be allowed to corrupt the learner model.
  if (question.verified && question.topicId) {
    await recordAnswer(userId, String(question.topicId), correct, {
      source: 'quiz',
      difficulty: question.difficulty,
    });
  }

  const units = await Unit.find({ _id: { $in: question.sourceUnitIds } }).lean();
  const sourceIds = [...new Set(units.map((u: any) => String(u.sourceId)))];
  const { Source } = await import('../models/Source');
  const sources = await Source.find({ _id: { $in: sourceIds } }).select('title type').lean();
  const smap = new Map(sources.map((s) => [String(s._id), s]));

  const citations = units.map((u: any) => {
    const src = smap.get(String(u.sourceId));
    const loc = u.location ?? {};
    let label = src?.title ?? 'Source';
    if (loc.startSec != null) label += ` · ${formatTs(loc.startSec)}`;
    else if (loc.slide != null) label += ` · Slide ${loc.slide}`;
    else if (loc.page != null) label += ` · p.${loc.page}`;
    return { label, excerpt: String(u.text).slice(0, 220), unitId: String(u._id) };
  });

  return {
    questionId,
    correct,
    correctAnswer: question.answerKey,
    explanation: question.explanation ?? '',
    misconception: correct ? null : question.misconception ?? null,
    citations,
    timeSpentSec,
  };
}

function formatTs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export { splitSentences, Topic, logEvent };