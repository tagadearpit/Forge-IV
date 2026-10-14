import { Types } from 'mongoose';
import { Response } from '../models/Response.js';
import { isNonblankAnswer } from './assessmentResult.js';

const RESPONSE_KEY = { userId: 1, assessmentId: 1, questionId: 1 } as const;

type LegacyResponse = { _id: Types.ObjectId; answer: unknown };

/** Input must be newest-first; preserve the newest useful answer, else the newest row. */
export function selectLegacyResponseToKeep<T extends { _id: unknown; answer: unknown }>(rows: readonly T[]): T | null {
  return rows.find((row) => isNonblankAnswer(row.answer)) ?? rows[0] ?? null;
}

/**
 * Collapse historical duplicate answers before installing the unique index.
 * For each key, keep the newest nonblank response (falling back to the newest
 * row only when every legacy answer is blank), using _id as a deterministic tie-break.
 * Startup calls this before accepting requests and fails closed on any error.
 */
export async function migrateAssessmentResponseUniqueness(): Promise<{ duplicateRowsRemoved: number }> {
  const collection = Response.collection;
  let duplicateRowsRemoved = 0;
  let currentKey = '';
  let groupRows: LegacyResponse[] = [];

  const flushGroup = async () => {
    if (groupRows.length < 2) return;
    const retainedId = selectLegacyResponseToKeep(groupRows)!._id;
    const removeIds = groupRows.filter((row) => !row._id.equals(retainedId as Types.ObjectId)).map((row) => row._id);
    if (removeIds.length) {
      const result = await collection.deleteMany({ _id: { $in: removeIds } });
      duplicateRowsRemoved += result.deletedCount ?? 0;
    }
  };

  const cursor = collection.find({}, {
    projection: { _id: 1, userId: 1, assessmentId: 1, questionId: 1, answer: 1, updatedAt: 1, createdAt: 1 },
  }).sort({ userId: 1, assessmentId: 1, questionId: 1, updatedAt: -1, createdAt: -1, _id: -1 });

  for await (const row of cursor) {
    const key = `${String(row.userId)}:${String(row.assessmentId)}:${String(row.questionId)}`;
    if (currentKey && key !== currentKey) {
      await flushGroup();
      groupRows = [];
    }
    currentKey = key;
    groupRows.push({ _id: row._id as Types.ObjectId, answer: row.answer });
  }
  await flushGroup();
  await cursor.close();

  const indexes = await collection.indexes().catch((err: unknown) => {
    // A newly created collection may not have indexes yet; other errors must fail startup.
    if ((err as { code?: number }).code === 26 || (err as { codeName?: string }).codeName === 'NamespaceNotFound') return [];
    throw err;
  });
  for (const index of indexes) {
    const sameKey = Object.entries(RESPONSE_KEY).every(([field, direction]) => index.key[field] === direction)
      && Object.keys(index.key).length === Object.keys(RESPONSE_KEY).length;
    if (sameKey && !index.unique && index.name) {
      await collection.dropIndex(index.name);
    }
  }

  // Explicit creation is ordered after cleanup; unique-index violations therefore
  // indicate a migration bug or a concurrent external writer and stop startup.
  await Response.createIndexes();
  return { duplicateRowsRemoved };
}
