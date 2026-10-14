import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPdfRateLimiter } from '../middleware/pdfRateLimit.js';

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown;
  setHeader(name: string, value: string | number) { this.headers[name.toLowerCase()] = String(value); return this; }
  getHeader(name: string) { return this.headers[name.toLowerCase()]; }
  status(code: number) { this.statusCode = code; return this; }
  json(body: unknown) { this.body = body; this.emit('finish'); return this; }
}

function request(path: string) {
  return { ip: '127.0.0.1', method: 'POST', originalUrl: path, url: path, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as any;
}

test('one five-per-minute quota covers explicit and automatic PDFs but not normal tutor questions', async () => {
  const limiter = createPdfRateLimiter({ windowMs: 60_000, limit: 5 });
  const explicit = async (path: string) => {
    const req = request(path);
    const res = new MockResponse() as any;
    await limiter.middleware(req, res, () => res.json({ ok: true }));
    return res;
  };
  const automatic = async (path: string) => {
    const req = request(path);
    const res = new MockResponse() as any;
    const allowed = await limiter.consume(req, res);
    if (allowed) res.json({ ok: true });
    return res;
  };

  // Ordinary tutor questions intentionally never call consume().
  assert.equal((await Promise.resolve({ statusCode: 200 })).statusCode, 200);
  for (let i = 0; i < 5; i++) {
    const res = i % 2 ? await automatic('/automatic-pdf') : await explicit('/explicit-pdf');
    assert.equal(res.statusCode, 200);
  }
  const limited = await automatic('/automatic-pdf');
  assert.equal(limited.statusCode, 429);
  assert.deepEqual(limited.body, {
    error: { code: 'RATE_LIMITED', message: 'PDF generation is limited to five reports per minute.' },
  });
});
