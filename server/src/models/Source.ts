import mongoose, { Schema, InferSchemaType } from 'mongoose';

export const SOURCE_TYPES = ['pdf', 'pptx', 'image', 'video', 'audio', 'text'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_STATUSES = ['queued', 'extracting', 'indexing', 'ready', 'failed'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

const SourceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: SOURCE_TYPES, required: true },
    title: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, default: '' },
    status: { type: String, enum: SOURCE_STATUSES, default: 'queued', index: true },
    statusReason: { type: String, default: null },
    pageCount: { type: Number, default: null },
    durationSec: { type: Number, default: null },
    sizeBytes: { type: Number, default: null },
    topicIds: [{ type: Schema.Types.ObjectId, ref: 'Topic' }],
    unitCount: { type: Number, default: 0 },
    progress: { type: Number, default: 0 }, // 0..1 for the upload progress chip
    isSeed: { type: Boolean, default: false },
    stats: {
      unitsTotal: { type: Number, default: 0 },
      unitsFailed: { type: Number, default: 0 },
      figures: { type: Number, default: 0 },
      indexedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

export type SourceDoc = InferSchemaType<typeof SourceSchema>;
export const Source = mongoose.model('Source', SourceSchema);
