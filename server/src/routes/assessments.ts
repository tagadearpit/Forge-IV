import { Router } from 'express';
import { z } from 'zod';
import { Assessment } from '../models/Assessment';
import { Question } from '../models/Question';
import { Response } from '../models/Response';
import { Topic } from '../models/Topic';
import { asyncHandler, ApiError, validateBody } from '../middleware/error';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { heavyLimiter } from '../middleware/rateLimit';
import { createAssessment, submitAnswer } from '../services/assessment';
import { getMasteryOverview } from '../services/learnerModel';
import { logEvent } from '../services/events';
import { getAIProvider } from '../ai/provider';

const router = Router();

const createSchema = z.object({
  scope: z
    .object({
      sourceIds: z.array(z.string()).optional(),
      topicIds: z.array(z.string()).optional(),
    })
    .optional(),
  types: z.array(z.enum(['mcq', 'short', 'numerical'])).optional(),
  count: z.number().int().min(1).max(50).optional(),
  difficultyMix: z
    .object({ easy: z.number().min(0).max(1), medium: z.number().min(0).max(1), hard: z.number().min(0).max(1) })
    .optional(),
  mode: z.enum(['quiz', 'mock']).optional(),
  durationSec: z.number().int().min(60).max(7200).optional(),
});

const answerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.union([z.string(), z.number()]),
  timeSpentSec: z.number().min(0).max(86_400).optional(),
});

/* ----------------------- POST /assessments ---------------------------- */

router.post(
  '/',
  requireAuth,
  heavyLimiter,
  validateBody(createSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const { assessment, rejected, dedupeRelaxed } = await createAssessment({ userId: req.userId!, ...body });

    if (assessment.status === 'failed') {
      throw new ApiError(
        422,
        'GENERATION_FAILED',
        assessment.statusReason ?? 'Could not generate questions from the selected material.'
      );
    }

    res.status(201).json({
      assessment: {
        id: String(assessment._id),
        mode: assessment.mode,
        status: assessment.status,
        questionCount: assessment.questionIds.length,
        durationSec: assessment.durationSec,
      },
      rejected,
      // Surfaced so the UI can say "novelty guard relaxed — corpus nearly
      // exhausted" instead of silently serving near-duplicates.
      dedupeRelaxed: Boolean(dedupeRelaxed),
    });
  })
);

/* ------------------------ GET /assessments/:id ------------------------ */

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const assessment = await Assessment.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!assessment) throw new ApiError(404, 'ASSESSMENT_NOT_FOUND', 'That assessment does not exist.');

    const questions = await Question.find({ _id: { $in: assessment.questionIds ?? [] } }).lean();
    const responses = await Response.find({ assessmentId: assessment._id }).lean();
    const rMap = new Map(responses.map((r: any) => [String(r.questionId), r]));

    // Never leak answer keys before submission.
    const isSubmitted = assessment.status === 'submitted';

    res.json({
      assessment: {
        id: String(assessment._id),
        mode: assessment.mode,
        status: assessment.status,
        startedAt: assessment.startedAt,
        submittedAt: assessment.submittedAt,
        durationSec: assessment.durationSec,
        score: assessment.score,
      },
      questions: questions.map((q: any) => {
        const r: any = rMap.get(String(q._id));
        return {
          id: String(q._id),
          type: q.type,
          text: q.text,
          options: q.options ?? null,
          units: q.units ?? null,
          difficulty: q.difficulty,
          topicId: q.topicId ? String(q.topicId) : null,
          answered: Boolean(r),
          // Feedback only after submission.
          ...(isSubmitted
            ? {
                correct: r?.correct ?? false,
                correctAnswer: q.answerKey,
                explanation: q.explanation,
                misconception: q.misconception,
              }
            : {}),
        };
      }),
    });
  })
);

/* ------------------ POST /assessments/:id/answers ---------------------- */

router.post(
  '/:id/answers',
  requireAuth,
  validateBody(answerSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { questionId, answer, timeSpentSec } = req.body as z.infer<typeof answerSchema>;

    const assessment = await Assessment.findOne({ _id: req.params.id, userId: req.userId });
    if (!assessment) throw new ApiError(404, 'ASSESSMENT_NOT_FOUND', 'That assessment does not exist.');
    if (assessment.status === 'submitted') {
      throw new ApiError(409, 'ALREADY_SUBMITTED', 'This assessment has already been submitted.');
    }

    const graded = await submitAnswer(
      req.userId!,
      String(assessment._id),
      questionId,
      answer,
      timeSpentSec ?? 0
    );
    if (!graded) throw new ApiError(404, 'QUESTION_NOT_FOUND', 'That question is not part of this assessment.');

    if (!assessment.startedAt) {
      assessment.startedAt = new Date();
      assessment.status = 'in_progress';
      await assessment.save();
    }

    res.json({
      questionId: graded.questionId,
      // The correctness signal is returned immediately (good UX for quizzes),
      // but the answer key and explanation only surface at submit time.
      recorded: true,
      correct: graded.correct,
    });
  })
);

/* ------------------ POST /assessments/:id/submit ---------------------- */

router.post(
  '/:id/submit',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const assessment = await Assessment.findOne({ _id: req.params.id, userId: req.userId });
    if (!assessment) throw new ApiError(404, 'ASSESSMENT_NOT_FOUND', 'That assessment does not exist.');
    if (assessment.status === 'submitted') {
      throw new ApiError(409, 'ALREADY_SUBMITTED', 'This assessment has already been submitted.');
    }

    const questions = await Question.find({ _id: { $in: assessment.questionIds ?? [] } }).lean();
    const responses = await Response.find({ assessmentId: assessment._id }).lean();

    const answered = new Set(responses.map((r: any) => String(r.questionId)));
    const correctCount = responses.filter((r: any) => r.correct).length;
    const score = questions.length ? correctCount / questions.length : 0;

    assessment.status = 'submitted';
    assessment.submittedAt = new Date();
    assessment.score = Number(score.toFixed(4));
    assessment.maxScore = questions.length;
    await assessment.save();

    await logEvent(req.userId!, 'quiz_taken', null, null, 'assessments', {
      assessmentId: String(assessment._id),
      score,
    });

    res.json({
      assessmentId: String(assessment._id),
      score: assessment.score,
      correct: correctCount,
      total: questions.length,
      unanswered: questions.length - answered.size,
    });
  })
);

/* ------------------- GET /assessments/:id/report ---------------------- */

router.get(
  '/:id/report',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const assessment = await Assessment.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!assessment) throw new ApiError(404, 'ASSESSMENT_NOT_FOUND', 'That assessment does not exist.');
    if (assessment.status !== 'submitted') {
      throw new ApiError(409, 'NOT_SUBMITTED', 'Submit the assessment before viewing its report.');
    }

    const questions = await Question.find({ _id: { $in: assessment.questionIds ?? [] } }).lean();
    const responses = await Response.find({ assessmentId: assessment._id }).lean();
    const topicIds = [...new Set(questions.map((q: any) => q.topicId).filter(Boolean).map(String))];
    const topics = await Topic.find({ _id: { $in: topicIds } }).lean();
    const tMap = new Map(topics.map((t: any) => [String(t._id), t.name]));

    // Topic-level breakdown.
    const byTopic = new Map<string, { correct: number; total: number }>();
    for (const r of responses) {
      const key = String(r.topicId ?? 'unassigned');
      const cur = byTopic.get(key) ?? { correct: 0, total: 0 };
      cur.total++;
      if (r.correct) cur.correct++;
      byTopic.set(key, cur);
    }

    const topicBreakdown = [...byTopic.entries()].map(([id, v]) => ({
      topicId: id,
      topicName: tMap.get(id) ?? 'Unassigned',
      correct: v.correct,
      total: v.total,
      score: v.total ? Number((v.correct / v.total).toFixed(3)) : 0,
    }));

    // Misconception tally — explicitly labelled, never inferred silently.
    const miscon = new Map<string, number>();
    for (const r of responses) {
      if (r.correct) continue;
      const q: any = questions.find((x: any) => String(x._id) === String(r.questionId));
      if (q?.misconception) miscon.set(q.misconception, (miscon.get(q.misconception) ?? 0) + 1);
    }

    const masteryAfter = await getMasteryOverview(req.userId!);

    res.json({
      score: assessment.score,
      correct: responses.filter((r: any) => r.correct).length,
      total: questions.length,
      durationSec: Math.round(
        ((assessment.submittedAt?.getTime() ?? 0) - (assessment.startedAt?.getTime() ?? 0)) / 1000
      ),
      topicBreakdown: topicBreakdown.sort((a, b) => a.score - b.score),
      weakTopics: topicBreakdown.filter((t) => t.score < 0.5).map((t) => t.topicName),
      misconceptions: [...miscon.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      timePerQuestion: responses.map((r: any) => ({
        questionId: String(r.questionId),
        timeSpentSec: r.timeSpentSec ?? 0,
        correct: r.correct,
      })),
      masteryAfter: masteryAfter.slice(0, 12),
      provider: getAIProvider().name,
    });
  })
);

/** Recent assessments for the dashboard feed. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const rows = await Assessment.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json({
      assessments: rows.map((a: any) => ({
        id: String(a._id),
        mode: a.mode,
        status: a.status,
        score: a.score,
        total: a.questionIds?.length ?? 0,
        createdAt: a.createdAt,
        submittedAt: a.submittedAt ?? null,
      })),
    });
  })
);

export default router;