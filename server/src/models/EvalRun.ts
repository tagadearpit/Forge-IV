import mongoose, { Schema, InferSchemaType } from 'mongoose';

const EvalRunSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    framework: { type: String, required: true }, // 'ragas' | 'local-exact'
    metrics: { type: Schema.Types.Mixed, required: true },
    personalization: { type: Schema.Types.Mixed, default: null },
    testSetVersion: { type: String, required: true },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

export type EvalRunDoc = InferSchemaType<typeof EvalRunSchema>;
export const EvalRun = mongoose.model('EvalRun', EvalRunSchema);
