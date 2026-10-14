import mongoose, { Schema, InferSchemaType } from 'mongoose';

const ChatThreadSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, trim: true, maxlength: 120, default: 'New chat' },
  scope: {
    sourceIds: [{ type: Schema.Types.ObjectId, ref: 'Source' }],
    topicIds: [{ type: Schema.Types.ObjectId, ref: 'Topic' }],
    sectionTitle: { type: String, maxlength: 160, default: null },
  },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  pendingPdf: { type: Boolean, default: false },
}, { timestamps: true });
ChatThreadSchema.index({ userId: 1, lastMessageAt: -1 });
export type ChatThreadDoc = InferSchemaType<typeof ChatThreadSchema>;
export const ChatThread = mongoose.model('ChatThread', ChatThreadSchema);
