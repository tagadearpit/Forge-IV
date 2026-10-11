import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError, validateBody } from '../middleware/error';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { getMasteryOverview, getMasterySummary, recordAnswer } from '../services/learnerModel';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const topics = await getMasteryOverview(req.userId!);
    res.json({ topics, summary: await getMasterySummary(req.userId!) });
  })
);

const eventSchema = z.object({
  topicId: z.string().min(1),
  correct: z.boolean(),
  source: z.string().optional(),
  difficulty: z.number().min(0).max(1).optional(),
});

/**
 * Internal write path used by the tutor (a correct explanation is evidence of
 * learning) and by simulated-student evaluation runs.
 */
router.post(
  '/events',
  requireAuth,
  validateBody(eventSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { topicId, correct, source, difficulty } = req.body as z.infer<typeof eventSchema>;
    const result = await recordAnswer(req.userId!, topicId, correct, { source, difficulty });
    res.json(result);
  })
);

export default router;
