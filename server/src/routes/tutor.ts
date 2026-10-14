import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, validateBody, ApiError } from '../middleware/error.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { answerQuestion, retrieveUnits } from '../services/rag.js';
import { env } from '../config/env.js';
import { logEvent } from '../services/events.js';
import { User } from '../models/User.js';
import { ChatThread } from '../models/ChatThread.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { Unit } from '../models/Unit.js';
import { PdfReport } from '../models/PdfReport.js';
import { signPdfDownloadToken, validatePdfDownloadToken } from '../services/pdfSecurity.js';
import { promptHistory } from '../services/chatMemory.js';

const router = Router();
const pdfLimiter = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'PDF generation is limited to five reports per minute.' } }) });
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier.');
const ids = z.array(objectId).max(30).optional();
const scopeSchema = z.object({ sourceIds: ids, topicIds: ids, sectionTitle: z.string().trim().min(1).max(160).optional() }).optional();
const askLimiter = rateLimit({
  windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many questions at once. Slow down a moment.' } }),
});
const askSchema = z.object({
  question: z.string().trim().min(1, 'Ask a question.').max(2000, 'That question is too long.'),
  threadId: objectId.optional(), scope: scopeSchema, language: z.enum(['en', 'hi']).optional(), includeContexts: z.boolean().optional(),
});

const pdfSchema = z.object({ messageId: objectId.optional(), threadId: objectId.optional(), prompt: z.string().trim().min(1).max(12000).optional() })
  .refine((v) => [v.messageId, v.threadId, v.prompt].filter(Boolean).length === 1, 'Provide exactly one of messageId, threadId, or prompt.');

function plainPdfText(text: string) {
  return text.replace(/\\\[|\\\]|\\\(|\\\)/g, '').replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1').replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)').replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)').replace(/[{}]/g, '').replace(/\\([a-zA-Z]+)/g, '$1').replace(/\s+/g, ' ').trim();
}
function fontFor(text: string) { return /[\u0900-\u097F]/.test(text) ? 'NotoHindi' : 'NotoSans'; }

router.post('/pdf', requireAuth, pdfLimiter, validateBody(pdfSchema), asyncHandler(async (req: AuthedRequest, res) => {
  const body = req.body as z.infer<typeof pdfSchema>;
  const userId = req.userId!;
  let answer = '';
  let outsideKnowledge: string | null = null;
  let citations: any[] = [];
  let title = 'StudyMind Tutor Report';
  if (body.messageId) {
    const msg = await ChatMessage.findOne({ _id: body.messageId, userId, role: 'assistant' }).lean() as any;
    if (!msg) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'That message does not exist.');
    answer = msg.content; outsideKnowledge = msg.outsideKnowledge; citations = msg.citations ?? [];
  } else if (body.threadId) {
    const thread = await ChatThread.findOne({ _id: body.threadId, userId }).lean();
    if (!thread) throw new ApiError(404, 'THREAD_NOT_FOUND', 'That chat does not exist.');
    const msg = await ChatMessage.findOne({ threadId: thread._id, userId, role: 'assistant' }).sort({ createdAt: -1 }).lean() as any;
    if (!msg) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'That chat has no tutor answer to export.');
    title = thread.title || title; answer = msg.content; outsideKnowledge = msg.outsideKnowledge; citations = msg.citations ?? [];
  } else if (body.prompt!.startsWith('STUDYMIND_EXPORT:')) {
    const lines = body.prompt!.slice('STUDYMIND_EXPORT:'.length).split('\n');
    title = plainPdfText(lines.shift()?.trim() || 'StudyMind Report').slice(0, 120);
    answer = lines.join('\n').trim().slice(0, 10000);
  } else {
    const result = await answerQuestion(userId, body.prompt!, {});
    answer = result.answer; outsideKnowledge = result.outsideKnowledge; citations = result.citations;
  }
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
    doc.on('end', () => exceededSizeCap
      ? reject(new ApiError(413, 'PDF_TOO_LARGE', 'Generated PDF exceeded the maximum size.'))
      : resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  let fonts = path.resolve(process.cwd(), 'assets/fonts');
  if (!(await fs.access(fonts).then(() => true).catch(() => false))) fonts = path.resolve(process.cwd(), 'server/assets/fonts');
  doc.registerFont('NotoSans', path.join(fonts, 'NotoSans.ttf'));
  doc.registerFont('NotoHindi', path.join(fonts, 'NotoSansDevanagari.ttf'));
  const footer = (pageNumber: number) => { doc.save().font('NotoSans').fontSize(8).fillColor('#666').text(`StudyMind · Page ${pageNumber}`, 54, 790, { width: 487, align: 'center', lineBreak: false }).restore(); }; 
  doc.font('NotoSans').fontSize(20).fillColor('#111').text(plainPdfText(title));
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
  await PdfReport.create({ userId, fileId: file, expiresAt });
  const token = signPdfDownloadToken({ uid: userId, file, exp: Date.now() + 5 * 60 * 1000 }, `${env.JWT_SECRET}:studymind-pdf-download`);
  res.status(201).json({ url: `/api/tutor/pdf/download?token=${encodeURIComponent(token)}`, expiresInSec: 300, fileExpiresInHours: 24 });
}));

router.get('/pdf/download', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const validation = validatePdfDownloadToken(token, `${env.JWT_SECRET}:studymind-pdf-download`, req.userId!);
  if (validation.status === 401) throw new ApiError(401, 'INVALID_PDF_TOKEN', 'This PDF link is invalid or expired.');
  if (validation.status === 403) throw new ApiError(403, 'PDF_WRONG_USER', 'This PDF link belongs to another account.');
  const payload = validation.claims!;
  const report = await PdfReport.findOne({ userId: req.userId, fileId: payload.file, expiresAt: { $gt: new Date() } }).lean();
  if (!report) throw new ApiError(401, 'EXPIRED_PDF_TOKEN', 'This PDF report is no longer available.');
  const filePath = path.join(env.UPLOAD_DIR, 'pdf-reports', `${payload.file}.pdf`);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) throw new ApiError(401, 'EXPIRED_PDF_TOKEN', 'This PDF report is no longer available.');
  res.download(filePath, 'studymind-tutor-report.pdf');
}));

router.post('/ask', requireAuth, askLimiter, validateBody(askSchema), asyncHandler(async (req: AuthedRequest, res) => {
  const { question, threadId, scope: requestedScope, language, includeContexts } = req.body as z.infer<typeof askSchema>;
  const userId = req.userId!;
  let thread = threadId ? await ChatThread.findOne({ _id: threadId, userId }) : null;
  if (threadId && !thread) throw new ApiError(404, 'THREAD_NOT_FOUND', 'That chat does not exist.');
  if (!thread) thread = await ChatThread.create({ userId, title: question.slice(0, 80), scope: requestedScope ?? {} });
  let scope = requestedScope ?? { sourceIds: (thread.scope as any)?.sourceIds?.map(String), topicIds: (thread.scope as any)?.topicIds?.map(String), sectionTitle: (thread.scope as any)?.sectionTitle ?? undefined };
  thread.scope = scope as never;
  thread.lastMessageAt = new Date();
  if (!thread.title || thread.title === 'New chat') thread.title = question.slice(0, 80);
  await thread.save();

  const priorRows = await ChatMessage.find({ userId, threadId: thread._id })
    .sort({ createdAt: -1 }).limit(8).select('role content citations').lean();
  const history = promptHistory(priorRows.reverse() as any);
  const userMessage = await ChatMessage.create({ userId, threadId: thread._id, role: 'user', content: question, scope });
  const user = await User.findById(userId).select('prefs').lean();
  const prefs = user?.prefs as any;
  const result = await answerQuestion(userId, question, {
    scope, history,
    previousAssistantCitations: [...priorRows].reverse().find((row: any) => row.role === 'assistant')?.citations ?? [],
    language: language ?? (prefs?.language === 'hi' ? 'hi' : 'en'),
    answerStyle: prefs?.answerStyle === 'deep' ? 'deep' : 'quick',
    studyLevel: prefs?.studyLevel ?? 'self-learner',
  });
  if (includeContexts) {
    const hits = await retrieveUnits(userId, { question, topK: env.RETRIEVAL_TOP_K, sourceIds: scope?.sourceIds, topicIds: scope?.topicIds });
    result.retrievedContexts = hits.map((h) => ({ unitId: h.unitId, sourceTitle: h.sourceTitle, text: h.text, similarity: h.similarity, location: h.location }));
  }
  const assistantMessage = await ChatMessage.create({
    userId, threadId: thread._id, role: 'assistant', content: result.answer || result.outsideKnowledge || '',
    citations: result.citations, groundingStatus: result.groundingStatus, outsideKnowledge: result.outsideKnowledge, scope,
  });
  thread.lastMessageAt = new Date(); await thread.save();
  await logEvent(userId, 'question_asked', null, null, 'tutor', { groundingStatus: result.groundingStatus, citations: result.citations.length });
  res.json({ ...result, threadId: String(thread._id), messageId: String(assistantMessage._id), userMessageId: String(userMessage._id) });
}));

// List threads via the requested resource route; keep /history as a backwards-compatible alias.
const listThreads = asyncHandler(async (req: AuthedRequest, res) => {
  const threads = await ChatThread.find({ userId: req.userId }).sort({ lastMessageAt: -1 }).limit(100).lean();
  res.json({ threads: threads.map((t: any) => ({ id: String(t._id), title: t.title, scope: t.scope, lastMessageAt: t.lastMessageAt, createdAt: t.createdAt })) });
});
router.get('/threads', requireAuth, listThreads);
router.get('/history', requireAuth, listThreads);
router.get('/threads/:id', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  if (!objectId.safeParse(req.params.id).success) throw new ApiError(400, 'INVALID_ID', 'That identifier is not valid.');
  const thread = await ChatThread.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!thread) throw new ApiError(404, 'THREAD_NOT_FOUND', 'That chat does not exist.');
  const messages = await ChatMessage.find({ threadId: thread._id, userId: req.userId }).sort({ createdAt: 1 }).limit(500).lean();
  res.json({ thread: { id: String(thread._id), title: thread.title, scope: thread.scope }, messages: messages.map((m: any) => ({ id: String(m._id), role: m.role, content: m.content, citations: m.citations, groundingStatus: m.groundingStatus, outsideKnowledge: m.outsideKnowledge, scope: m.scope, createdAt: m.createdAt })) });
}));
router.patch('/threads/:id', requireAuth, validateBody(z.object({ title: z.string().trim().min(1).max(120) })), asyncHandler(async (req: AuthedRequest, res) => {
  const thread = await ChatThread.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { $set: { title: (req.body as any).title } }, { new: true });
  if (!thread) throw new ApiError(404, 'THREAD_NOT_FOUND', 'That chat does not exist.');
  res.json({ id: String(thread._id), title: thread.title });
}));
router.delete('/threads/:id', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const thread = await ChatThread.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!thread) throw new ApiError(404, 'THREAD_NOT_FOUND', 'That chat does not exist.');
  await ChatMessage.deleteMany({ threadId: thread._id, userId: req.userId });
  res.status(204).send();
}));

export default router;
