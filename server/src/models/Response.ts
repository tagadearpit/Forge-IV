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
  { timestamps: true, autoIndex: false }
);

export type ResponseDoc = InferSchemaType<typeof ResponseSchema>;
// The app explicitly migrates/deduplicates legacy rows before creating indexes.
// Automatic index creation is disabled above so a unique build can never race the migration.
ResponseSchema.index({ userId: 1, assessmentId: 1, questionId: 1 }, { unique: true });
export const Response = mongoose.model('Response', ResponseSchema);
