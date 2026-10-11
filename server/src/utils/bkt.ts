/**
 * Bayesian Knowledge Tracing + a memory-stability forgetting curve.
 *
 * BKT assumes each topic is a two-state hidden variable (Not-Learned / Learned)
 * and models four parameters per topic:
 *
 *   pT  transition   — P(learning the topic) on each opportunity you practise it
 *   pS  slip         — P(you know it but answer wrong)
 *   pG  guess        — P(you answer right without knowing it)
 *   pL  p(Learned)   — current posterior probability the topic is mastered
 *
 * Update rule. Given the prior p(L=1) = pL and an observation o:
 *
 *   Correct (o=1):   pL_post = pL(1-pS) / [ pL(1-pS) + (1-pL)pG ]
 *   Incorrect (o=0): pL_post = pL·pS   / [ pL·pS   + (1-pL)(1-pG) ]
 *
 * The denominator is the total probability of seeing that observation, so this
 * is a single Bayes step over the two-state hidden Markov model.
 *
 * Then the transition is applied for the NEXT opportunity:
 *
 *   pL_next = pL_post + (1 - pL_post)·pT
 *
 * The distinction matters: the posterior reflects evidence about the past, the
 * transition projects forward. Merging them (a common shortcut) inflates gains.
 */

export interface BKTParams {
  pT: number;
  pS: number;
  pG: number;
}

export const DEFAULT_BKT: BKTParams = { pT: 0.12, pS: 0.1, pG: 0.2 };
export const DEFAULT_P_LEARNED = 0.1;

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** One Bayes step of the BKT posterior. */
export function bktPosterior(pLearned: number, correct: boolean, params: BKTParams): number {
  const { pS, pG } = params;
  const pL = clamp01(pLearned);

  if (correct) {
    const numerator = pL * (1 - pS);
    const denominator = numerator + (1 - pL) * pG;
    return denominator > 0 ? clamp01(numerator / denominator) : pL;
  }
  const numerator = pL * pS;
  const denominator = numerator + (1 - pL) * (1 - pG);
  return denominator > 0 ? clamp01(numerator / denominator) : pL;
}

/** Projects the posterior forward one opportunity using the transition probability. */
export function bktTransition(pPosterior: number, params: BKTParams): number {
  return clamp01(pPosterior + (1 - pPosterior) * params.pT);
}

/** Full update after observing one response. */
export function bktUpdate(
  pLearned: number,
  correct: boolean,
  params: BKTParams = DEFAULT_BKT
): { pLearned: number; posterior: number } {
  const posterior = bktPosterior(pLearned, correct, params);
  return { posterior, pLearned: bktTransition(posterior, params) };
}

/**
 * Confidence that the mastery estimate is meaningful. Low until enough
 * attempts accumulate, so the UI can honestly show "low confidence" for a
 * topic the student has only just encountered.
 */
export function masteryConfidence(attempts: number): number {
  return clamp01(attempts / 8);
}

export function confidenceLabel(attempts: number): 'low' | 'medium' | 'high' {
  if (attempts >= 8) return 'high';
  if (attempts >= 3) return 'medium';
  return 'low';
}

/* ------------------------------------------------------------------ *
 * Forgetting curve / memory stability (FSRS-lite)
 * ------------------------------------------------------------------ */

/** Retention decays exponentially with elapsed time. stability is in days. */
export function retention(pLearned: number, daysSinceReview: number, stability: number): number {
  if (daysSinceReview <= 0) return clamp01(pLearned);
  const s = Math.max(0.1, stability);
  return clamp01(pLearned * Math.exp(-daysSinceReview / s));
}

export interface StabilityUpdate {
  stability: number;
  retrievability: number;
}

/**
 * FSRS-lite stability update.
 *
 * A successful recall when retrievability was still low is strong evidence and
 * yields a large stability jump; a success when retention was already ~1 barely
 * moves it. Failure shrinks stability sharply.
 */
export function updateStability(
  stability: number,
  correct: boolean,
  daysSinceReview: number,
  difficulty = 0.5
): StabilityUpdate {
  const s = Math.max(0.1, stability);
  const days = Math.max(0, daysSinceReview);
  const retrievability = Math.exp(-days / s);

  // Harder items (higher difficulty) get a shorter stability growth rate.
  const difficultyFactor = 1.25 - difficulty * 0.5;

  let next: number;
  if (correct) {
    const growth = (0.9 + (1 - retrievability) * 2.2) * difficultyFactor;
    next = s * (1 + growth);
  } else {
    const penalty = 0.35 + (1 - difficulty) * 0.15;
    next = Math.max(0.5, s * penalty);
  }
  return { stability: Number(next.toFixed(4)), retrievability: Number(retrievability.toFixed(4)) };
}

/**
 * Zone of Proximal Development. Topics already mastered (or hopeless) teach the
 * least; mastery in this band yields the biggest learning gain per minute.
 */
export function inZPD(pLearned: number, low = 0.3, high = 0.7): boolean {
  return pLearned >= low && pLearned <= high;
}

/** Estimated minutes needed on a topic, scaled by how weak and how urgent it is. */
export function priorityScore(
  pLearned: number,
  retentionValue: number,
  attempts: number,
  daysToExam: number | null
): number {
  const weakness = 1 - pLearned;
  const decay = 1 - retentionValue;
  const ignorance = attempts === 0 ? 0.5 : 0; // untouched topics carry extra risk
  let urgency = 0;
  if (daysToExam !== null && daysToExam > 0) {
    // Urgency rises as the exam approaches.
    urgency = clamp01(1 - daysToExam / 60);
  }
  return Number((weakness * 0.5 + decay * 0.3 + ignorance * 0.2 + urgency * 0.4).toFixed(4));
}

export function masteryBand(pLearned: number): 'weak' | 'developing' | 'strong' {
  if (pLearned < 0.4) return 'weak';
  if (pLearned <= 0.7) return 'developing';
  return 'strong';
}

export function daysBetween(from: Date | null | undefined, to: Date = new Date()): number {
  if (!from) return 0;
  return Math.max(0, (to.getTime() - new Date(from).getTime()) / 86_400_000);
}