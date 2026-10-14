import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import pdfParse from 'pdf-parse';
import { renderPdfReport } from '../services/pdfReport.js';

test('renderPdfReport preserves English, Hindi, paragraph breaks, citations and multiple pages', async () => {
  const paragraphs = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}: OSI layers explain network communication.\nयह हिन्दी पाठ है और इसमें आवश्यक जानकारी शामिल है।`).join('\n\n');
  const buffer = await renderPdfReport({
    answer: paragraphs,
    title: 'OSI Layers — अध्ययन रिपोर्ट',
    citations: [{ label: 'Page 4', sourceTitle: 'Networking notes', excerpt: 'Encapsulation moves data through the layers.' }],
    fontDir: path.resolve(process.cwd(), 'assets/fonts'),
  });
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  const parsed = await pdfParse(buffer);
  assert.ok(parsed.numpages > 1);
  assert.match(parsed.text, /OSI layers/);
  assert.match(parsed.text, /पाठ है/);
  assert.match(parsed.text, /Networking notes/);
  assert.match(parsed.text, /Paragraph 80/);
});
