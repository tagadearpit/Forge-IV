import mongoose, { Schema, InferSchemaType } from 'mongoose';

const AssessmentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mode: { type: String, enum: ['quiz', 'mock'], required: true, default: 'quiz' },
    scope: {
      type: { topicIds: [{ type: Schema.Types.ObjectId, ref: 'Topic' }], sourceIds: [{ type: Schema.Types.ObjectId, ref: 'Source' }] },
      default: () => ({ topicIds: [], sourceIds: [] }),
    },
    types: { type: [String], default: ['mcq', 'short', 'numerical'] },
    difficultyMix: {
      easy: { type: Number, default: 0.33 },
      medium: { type: Number, default: 0.34 },
      hard: { type: Number, default: 0.33 },
    },
    questionIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
    status: { type: String, enum: ['generating', 'ready', 'in_progress', 'submitted', 'failed'], default: 'generating' },
    statusReason: { type: String, default: null },
    score: { type: Number, default: null },
    maxScore: { type: Number, default: null },
    durationSec: { type: Number, default: null }, // timed mock exams only
    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export type AssessmentDoc = InferSchemaType<typeof AssessmentSchema>;
export const Assessment = mongoose.model('Assessment', AssessmentSchema);
