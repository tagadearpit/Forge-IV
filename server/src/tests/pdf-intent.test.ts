import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPdfIntent } from '../services/pdfIntent.js';

test('detects clear PDF generation requests for previous and new content', () => {
  assert.deepEqual(detectPdfIntent('make a PDF of this'), { kind: 'request', target: 'previous' });
  assert.deepEqual(detectPdfIntent('make this a PDF'), { kind: 'request', target: 'previous' });
  assert.deepEqual(detectPdfIntent('Create a PDF explaining page replacement'), { kind: 'request', target: 'new', contentQuestion: 'Explain page replacement.' });
  assert.equal(detectPdfIntent('What is a PDF?').kind, 'none');
});

test('leaves vague PDF requests for an optional classifier and resolves pronouns', () => {
  assert.deepEqual(detectPdfIntent('Could you make a PDF?'), { kind: 'ambiguous', target: 'new' });
  assert.deepEqual(detectPdfIntent('Can you PDF this?'), { kind: 'ambiguous', target: 'previous' });
});

test('recognizes the user’s tutor-chat PDF requests as referring to the visible previous answer', () => {
  assert.deepEqual(detectPdfIntent('Now generate a pdf for that kind of information'), { kind: 'request', target: 'previous' });
  assert.deepEqual(detectPdfIntent('make a pdf for that information'), { kind: 'request', target: 'previous' });
});
