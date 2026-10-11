import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { EvalRun } from '../models/EvalRun';
import { Unit } from '../models/Unit';
import { Source } from '../models/Source';
import { Topic } from '../models/Topic';
import { asyncHandler, ApiError } from '../middleware/error';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { heavyLimiter } from '../middleware/rateLimit';
import { answerQuestion, retrieveUnits } from '../services/rag';
import { getAIProvider } from '../ai/provider';
import { contentWords } from '../utils/text';

const router = Router();

/**
 * System evaluation endpoint (PDF Requirement 5).
 *
 * Metrics here are computed against a team-built test set whose entries carry
 * known ground-truth unit IDs, so faithfulness / context precision / recall /
 * refusal accuracy / citation accuracy are all measurable.
 *
 * `framework` records how the numbers were produced:
 *   - 'ragas'        when /evaluation/run_eval.py has written results
 *   - 'local-exact'  for the built-in metric implementation below
 * We never label one as the other.
 */

export interface TestSetEntry {
  question: string;
  referenceAnswer: string;
  groundTruthUnitIds: string[];
  isOffMaterial: boolean;
}

/* ------------------------- metric implementation ----------------------- */

function tokenF1(pred: string, ref: string): number {
  const p = contentWords(pred);
  const r = contentWords(ref);
  if (!p.length || !r.length) return 0;
  const rset = new Set(r);
  const overlap = p.filter((t) => rset.has(t)).length;
  if (!overlap) return 0;
  const precision = overlap / p.length;
  const recall = overlap / r.length;
  return (2 * precision * recall) / (precision + recall);
}

/** Fraction of answer sentences whose content words appear in the cited text. */
export function faithfulness(answer: string, citedText: string): number {
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
  if (!sentences.length) return 1;
  const haystack = new Set(contentWords(citedText));
  const supported = sentences.filter((s) => {
    const terms = contentWords(s);
    if (!terms.length) return true;
    const hit = terms.filter((t) => haystack.has(t)).length;
    return hit / terms.length >= 0.5;
  });
  return Number((supported.length / sentences.length).toFixed(4));
}

export function answerRelevancy(answer: string, question: string): number {
  return Number(tokenF1(answer, question).toFixed(4));
}

export function contextPrecision(retrieved: string[], groundTruth: string[]): number {
  if (!retrieved.length) return 0;
  const gt = new Set(groundTruth);
  const relevant = retrieved.filter((id) => gt.has(id));
  return Number((relevant.length / retrieved.length).toFixed(4));
}

export function contextRecall(retrieved: string[], groundTruth: string[]): number {
  if (!groundTruth.length) return 1;
  const got = new Set(retrieved);
  const hits = groundTruth.filter((id) => got.has(id));
  return Number((hits.length / groundTruth.length).toFixed(4));
}

export function citationAccuracy(cited: string[], groundTruth: string[]): number {
  if (!cited.length) return groundTruth.length ? 0 : 1;
  const gt = new Set(groundTruth);
  const correct = cited.filter((id) => gt.has(id));
  return Number((correct.length / cited.length).toFixed(4));
}

/* ------------------------------ runner --------------------------------- */

export async function runLocalEval(userId: string, limit = 40) {
  const testsetPath = path.resolve(process.cwd(), '../evaluation/testset.json');
  if (!fs.existsSync(testsetPath)) {
    throw new ApiError(
      404,
      'TESTSET_MISSING',
      'No evaluation test set found. Run evaluation/build_testset.py first.'
    );
  }
  // testset.json is { version, entries[], ... } — the array lives under
  // `entries`, not at the top level.
  const parsed = JSON.parse(fs.readFileSync(testsetPath, 'utf8')) as
    | TestSetEntry[]
    | { entries: TestSetEntry[] };
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries) || !entries.length) {
    throw new ApiError(422, 'TESTSET_EMPTY', 'The evaluation test set is empty.');
  }

  const agg = {
    faithfulness: 0,
    answer_relevancy: 0,
    context_precision: 0,
    context_recall: 0,
    refusal_accuracy: 0,
    citation_accuracy: 0,
  };
  let n = 0;
  let offMaterial = 0;
  let offMaterialCorrect = 0;
  const failures: string[] = [];

  // A plain slice(0, limit) would take only the leading in-material entries and
  // silently drop every off-material query (they sort last), leaving
  // refusal_accuracy undefined. Sample proportionally instead.
  const inAll = entries.filter((e) => !e.isOffMaterial);
  const offAll = entries.filter((e) => e.isOffMaterial);
  const offQuota = Math.min(offAll.length, Math.max(1, Math.round(limit * 0.25)));
  const inQuota = Math.max(1, limit - offQuota);
  const sample = [...inAll.slice(0, inQuota), ...offAll.slice(0, offQuota)];

  for (const entry of sample) {
    let hits: Awaited<ReturnType<typeof retrieveUnits>> = [];
    try {
      hits = await retrieveUnits(userId, { question: entry.question, topK: 8 });
    } catch {
      failures.push(entry.question);
      continue;
    }
    const retrievedIds = hits.map((h) => h.unitId);
    const result = await answerQuestion(userId, entry.question);

    if (entry.isOffMaterial) {
      offMaterial++;
      // "Correct" = declined or flagged rather than confidently answering.
      if (result.groundingStatus === 'outside_material') offMaterialCorrect++;
      continue;
    }

    // Use the full unit text: `citation.excerpt` is truncated to 240 chars for
    // the UI, so scoring against it understates faithfulness for any answer
    // drawing on a longer passage. This matches evaluation/run_eval.py.
    const citedIds = result.citations.map((c) => c.unitId);
    const fullUnits = citedIds.length
      ? await Unit.find({ _id: { $in: citedIds } }).select('text').lean()
      : [];
    const fullById = new Map(fullUnits.map((u: any) => [String(u._id), u.text as string]));
    const citedText =
      result.citations.map((c) => fullById.get(c.unitId) ?? c.excerpt).join(' ') || '';
    agg.faithfulness += faithfulness(result.answer, citedText);
    agg.answer_relevancy += answerRelevancy(result.answer, entry.question);
    agg.context_precision += contextPrecision(retrievedIds, entry.groundTruthUnitIds);
    agg.context_recall += contextRecall(retrievedIds, entry.groundTruthUnitIds);
    agg.citation_accuracy += citationAccuracy(
      result.citations.map((c) => c.unitId),
      entry.groundTruthUnitIds
    );
    n++;
  }

  const div = n || 1;
  const metrics = {
    faithfulness: Number((agg.faithfulness / div).toFixed(4)),
    answer_relevancy: Number((agg.answer_relevancy / div).toFixed(4)),
    context_precision: Number((agg.context_precision / div).toFixed(4)),
    context_recall: Number((agg.context_recall / div).toFixed(4)),
    citation_accuracy: Number((agg.citation_accuracy / div).toFixed(4)),
    refusal_accuracy: Number((offMaterial ? offMaterialCorrect / offMaterial : 0).toFixed(4)),
    evaluated: n,
    off_material_tested: offMaterial,
    off_material_declined: offMaterialCorrect,
    retrieval_failures: failures.length,
    sampling: `first ${inQuota} in-material + first ${offQuota} off-material`,
  };

  const run = await EvalRun.create({
    userId,
    framework: 'local-exact',
    metrics,
    personalization: null,
    testSetVersion: 'v1',
    notes:
      'Computed by the in-app evaluator against evaluation/testset.json. ' +
      'Faithfulness here is lexical support (fraction of answer sentences whose content words ' +
      'appear in cited excerpts) — a conservative lower bound versus an LLM-judge method.',
  });

  const resultsDir = path.resolve(process.cwd(), '../evaluation/results');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, `local-eval-${run._id}.json`),
    JSON.stringify({ metrics, createdAt: run.createdAt }, null, 2)
  );

  return { runId: String(run._id), metrics };
}

/* ------------------------------- routes -------------------------------- */

router.get(
  '/results',
  asyncHandler(async (_req, res) => {
    // Evaluation results are properties of the SYSTEM, not of one student, so the
  // latest run is global. (Querying userId:null here would always miss runs
  // recorded against a specific account and the landing page would stay empty.)
  const run = await EvalRun.findOne({}).sort({ createdAt: -1 }).lean();
    if (!run) {
      res.json({
        metrics: null,
        message: 'Run evaluation to populate.',
        framework: null,
      });
      return;
    }
    res.json({ metrics: run.metrics, personalization: run.personalization, framework: run.framework, createdAt: run.createdAt });
  })
);

router.post(
  '/run',
  requireAuth,
  heavyLimiter,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await runLocalEval(req.userId!);
    res.json(result);
  })
);

export default router;