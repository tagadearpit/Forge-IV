import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isUnhelpfulExcerptDump, makeReadableExtractiveAnswer } from '../services/answerFormatter.js';

describe('readable grounded-answer fallback', () => {
  const useful = 'Quantum computing represents information using quantum states, which can exist in a combination of basis states before measurement. Measurement converts the state into a classical outcome according to its probability amplitudes.';

  test('selects readable, distinct source sentences and formats them as Markdown', () => {
    const result = makeReadableExtractiveAnswer('What is measurement?', [
      { unitId: 'u1', text: `MONOGRAPH SERIES IN ADVANCED PHYSICS. ${useful}` },
      { unitId: 'u2', text: useful },
    ]);
    assert.match(result.answer, /^\*\*Short answer\*\*/);
    assert.match(result.answer, /### What it means/);
    assert.equal((result.answer.match(/Measurement converts/g) ?? []).length, 1);
    assert.ok(result.citedUnitIds.length > 0);
    assert.ok(!result.answer.includes('MONOGRAPH SERIES'));
  });

  test('detects OCR/header-heavy copied answer dumps without flagging concise prose', () => {
    const excerpts = [{ unitId: 'u1', text: `MONOGRAPH SERIES IN ADVANCED PHYSICS ${useful} ${useful}` }];
    assert.equal(isUnhelpfulExcerptDump(`${useful} ${useful} ${useful} ${useful} ${useful}`, excerpts), true);
    assert.equal(isUnhelpfulExcerptDump('Measurement changes a quantum state into an observed result.', excerpts), false);
  });
});
