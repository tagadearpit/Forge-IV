import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/User';
import { env } from '../config/env';
import { ApiError, asyncHandler, validateBody } from '../middleware/error';
import { requireAuth, signToken, AuthedRequest } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import { logEvent } from '../services/events';

const router = Router();

/* ----------------------------- validation ----------------------------- */

const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(60, 'Name must be at most 60 characters.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number including country code.'),
  password: passwordRule,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

const patchMeSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  phone: z.string().trim().regex(/^\+?[0-9]{7,15}$/).optional(),
  prefs: z
    .object({
      language: z.enum(['en', 'hi']).optional(),
      examDate: z.string().optional().nullable(),
      targetScore: z.number().min(0).max(100).optional().nullable(),
    })
    .optional(),
});

/* ------------------------------ helpers ------------------------------- */

/** prefs arrives as a plain object or a Mongoose Map depending on the query. */
function normalisePrefs(prefs: unknown): Record<string, unknown> {
  if (!prefs) return {};
  if (prefs instanceof Map) return Object.fromEntries(prefs as Map<string, unknown>);
  return prefs as Record<string, unknown>;
}

type PublicUserInput = {
  _id: unknown;
  name: string;
  email: string;
  phone: string;
  createdAt: Date;
  prefs?: unknown;
};

function publicUser(u: PublicUserInput) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone,
    createdAt: u.createdAt,
    prefs: normalisePrefs(u.prefs),
  };
}

/* ------------------------------- routes ------------------------------- */

router.post(
  '/register',
  authLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, phone, password } = req.body as z.infer<typeof registerSchema>;

    const existing = await User.findOne({ email }).lean();
    if (existing) {
      throw new ApiError(
        409,
        'EMAIL_EXISTS',
        'An account with this email already exists. Please log in.'
      );
    }

    // Hashing is always server-side; the client never sends a hash.
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);

    const user = await User.create({ name, email, phone, passwordHash });
    await logEvent(String(user._id), 'login', null, null, 'auth');

    const token = signToken(String(user._id), user.email);
    res.status(201).json({ token, user: publicUser(user) });
  })
);

router.post(
  '/login',
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    // passwordHash is select:false, so it must be requested explicitly.
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'User does not exist. Please register first.');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new ApiError(401, 'INVALID_PASSWORD', 'Incorrect password. Please try again.');
    }

    await logEvent(String(user._id), 'login', null, null, 'auth');

    const token = signToken(String(user._id), user.email);
    res.status(200).json({ token, user: publicUser(user) });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await User.findById(req.userId);
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User does not exist.');
    res.json({ user: publicUser(user) });
  })
);

router.patch(
  '/me',
  requireAuth,
  validateBody(patchMeSchema),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name, phone, prefs } = req.body as z.infer<typeof patchMeSchema>;
    const user = await User.findById(req.userId);
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User does not exist.');

    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (prefs) {
      const target = (user.prefs ??= { language: 'en', onboarded: false } as never);
      if (prefs.language) target.language = prefs.language as 'en' | 'hi';
      if (prefs.targetScore !== undefined) {
        target.targetScore = prefs.targetScore as number | null;
      }
      if (prefs.examDate !== undefined) {
        target.examDate = prefs.examDate ? new Date(prefs.examDate) : null;
      }
    }
    await user.save();
    res.json({ user: publicUser(user) });
  })
);

/**
 * Stateless JWT: there is nothing server-side to revoke, so this endpoint is a
 * deliberate 204 no-op that exists so the client has one obvious call to make
 * (and a place to hang future token-blacklist logic).
 */
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res) => {
    res.status(204).send();
  })
);

export default router;