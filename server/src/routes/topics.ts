import { Router } from 'express';
import { Topic } from '../models/Topic.js';
import { Mastery } from '../models/Mastery.js';
import { asyncHandler, ApiError } from '../middleware/error.js';
import { requireAuth, AuthedRequest } from '../middleware/auth.js';

const router = Router();

/** Full topic tree: Topics -> Subtopics -> Key Concepts, with mastery merged in. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const topics = await Topic.find({ userId: req.userId }).lean();
    const mastery = await Mastery.find({ userId: req.userId }).lean();
    const mMap = new Map(mastery.map((m) => [String(m.topicId), m]));

    const nodes = topics.map((t: any) => {
      const m = mMap.get(String(t._id));
      return {
        id: String(t._id),
        name: t.name,
        parentId: t.parentId ? String(t.parentId) : null,
        prerequisiteIds: (t.prerequisiteIds ?? []).map(String),
        keyConcepts: t.keyConcepts ?? [],
        summary: t.summary ?? null,
        sourceUnitIds: (t.sourceUnitIds ?? []).map(String).slice(0, 20),
        pLearned: m?.pLearned ?? 0.1,
        attempts: m?.attempts ?? 0,
      };
    });

    // Group into a tree for the sidebar / course-map consumers.
    const byId = new Map(nodes.map((n) => [n.id, { ...n, children: [] as any[] }]));
    const roots: any[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
      else roots.push(node);
    }

    res.json({ topics: roots, flat: nodes });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const topic = await Topic.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!topic) throw new ApiError(404, 'TOPIC_NOT_FOUND', 'That topic does not exist.');
    res.json({ topic });
  })
);

export default router;
