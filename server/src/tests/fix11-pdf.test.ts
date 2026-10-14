import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import pdfParse from 'pdf-parse';
import { signPdfDownloadToken, validatePdfDownloadToken } from '../services/pdfSecurity.js';
import { reconstructLines } from '../services/extractors.js';

const fonts = path.resolve(process.cwd(), 'assets/fonts');

test('Noto font PDF parses with multiple numbered pages and Hindi glyph text', async () => {
  assert.ok(fs.existsSync(path.join(fonts, 'NotoSans.ttf')));
  assert.ok(fs.existsSync(path.join(fonts, 'NotoSansDevanagari.ttf')));
  const doc = new PDFDocument({ size: 'A4', bufferPages: true });
  doc.registerFont('NotoSans', path.join(fonts, 'NotoSans.ttf'));
  doc.registerFont('NotoHindi', path.join(fonts, 'NotoSansDevanagari.ttf'));
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.font('NotoSans').text('StudyMind PDF page one');
  doc.addPage().font('NotoHindi').text('नमस्ते, यह हिन्दी परीक्षण है।');
  doc.end();
  const buffer = await finished;
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  const parsed = await pdfParse(buffer);
  assert.equal(parsed.numpages, 2);
  assert.match(parsed.text, /StudyMind PDF page one/);
  assert.match(parsed.text, /नमस्ते/);
});

test('PDF text reconstruction joins tracked characters but preserves word boundaries', () => {
  const content = 'QUANTUM COMPUTING: STATE OF THE ART';
  const items: Array<{ str: string; transform: number[]; width: number; height: number }> = [];
  let x = 0;
  for (const character of content) {
    if (character === ' ') {
      x += 3;
      continue;
    }
    items.push({ str: character, transform: [1, 0, 0, 10, x, 100], width: 5, height: 10 });
    x += 5;
  }
  assert.equal(reconstructLines(items), content);
});

test('PDF text reconstruction handles missing widths, punctuation, line breaks, and Hindi', () => {
  const content = 'Quantum: state of the art.\nक्वांटम कंप्यूटिंग';
  const lines = [
    'Quantum: state of the art.',
    'क्वांटम कंप्यूटिंग',
  ];
  const items: Array<{ str: string; transform: number[]; width?: number; height: number }> = [];
  for (const [lineIndex, line] of lines.entries()) {
    let x = 0;
    for (const character of line) {
      if (character === ' ') {
        x += 3;
        continue;
      }
      items.push({
        str: character,
        transform: [1, 0, 0, 10, x, 100 - lineIndex * 14],
        // pdf.js may omit or report zero width for individual glyph runs.
        width: lineIndex === 0 ? (items.length % 2 === 0 ? 0 : undefined) : 5,
        height: 10,
      });
      x += 5;
    }
  }
  assert.equal(reconstructLines(items), content);
});

test('signed PDF download token rejects expired, forged, and wrong-user tokens', () => {
  const secret = 'test-only-key';
  const now = 1_800_000_000_000;
  const file = '123e4567-e89b-12d3-a456-426614174000';
  const valid = signPdfDownloadToken({ uid: 'user-a', file, exp: now + 60_000 }, secret);
  assert.equal(validatePdfDownloadToken(valid, secret, 'user-a', now).status, 200);
  assert.equal(validatePdfDownloadToken(valid, secret, 'user-b', now).status, 403);
  const expired = signPdfDownloadToken({ uid: 'user-a', file, exp: now - 1 }, secret);
  assert.equal(validatePdfDownloadToken(expired, secret, 'user-a', now).status, 401);
  assert.equal(validatePdfDownloadToken(`${valid}x`, secret, 'user-a', now).status, 401);
});
