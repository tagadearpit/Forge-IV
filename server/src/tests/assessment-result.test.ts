import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNonblankAnswer, latestNonblankResponses, summarizeAssessment } from '../services/assessmentResult.js';
import { selectLegacyResponseToKeep } from '../services/assessmentResponseMigration.js';

test('assessment result ignores blank answers and caps score against distinct questions', () => {
  const result = summarizeAssessment(3, [
    { questionId: 'q1', answer: 'yes', correct: true, createdAt: new Date('2026-01-01') },
    { questionId: 'q1', answer: 'no', correct: false, createdAt: new Date('2026-01-02') },
    { questionId: 'q2', answer: '   ', correct: true },
    { questionId: 'q3', answer: '2', correct: true },
  ]);
  assert.equal(result.answered, 2);
  assert.equal(result.correct, 1);
  assert.equal(result.total, 3);
  assert.equal(result.unanswered, 1);
  assert.equal(result.score, 1 / 3);
});

test('blank and whitespace-only UI answers are not persisted or counted', () => {
  assert.equal(isNonblankAnswer(''), false);
  assert.equal(isNonblankAnswer('   \n'), false);
  assert.equal(isNonblankAnswer('0'), true);
  assert.equal(isNonblankAnswer(0), true);
});

test('legacy response migration retains the newest useful answer and falls back to newest blank', () => {
  const rows = [
    { _id: 'newest-blank', answer: '  ' },
    { _id: 'older-useful', answer: 'saved answer' },
  ];
  assert.equal(selectLegacyResponseToKeep(rows)?._id, 'older-useful');
  assert.equal(selectLegacyResponseToKeep([{ _id: 'blank', answer: '' }])?._id, 'blank');
});

test('legacy duplicate responses select the most recently saved row and ignore a latest blank', () => {
  const rows = latestNonblankResponses([
    { questionId: 'q1', answer: 'older', correct: true, updatedAt: new Date('2026-02-01') },
    { questionId: 'q1', answer: 'newer', correct: false, updatedAt: new Date('2026-02-02') },
    { questionId: 'q2', answer: 'stale answer', correct: true, updatedAt: new Date('2026-02-01') },
    { questionId: 'q2', answer: '   ', correct: true, updatedAt: new Date('2026-02-02') },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].answer, 'newer');
  assert.equal(summarizeAssessment(2, rows).score, 0);
});
