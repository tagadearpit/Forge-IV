import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody, ApiError } from '../middleware/error.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';
import { generateStudyPlan, completeTask, buildRevision } from '../services/studyPlan.js';
import { Event } from '../models/Event.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const tasks = await generateStudyPlan(req.userId!);
    const done = await Event.find({ userId: req.userId, type: 'study_task_done' }).select('meta').lean();
    const doneIds = new Set(done.map((d: any) => d.meta?.taskId).filter(Boolean));
    res.json({ tasks: tasks.map((t) => ({ ...t, done: doneIds.has(t.id) })) });
  })
);

router.post(
  '/generate',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const tasks = await generateStudyPlan(req.userId!);
    res.json({ tasks });
  })
);

router.post(
  '/tasks/:taskId/complete',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    await completeTask(req.userId!, req.params.taskId);
    res.json({ ok: true, taskId: req.params.taskId });
  })
);

/** GET /revision/:topicId — flashcards + summary slides for one topic. */
export const revisionRouter = Router();

revisionRouter.get(
  '/:topicId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const revision = await buildRevision(req.userId!, req.params.topicId);
    if (!revision) throw new ApiError(404, 'TOPIC_NOT_FOUND', 'That topic does not exist.');
    res.json(revision);
  })
);

export default router;
