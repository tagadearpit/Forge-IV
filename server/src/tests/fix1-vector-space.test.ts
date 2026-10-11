import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity,
  safeCosineSimilarity,
  sameSpace,
  localEmbed,
  EMBEDDING_DIM,
} from '../utils/embedding';
import { Unit } from '../models/Unit';
import { retrieveUnits } from '../services/rag';
import { __setActiveSpace, activeSpace, groundingThresholds } from '../utils/vectorSpace';
import mongoose from 'mongoose';
import { getAIProvider } from '../ai/provider';

/**
 * FIX 1 — embedding-space consistency.
 *
 * The regression: retrieveUnits() embedded the query with the local hashing
 * vectoriser (256-dim) while stored units carried Gemini vectors (768-dim).
 * cosineSimilarity compared the first 256 components of two unrelated spaces
 * and returned noise, so retrieval silently degraded instead of failing.
 */

const FAKE_DIM = 8;

/** Deterministic stand-in provider returning fixed-dimension vectors. */
function fakeEmbed(text: string): number[] {
  const v = new Array<number>(FAKE_DIM).fill(0);
  for (let i = 0; i < text.length; i++) {
    v[i % FAKE_DIM] += text.charCodeAt(i) / 255 - 0.5;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

describe('cosineSimilarity never truncates silently', () => {
  test('throws on dimension mismatch instead of comparing a prefix', () => {
    const a = new Array(768).fill(0).map((_, i) => i / 768);
    const b = new Array(256).fill(0).map((_, i) => i / 256);
    assert.throws(
      () => cosineSimilarity(a, b),
      /dimension mismatch/i,
      'a 768 vs 256 comparison must throw, not silently compare 256 components'
    );
  });

  test('safeCosineSimilarity returns 0 on mismatch', () => {
    assert.equal(safeCosineSimilarity(new Array(768).fill(0.1), new Array(256).fill(0.1)), 0);
  });

  test('sameSpace detects compatibility', () => {
    assert.equal(sameSpace(new Array(8).fill(1), new Array(8).fill(1)), true);
    assert.equal(sameSpace(new Array(8).fill(1), new Array(9).fill(1)), false);
    assert.equal(sameSpace(undefined, new Array(8).fill(1)), false);
  });

  test('identical vectors still score 1.0', () => {
    const v = fakeEmbed('virtual memory subsystem');
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
  });

  test('localEmbed emits a fixed dimension', () => {
    assert.equal(localEmbed('anything at all').length, EMBEDDING_DIM);
  });
});

describe('retrieveUnits embeds the query in the units\' space', () => {
  let userId: string;

  async function seed() {
    await mongoose.connect('mongodb://127.0.0.1:27017/studymind_vectorspace_test');
    await mongoose.connection.dropDatabase();
    const { User } = await import('../models/User');
    const u = await User.create({
      name: 'Vector Space Tester',
      email: `vs_${Date.now()}@test.local`,
      phone: '+919000000099',
      passwordHash: 'x',
    });
    userId = String(u._id);
  }

  async function cleanup() {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    __setActiveSpace(null);
  }

  test('(a) query is embedded with the PROVIDER, and matching units are scored', async () => {
    await seed();
    // Force the active space to the fake provider's 8-dim output.
    __setActiveSpace({ provider: 'gemini', dim: FAKE_DIM });

    // Spy on the provider: prove retrieveUnits calls provider.embed for the query.
    const ai = getAIProvider();
    const original = ai.embed.bind(ai);
    let called = 0;
    let lastInput: string | null = null;
    (ai as any).embed = async (texts: string[]) => {
      called++;
      lastInput = texts[0];
      return texts.map(fakeEmbed);
    };

    await Unit.create({
      sourceId: new mongoose.Types.ObjectId(),
      userId,
      kind: 'text',
      text: 'The virtual memory subsystem provides isolation between processes.',
      location: { page: 1 },
      embedding: fakeEmbed('The virtual memory subsystem provides isolation between processes.'),
      embeddingProvider: 'gemini',
      embeddingDim: FAKE_DIM,
    });

    const hits = await retrieveUnits(userId, { question: 'virtual memory subsystem', topK: 5 });

    (ai as any).embed = original;

    assert.equal(called, 1, 'retrieveUnits must call the provider to embed the query');
    assert.equal(lastInput, 'virtual memory subsystem');
    assert.equal(hits.length, 1, 'a unit in the same 8-dim space must be retrievable');
    assert.ok(hits[0].similarity > 0, `expected a positive score, got ${hits[0].similarity}`);

    await cleanup();
  });

  test('(b) units in a DIFFERENT space are excluded, not mis-scored', async () => {
    await seed();
    __setActiveSpace({ provider: 'gemini', dim: FAKE_DIM });

    const ai = getAIProvider();
    const original = ai.embed.bind(ai);
    (ai as any).embed = async (texts: string[]) => texts.map(fakeEmbed);

    // One unit in the active 8-dim space...
    await Unit.create({
      sourceId: new mongoose.Types.ObjectId(),
      userId,
      kind: 'text',
      text: 'in the right space',
      location: { page: 1 },
      embedding: fakeEmbed('in the right space'),
      embeddingProvider: 'gemini',
      embeddingDim: FAKE_DIM,
    });
    // ...and one left over from the local provider at a different dimension.
    await Unit.create({
      sourceId: new mongoose.Types.ObjectId(),
      userId,
      kind: 'text',
      text: 'stale local vector in the wrong space',
      location: { page: 2 },
      embedding: localEmbed('stale local vector in the wrong space'),
      embeddingProvider: 'local',
      embeddingDim: EMBEDDING_DIM,
    });

    const hits = await retrieveUnits(userId, { question: 'anything', topK: 10 });

    (ai as any).embed = original;

    assert.equal(hits.length, 1, 'only the same-space unit may be returned');
    assert.equal(
      (hits[0] as any).text,
      'in the right space',
      'the foreign-space unit must be excluded'
    );

    await cleanup();
  });

  test('legacy units without embeddingProvider are accepted only if the dim matches', async () => {
    await seed();
    __setActiveSpace({ provider: 'local', dim: EMBEDDING_DIM });

    await Unit.create({
      sourceId: new mongoose.Types.ObjectId(),
      userId,
      kind: 'text',
      text: 'legacy unit with no space metadata',
      location: { page: 1 },
      embedding: localEmbed('legacy unit with no space metadata'),
      embeddingProvider: null,
      embeddingDim: null,
    });

    const hits = await retrieveUnits(userId, { question: 'legacy unit', topK: 5 });
    assert.equal(hits.length, 1, 'a dim-matching legacy unit must still be retrievable');

    await cleanup();
  });
});

describe('grounding thresholds are provider-specific', () => {
  test('local and gemini resolve independently', () => {
    const saved = { ...process.env };
    try {
      process.env.GROUNDING_SIMILARITY_THRESHOLD_LOCAL = '0.17';
      process.env.GROUNDING_SIMILARITY_THRESHOLD_GEMINI = '0.61';
      delete process.env.GROUNDING_SIMILARITY_THRESHOLD;
      delete process.env.GROUNDING_SIMILARITY_THRESHOLD_LEGACY;

      __setActiveSpace({ provider: 'local', dim: 256 });
      assert.equal(groundingThresholds().similarity, 0.17);

      __setActiveSpace({ provider: 'gemini', dim: 768 });
      assert.equal(groundingThresholds().similarity, 0.61);
    } finally {
      process.env = saved;
      __setActiveSpace(null);
    }
  });

  test('uncalibrated gemini fails CLOSED rather than using the local threshold', () => {
    const saved = { ...process.env };
    try {
      process.env.GROUNDING_SIMILARITY_THRESHOLD_LOCAL = '0.17';
      delete process.env.GROUNDING_SIMILARITY_THRESHOLD_GEMINI;
      delete process.env.GROUNDING_SIMILARITY_THRESHOLD;
      delete process.env.GROUNDING_SIMILARITY_THRESHOLD_LEGACY;
      __setActiveSpace({ provider: 'gemini', dim: 768 });

      const t = groundingThresholds();
      assert.equal(
        t.similarity,
        Number.POSITIVE_INFINITY,
        'with no Gemini calibration the gate must not admit on similarity alone'
      );
      __setActiveSpace(null);
    } finally {
      process.env = saved;
      __setActiveSpace(null);
    }
  });
});