import mongoose from 'mongoose';
import { Event } from '../models/Event.js';

export type EventType =
  | 'quiz_taken'
  | 'question_asked'
  | 'source_uploaded'
  | 'source_ready'
  | 'login'
  | 'revision_reviewed'
  | 'study_task_done';

/** YYYY-MM-DD in UTC — a denormalised key so streak maths is an index scan. */
export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fire-and-forget activity logging. Never allowed to break a request path, so
 * failures are swallowed after being logged.
 */
export async function logEvent(
  userId: string,
  type: EventType,
  topicId?: string | null,
  correct?: boolean | null,
  source = 'app',
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await Event.create({
      userId,
      type,
      topicId: topicId ?? null,
      correct: correct ?? null,
      source,
      meta: meta ?? null,
      day: dayKey(),
      timestamp: new Date(),
    });
  } catch (err) {
    console.warn('[events] failed to record event', (err as Error).message);
  }
}

/**
 * Consecutive days ending today (or yesterday, so an unfinished today does not
 * read as a broken streak) with at least one logged event.
 */
export async function computeStreak(userId: string): Promise<number> {
  // NOTE: Mongoose does NOT cast values inside aggregation $match (unlike
  // find()). Passing the raw string here silently matched nothing, so the
  // streak was always 0. Cast explicitly.
  const oid = new mongoose.Types.ObjectId(String(userId));
  const rows = await Event.aggregate<{ _id: string }>([
    { $match: { userId: oid } },
    { $group: { _id: '$day' } },
    { $sort: { _id: -1 } },
  ]);

  // $group {_id: '$day'} yields rows shaped {_id}, not {day}.
  const days = rows.map((r) => r._id).sort().reverse();
  if (!days.length) return 0;

  const today = new Date();
  const todayKey = dayKey(today);
  const yesterdayKey = dayKey(new Date(today.getTime() - 86_400_000));

  // The streak is only "live" if the most recent day is today or yesterday.
  if (days[0] !== todayKey && days[0] !== yesterdayKey) return 0;

  let streak = 1;
  const cursor = new Date(`${days[0]}T00:00:00.000Z`);
  for (let i = 1; i < days.length; i++) {
    const expected = new Date(cursor.getTime() - 86_400_000);
    if (days[i] === dayKey(expected)) {
      streak++;
      cursor.setTime(expected.getTime());
    } else break;
  }
  return streak;
}