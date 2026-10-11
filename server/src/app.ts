import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { dbIsHealthy } from './db/connect';
import { providerInfo } from './ai/provider';
import { errorHandler, notFoundHandler, ApiError, asyncHandler } from './middleware/error';
import { apiLimiter } from './middleware/rateLimit';
import { requireAuth } from './middleware/auth';

import authRoutes from './routes/auth';
import sourceRoutes from './routes/sources';
import topicRoutes from './routes/topics';
import tutorRoutes from './routes/tutor';
import assessmentRoutes from './routes/assessments';
import masteryRoutes from './routes/mastery';
import { revisionRouter } from './routes/studyPlan';
import studyPlanRoutes from './routes/studyPlan';
import onboardingRoutes from './routes/onboarding';
import evalRoutes from './routes/eval';
import { getMasterySummary } from './services/learnerModel';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // required for correct client IPs behind Replit/Vercel

  // CORS: only the configured Vercel origin (plus localhost in dev).
  const allowed = new Set([env.CLIENT_ORIGIN]);
  if (!env.isProd) {
    allowed.add('http://localhost:3000');
    allowed.add('http://127.0.0.1:3000');
  }
  app.use(
    cors({
      origin: (origin, cb) => {
        // Same-origin / curl / server-to-server requests have no Origin header.
        if (!origin) return cb(null, true);
        if (allowed.has(origin)) return cb(null, true);
        return cb(new ApiError(403, 'CORS_DENIED', 'Origin not allowed.'));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', apiLimiter);

  /* ------------------------------ health ------------------------------ */
  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      res.json({
        status: 'ok',
        db: dbIsHealthy() ? 'connected' : 'error',
        provider: providerInfo().name,
        time: new Date().toISOString(),
      });
    })
  );

  /* ------------------------------ routes ------------------------------ */
  app.use('/api/auth', authRoutes);
  app.use('/api/sources', sourceRoutes);
  app.use('/api/topics', topicRoutes);
  app.use('/api/tutor', tutorRoutes);
  app.use('/api/assessments', assessmentRoutes);
  app.use('/api/mastery', masteryRoutes);
  app.use('/api/study-plan', studyPlanRoutes);
  app.use('/api/revision', revisionRouter);
  app.use('/api/onboarding', onboardingRoutes);
  app.use('/api/eval', evalRoutes);

  /* ---------------------------- dashboard ----------------------------- */
  app.get(
    '/api/dashboard',
    requireAuth,
    asyncHandler(handleDashboard)
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

async function handleDashboard(req: express.Request & { userId?: string }, res: express.Response) {
  const { User } = await import('./models/User');
  const { Source } = await import('./models/Source');
  const { Assessment } = await import('./models/Assessment');
  const { Event } = await import('./models/Event');
  const { computeStreak } = await import('./services/events');
  const { getAIProvider } = await import('./ai/provider');
  const { answerQuestion } = await import('./services/rag');

  const userId = req.userId as string;
  const [user, sources, assessments, events, streak, summary] = await Promise.all([
    User.findById(userId).lean(),
    Source.find({ userId }).select('status createdAt title').lean(),
    Assessment.find({ userId, status: 'submitted' }).sort({ submittedAt: -1 }).lean(),
    Event.find({ userId }).sort({ timestamp: -1 }).limit(10).lean(),
    computeStreak(userId),
    getMasterySummary(userId),
  ]);

  // "Next best to study": top weak/most-at-risk topics with a reason string.
  const nextUp = summary.weak.length
    ? summary.weak.map((t: any) => ({
        topicId: t.topicId,
        topicName: t.name,
        pLearned: t.pLearned,
        retention: t.retention,
        reason:
          t.lastReviewedDaysAgo > 0
            ? `Not reviewed in ${Math.round(t.lastReviewedDaysAgo)} days`
            : t.attempts === 0
              ? 'Not studied yet'
              : `Weak at ${Math.round(t.pLearned * 100)}%`,
      }))
    : [];

  res.json({
    greetingName: user?.name?.split(' ')[0] ?? 'there',
    examDate: user?.prefs?.examDate ?? null,
    daysToExam: user?.prefs?.examDate
      ? Math.ceil((new Date(user.prefs.examDate).getTime() - Date.now()) / 86_400_000)
      : null,
    kpis: {
      overallMastery: summary.overall,
      topicsMastered: summary.mastered,
      topicsTracked: summary.total,
      quizzesTaken: assessments.length,
      studyStreak: streak,
    },
    masteryByTopic: [...summary.weak, ...summary.developing, ...summary.strong].map((t: any) => ({
      topicId: t.topicId,
      name: t.name,
      pLearned: t.pLearned,
      band: t.band,
    })),
    nextUp,
    sources: {
      total: sources.length,
      ready: sources.filter((s: any) => s.status === 'ready').length,
      failed: sources.filter((s: any) => s.status === 'failed').length,
    },
    recentActivity: events.map((e: any) => ({
      id: String(e._id),
      type: e.type,
      at: e.timestamp,
      topicId: e.topicId ? String(e.topicId) : null,
    })),
    provider: getAIProvider().name,
  });
}
