import mongoose, { Schema, InferSchemaType } from 'mongoose';

const EventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['quiz_taken', 'question_asked', 'source_uploaded', 'source_ready', 'login', 'revision_reviewed', 'study_task_done'],
      required: true,
    },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', default: null },
    sourceId: { type: Schema.Types.ObjectId, ref: 'Source', default: null },
    correct: { type: Boolean, default: null },
    meta: { type: Schema.Types.Mixed, default: null },
    /** Denormalised day key (YYYY-MM-DD) so streak calculation stays a cheap index scan. */
    day: { type: String, required: true, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

EventSchema.index({ userId: 1, timestamp: -1 });

export type EventDoc = InferSchemaType<typeof EventSchema>;
export const Event = mongoose.model('Event', EventSchema);
