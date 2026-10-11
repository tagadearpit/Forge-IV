import { Mastery } from '../models/Mastery';
import { Topic } from '../models/Topic';
import { User } from '../models/User';
import {
  DEFAULT_BKT,
  DEFAULT_P_LEARNED,
  bktUpdate,
  clamp01,
  confidenceLabel,
  daysBetween,
  inZPD,
  masteryBand,
  masteryConfidence,
  priorityScore,
  retention,
  updateStability,
} from '../utils/bkt';
import { logEvent } from './events';

/**
 * Learner-model service: owns every read/write of per-topic mastery so the BKT
 * maths in utils/bkt.ts stays pure and testable.
 */

export interface TopicMasteryView {
  topicId: string;
  name: string;
  pLearned: number;
  retention: number;
  confidence: number;
  confidenceLabel: 'low' | 'medium' | 'high';
  band: 'weak' | 'developing' | 'strong';
  attempts: number;
  lastReviewedAt: Date | null;
  lastReviewedDaysAgo: number;
  stability: number;
  history: Array<{ at: Date; pLearned: number; retention: number }>;
  priority: number;
  daysToExam: number | null;
}

export async function getMasteryRecord(userId: string, topicId: string) {
  let rec = await Mastery.findOne({ userId, topicId });
  if (!rec) {
    rec = await Mastery.create({
      userId,
      topicId,
      pLearned: DEFAULT_P_LEARNED,
      pSlip: DEFAULT_BKT.pS,
      pGuess: DEFAULT_BKT.pG,
      pTransit: DEFAULT_BKT.pT,
      attempts: 0,
      stability: 1,
      history: [],
    });
  }
  return rec;
}

/**
 * Records one graded response against a topic and advances the model.
 * This is the single write path for mastery, so dashboard / mastery / study
 * plan can never disagree with each other.
 */
export async function recordAnswer(
  userId: string,
  topicId: string,
  correct: boolean,
  opts: { source?: string; difficulty?: number } = {}
): Promise<{ pLearned: number; retention: number; band: string }> {
  const rec = await getMasteryRecord(userId, topicId);
  const params = { pT: rec.pTransit, pS: rec.pSlip, pG: rec.pGuess };

  const before = rec.pLearned;
  const { pLearned } = bktUpdate(before, correct, params);

  const days = daysBetween(rec.lastReviewedAt);
  const { stability } = updateStability(
    rec.stability,
    correct,
    days,
    opts.difficulty ?? 0.5
  );
  const currentRetention = retention(pLearned, 0, stability);

  rec.pLearned = clamp01(pLearned);
  rec.stability = stability;
  rec.attempts = (rec.attempts ?? 0) + 1;
  if (correct) rec.correctCount = (rec.correctCount ?? 0) + 1;
  rec.lastReviewedAt = new Date();
  rec.lastSeenAt = new Date();
  rec.source = opts.source ?? 'quiz';

  // Keep a bounded history for the sparkline / mastery-over-time chart.
  rec.history.push({
    at: new Date(),
    pLearned: rec.pLearned,
    retention: currentRetention,
  } as never);
  if (rec.history.length > 200) rec.history.splice(0, rec.history.length - 200) as never;

  await rec.save();

  return {
    pLearned: rec.pLearned,
    retention: currentRetention,
    band: masteryBand(rec.pLearned),
  };
}

/**
 * Cold start: blend the student's self-rated familiarity with a flat prior.
 * Confidence stays "low" until real attempts arrive, so the UI never implies
 * we know more than we do.
 */
export async function applyIntakePrior(
  userId: string,
  topicId: string,
  selfRating: number
): Promise<void> {
  const rec = await getMasteryRecord(userId, topicId);
  // Self-rating is 1..5; map to 0.15..0.6 so it never starts a student "mastered".
  const prior = 0.15 + (clamp01(selfRating / 5) * 0.45);
  const weight = rec.attempts === 0 ? 1 : 0.3;
  rec.pLearned = clamp01(rec.pLearned * (1 - weight) + prior * weight);
  rec.history.push({ at: new Date(), pLearned: rec.pLearned, retention: rec.pLearned } as never);
  await rec.save();
}

export async function getMasteryOverview(userId: string): Promise<TopicMasteryView[]> {
  const [topics, records, user] = await Promise.all([
    Topic.find({ userId }).lean(),
    Mastery.find({ userId }).lean(),
    User.findById(userId).lean(),
  ]);

  const topicMap = new Map(topics.map((t) => [String(t._id), t]));
  const recMap = new Map(records.map((r) => [String(r.topicId), r]));

  const daysToExam = user?.prefs?.examDate
    ? Math.ceil((new Date(user.prefs.examDate).getTime() - Date.now()) / 86_400_000)
    : null;

  // Topics with no mastery row yet still deserve a row (weakest first).
  const rows: TopicMasteryView[] = [];

  for (const t of topics) {
    const id = String(t._id);
    const rec = recMap.get(id);
    const pLearned = rec?.pLearned ?? DEFAULT_P_LEARNED;
    const stability = rec?.stability ?? 1;
    const days = rec?.lastReviewedAt ? daysBetween(rec.lastReviewedAt) : 0;
    const ret = retention(pLearned, days, stability);
    const attempts = rec?.attempts ?? 0;

    rows.push({
      topicId: id,
      name: t.name,
      pLearned: Number(pLearned.toFixed(4)),
      retention: Number(ret.toFixed(4)),
      confidence: Number(masteryConfidence(attempts).toFixed(4)),
      confidenceLabel: confidenceLabel(attempts),
      band: masteryBand(pLearned),
      attempts,
      lastReviewedAt: rec?.lastReviewedAt ?? null,
      lastReviewedDaysAgo: Number(days.toFixed(1)),
      stability: Number(stability.toFixed(4)),
      history: ((rec?.history ?? []) as Array<{ at: Date; pLearned: number; retention: number }>).map(
        (h) => ({ at: h.at, pLearned: h.pLearned, retention: h.retention })
      ),
      priority: priorityScore(pLearned, ret, attempts, daysToExam),
      daysToExam,
    });
  }

  rows.sort((a, b) => b.priority - a.priority);
  return rows;
}

/**
 * Topic selection for the next question: prefer the Zone of Proximal
 * Development, then the highest forgetting-curve urgency. Returns at most `n`.
 */
export async function selectAdaptiveTopics(userId: string, n = 3): Promise<string[]> {
  const overview = await getMasteryOverview(userId);
  if (!overview.length) return [];

  const zpd = overview.filter((t) => inZPD(t.pLearned));
  const pool = zpd.length ? zpd : overview.filter((t) => t.band !== 'strong');
  const source = (pool.length ? pool : overview).slice(0, n);

  return source.map((t) => t.topicId);
}

/** Summary statistics for the dashboard KPI row. */
export async function getMasterySummary(userId: string) {
  const overview = await getMasteryOverview(userId);
  if (!overview.length) {
    return { overall: 0, mastered: 0, total: 0, weak: [], developing: [], strong: [] };
  }
  const overall = overview.reduce((s, t) => s + t.pLearned, 0) / overview.length;
  return {
    overall: Number((overall * 100).toFixed(1)),
    mastered: overview.filter((t) => t.band === 'strong').length,
    total: overview.length,
    weak: overview.filter((t) => t.band === 'weak').slice(0, 3),
    developing: overview.filter((t) => t.band === 'developing').slice(0, 3),
    strong: overview.filter((t) => t.band === 'strong').slice(0, 3),
  };
}