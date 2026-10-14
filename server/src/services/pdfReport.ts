import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';
import { Unit } from '../models/Unit.js';
import { PdfReport } from '../models/PdfReport.js';
import { signPdfDownloadToken } from './pdfSecurity.js';
import { ApiError } from '../middleware/error.js';

const PDF_RETENTION_MS = 24 * 60 * 60 * 1000;
const PDF_MAX_BYTES = 20 * 1024 * 1024;

export interface PdfCitation {
  unitId?: string;
  label?: string;
  excerpt?: string;
  sourceTitle?: string;
  location?: { page?: number; slide?: number; startSec?: number };
}

function plainPdfText(text: string): string {
  return (text ?? '')
    .replace(/\\\[|\\\]|\\\(|\\\)/g, '')
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
    .replace(/[{}]/g, '')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fontFor(text: string): 'NotoHindi' | 'NotoSans' {
  return /[\u0900-\u097F]/.test(text) ? 'NotoHindi' : 'NotoSans';
}

function safeErrorFields(err: unknown) {
  const error = err as { name?: string; code?: string };
  return { name: error?.name ?? 'Error', code: error?.code ?? 'UNKNOWN' };
}

/** Remove expired report rows and stale/orphaned local PDF files. */
export async function cleanupExpiredPdfReports(now = Date.now()): Promise<void> {
  const dir = path.join(env.UPLOAD_DIR, 'pdf-reports');
  await fs.mkdir(dir, { recursive: true });
  const expiredAt = new Date(now);
  const expired = await PdfReport.find({ expiresAt: { $lte: expiredAt } }).select('fileId').lean();
  for (const report of expired as Array<{ fileId: string }>) {
    await fs.rm(path.join(dir, `${report.fileId}.pdf`), { force: true }).catch(() => undefined);
  }
  await PdfReport.deleteMany({ expiresAt: { $lte: expiredAt } });

  const active = await PdfReport.find({ expiresAt: { $gt: expiredAt } }).select('fileId').lean();
  const activeIds = new Set(active.map((report: any) => String(report.fileId)));
  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    if (!/^[a-f\d-]+\.pdf$/i.test(entry)) continue;
    const fileId = entry.slice(0, -4);
    const filePath = path.join(dir, entry);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) continue;
    const expiredByFileAge = now - stat.mtimeMs >= PDF_RETENTION_MS;
    const oldOrphan = !activeIds.has(fileId) && now - stat.mtimeMs >= PDF_RETENTION_MS;
    if (expiredByFileAge || oldOrphan) await fs.rm(filePath, { force: true });
  }
}

/** Render a complete PDF in memory; exposed separately so layout/content can be tested without MongoDB. */
export async function renderPdfReport(args: {
  answer: string;
  outsideKnowledge?: string | null;
  citations?: PdfCitation[];
  title?: string;
  unitMap?: Map<string, { text?: string; location?: unknown }>;
  fontDir?: string;
}): Promise<Buffer> {
  const answer = plainPdfText(args.answer);
  const outsideKnowledge = plainPdfText(args.outsideKnowledge ?? '');
  if (!answer && !outsideKnowledge) {
    throw new ApiError(422, 'PDF_CONTENT_EMPTY', 'There is no answer content to export. Ask a question or give me a topic first.');
  }
  const citations = args.citations ?? [];
  const fontDir = args.fontDir ?? path.resolve(__dirname, '../../assets/fonts');

  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 64, left: 54, right: 54 }, bufferPages: true });
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let exceededSizeCap = false;
  const docPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > PDF_MAX_BYTES) {
        exceededSizeCap = true;
        return;
      }
      chunks.push(chunk);
    });
    doc.on('end', () => exceededSizeCap
      ? reject(new ApiError(413, 'PDF_TOO_LARGE', 'Generated PDF exceeded the 20 MB limit.'))
      : resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  try {
    doc.registerFont('NotoSans', path.join(fontDir, 'NotoSans.ttf'));
    doc.registerFont('NotoHindi', path.join(fontDir, 'NotoSansDevanagari.ttf'));
    const title = plainPdfText(args.title || 'StudyMind Tutor Report').replace(/\n/g, ' ').slice(0, 120) || 'StudyMind Tutor Report';
    doc.font(fontFor(title)).fontSize(20).fillColor('#111').text(title);
    doc.moveDown(0.4).font('NotoSans').fontSize(9).fillColor('#666').text(`Generated ${new Date().toLocaleString('en-IN')}`);
    if (answer) {
      doc.moveDown().font('NotoSans').fontSize(14).fillColor('#111').text('Tutor answer');
      doc.moveDown(0.4).font(fontFor(answer)).fontSize(10).fillColor('#222').text(answer, { lineGap: 3, paragraphGap: 4 });
    }
    if (outsideKnowledge) {
      doc.moveDown().font('NotoSans').fontSize(14).fillColor('#8a4b00').text('General knowledge — not from uploaded material');
      doc.moveDown(0.4).font(fontFor(outsideKnowledge)).fontSize(10).fillColor('#333').text(outsideKnowledge, { lineGap: 3, paragraphGap: 4 });
    }
    if (citations.length) {
      doc.moveDown().font('NotoSans').fontSize(14).fillColor('#111').text('Cited sources and excerpts');
      for (const citation of citations) {
        const unit = args.unitMap?.get(String(citation.unitId));
        const location = citation.location ?? {};
        const loc = location.page != null ? `Page ${location.page}`
          : location.slide != null ? `Slide ${location.slide}`
          : citation.label ?? 'Source excerpt';
        const sourceLine = `${citation.sourceTitle ?? 'Source'} — ${loc}`;
        doc.moveDown(0.45).font(fontFor(sourceLine)).fontSize(10).fillColor('#164e63').text(plainPdfText(sourceLine));
        const excerpt = unit?.text ?? citation.excerpt ?? '';
        if (excerpt) doc.moveDown(0.15).font(fontFor(excerpt)).fontSize(9).fillColor('#333').text(plainPdfText(excerpt.slice(0, 4000)), { lineGap: 2, paragraphGap: 3 });
      }
    }
    const pageRange = doc.bufferedPageRange();
    for (let page = pageRange.start; page < pageRange.start + pageRange.count; page++) {
      doc.switchToPage(page);
      doc.save().font('NotoSans').fontSize(8).fillColor('#666')
        .text(`StudyMind · Page ${page + 1}`, 54, 790, { width: 487, align: 'center', lineBreak: false })
        .restore();
    }
    doc.end();
  } catch (err) {
    (doc as unknown as { destroy?: () => void }).destroy?.();
    throw err;
  }

  const buffer = await docPromise;
  if (buffer.length > PDF_MAX_BYTES) throw new ApiError(413, 'PDF_TOO_LARGE', 'Generated PDF exceeded the 20 MB limit.');
  return buffer;
}

export async function createPdfReport(args: {
  userId: string; answer: string; outsideKnowledge?: string | null; citations?: PdfCitation[]; title?: string; messageId?: string;
}): Promise<{ url: string; expiresInSec: number; fileExpiresInHours: number }> {
  const { userId } = args;
  const citations = args.citations ?? [];
  const citedIds = citations.map((citation) => String(citation.unitId)).filter((id) => /^[a-f\d]{24}$/i.test(id));
  let units: Array<{ _id: unknown; text: string; location?: unknown }> = [];
  try {
    units = citedIds.length
      ? await Unit.find({ _id: { $in: citedIds }, userId }).select('text location sourceId').lean() as any
      : [];
  } catch (err) {
    console.error('[pdf] source lookup failed', { userId, ...safeErrorFields(err) });
    throw new ApiError(503, 'PDF_SOURCE_UNAVAILABLE', 'Could not load the cited source details. Please retry the PDF export.');
  }
  const unitMap = new Map(units.map((unit: any) => [String(unit._id), unit]));

  try {
    await cleanupExpiredPdfReports();
  } catch (err) {
    // Cleanup is best-effort; a stale file must not prevent a new report.
    console.error('[pdf] expiry cleanup failed', safeErrorFields(err));
  }

  let buffer: Buffer;
  try {
    buffer = await renderPdfReport({ ...args, citations, unitMap });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error('[pdf] render failed', { userId, ...safeErrorFields(err) });
    throw new ApiError(500, 'PDF_RENDER_FAILED', 'We could not render the PDF. Please try again.');
  }

  const dir = path.join(env.UPLOAD_DIR, 'pdf-reports');
  const fileId = crypto.randomUUID();
  const filePath = path.join(dir, `${fileId}.pdf`);
  const expiresAt = new Date(Date.now() + PDF_RETENTION_MS);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, buffer, { flag: 'wx' });
    await PdfReport.create({ userId, fileId, expiresAt, ...(args.messageId ? { messageId: args.messageId } : {}) });
  } catch (err) {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    console.error('[pdf] file/metadata persistence failed', { userId, ...safeErrorFields(err) });
    throw new ApiError(503, 'PDF_STORAGE_UNAVAILABLE', 'The PDF was created but could not be saved for download. Please retry.');
  }

  const token = signPdfDownloadToken({ uid: userId, file: fileId, exp: Date.now() + 5 * 60 * 1000 }, `${env.JWT_SECRET}:studymind-pdf-download`);
  return { url: `/api/tutor/pdf/download?token=${encodeURIComponent(token)}`, expiresInSec: 300, fileExpiresInHours: 24 };
}

/** Return only PDF attachments whose metadata and local file are both live. */
export async function deletePdfReportsForMessages(userId: string, messageIds: unknown[]): Promise<void> {
  const ids = messageIds.filter(Boolean);
  if (!ids.length) return;
  const reports = await PdfReport.find({ userId, messageId: { $in: ids } }).select('fileId').lean();
  await PdfReport.deleteMany({ userId, messageId: { $in: ids } });
  const dir = path.join(env.UPLOAD_DIR, 'pdf-reports');
  await Promise.all((reports as Array<{ fileId: string }>).map((report) =>
    fs.rm(path.join(dir, `${report.fileId}.pdf`), { force: true }).catch(() => undefined)
  ));
}

export async function availablePdfMessageIds(userId: string, messageIds: unknown[]): Promise<Set<string>> {
  const ids = messageIds.filter(Boolean);
  if (!ids.length) return new Set();
  const reports = await PdfReport.find({ userId, messageId: { $in: ids }, expiresAt: { $gt: new Date() } })
    .select('fileId messageId').lean();
  const live = new Set<string>();
  for (const report of reports as any[]) {
    const filePath = path.join(env.UPLOAD_DIR, 'pdf-reports', `${report.fileId}.pdf`);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs < PDF_RETENTION_MS) live.add(String(report.messageId));
    else {
      await PdfReport.deleteOne({ _id: report._id, userId }).catch((err) => {
        console.error('[pdf] stale attachment metadata cleanup failed', { userId, ...safeErrorFields(err) });
      });
      await fs.rm(filePath, { force: true }).catch(() => undefined);
    }
  }
  return live;
}
