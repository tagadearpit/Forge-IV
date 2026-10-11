import mongoose, { Schema, InferSchemaType } from 'mongoose';

const QuestionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assessmentId: { type: Schema.Types.ObjectId, ref: 'Assessment', default: null, index: true },
    type: { type: String, enum: ['mcq', 'short', 'numerical'], required: true },
    text: { type: String, required: true },
    options: { type: [String], default: null }, // mcq only
    answerKey: { type: Schema.Types.Mixed, required: true }, // string | number
    /** Numerical answers carry an absolute tolerance so floating point never fails a student. */
    tolerance: { type: Number, default: null },
    units: { type: String, default: null }, // numerical unit label, e.g. "m/s"
    explanation: { type: String, default: null },
    misconception: { type: String, default: null },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', default: null, index: true },
    sourceUnitIds: [{ type: Schema.Types.ObjectId, ref: 'Unit' }],
    difficulty: { type: Number, default: 0.5, min: 0, max: 1 },
    verified: { type: Boolean, default: false },
    verificationMethod: { type: String, default: null },
    /** normalized-text hash + embedding vector, used for cross-assessment dedupe. */
    fingerprint: { type: String, default: null, index: true },
    fingerprintEmbedding: { type: [Number], default: undefined },
  },
  { timestamps: true }
);

QuestionSchema.index({ userId: 1, fingerprint: 1 });

export type QuestionDoc = InferSchemaType<typeof QuestionSchema>;
export const Question = mongoose.model('Question', QuestionSchema);
