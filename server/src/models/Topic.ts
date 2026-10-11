import mongoose, { Schema, InferSchemaType } from 'mongoose';

const TopicSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    /** parentId === null marks a top-level topic; children are subtopics. */
    parentId: { type: Schema.Types.ObjectId, ref: 'Topic', default: null, index: true },
    prerequisiteIds: [{ type: Schema.Types.ObjectId, ref: 'Topic' }],
    keyConcepts: { type: [String], default: [] },
    sourceUnitIds: [{ type: Schema.Types.ObjectId, ref: 'Unit' }],
    summary: { type: String, default: null },
  },
  { timestamps: true }
);

export type TopicDoc = InferSchemaType<typeof TopicSchema>;
export const Topic = mongoose.model('Topic', TopicSchema);
