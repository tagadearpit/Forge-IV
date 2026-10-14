import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectTestDatabase } from './testDatabase.js';
import { Assessment } from '../models/Assessment.js';
import { Mastery } from '../models/Mastery.js';
import { Question } from '../models/Question.js';
import { Response } from '../models/Response.js';
import { migrateAssessmentResponseUniqueness } from '../services/assessmentResponseMigration.js';
import { submitAnswer } from '../services/assessment.js';

test('migrates duplicate legacy responses, then concurrent saves create one row and one mastery update', async () => {
  await connectTestDatabase('assessment_response_race');
  await mongoose.connection.dropDatabase();

  const userId = new mongoose.Types.ObjectId();
  const assessmentId = new mongoose.Types.ObjectId();
  const questionId = new mongoose.Types.ObjectId();
  const topicId = new mongoose.Types.ObjectId();
  const date1 = new Date('2026-01-01T00:00:00Z');
  const date2 = new Date('2026-01-02T00:00:00Z');
  await Response.collection.insertMany([
    { userId, assessmentId, questionId, answer: 'older useful answer', correct: false, createdAt: date1, updatedAt: date1 },
    { userId, assessmentId, questionId, answer: '   ', correct: false, createdAt: date2, updatedAt: date2 },
  ]);

  const migration = await migrateAssessmentResponseUniqueness();
  assert.equal(migration.duplicateRowsRemoved, 1);
  const retained = await Response.findOne({ userId, assessmentId, questionId }).lean() as any;
  assert.equal(retained.answer, 'older useful answer', 'prefer the latest useful row over a newer blank legacy row');
  const uniqueIndex = (await Response.collection.indexes()).find((index) => index.unique && index.key.userId === 1 && index.key.assessmentId === 1 && index.key.questionId === 1);
  assert.ok(uniqueIndex, 'unique compound index is installed only after dedupe');

  await Response.deleteMany({ userId, assessmentId, questionId });
  await Assessment.create({ _id: assessmentId, userId, questionIds: [questionId], status: 'in_progress', mode: 'quiz' });
  await Question.create({
    _id: questionId, userId, assessmentId, topicId, type: 'short', text: 'What is the answer?',
    answerKey: 'four', explanation: '', difficulty: 0.5, verified: true,
  });

  const saves = await Promise.all(Array.from({ length: 12 }, () => submitAnswer(
    String(userId), String(assessmentId), String(questionId), 'four', 3
  )));
  assert.ok(saves.every(Boolean));
  assert.equal(await Response.countDocuments({ userId, assessmentId, questionId }), 1);
  const mastery = await Mastery.findOne({ userId, topicId }).lean() as any;
  assert.equal(mastery?.attempts, 1, 'only the winning atomic insert advances mastery');
});
