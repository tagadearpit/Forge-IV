import mongoose, { Schema, InferSchemaType } from 'mongoose';

/**
 * Bayesian Knowledge Tracing state for one (user, topic) pair, plus an
 * FSRS-lite memory-stability term that drives the forgetting curve.
 */
const MasterySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true, index: true },
    pLearned: { type: Number, default: 0.1, min: 0, max: 1 },
    pSlip: { type: Number, default: 0.1, min: 0, max: 1 },
    pGuess: { type: Number, default: 0.2, min: 0, max: 1 },
    pTransit: { type: Number, default: 0.12, min: 0, max: 1 },
    attempts: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    lastReviewedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    stability: { type: Number, default: 1.0, min: 0.1 },
    /** Rolling history for the sparkline / mastery-over-time chart. */
    history: {
      type: [{ at: Date, pLearned: Number, retention: Number }],
      default: [],
    },
    source: { type: String, default: 'quiz' },
  },
  { timestamps: true }
);

MasterySchema.index({ userId: 1, topicId: 1 }, { unique: true });

export type MasteryDoc = InferSchemaType<typeof MasterySchema>;
export const Mastery = mongoose.model('Mastery', MasterySchema);
