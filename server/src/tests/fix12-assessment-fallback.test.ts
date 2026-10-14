import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectTestDatabase, disconnectTestDatabase } from './testDatabase.js';
import { getAIProvider, localEmbed, type DraftQuestion } from '../ai/provider.js';
import { Assessment } from '../models/Assessment.js';
import { Question } from '../models/Question.js';
import { Unit } from '../models/Unit.js';
import { createAssessment } from '../services/assessment.js';
import { fingerprint } from '../utils/embedding.js';

test('quiz generation broadens adaptive retrieval within source scope but still verifies and deduplicates', async (t) => {
  const ai = getAIProvider();
  if (ai.name !== 'local') {
    t.skip('Regression uses the deterministic local provider; Gemini is covered by provider integration tests.');
    return;
  }

  await connectTestDatabase('studymind_assessment_fallback_test');
  await mongoose.connection.dropDatabase();

  const userId = new mongoose.Types.ObjectId();
  const allowedSourceId = new mongoose.Types.ObjectId();
  const unrelatedSourceId = new mongoose.Types.ObjectId();
  const text =
    'Quantum entanglement describes correlations between particles that cannot be explained by classical physics.';
  const otherText = 'Unrelated classical mechanics discusses force, mass, acceleration, and motion.';
  const embeddingModel = ai.embeddingModel;
  const embedding = localEmbed(text);
  const unrelatedEmbedding = localEmbed(otherText);
  await Unit.create([
    {
      sourceId: allowedSourceId,
      userId,
      kind: 'text',
      text,
      location: { page: 1 },
      embedding,
      embeddingProvider: 'local',
      embeddingModel,
      embeddingDim: embedding.length,
      topicIds: [],
    },
    {
      sourceId: unrelatedSourceId,
      userId,
      kind: 'text',
      text: otherText,
      location: { page: 1 },
      embedding: unrelatedEmbedding,
      embeddingProvider: 'local',
      embeddingModel,
      embeddingDim: unrelatedEmbedding.length,
      topicIds: [],
    },
  ]);

  const duplicateText = 'What describes quantum entanglement?';
  await Question.create({
    userId,
    type: 'short',
    text: duplicateText,
    answerKey: 'quantum entanglement',
    explanation: 'Previously used question.',
    sourceUnitIds: [],
    fingerprint: fingerprint(duplicateText),
  });

  const draftsSeen: string[][] = [];
  const originalDraftQuestions = ai.draftQuestions;
  let call = 0;
  ai.draftQuestions = async (opts): Promise<DraftQuestion[]> => {
    call++;
    draftsSeen.push(opts.excerpts.map((excerpt) => excerpt.text));
    // Force the initial adaptive attempt to produce nothing. The broader retry
    // deliberately offers one unsupported answer, one exact duplicate, and one
    // grounded, novel answer so all three quality gates are exercised.
    if (call === 1) return [];
    return [
      {
        type: 'short',
        text: 'What is the name of the Moon of Jupiter?',
        answerKey: 'Europa',
        explanation: 'Test draft.',
        difficulty: 0.5,
        citedIndices: [1],
      },
      {
        type: 'short',
        text: duplicateText,
        answerKey: 'quantum entanglement',
        explanation: 'Previously asked.',
        difficulty: 0.5,
        citedIndices: [1],
      },
      {
        type: 'short',
        text: 'What describes quantum entanglement in this material?',
        answerKey: 'quantum entanglement',
        explanation: 'The text directly describes these correlations.',
        difficulty: 0.5,
        citedIndices: [1],
      },
    ];
  };

  try {
    const result = await createAssessment({
      userId: String(userId),
      count: 1,
      types: ['short'],
      scope: { sourceIds: [String(allowedSourceId)] },
    });

    assert.equal(call, 2, 'a zero-question adaptive attempt should trigger the broader retry');
    assert.ok(draftsSeen.flat().includes(text));
    assert.equal(draftsSeen.flat().includes(otherText), false, 'broader retry must preserve source scope');
    assert.equal(result.assessment.status, 'ready');
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].verified, true, 'only verified questions are persisted');
    assert.ok(result.rejected.some((reason) => reason.includes('failed verification')));
    assert.ok(result.rejected.some((reason) => reason.includes('near-duplicate')));
  } finally {
    ai.draftQuestions = originalDraftQuestions;
    await Assessment.deleteMany({ userId });
    await Question.deleteMany({ userId });
    await Unit.deleteMany({ userId });
    await disconnectTestDatabase();
  }
});
