import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Topic } from '../models/Topic.js';
import { asyncHandler, validateBody, ApiError } from '../middleware/error.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { applyIntakePrior } from '../services/learnerModel.js';

const router = Router();

const intakeSchema = z.object({
  examDate: z.string().optional().nullable(),
  targetScore: z.number().min(0).max(100).optional().nullable(),
  language: z.enum(['en', 'hi']).optional(),
  /** Self-rated familiarity per topic, 1 (new) .. 5 (very familiar). */
  familiarity: z.record(z.string(), z.number().min(1).max(5)).optional(),
});

/**
 * Cold-start intake. Self-ratings become a prior on pLearned, but confidence
 * stays "low" until real attempts accumulate, so the dashboard never implies
 * knowledge we inferred rather than measured.
 */
router.post(
  '/intake',
  requireAuth,
  validateBody(intakeSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { examDate, targetScore, language, familiarity } = req.body as z.infer<typeof intakeSchema>;
    const user = await User.findById(req.userId);
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User does not exist.');

    const prefs = (user.prefs ??= {} as never);
    if (examDate !== undefined) prefs.examDate = examDate ? new Date(examDate) : null;
    if (targetScore !== undefined) prefs.targetScore = targetScore;
    if (language) prefs.language = language;
    prefs.onboarded = true;
    if (familiarity) prefs.selfRatedFamiliarity = new Map(Object.entries(familiarity).map(([k, v]) => [k, v]) as never);
    await user.save();

    let applied = 0;
    if (familiarity) {
      const topics = await Topic.find({ userId: req.userId }).lean();
      for (const t of topics) {
        const rating = familiarity[String(t._id)] ?? familiarity[t.name];
        if (typeof rating === 'number') {
          await applyIntakePrior(req.userId!, String(t._id), rating);
          applied++;
        }
      }
    }

    res.json({ ok: true, topicsSeeded: applied });
  })
);

export default router;
