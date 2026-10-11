import mongoose, { Schema, InferSchemaType } from 'mongoose';

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    prefs: {
      language: { type: String, enum: ['en', 'hi'], default: 'en' },
      examDate: { type: Date, default: null },
      targetScore: { type: Number, default: null, min: 0, max: 100 },
      onboarded: { type: Boolean, default: false },
      selfRatedFamiliarity: { type: Map, of: Number, default: {} },
    },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const User = mongoose.model('User', UserSchema);
