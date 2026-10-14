import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';
import { Unit } from '../models/Unit.js';
import { PdfReport } from '../models/PdfReport.js';
import { signPdfDownloadToken } from './pdfSecurity.js';
import { ApiError } from '../middleware/error.js';

function plainPdfText(text: string) {
  return text.replace(/\\\[|\\\]|\\\(|\\\)/g, '').replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1').replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)').replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)').replace(/[{}]/g, '').replace(/\\([a-zA-Z]+)/g, '$1').replace(/\s+/g, ' ').trim();
}
function fontFor(text: string) { return /[\u0900-\u097F]/.test(text) ? 'NotoHindi' : 'NotoSans'; }

export async function createPdfReport(args: {
  userId: string; answer: string; outsideKnowledge?: string | null; citations?: any[]; title?: string; messageId?: string;
}): Promise<{ url: string; expiresInSec: number; fileExpiresInHours: number }> {
  const { userId, answer } = args;
  const outsideKnowledge = args.outsideKnowledge ?? null;
  const citations = args.citations ?? [];
  const citedIds = citations.map((c: any) => String(c.unitId)).filter((id: string) => /^[a-f\d]{24}$/i.test(id));
  const units = citedIds.length ? await Unit.find({ _id: { $in: citedIds }, userId }).select('text location sourceId').lean() : [];
  const unitMap = new Map(units.map((u: any) => [String(u._id), u]));
  const dir = path.join(env.UPLOAD_DIR, 'pdf-reports');
  await fs.mkdir(dir, { recursive: true });
  for (const entry of await fs.readdir(dir).catch(() => [] as string[])) {
    const full = path.join(dir, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) await fs.rm(full, { force: true });
  }
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 54, right: 54 }, bufferPages: true });
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let exceededSizeCap = false;
  const docPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > 20 * 1024 * 1024) { exceededSizeCap = true; return; }
      chunks.push(chunk);
    });
    doc.on('end', () => exceededSizeCap ? reject(new ApiError(413, 'PDF_TOO_LARGE', 'Generated PDF exceeded the maximum size.')) : resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  let fonts = path.resolve(process.cwd(), 'assets/fonts');
  if (!(await fs.access(fonts).then(() => true).catch(() => false))) fonts = path.resolve(process.cwd(), 'server/assets/fonts');
  doc.registerFont('NotoSans', path.join(fonts, 'NotoSans.ttf'));
  doc.registerFont('NotoHindi', path.join(fonts, 'NotoSansDevanagari.ttf'));
  const footer = (pageNumber: number) => { doc.save().font('NotoSans').fontSize(8).fillColor('#666').text(`StudyMind · Page ${pageNumber}`, 54, 790, { width: 487, align: 'center', lineBreak: false }).restore(); };
  doc.font('NotoSans').fontSize(20).fillColor('#111').text(plainPdfText(args.title || 'StudyMind Tutor Report'));
  doc.moveDown(0.4).fontSize(9).fillColor('#666').text(`Generated ${new Date().toLocaleString('en-IN')}`);
  doc.moveDown().fontSize(14).fillColor('#111').text('Tutor answer');
  doc.moveDown(0.4).font(fontFor(answer)).fontSize(10).fillColor('#222').text(plainPdfText(answer), { lineGap: 3 });
  if (outsideKnowledge?.trim()) { doc.moveDown().font('NotoSans').fontSize(14).fillColor('#8a4b00').text('General knowledge — not from uploaded material'); doc.moveDown(0.4).font(fontFor(outsideKnowledge)).fontSize(10).fillColor('#333').text(plainPdfText(outsideKnowledge), { lineGap: 3 }); }
  if (citations.length) {
    doc.moveDown().font('NotoSans').fontSize(14).fillColor('#111').text('Cited sources and excerpts');
    for (const c of citations) {
      const unit = unitMap.get(String(c.unitId)) as any;
      const loc = c.location?.page != null ? `Page ${c.location.page}` : c.location?.slide != null ? `Slide ${c.location.slide}` : c.label;
      doc.moveDown(0.45).font('NotoSans').fontSize(10).fillColor('#164e63').text(`${c.sourceTitle ?? 'Source'} — ${loc}`);
      const excerpt = unit?.text ?? c.excerpt ?? '';
      doc.moveDown(0.15).font(fontFor(excerpt)).fontSize(9).fillColor('#333').text(plainPdfText(excerpt.slice(0, 4000)), { lineGap: 2 });
    }
  }
  const pageRange = doc.bufferedPageRange();
  for (let page = pageRange.start; page < pageRange.start + pageRange.count; page++) { doc.switchToPage(page); footer(page + 1); }
  doc.end();
  const buffer = await docPromise;
  if (buffer.length > 20 * 1024 * 1024) throw new ApiError(413, 'PDF_TOO_LARGE', 'Generated PDF exceeded the maximum size.');
  const file = crypto.randomUUID();
  await fs.writeFile(path.join(dir, `${file}.pdf`), buffer, { flag: 'wx' });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await PdfReport.create({ userId, fileId: file, expiresAt, ...(args.messageId ? { messageId: args.messageId } : {}) });
  const token = signPdfDownloadToken({ uid: userId, file, exp: Date.now() + 5 * 60 * 1000 }, `${env.JWT_SECRET}:studymind-pdf-download`);
  return { url: `/api/tutor/pdf/download?token=${encodeURIComponent(token)}`, expiresInSec: 300, fileExpiresInHours: 24 };
}
