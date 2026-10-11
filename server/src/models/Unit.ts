import mongoose, { Schema, InferSchemaType } from 'mongoose';

/**
 * A Unit is the atomic, citable piece of knowledge. Every unit keeps an exact
 * `location` so an answer can be traced back to page / slide / timestamp.
 */
const UnitSchema = new Schema(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: 'Source', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: {
      type: String,
      enum: ['text', 'figure', 'transcript'],
      required: true,
      default: 'text',
    },
    text: { type: String, required: true },
    location: {
      page: { type: Number, default: null },
      slide: { type: Number, default: null },
      startSec: { type: Number, default: null },
      endSec: { type: Number, default: null },
    },
    figureDescription: { type: String, default: null },
    /** Speaker notes recovered from a slide deck, kept separate from slide body text. */
    speakerNotes: { type: String, default: null },
    embedding: { type: [Number], default: undefined, index: true },
    topicIds: [{ type: Schema.Types.ObjectId, ref: 'Topic', index: true }],
    charStart: { type: Number, default: null },
    charEnd: { type: Number, default: null },
  },
  { timestamps: true }
);

UnitSchema.index({ userId: 1, sourceId: 1 });

export type UnitDoc = InferSchemaType<typeof UnitSchema>;
export const Unit = mongoose.model('Unit', UnitSchema);
