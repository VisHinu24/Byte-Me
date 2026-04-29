import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { DerivedMemory } from '../models/index.js';
import { runRetrievalAgent } from '../agents/retrieval.js';
import { runDistillationAgent } from '../agents/distillation.js';
import { requireConsent } from '../middleware/consent.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/error.js';
import { logger } from '../config/logger.js';

const router = Router();

/**
 * DerivedMemory is patient-curated. The patient owns the memory layer:
 *   - they list their own memories
 *   - they trigger distillation
 *   - they reject / restore memories
 *
 * Doctors do NOT see the Memory tab in the UI and cannot hit these endpoints
 * directly. Memories still surface inside the synthesized brief (with cite
 * pins) via the retrieval agent, but the curation surface stays patient-only.
 */
function requirePatientSelf(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
  if (req.user.role !== 'patient') {
    throw new HttpError(403, 'Memory curation is patient-only');
  }
  if (req.params.id && req.user.sub !== req.params.id) {
    throw new HttpError(403, 'You can only manage memories for your own record');
  }
  next();
}

// ---------- Patient-scoped: list + distill ----------

router.get(
  '/:id/DerivedMemory',
  requireValidId,
  requirePatientSelf,
  async (req, res) => {
    const { status = 'active', kind } = req.query;
    const filter = { 'patient.reference': `Patient/${req.params.id}` };
    if (status !== 'all') filter.status = status;
    if (kind) filter.kind = kind;

    const items = await DerivedMemory.find(filter).sort({ createdAt: -1 }).lean({ virtuals: true });
    res.json({ total: items.length, items });
  }
);

router.post(
  '/:id/_distill',
  requireValidId,
  requirePatientSelf,
  async (req, res) => {
    const patientId = req.params.id;
    const patientRef = `Patient/${patientId}`;

    // Patient self-distillation — full record is allowed (allowedCategories=null).
    const { findings } = await runRetrievalAgent({
      patientId,
      allowedCategories: null,
    });

    // Avoid duplicating against existing active memories
    const existing = await DerivedMemory.find({
      'patient.reference': patientRef,
      status: 'active',
    }).lean();

    const { candidates, modelHint } = await runDistillationAgent({ findings, existing });

    // Dedup against existing memories by kind + title
    const existingKeys = new Set(existing.map((m) => `${m.kind}::${m.title}`));
    const fresh = candidates.filter((c) => !existingKeys.has(`${c.kind}::${c.title}`));

    const created = [];
    for (const c of fresh) {
      try {
        const memory = await DerivedMemory.create({
          patient: { reference: patientRef },
          kind: c.kind,
          title: c.title,
          summary: c.summary,
          tags: c.tags ?? [],
          confidence: typeof c.confidence === 'number' ? c.confidence : 0.7,
          timeWindow: {
            start: parseDate(c.timeWindow?.start),
            end: parseDate(c.timeWindow?.end),
          },
          sources: (c.sources ?? []).filter((s) => s?.resourceType && s?.id),
          createdBy: { kind: 'agent', id: 'distillation', modelHint },
          status: 'active',
        });
        created.push(memory.toJSON());
      } catch (err) {
        logger.warn({ err: err.message, candidate: c.title }, 'memory create failed');
      }
    }

    await recordAudit({
      req,
      action: 'agent.synthesis',
      patientId,
      details: { distilled: created.length, candidatesProposed: candidates.length, modelHint },
    });

    res.json({
      proposed: candidates.length,
      created: created.length,
      skipped: candidates.length - fresh.length,
      modelHint,
      memories: created,
    });
  }
);

// ---------- Memory-scoped: status updates ----------

const statusSchema = z.object({
  status: z.enum(['active', 'rejected', 'flagged-stale', 'superseded']),
  rejectedReason: z.string().optional(),
});

/**
 * PATCH /api/DerivedMemory/:id/status — update lifecycle. Mounted at app
 * level via memoryStatusRouter export below.
 */
export const memoryStatusRouter = Router();

memoryStatusRouter.patch('/:id/status', async (req, res) => {
  const memId = req.params.id;
  if (!mongoose.isValidObjectId(memId)) throw new HttpError(400, 'Invalid memory id');
  if (!req.user) throw new HttpError(401, 'Not authenticated');

  const body = statusSchema.parse(req.body);
  const memory = await DerivedMemory.findById(memId);
  if (!memory) throw new HttpError(404, 'Memory not found');

  // Patient-only — only the patient can curate (reject / restore / supersede)
  // memories on their own record.
  const memoryPatientId = memory.patient.reference?.split('/')[1];
  if (req.user.role !== 'patient' || req.user.sub !== memoryPatientId) {
    throw new HttpError(403, 'Memory curation is patient-only');
  }

  memory.status = body.status;
  if (body.status === 'rejected') memory.rejectedReason = body.rejectedReason;
  await memory.save();

  await recordAudit({
    req,
    action: 'agent.synthesis',
    patientId: memoryPatientId,
    details: { memoryId: memId, newStatus: body.status, reason: body.rejectedReason },
  });

  res.json(memory.toJSON());
});

// ---------- helpers ----------

function requireValidId(req, _res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new HttpError(400, 'Invalid patient id');
  }
  next();
}

function parseDate(d) {
  if (!d) return undefined;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? undefined : t;
}

export default router;
