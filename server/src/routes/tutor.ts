import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
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
import { PdfReport } from '../models/PdfReport.js';
import { signPdfDownloadToken, validatePdfDownloadToken } from '../services/pdfSecurity.js';
import { promptHistory, selectPreviousAssistant } from '../services/chatMemory.js';
import { createPdfRateLimiter, withPdfQuota } from '../middleware/pdfRateLimit.js';
import { resolvePdfTurn } from '../services/pdfIntent.js';
import { availablePdfMessageIds, createPdfReport, deletePdfReportsForMessages } from '../services/pdfReport.js';

const router = Router();
const pdfRateLimiter = createPdfRateLimiter();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier.');
const ids = z.array(objectId).max(30).optional();
const scopeSchema = z.object({ sourceIds: ids, topicIds: ids, sectionTitle: z.string().trim().min(1).max(160).optional() }).optional();
const askLimiter = rateLimit({
  windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many questions at once. Slow down a moment.' } }),
});

const askSchema = z.object({
  question: z.string().trim().min(1, 'Ask a question.').max(2000, 'That question is too long.'),
  threadId: objectId.optional(), previousMessageId: objectId.optional(), scope: scopeSchema, language: z.enum(['en', 'hi']).optional(), includeContexts: z.boolean().optional(),
});

const pdfSchema = z.object({ messageId: objectId.optional(), threadId: objectId.optional(), prompt: z.string().trim().min(1).max(12000).optional() })
  .refine((v) => [v.messageId, v.threadId, v.prompt].filter(Boolean).length === 1, 'Provide exactly one of messageId, threadId, or prompt.');

type TutorPdfContent = {
  pdfContent: string;
  outsideKnowledge: string | null;
  citations: any[];
  groundingStatus: 'full' | 'partial' | 'outside_material';
  responseAnswer: string;
  responseExtra: Record<string, unknown>;
};

function plainPdfText(text: string) { return text.replace(/[{}]/g, '').replace(/\\([a-zA-Z]+)/g, '$1').replace(/\s+/g, ' ').trim(); }

router.post('/pdf', requireAuth, validateBody(pdfSchema), asyncHandler(async (req: AuthedRequest, res) => {
  const body = req.body as z.infer<typeof pdfSchema>;
  const userId = req.userId!;
  const prepared = await withPdfQuota(
    () => pdfRateLimiter.consume(req, res),
    async () => {
      let answer = '';
      let outsideKnowledge: string | null = null;
      let citations: any[] = [];
      let title = 'StudyMind Tutor Report';
      if (body.messageId) {
        const msg = await ChatMessage.findOne({ _id: body.messageId, userId, role: 'assistant', pdfClarification: { $ne: true } }).lean() as any;
        if (!msg) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'That message does not exist.');
        answer = msg.content; outsideKnowledge = msg.outsideKnowledge; citations = msg.citations ?? [];
      } else if (body.threadId) {
        const thread = await ChatThread.findOne({ _id: body.threadId, userId }).lean();
        if (!thread) throw new ApiError(404, 'THREAD_NOT_FOUND', 'That chat does not exist.');
        const msg = await ChatMessage.findOne({ threadId: thread._id, userId, role: 'assistant', pdfClarification: { $ne: true } }).sort({ createdAt: -1 }).lean() as any;
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
      if (!answer.trim() && !outsideKnowledge?.trim()) {
        throw new ApiError(422, 'PDF_CONTENT_EMPTY', 'There is no answer content to export. Ask a question or give me a topic first.');
      }
      return { answer, outsideKnowledge, citations, title };
    }
  );
  if (!prepared.allowed) return;
  const download = await createPdfReport({ userId, ...prepared.value });
  res.status(201).json(download);
}));

router.get('/pdf/download', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const validation = validatePdfDownloadToken(token, `${env.JWT_SECRET}:studymind-pdf-download`, req.userId!);
  if (validation.status === 401) throw new ApiError(401, 'INVALID_PDF_TOKEN', 'This PDF link is invalid or expired.');
  if (validation.status === 403) throw new ApiError(403, 'PDF_WRONG_USER', 'This PDF link belongs to another account.');
  const payload = validation.claims!;
  const now = new Date();
  const report = await PdfReport.findOne({ userId: req.userId, fileId: payload.file, expiresAt: { $gt: now } }).lean();
  if (!report) {
    await PdfReport.deleteOne({ userId: req.userId, fileId: payload.file, expiresAt: { $lte: now } });
    throw new ApiError(410, 'PDF_EXPIRED', 'This PDF has expired. Generate it again from the tutor answer.');
  }
  const filePath = path.join(env.UPLOAD_DIR, 'pdf-reports', `${payload.file}.pdf`);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || Date.now() - stat.mtimeMs >= 24 * 60 * 60 * 1000) {
    await PdfReport.deleteOne({ _id: report._id, userId: req.userId });
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    throw new ApiError(410, 'PDF_FILE_MISSING', 'This PDF file is no longer available. Generate it again from the tutor answer.');
  }
  res.download(filePath, 'studymind-tutor-report.pdf');
}));

router.get('/pdf/messages/:messageId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  if (!objectId.safeParse(req.params.messageId).success) throw new ApiError(400, 'INVALID_ID', 'That identifier is not valid.');
  const message = await ChatMessage.findOne({ _id: req.params.messageId, userId: req.userId, role: 'assistant' }).select('_id').lean();
  if (!message) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'That message does not exist.');
  const now = new Date();
  const report = await PdfReport.findOne({ userId: req.userId, messageId: message._id, expiresAt: { $gt: now } }).lean();
  if (!report) {
    await PdfReport.deleteMany({ userId: req.userId, messageId: message._id, expiresAt: { $lte: now } });
    throw new ApiError(410, 'PDF_EXPIRED', 'This PDF attachment has expired. Generate it again from the tutor answer.');
  }
  const filePath = path.join(env.UPLOAD_DIR, 'pdf-reports', `${report.fileId}.pdf`);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || Date.now() - stat.mtimeMs >= 24 * 60 * 60 * 1000) {
    await PdfReport.deleteOne({ _id: report._id, userId: req.userId });
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    throw new ApiError(410, 'PDF_FILE_MISSING', 'This PDF attachment is no longer available. Generate it again from the tutor answer.');
  }
  res.download(filePath, 'studymind-tutor-report.pdf');
}));

router.post('/ask', requireAuth, askLimiter, validateBody(askSchema), asyncHandler(async (req: AuthedRequest, res) => {
  const { question, threadId, previousMessageId, scope: requestedScope, language, includeContexts } = req.body as z.infer<typeof askSchema>;
  const userId = req.userId!;
  const requestedPreviousAssistant = previousMessageId
    ? await ChatMessage.findOne({ _id: previousMessageId, userId, role: 'assistant', pdfClarification: { $ne: true } }).lean() as any
    : null;
  if (previousMessageId && !requestedPreviousAssistant) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'That tutor answer does not exist.');

  let thread = requestedPreviousAssistant
    ? await ChatThread.findOne({ _id: requestedPreviousAssistant.threadId, userId })
    : threadId ? await ChatThread.findOne({ _id: threadId, userId }) : null;
  if (threadId && !thread && !requestedPreviousAssistant) throw new ApiError(404, 'THREAD_NOT_FOUND', 'That chat does not exist.');
  if (requestedPreviousAssistant && !thread) throw new ApiError(404, 'THREAD_NOT_FOUND', 'That chat does not exist.');
  if (!thread) thread = await ChatThread.create({ userId, title: question.slice(0, 80), scope: requestedScope ?? {} });
  let scope = requestedScope ?? { sourceIds: (thread.scope as any)?.sourceIds?.map(String), topicIds: (thread.scope as any)?.topicIds?.map(String), sectionTitle: (thread.scope as any)?.sectionTitle ?? undefined };
  thread.scope = scope as never;
  thread.lastMessageAt = new Date();
  if (!thread.title || thread.title === 'New chat') thread.title = question.slice(0, 80);
  await thread.save();

  const priorRows = await ChatMessage.find({ userId, threadId: thread._id })
    .sort({ createdAt: -1 }).limit(8).select('role content citations pdfClarification').lean();
  const history = promptHistory(priorRows.reverse() as any);
  const previousAssistant = selectPreviousAssistant(priorRows as any[], requestedPreviousAssistant as any) as any;
  const userMessage = await ChatMessage.create({ userId, threadId: thread._id, role: 'user', content: question, scope });
  const user = await User.findById(userId).select('prefs').lean();
  const prefs = user?.prefs as any;
  const answerOptions = {
    scope, history,
    previousAssistantCitations: previousAssistant?.citations ?? [],
    language: language ?? (prefs?.language === 'hi' ? 'hi' : 'en') as 'en' | 'hi',
    answerStyle: prefs?.answerStyle === 'deep' ? 'deep' as const : 'quick' as const,
    studyLevel: prefs?.studyLevel ?? 'self-learner',
  };
  const pdfTurn = resolvePdfTurn(question, Boolean(thread.pendingPdf));
  const effectiveQuestion = pdfTurn.effectiveQuestion;
  let pdfIntent = pdfTurn.intent;
  if (pdfTurn.cancelled) {
    thread.pendingPdf = false;
    thread.lastMessageAt = new Date();
    await thread.save();
    if (!effectiveQuestion.trim()) {
      const acknowledgement = answerOptions.language === 'hi'
        ? 'ठीक है, मैंने PDF का अनुरोध रद्द कर दिया है।'
        : 'Okay, I’ve cancelled that PDF request.';
      const assistantMessage = await ChatMessage.create({
        userId, threadId: thread._id, role: 'assistant', content: acknowledgement,
        citations: [], groundingStatus: 'partial', outsideKnowledge: null, scope, attachments: [],
      });
      return res.json({
        answer: acknowledgement, citations: [], groundingStatus: 'partial', outsideKnowledge: null,
        language: answerOptions.language, topSimilarity: 0, lexicalOverlap: 0,
        audit: { citedRequested: 0, citedVerified: 0, stripped: 0, declined: false },
        unsearchableCount: 0, usingSource: null, threadId: String(thread._id),
        messageId: String(assistantMessage._id), userMessageId: String(userMessage._id),
      });
    }
  }
  // Keep ambiguous requests in the clarification flow rather than calling an AI
  // classifier before the PDF quota has been checked. This also avoids charging
  // ordinary PDF-topic questions against the shared report limit.

  const clarifyPdf = async (message?: string) => {
    const clarification = message ?? (answerOptions.language === 'hi'
      ? 'PDF में क्या रखना चाहिए? कोई विषय बताओ, या पहले इस चैट में उत्तर माँगो जिसे मैं PDF में बदल सकूँ।'
      : 'What would you like the PDF to contain? Tell me a topic, or ask something first and I can export that answer.');
    thread.pendingPdf = true;
    thread.lastMessageAt = new Date();
    await thread.save();
    const assistantMessage = await ChatMessage.create({
      userId, threadId: thread._id, role: 'assistant', content: clarification,
      citations: [], groundingStatus: 'partial', outsideKnowledge: null, scope, pdfClarification: true, attachments: [],
    });
    return res.json({
      answer: clarification, citations: [], groundingStatus: 'partial', outsideKnowledge: null,
      language: answerOptions.language, topSimilarity: 0, lexicalOverlap: 0,
      audit: { citedRequested: 0, citedVerified: 0, stripped: 0, declined: false },
      unsearchableCount: 0, usingSource: null, pdfClarification: true,
      threadId: String(thread._id), messageId: String(assistantMessage._id), userMessageId: String(userMessage._id),
    });
  };

  if (pdfIntent.kind === 'ambiguous') return clarifyPdf();
  if (pdfIntent.kind === 'request' && pdfIntent.target === 'previous' && !previousAssistant) return clarifyPdf();
  if (pdfIntent.kind === 'request' && pdfIntent.target === 'new' && !pdfIntent.contentQuestion) return clarifyPdf();

  const pdfRequested = pdfIntent.kind === 'request';
  let preparedPdf: TutorPdfContent | null = null;
  if (pdfRequested) {
    const quota = await withPdfQuota<TutorPdfContent>(
      () => pdfRateLimiter.consume(req, res),
      async () => {
        if (pdfIntent.target === 'previous' && previousAssistant) {
          return {
            pdfContent: previousAssistant.content,
            outsideKnowledge: previousAssistant.outsideKnowledge ?? null,
            citations: previousAssistant.citations ?? [],
            groundingStatus: previousAssistant.groundingStatus ?? 'partial',
            responseAnswer: 'I prepared a PDF of the previous tutor answer.',
            responseExtra: {},
          };
        }
        const result = await answerQuestion(userId, pdfIntent.contentQuestion!, answerOptions);
        const pdfContent = result.answer || result.outsideKnowledge || '';
        return {
          pdfContent,
          outsideKnowledge: result.outsideKnowledge,
          citations: result.citations,
          groundingStatus: result.groundingStatus,
          responseAnswer: pdfContent,
          responseExtra: result as unknown as Record<string, unknown>,
        };
      }
    );
    if (!quota.allowed) return;
    preparedPdf = quota.value;
  }

  if (pdfRequested && preparedPdf) {
    const { pdfContent, outsideKnowledge, citations, groundingStatus, responseAnswer, responseExtra } = preparedPdf;
    if (!pdfContent.trim()) return clarifyPdf();
    const assistantMessage = await ChatMessage.create({
      userId, threadId: thread._id, role: 'assistant', content: responseAnswer,
      citations, groundingStatus, outsideKnowledge, scope, attachments: [],
    });
    let download: Awaited<ReturnType<typeof createPdfReport>>;
    try {
      download = await createPdfReport({ userId, answer: pdfContent, outsideKnowledge, citations, title: thread.title || 'StudyMind Tutor Report', messageId: String(assistantMessage._id) });
      assistantMessage.attachments = [{ type: 'pdf', messageId: assistantMessage._id }] as never;
      await assistantMessage.save();
      thread.pendingPdf = false;
      thread.lastMessageAt = new Date();
      await thread.save();
    } catch (err) {
      await deletePdfReportsForMessages(userId, [assistantMessage._id]).catch((cleanupErr) => {
        console.error('[pdf] rollback failed', { userId, error: (cleanupErr as Error)?.name ?? 'Error' });
      });
      await ChatMessage.deleteOne({ _id: assistantMessage._id, userId }).catch(() => undefined);
      throw err;
    }
    await logEvent(userId, 'question_asked', null, null, 'tutor', { groundingStatus, citations: citations.length, pdfAttachment: true }).catch((err) => {
      console.error('[tutor] event log failed', { userId, error: (err as Error)?.name ?? 'Error' });
    });
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
  const result = await answerQuestion(userId, effectiveQuestion, answerOptions);
  if (includeContexts) {
    const hits = await retrieveUnits(userId, { question: effectiveQuestion, topK: env.RETRIEVAL_TOP_K, sourceIds: scope?.sourceIds, topicIds: scope?.topicIds });
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
  const attachedMessageIds = messages.filter((m: any) => m.attachments?.some((a: any) => a.type === 'pdf')).map((m: any) => m._id);
  const livePdfMessageIds = await availablePdfMessageIds(String(req.userId), attachedMessageIds);
  res.json({ thread: { id: String(thread._id), title: thread.title, scope: thread.scope, pendingPdf: Boolean(thread.pendingPdf) }, messages: messages.map((m: any) => ({ id: String(m._id), role: m.role, content: m.content, citations: m.citations, groundingStatus: m.groundingStatus, outsideKnowledge: m.outsideKnowledge, pdfClarification: Boolean(m.pdfClarification), scope: m.scope, attachments: (m.attachments ?? []).filter((a: any) => a.type !== 'pdf' || livePdfMessageIds.has(String(m._id))), createdAt: m.createdAt })) });
}));
router.patch('/threads/:id', requireAuth, validateBody(z.object({ title: z.string().trim().min(1).max(120) })), asyncHandler(async (req: AuthedRequest, res) => {
  const thread = await ChatThread.findOneAndUpdate({ _id: req.params.id, userId: req.userId }, { $set: { title: (req.body as any).title } }, { new: true });
  if (!thread) throw new ApiError(404, 'THREAD_NOT_FOUND', 'That chat does not exist.');
  res.json({ id: String(thread._id), title: thread.title });
}));
router.delete('/threads/:id', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const thread = await ChatThread.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!thread) throw new ApiError(404, 'THREAD_NOT_FOUND', 'That chat does not exist.');
  const messages = await ChatMessage.find({ threadId: thread._id, userId: req.userId }).select('_id').lean();
  await deletePdfReportsForMessages(String(req.userId), messages.map((m: any) => m._id));
  await ChatMessage.deleteMany({ threadId: thread._id, userId: req.userId });
  res.status(204).send();
}));

export default router;
