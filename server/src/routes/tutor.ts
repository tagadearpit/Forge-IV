import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, validateBody, ApiError } from '../middleware/error';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { answerQuestion } from '../services/rag';
import { logEvent } from '../services/events';

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
});

router.post(
  '/ask',
  requireAuth,
  askLimiter,
  validateBody(askSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { question, scope, language } = req.body as z.infer<typeof askSchema>;
    const result = await answerQuestion(req.userId!, question, { scope, language });
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
    const { Event } = await import('../models/Event');
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
