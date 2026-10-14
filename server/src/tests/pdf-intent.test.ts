import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAmbiguousPdfIntent, detectPdfIntent } from '../services/pdfIntent.js';

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
