import mongoose, { Schema } from 'mongoose';

const PdfReportSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fileId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, { timestamps: false });
PdfReportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
PdfReportSchema.index({ userId: 1, createdAt: -1 });
export const PdfReport = mongoose.model('PdfReport', PdfReportSchema);
