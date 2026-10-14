import mongoose, { Schema, InferSchemaType } from 'mongoose';

const ChatMessageSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  threadId: { type: Schema.Types.ObjectId, ref: 'ChatThread', required: true, index: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true, maxlength: 12000 },
  citations: { type: [Schema.Types.Mixed], default: [] },
  groundingStatus: { type: String, enum: ['full', 'partial', 'outside_material'], default: null },
  outsideKnowledge: { type: String, default: null, maxlength: 12000 },
  pdfClarification: { type: Boolean, default: false },
  scope: { sourceIds: [{ type: Schema.Types.ObjectId }], topicIds: [{ type: Schema.Types.ObjectId }] },
  attachments: { type: [{ type: { type: String, enum: ['pdf'], required: true }, messageId: { type: Schema.Types.ObjectId, required: true } }], default: [] },
  createdAt: { type: Date, default: Date.now, index: true },
}, { timestamps: false });
ChatMessageSchema.index({ userId: 1, threadId: 1, createdAt: 1 });
export type ChatMessageDoc = InferSchemaType<typeof ChatMessageSchema>;
export const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);
