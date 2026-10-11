import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../db/connect';
import { env } from '../config/env';
import { User } from '../models/User';
import { Source } from '../models/Source';
import { Topic } from '../models/Topic';
import { Unit } from '../models/Unit';
import { Mastery } from '../models/Mastery';
import { Assessment } from '../models/Assessment';
import { Question } from '../models/Question';
import { Response } from '../models/Response';
import { Event } from '../models/Event';
import { ingestSource } from '../services/ingestion';
import { buildPdf } from './pdfWriter';
import { SAMPLE_COURSE_TITLE, SAMPLE_COURSE_PARAGRAPHS } from './sampleCourse';

const DEMO_EMAIL = 'demo@studymind.app';
const DEMO_PASSWORD = 'Demo@1234';

/**
 * Seeds a working demo account so a judge can sign in and immediately see a
 * populated knowledge base, mastery history and completed quizzes — nothing
 * should be empty on first view.
 */
async function main() {
  await connectDb();
  fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

  /* ---------------------------- demo user --------------------------- */
  let user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) {
    user = await User.create({
      name: 'Demo Student',
      email: DEMO_EMAIL,
      phone: '+919000000001',
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_COST),
      prefs: {
        language: 'en',
        onboarded: true,
        examDate: new Date(Date.now() + 21 * 86_400_000),
        targetScore: 85,
      },
    });
    console.log('[seed] created demo user');
  } else {
    console.log('[seed] demo user already exists — resetting its data');
  }

  const userId = String(user._id);

  // Idempotent: clear the demo user's generated content, keep the account.
  await Promise.all([
    Source.deleteMany({ userId }),
    Topic.deleteMany({ userId }),
    Unit.deleteMany({ userId }),
    Mastery.deleteMany({ userId }),
    Assessment.deleteMany({ userId }),
    Question.deleteMany({ userId }),
    Response.deleteMany({ userId }),
    Event.deleteMany({ userId }),
  ]);

  /* --------------------------- sample course ------------------------- */
  const pdf = buildPdf(SAMPLE_COURSE_PARAGRAPHS);
  const filePath = path.join(env.UPLOAD_DIR, 'seed-cs241-memory-concurrency.pdf');
  fs.writeFileSync(filePath, pdf);
  console.log(`[seed] wrote sample PDF (${pdf.length} bytes, ~${SAMPLE_COURSE_PARAGRAPHS.length} paragraphs)`);

  const source = await Source.create({
    userId,
    type: 'pdf',
    title: SAMPLE_COURSE_TITLE,
    fileUrl: path.basename(filePath),
    originalName: 'cs241-lecture7.pdf',
    mimeType: 'application/pdf',
    status: 'queued',
    sizeBytes: pdf.length,
    isSeed: true,
  });

  console.log('[seed] ingesting sample source (this runs the full pipeline)...');
  const result = await ingestSource(String(source._id), userId, filePath, 'application/pdf');
  console.log(
    `[seed] ingested: ${result.units} units, ${result.topics} topics, ${result.failures} unit failures, ${result.durationMs}ms`
  );

  /* ------------------- pre-populate mastery history ------------------- */
  const topics = await Topic.find({ userId }).lean();
  if (topics.length) {
    // Deterministic spread so the dashboard looks like a real student mid-course:
    // some strong, some developing, some weak.
    const profile = [0.86, 0.74, 0.62, 0.55, 0.41, 0.33, 0.22, 0.68];
    for (let i = 0; i < topics.length; i++) {
      const p = profile[i % profile.length];
      const attempts = 3 + (i % 6);
      const stability = 1.5 + (i % 5) * 0.8;
      const history: Array<{ at: Date; pLearned: number; retention: number }> = [];
      for (let k = 5; k >= 0; k--) {
        const progress = (5 - k) / 5;
        history.push({
          at: new Date(Date.now() - k * 4 * 86_400_000),
          pLearned: Number((0.1 + (p - 0.1) * progress).toFixed(4)),
          retention: Number((0.1 + (p - 0.1) * progress).toFixed(4)),
        });
      }
      await Mastery.create({
        userId,
        topicId: topics[i]._id,
        pLearned: p,
        pSlip: 0.1,
        pGuess: 0.2,
        pTransit: 0.12,
        attempts,
        correctCount: Math.round(attempts * p),
        lastReviewedAt: new Date(Date.now() - (i % 7) * 86_400_000),
        lastSeenAt: new Date(Date.now() - (i % 7) * 86_400_000),
        stability,
        history,
        source: 'seed',
      });
    }
    console.log(`[seed] wrote mastery history for ${topics.length} topics`);
  }

  /* -------------------- a completed quiz for the feed ----------------- */
  const assessment = await Assessment.create({
    userId,
    mode: 'quiz',
    status: 'submitted',
    questionIds: [],
    score: 0.75,
    maxScore: 4,
    startedAt: new Date(Date.now() - 2 * 86_400_000),
    submittedAt: new Date(Date.now() - 2 * 86_400_000 + 240_000),
  });
  await Assessment.updateOne({ _id: assessment._id }, { $set: { questionIds: [] } });
  console.log('[seed] wrote a completed quiz record');

  /* --------------------------- recent activity ------------------------ */
  const now = Date.now();
  const activity = [
    { type: 'quiz_taken' as const, days: 0, meta: { score: 0.75 } },
    { type: 'question_asked' as const, days: 0, meta: { groundingStatus: 'full', citations: 3 } },
    { type: 'source_uploaded' as const, days: 1, meta: null },
    { type: 'source_ready' as const, days: 1, meta: null },
    { type: 'question_asked' as const, days: 2, meta: { groundingStatus: 'outside_material', citations: 0 } },
    { type: 'revision_reviewed' as const, days: 3, meta: null },
    { type: 'question_asked' as const, days: 4, meta: { groundingStatus: 'full', citations: 2 } },
    { type: 'study_task_done' as const, days: 5, meta: { taskId: 'seed-task-1' } },
  ];
  for (const a of activity) {
    const ts = new Date(now - a.days * 86_400_000);
    await Event.create({
      userId,
      type: a.type,
      day: ts.toISOString().slice(0, 10),
      timestamp: ts,
      meta: a.meta,
      source: 'seed',
    });
  }
  console.log(`[seed] wrote ${activity.length} activity events (5-day streak)`);

  console.log('\n============================================');
  console.log('  StudyMind seed complete');
  console.log('============================================');
  console.log(`  Demo login : ${DEMO_EMAIL}`);
  console.log(`  Password  : ${DEMO_PASSWORD}`);
  console.log(`  Units     : ${result.units}`);
  console.log(`  Topics    : ${result.topics}`);
  console.log('============================================\n');

  await disconnectDb();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});