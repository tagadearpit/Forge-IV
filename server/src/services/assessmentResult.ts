export interface AssessmentResponseLike {
  questionId: unknown;
  answer: unknown;
  correct: boolean;
  topicId?: unknown;
  timeSpentSec?: number;
  updatedAt?: Date | string | number;
  createdAt?: Date | string | number;
}

export function isNonblankAnswer(answer: unknown): boolean {
  if (typeof answer === 'string') return answer.trim().length > 0;
  return answer !== null && answer !== undefined;
}

/** Collapse legacy duplicate response rows to the most recently saved answer. */
export function latestNonblankResponses<T extends AssessmentResponseLike>(rows: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const id = String(row.questionId);
    const prior = latest.get(id);
    const time = (value: T) => new Date(value.updatedAt ?? value.createdAt ?? 0).getTime();
    if (!prior || time(row) >= time(prior)) latest.set(id, row);
  }
  return [...latest.values()].filter((row) => isNonblankAnswer(row.answer));
}

export function summarizeAssessment(questionCount: number, rows: readonly AssessmentResponseLike[]) {
  const responses = latestNonblankResponses(rows);
  const correct = responses.filter((row) => row.correct).length;
  const total = Math.max(0, questionCount);
  const score = total ? Math.min(1, correct / total) : 0;
  return { responses, answered: responses.length, correct, total, unanswered: Math.max(0, total - responses.length), score };
}
