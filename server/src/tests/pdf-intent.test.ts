import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAmbiguousPdfIntent, detectPdfIntent, resolvePdfTurn } from '../services/pdfIntent.js';

test('detects clear PDF generation requests for previous and new content', () => {
  assert.deepEqual(detectPdfIntent('make a PDF of this'), { kind: 'request', target: 'previous' });
  assert.deepEqual(detectPdfIntent('make this a PDF'), { kind: 'request', target: 'previous' });
  assert.deepEqual(detectPdfIntent('Create a PDF explaining page replacement'), { kind: 'request', target: 'new', contentQuestion: 'Explain page replacement.' });
  assert.equal(detectPdfIntent('What is a PDF?').kind, 'none');
});

test('leaves vague PDF requests for an optional classifier and resolves pronouns', () => {
  assert.deepEqual(detectPdfIntent('Could you make a PDF?'), { kind: 'ambiguous', target: 'new' });
  assert.deepEqual(detectPdfIntent('Can you PDF this?'), { kind: 'request', target: 'previous' });
});

test('handles the explicit acceptance phrases without turning generic document nouns into subjects', () => {
  assert.deepEqual(detectPdfIntent('What is a PDF?'), { kind: 'none', target: 'new' });
  assert.deepEqual(detectPdfIntent('Make a PDF of this'), { kind: 'request', target: 'previous' });
  assert.deepEqual(detectPdfIntent('Generate a PDF'), { kind: 'request', target: 'previous' });
  assert.deepEqual(detectPdfIntent('Create a PDF document'), { kind: 'request', target: 'previous' });
  assert.deepEqual(detectPdfIntent('Generate a PDF about OSI layers'), {
    kind: 'request', target: 'new', contentQuestion: 'Explain OSI layers.'
  });
  assert.deepEqual(detectPdfIntent('Create a PDF document explaining OSI layers'), {
    kind: 'request', target: 'new', contentQuestion: 'Explain OSI layers.'
  });
});

test('classifier errors preserve the ambiguous state for a safe clarification', async () => {
  const ambiguous = detectPdfIntent('Could you PDF the thing?');
  const result = await classifyAmbiguousPdfIntent(ambiguous, async () => { throw new Error('provider unavailable'); });
  assert.equal(result.kind, 'ambiguous');
});

test('recognizes the user’s tutor-chat PDF requests as referring to the visible previous answer', () => {
  assert.deepEqual(detectPdfIntent('Now generate a pdf for that kind of information'), { kind: 'request', target: 'previous' });
  assert.deepEqual(detectPdfIntent('make a pdf for that information'), { kind: 'request', target: 'previous' });
});

test('pending PDF clarification can be cancelled, after which the next question is ordinary tutor Q&A', () => {
  for (const wording of ['cancel that', 'never mind', 'forget the PDF']) {
    const cancelled = resolvePdfTurn(wording, true);
    assert.equal(cancelled.cancelled, true, wording);
    assert.equal(cancelled.effectiveQuestion, '', wording);
    assert.equal(cancelled.intent.kind, 'none', wording);
  }
  const nextTurn = resolvePdfTurn('What is a router?', false);
  assert.equal(nextTurn.cancelled, false);
  assert.equal(nextTurn.intent.kind, 'none');
});

test('pending clarification accepts a topic or an explicit previous-answer export', () => {
  assert.deepEqual(resolvePdfTurn('OSI layers', true), {
    cancelled: false,
    effectiveQuestion: 'OSI layers',
    intent: { kind: 'request', target: 'new', contentQuestion: 'Explain OSI layers.' },
  });
  assert.deepEqual(resolvePdfTurn('Make a PDF of the previous answer', true), {
    cancelled: false,
    effectiveQuestion: 'Make a PDF of the previous answer',
    intent: { kind: 'request', target: 'previous' },
  });
});

test('cancellation prefix can be followed by a regular tutor question', () => {
  const turn = resolvePdfTurn('Cancel that, explain OSI layers', true);
  assert.equal(turn.cancelled, true);
  assert.equal(turn.effectiveQuestion, 'explain OSI layers');
  assert.equal(turn.intent.kind, 'none');
});
