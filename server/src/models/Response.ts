import mongoose, { Schema, InferSchemaType } from 'mongoose';

const ResponseSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true, index: true },
    assessmentId: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    answer: { type: Schema.Types.Mixed, required: true },
    correct: { type: Boolean, required: true },
    timeSpentSec: { type: Number, default: 0 },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', default: null },
    selectedMisconception: { type: String, default: null },
  },
  { timestamps: true }
);

export type ResponseDoc = InferSchemaType<typeof ResponseSchema>;
// Retries update a response through the service upsert. Do not add a unique index
// here: historical deployments may already contain duplicate rows. Reads collapse
// those rows to the most recently saved answer before scoring/reporting.
ResponseSchema.index({ userId: 1, assessmentId: 1, questionId: 1 });
export const Response = mongoose.model('Response', ResponseSchema);
