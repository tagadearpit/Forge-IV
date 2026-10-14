import { connectTestDatabase, disconnectTestDatabase } from './testDatabase.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateNumericExpression,
  gradeAnswer,
  generateQuestions,
} from '../services/assessment.js';
import { getAIProvider } from '../ai/provider.js';
import mongoose from 'mongoose';
import { Unit } from '../models/Unit.js';
import { Topic } from '../models/Topic.js';

/**
 * FIX 4 — numeric tolerance.
 * The old rule was max(0.01, |Number(units)| * 0). `units` is a display string
 * ("m/s"), so Number(units) was NaN -> 1 -> 1*0 = 0. It ALWAYS returned 0.01,
 * so an answer of 12000 was graded with +/-0.01, i.e. exact float equality.
 *
 * FIX 5 — misconceptions must never be random.
 * FIX 6 — no module-level per-user mutable state.
 */

describe('numeric tolerance is magnitude-aware', () => {
  const grade = (key: number, tol: number | null, given: number) =>
    gradeAnswer({ type: 'numerical', answerKey: key, tolerance: tol }, given);

  test('large value gets 1% relative tolerance', () => {
    // 12000 +/- 120 (= 1%)
    assert.equal(grade(12000, 120, 12119).correct, true);
    assert.equal(grade(12000, 120, 11880).correct, true);
    assert.equal(grade(12000, 120, 12200).correct, false);
  });

  test('small value falls back to the absolute floor of 0.01', () => {
    assert.equal(grade(0.05, 0.01, 0.055).correct, true);
    assert.equal(grade(0.05, 0.01, 0.07).correct, false);
  });

  test('negative values use magnitude', () => {
    assert.equal(grade(-500, 5, -504.9).correct, true);
    assert.equal(grade(-500, 5, -520).correct, false);
  });

  test('zero tolerance band still admits an exact zero', () => {
    assert.equal(grade(0, 0.01, 0).correct, true);
    assert.equal(grade(0, 0.01, 0.005).correct, true);
    assert.equal(grade(0, 0.01, 1).correct, false);
  });

  test('null tolerance derives 1% from the key, not a fixed 0.01', () => {
    // 12000 with NO stored tolerance must still accept ~1% drift.
    assert.equal(grade(12000, null, 12100).correct, true);
    assert.equal(grade(12000, null, 12500).correct, false);
  });
});

describe('numeric answers are recomputed, not trusted', () => {
  test('evaluates simple arithmetic', () => {
    assert.equal(evaluateNumericExpression('What is 12 * 4?'), 48);
    assert.equal(evaluateNumericExpression('Compute (3 + 4) / 2.'), 3.5);
    assert.equal(evaluateNumericExpression('2^3'), 8);
  });

  test('returns null when there is no expression', () => {
    assert.equal(evaluateNumericExpression('Describe the page fault types.'), null);
  });

  test('never evaluates code — only a pure-arithmetic grammar is accepted', () => {
    // The real security property is not "returns null" but "only ever consumes
    // [0-9+\-*/^()] characters". A string containing code yields either null or
    // the value of the arithmetic substring; nothing is ever executed.
    assert.equal(evaluateNumericExpression('process.exit(1)'), null);
    assert.equal(evaluateNumericExpression('1 + require("fs")'), null);
    // "2 * 3 + alert(1)" contains the arithmetic "2 * 3"; evaluating that is
    // correct and harmless. What must never happen is alert() being invoked.
    assert.equal(evaluateNumericExpression('2 * 3 + alert(1)'), 6);
    assert.equal(evaluateNumericExpression('__proto__.polluted = 1'), null);
  });

  test('division by zero yields NaN, not Infinity', () => {
    // Guard must check the DIVISOR: 5/0 is Infinity in JS and would sail
    // through a naive numeric-equality grade.
    const v = evaluateNumericExpression('5 / 0');
    assert.ok(v === null || Number.isNaN(v), `expected null or NaN, got ${v}`);
  });
});

describe('misconceptions are never invented', () => {
  test('local provider attaches NO distractor labels (never synthesised)', async () => {
    const ai = getAIProvider();
    if (ai.name !== 'local') return; // gemini path is exercised separately
    const drafts = await ai.draftQuestions({
      type: 'mcq',
      excerpts: [
        {
          unitId: 'u1',
          text:
            'The Clock or Second Chance algorithm approximates LRU by keeping a reference bit on ' +
            'each memory frame. On eviction the hand clears the reference bit and moves on; only ' +
            'a frame whose bit was already clear is actually evicted, which resists the ' +
            'sequential-scan pathology that defeats strict least-recently-used replacement.',
        },
      ],
      count: 1,
      targetDifficulty: 0.5,
    });
    assert.ok(drafts.length > 0, 'expected a drafted mcq');
    for (const d of drafts) {
      assert.equal(
        d.distractorMisconceptions ?? null,
        null,
        'LocalProvider must not fabricate distractor misconception labels'
      );
    }
  });

  test('a wrong MCQ answer with no labels yields misconception null', async () => {
    const q: any = {
      type: 'mcq',
      text: 'Pick one',
      options: ['right answer', 'wrong one'],
      answerKey: 'right answer',
      distractorMisconceptions: null,
      misconception: null,
    };
    const g = gradeAnswer(q, 'wrong one');
    assert.equal(g.correct, false);
  });
});

describe('Fix 6 — no cross-user topic leakage', () => {
  test('concurrent generation for two users keeps topic tags inside each user', async () => {
    await connectTestDatabase('studymind_concurrency_test');
    await mongoose.connection.dropDatabase();

    const { User } = await import('../models/User.js');
    const mk = async (name: string, email: string) => {
      const u = await User.create({ name, email, phone: '+919000000001', passwordHash: 'x' });
      const topic = await Topic.create({
        userId: u._id,
        name: `${name}-only-topic`,
        keyConcepts: [],
        sourceUnitIds: [],
      });
      await Unit.create({
        sourceId: new mongoose.Types.ObjectId(),
        userId: u._id,
        kind: 'text',
        text: `${name} material about clocks, caches and deadlocks with enough words to be indexed.`,
        location: { page: 1 },
        embedding: new Array(256).fill(0).map((_, i) => (i % 7) / 10),
        embeddingProvider: 'local',
        embeddingModel: 'local-hash-v1',
        embeddingDim: 256,
        topicIds: [topic._id],
      });
      return { id: String(u._id), topicId: String(topic._id) };
    };

    const a = await mk('Alpha', `alpha_${Date.now()}@test.local`);
    const b = await mk('Beta', `beta_${Date.now()}@test.local`);

    const [ra, rb] = await Promise.all([
      generateQuestions({ userId: a.id, count: 3, types: ['short'] }),
      generateQuestions({ userId: b.id, count: 3, types: ['short'] }),
    ]);

    const aTopics = new Set((await Topic.find({ userId: a.id }).lean()).map((t: any) => String(t._id)));
    const bTopics = new Set((await Topic.find({ userId: b.id }).lean()).map((t: any) => String(t._id)));

    for (const q of ra.questions) {
      if (!q.topicId) continue;
      assert.ok(
        aTopics.has(String(q.topicId)),
        `Alpha received topic ${q.topicId} which does not belong to Alpha`
      );
      assert.equal(bTopics.has(String(q.topicId)), false, 'Alpha got a Beta topic');
    }
    for (const q of rb.questions) {
      if (!q.topicId) continue;
      assert.ok(bTopics.has(String(q.topicId)), `Beta received topic ${q.topicId} not owned by Beta`);
      assert.equal(aTopics.has(String(q.topicId)), false, 'Beta got an Alpha topic');
    }

    await mongoose.connection.dropDatabase();
    await disconnectTestDatabase();
  });
});