import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, validateBody, ApiError } from '../middleware/error.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { answerQuestion, retrieveUnits } from '../services/rag.js';
import { env } from '../config/env.js';
import { logEvent } from '../services/events.js';
import { User } from '../models/User.js';

const router = Router();

const askLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many questions at once. Slow down a moment.' } }),
});

const askSchema = z.object({
  question: z.string().trim().min(1, 'Ask a question.').max(2000, 'That question is too long.'),
  scope: z
    .object({
      sourceIds: z.array(z.string()).optional(),
      topicIds: z.array(z.string()).optional(),
    })
    .optional(),
  language: z.enum(['en', 'hi']).optional(),
  /**
   * EVALUATION ONLY. Returns the FULL retrieved unit texts and ids as
   * `retrievedContexts`. Context metrics must be scored against these, not
   * against the 240-char excerpt the UI shows — doing so systematically
   * understates faithfulness and context recall.
   */
  includeContexts: z.boolean().optional(),
});

router.post(
  '/ask',
  requireAuth,
  askLimiter,
  validateBody(askSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { question, scope, language, includeContexts } =
      req.body as z.infer<typeof askSchema>;
    const user = await User.findById(req.userId).select('prefs').lean();
    const prefs = user?.prefs as any;
    const result = await answerQuestion(req.userId!, question, {
      scope,
      language: language ?? (prefs?.language === 'hi' ? 'hi' : 'en'),
      answerStyle: prefs?.answerStyle === 'deep' ? 'deep' : 'quick',
      studyLevel: prefs?.studyLevel ?? 'self-learner',
    });

    if (includeContexts) {
      const hits = await retrieveUnits(req.userId!, {
        question,
        topK: env.RETRIEVAL_TOP_K,
        sourceIds: scope?.sourceIds,
        topicIds: scope?.topicIds,
      });
      result.retrievedContexts = hits.map((h) => ({
        unitId: h.unitId,
        sourceTitle: h.sourceTitle,
        text: h.text,
        similarity: h.similarity,
        location: h.location,
      }));
    }

    await logEvent(req.userId!, 'question_asked', null, null, 'tutor', {
      groundingStatus: result.groundingStatus,
      citations: result.citations.length,
    });
    res.json(result);
  })
);

router.get(
  '/history',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { Event } = await import('../models/Event.js');
    const rows = await Event.find({ userId: req.userId, type: 'question_asked' })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();
    res.json({
      history: rows.map((r: any) => ({
        id: String(r._id),
        at: r.timestamp,
        groundingStatus: r.meta?.groundingStatus ?? null,
        citations: r.meta?.citations ?? 0,
      })),
    });
  })
);

export default router;
