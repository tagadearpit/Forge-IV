import { priorityScore, inZPD } from '../utils/bkt.js';

/**
 * ============================================================================
 * Adaptive topic-selection policy (pure)
 * ============================================================================
 * Extracted so it can be imported by the simulation harness without going
 * through HTTP or an LLM-dependent path. `generateQuestions` calls this exact
 * function — there is no second copy of the policy anywhere.
 */

export interface MasterySnapshot {
  topicId: string;
  pLearned: number;
  retention: number;
  attempts: number;
  stability: number;
  daysToExam: number | null;
}

/** Priority of a topic for being asked next. Higher = more urgent. */
export function topicPriority(s: MasterySnapshot): number {
  return priorityScore(s.pLearned, s.retention, s.attempts, s.daysToExam);
}

/**
 * Picks the next topic to ask about.
 *
 * `history` is the list of (session, topicId) pairs already asked, used only to
 * avoid re-asking a topic asked in the SAME session when alternatives exist.
 * Returns a topicId, or null when there is nothing to ask about.
 */
export function selectNextTopic(
  mastery: MasterySnapshot[],
  history: Array<[number, string]> = [],
  session = 0
): string {
  if (!mastery.length) return '';

  const askedThisSession = new Set(
    history.filter(([s]) => s === session).map(([, t]) => t)
  );

  const ranked = [...mastery].sort((a, b) => topicPriority(b) - topicPriority(a));

  // Prefer a topic not already asked this session, but fall back to the most
  // urgent one rather than returning nothing.
  const fresh = ranked.find((t) => !askedThisSession.has(t.topicId));
  return (fresh ?? ranked[0]).topicId;
}

/**
 * Selects up to `n` topics, preferring the Zone of Proximal Development.
 * Used when an assessment spans several topics.
 */
export function selectAdaptiveTopics(
  mastery: MasterySnapshot[],
  n = 3
): string[] {
  if (!mastery.length) return [];
  const zpd = mastery.filter((m) => inZPD(m.pLearned));
  const pool = (zpd.length ? zpd : mastery).sort(
    (a, b) => topicPriority(b) - topicPriority(a)
  );
  return pool.slice(0, n).map((m) => m.topicId);
}