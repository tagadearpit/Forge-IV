import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, validateBody, ApiError } from '../middleware/error.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { answerQuestion, retrieveUnits } from '../services/rag.js';
import { getAIProvider } from '../ai/provider.js';
import { env } from '../config/env.js';
import { logEvent } from '../services/events.js';
import { User } from '../models/User.js';
import { ChatThread } from '../models/ChatThread.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { PdfReport } from '../models/PdfReport.js';
import { signPdfDownloadToken, validatePdfDownloadToken } from '../services/pdfSecurity.js';
import { promptHistory } from '../services/chatMemory.js';
import { detectPdfIntent } from '../services/pdfIntent.js';
import { createPdfReport } from '../services/pdfReport.js';

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

function plainPdfText(text: string) { return text.replace(/[{}]/g, '').replace(/\\([a-zA-Z]+)/g, '$1').replace(/\s+/g, ' ').trim(); }

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
  const download = await createPdfReport({ userId, answer, outsideKnowledge, citations, title });
  res.status(201).json(download);
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

router.get('/pdf/messages/:messageId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  if (!objectId.safeParse(req.params.messageId).success) throw new ApiError(400, 'INVALID_ID', 'That identifier is not valid.');
  const message = await ChatMessage.findOne({ _id: req.params.messageId, userId: req.userId, role: 'assistant' }).select('_id').lean();
  if (!message) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'That message does not exist.');
  const report = await PdfReport.findOne({ userId: req.userId, messageId: message._id, expiresAt: { $gt: new Date() } }).lean();
  if (!report) throw new ApiError(404, 'PDF_NOT_FOUND', 'This message has no available PDF attachment.');
  const filePath = path.join(env.UPLOAD_DIR, 'pdf-reports', `${report.fileId}.pdf`);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) throw new ApiError(404, 'PDF_NOT_FOUND', 'This PDF attachment is no longer available.');
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
  const answerOptions = {
    scope, history,
    previousAssistantCitations: [...priorRows].reverse().find((row: any) => row.role === 'assistant')?.citations ?? [],
    language: language ?? (prefs?.language === 'hi' ? 'hi' : 'en') as 'en' | 'hi',
    answerStyle: prefs?.answerStyle === 'deep' ? 'deep' as const : 'quick' as const,
    studyLevel: prefs?.studyLevel ?? 'self-learner',
  };
  const previousAssistant = [...priorRows].reverse().find((row: any) => row.role === 'assistant') as any;
  let pdfIntent = detectPdfIntent(question);
  if (pdfIntent.kind === 'ambiguous' && getAIProvider().name === 'gemini') {
    try {
      const decision = await getAIProvider().generateJSON<{ makePdf: boolean; target?: 'previous' | 'new'; contentQuestion?: string }>({
        prompt: `Decide whether this student message is asking to generate/export a PDF file, rather than asking about PDF as a topic. Return exactly JSON: {"makePdf":boolean,"target":"previous"|"new","contentQuestion":string|null}. Use target previous only for clear references to the preceding tutor answer. Message: ${JSON.stringify(question)}`,
        temperature: 0, maxOutputTokens: 80,
      });
      if (decision.makePdf) pdfIntent = { kind: 'request', target: decision.target === 'previous' ? 'previous' : 'new', ...(decision.contentQuestion ? { contentQuestion: decision.contentQuestion } : {}) };
      else pdfIntent = { kind: 'none', target: 'new' };
    } catch { pdfIntent = { kind: 'none', target: 'new' }; }
  }
  if (pdfIntent.kind === 'request' && pdfIntent.target === 'previous' && !previousAssistant) {
    throw new ApiError(409, 'PDF_SOURCE_MISSING', 'There is no previous tutor answer to export yet. Ask a question first.');
  }
  if (pdfIntent.kind === 'request' && (pdfIntent.target === 'previous' ? Boolean(previousAssistant) : Boolean(pdfIntent.contentQuestion))) {
    let pdfContent: string;
    let outsideKnowledge: string | null;
    let citations: any[];
    let groundingStatus: 'full' | 'partial' | 'outside_material';
    let responseAnswer: string;
    let responseExtra: Record<string, unknown> = {};
    if (pdfIntent.target === 'previous' && previousAssistant) {
      pdfContent = previousAssistant.content;
      outsideKnowledge = previousAssistant.outsideKnowledge ?? null;
      citations = previousAssistant.citations ?? [];
      groundingStatus = previousAssistant.groundingStatus ?? 'partial';
      responseAnswer = 'I prepared a PDF of the previous tutor answer.';
    } else {
      const result = await answerQuestion(userId, pdfIntent.contentQuestion!, answerOptions);
      pdfContent = result.answer || result.outsideKnowledge || '';
      outsideKnowledge = result.outsideKnowledge;
      citations = result.citations;
      groundingStatus = result.groundingStatus;
      responseAnswer = pdfContent;
      responseExtra = result as unknown as Record<string, unknown>;
    }
    const assistantMessage = await ChatMessage.create({
      userId, threadId: thread._id, role: 'assistant', content: responseAnswer,
      citations, groundingStatus, outsideKnowledge, scope, attachments: [],
    });
    const download = await createPdfReport({ userId, answer: pdfContent, outsideKnowledge, citations, title: thread.title || 'StudyMind Tutor Report', messageId: String(assistantMessage._id) });
    assistantMessage.attachments = [{ type: 'pdf', messageId: assistantMessage._id }] as never;
    await assistantMessage.save();
    thread.lastMessageAt = new Date(); await thread.save();
    await logEvent(userId, 'question_asked', null, null, 'tutor', { groundingStatus, citations: citations.length, pdfAttachment: true });
    return res.json({
      answer: responseAnswer, citations, groundingStatus, outsideKnowledge,
      language: answerOptions.language, topSimilarity: 0, lexicalOverlap: 0,
      audit: { citedRequested: citations.length, citedVerified: citations.length, stripped: 0, declined: false },
      unsearchableCount: 0, usingSource: null, ...responseExtra,
      attachment: { type: 'pdf', messageId: String(assistantMessage._id), url: `/api/tutor/pdf/messages/${assistantMessage._id}` },
      threadId: String(thread._id), messageId: String(assistantMessage._id), userMessageId: String(userMessage._id),
      pdfDownload: download.url,
    });
  }
  const result = await answerQuestion(userId, question, answerOptions);
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
  res.json({ thread: { id: String(thread._id), title: thread.title, scope: thread.scope }, messages: messages.map((m: any) => ({ id: String(m._id), role: m.role, content: m.content, citations: m.citations, groundingStatus: m.groundingStatus, outsideKnowledge: m.outsideKnowledge, scope: m.scope, attachments: m.attachments ?? [], createdAt: m.createdAt })) });
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
