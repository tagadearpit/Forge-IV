import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Source, SOURCE_TYPES } from '../models/Source.js';
import { Unit } from '../models/Unit.js';
import { Topic } from '../models/Topic.js';
import { env } from '../config/env.js';
import { ApiError, asyncHandler } from '../middleware/error.js';
import { requireAuth, signFileToken, verifyFileToken, AuthedRequest } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/rateLimit.js';
import { ingestSource } from '../services/ingestion.js';
import { logEvent } from '../services/events.js';

const router = Router();

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const ACCEPTED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'video/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'text/plain',
  'text/markdown',
]);

const EXT_TYPE: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, env.UPLOAD_DIR),
    filename: (_req, file, cb) => {
      // multer 2.x no longer guarantees `req.params` is populated inside the
      // storage callback, so the filename must not depend on it. A timestamp
      // plus the sanitised original name is unique enough and carries no PII.
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
    },
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = ACCEPTED.has(file.mimetype) || EXT_TYPE[ext];
    if (!ok) {
      cb(
        new ApiError(
          415,
          'UNSUPPORTED_TYPE',
          `Unsupported file type. Accepted: PDF, PPTX, PNG, JPG, MP4, MP3, TXT.`
        ) as never
      );
      return;
    }
    cb(null, true);
  },
});

function detectType(original: string, mime: string): (typeof SOURCE_TYPES)[number] {
  const ext = path.extname(original).toLowerCase();
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === '.pptx' || mime.includes('presentationml')) return 'pptx';
  if (['.png', '.jpg', '.jpeg'].includes(ext) || mime.startsWith('image/')) return 'image';
  if (ext === '.mp4' || mime.startsWith('video/')) return 'video';
  if (['.mp3', '.wav'].includes(ext) || mime.startsWith('audio/')) return 'audio';
  if (['.txt', '.md'].includes(ext) || mime.startsWith('text/')) return 'text';
  return 'text';
}

/* --------------------------- POST /sources ---------------------------- */

router.post(
  '/',
  requireAuth,
  heavyLimiter,
  upload.single('file'),
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!req.file) {
      throw new ApiError(400, 'NO_FILE', 'No file was uploaded.');
    }
    if (req.file.size === 0) {
      fs.unlink(req.file.path, () => {});
      throw new ApiError(400, 'EMPTY_FILE', 'That file is empty. Please upload a file with content.');
    }

    const type = detectType(req.file.originalname, req.file.mimetype);
    const title = (req.body?.title || path.basename(req.file.originalname, path.extname(req.file.originalname))).slice(0, 120);

    const uid = req.userId!;
    const source = await Source.create({
      userId: uid,
      type,
      title,
      fileUrl: path.basename(req.file.path),
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      status: 'queued',
      sizeBytes: req.file.size,
    });

    await logEvent(uid, 'source_uploaded', null, null, 'upload', {
      sourceId: String(source._id),
    });

    // Kick off ingestion without blocking the response. The client polls the
    // source status, which is why 202 (accepted, not created-and-ready) is the
    // correct code here.
    setImmediate(() => {
      ingestSource(String(source._id), uid, req.file!.path, req.file!.mimetype).catch(
        (err) => console.error('[ingest:background]', err.message)
      );
    });

    res.status(202).json({ sourceId: String(source._id), status: source.status });
  })
);

/* --------------------------- GET /sources ----------------------------- */

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const sources = await Source.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
    const topicNames = await Topic.find({ userId: req.userId }).select('name').lean();
    const nameMap = new Map(topicNames.map((t: any) => [String(t._id), t.name]));

    res.json({
      sources: sources.map((s: any) => ({
        id: String(s._id),
        type: s.type,
        title: s.title,
        status: s.status,
        statusReason: s.statusReason ?? null,
        embeddingStatus: s.embeddingStatus ?? 'queued',
        outline: s.outline ?? [],
        progress: s.progress ?? 0,
        pageCount: s.pageCount ?? null,
        durationSec: s.durationSec ?? null,
        sizeBytes: s.sizeBytes ?? null,
        unitCount: s.unitCount ?? 0,
        createdAt: s.createdAt,
        topics: (s.topicIds ?? []).map((id: string) => nameMap.get(String(id))).filter(Boolean),
      })),
    });
  })
);

/* -------------------------- GET /sources/:id -------------------------- */

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const source = await Source.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'That source does not exist.');

    const units = await Unit.find({ sourceId: source._id }).sort({ createdAt: 1 }).lean();
    const topics = await Topic.find({ _id: { $in: source.topicIds ?? [] } }).lean();

    res.json({
      source: {
        id: String(source._id),
        type: source.type,
        title: source.title,
        status: source.status,
        statusReason: source.statusReason ?? null,
        embeddingStatus: source.embeddingStatus ?? 'queued',
        outline: source.outline ?? [],
        pageCount: source.pageCount ?? null,
        durationSec: source.durationSec ?? null,
        progress: source.progress ?? 0,
        stats: source.stats ?? null,
        createdAt: source.createdAt,
      },
      units: units.map((u: any) => ({
        id: String(u._id),
        kind: u.kind,
        text: u.text,
        location: u.location,
        figureDescription: u.figureDescription ?? null,
        speakerNotes: u.speakerNotes ?? null,
        topicIds: (u.topicIds ?? []).map(String),
      })),
      topics: topics.map((t: any) => ({
        id: String(t._id),
        name: t.name,
        summary: t.summary ?? null,
        keyConcepts: t.keyConcepts ?? [],
      })),
    });
  })
);

/* ---------------------- GET /sources/:id/units/:unitId ------------------ */

router.get(
  '/:id/units/:unitId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const unit = await Unit.findOne({
      _id: req.params.unitId,
      sourceId: req.params.id,
      userId: req.userId,
    }).lean();
    if (!unit) throw new ApiError(404, 'UNIT_NOT_FOUND', 'That content unit does not exist.');
    res.json({
      unit: {
        id: String(unit._id),
        kind: unit.kind,
        text: unit.text,
        location: unit.location,
        figureDescription: unit.figureDescription ?? null,
      },
    });
  })
);

/* -------------------------- GET /sources/:id/file ---------------------- */

/**
 * Issues a 5-minute, single-source file token for use in <iframe>/<video>/<audio>
 * src URLs. The long-lived login JWT is NEVER placed in a URL.
 */
router.post(
  '/:id/file-token',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const source = await Source.findOne({ _id: req.params.id, userId: req.userId })
      .select('fileUrl')
      .lean();
    if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'That source does not exist.');

    const filePath = path.join(env.UPLOAD_DIR, path.basename(source.fileUrl));
    if (!fs.existsSync(filePath)) {
      throw new ApiError(404, 'FILE_MISSING', 'The original file is no longer available on the server.');
    }

    const token = signFileToken(req.userId!, req.params.id, 300);
    res.json({
      url: `/api/sources/${req.params.id}/file?t=${encodeURIComponent(token)}`,
      expiresInSec: 300,
    });
  })
);

/**
 * Streams the original file.
 *
 * Accepts EITHER the normal `Authorization: Bearer` header OR `?t=<file-token>`,
 * because media elements cannot send headers. Range requests are supported so
 * <video>/<audio> can seek.
 */
router.get(
  '/:id/file',
  asyncHandler(async (req: AuthedRequest, res) => {
    // Resolve the caller from EITHER transport, then scope the lookup to them.
    const header = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : undefined;
    const raw = header ?? (req.query.t as string | undefined);
    const payload = verifyFileToken(raw, req.params.id);
    if (!payload) {
      throw new ApiError(
        401,
        'FILE_UNAUTHORISED',
        'A valid file token is required to stream this file.'
      );
    }

    const source = await Source.findOne({ _id: req.params.id, userId: payload.sub })
      .select('fileUrl mimeType originalName')
      .lean();
    if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'That source does not exist.');

    const filePath = path.join(env.UPLOAD_DIR, path.basename(source.fileUrl));
    if (!fs.existsSync(filePath)) {
      throw new ApiError(404, 'FILE_MISSING', 'The original file is no longer available on the server.');
    }

    res.setHeader('Content-Type', source.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${source.originalName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Deliberately NO X-Frame-Options and no CSP frame-ancestors: the Vercel
    // origin frames this URL in an <iframe>. Scope is enforced by the token.

    // Range support so <video>/<audio> can seek.
    const range = req.headers.range;
    if (range) {
      const stat = fs.statSync(filePath);
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const size = stat.size;
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : size - 1;
        if (!Number.isNaN(start) && start < size && end >= start) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${Math.min(end, size - 1)}/${size}`);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Length', String(Math.min(end, size - 1) - start + 1));
          fs.createReadStream(filePath, { start, end: Math.min(end, size - 1) }).pipe(res);
          return;
        }
        res.status(416).setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
    }

    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(filePath).pipe(res);
  })
);

/* ------------------------- DELETE /sources/:id ------------------------ */

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Remove the owner-scoped source first: this is the tombstone that stops
    // ingestion/re-embedding workers from making further guarded updates.
    const source = await Source.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'That source does not exist.');

    const units = await Unit.find({ sourceId: source._id, userId: req.userId }).select('_id').lean();
    const unitIds = units.map((unit: any) => unit._id);
    await Promise.all([
      Unit.deleteMany({ sourceId: source._id, userId: req.userId }),
      Topic.deleteMany({ _id: { $in: source.topicIds ?? [] }, userId: req.userId }),
    ]);
    // Also remove any in-flight topic links omitted from the source snapshot.
    if (unitIds.length) {
      await Topic.updateMany({ userId: req.userId, sourceUnitIds: { $in: unitIds } }, { $pull: { sourceUnitIds: { $in: unitIds } } });
    }
    // Remove the original file, but never fail the request if it is already gone.
    fs.unlink(path.join(env.UPLOAD_DIR, path.basename(source.fileUrl)), () => {});

    res.status(204).send();
  })
);

export default router;