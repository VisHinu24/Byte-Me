import { Router } from 'express';
import mongoose from 'mongoose';
import { orchestrateBrief } from '../agents/orchestrator.js';
import { requireConsent } from '../middleware/consent.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/error.js';

const router = Router();

/**
 * POST /api/Patient/:id/_brief
 *
 * Streams the orchestrated point-of-care brief as Server-Sent Events.
 * Each event is JSON, see orchestrator.js for the event schema.
 *
 * Body (optional): { complaint: string }
 *
 * (Underscore-prefix instead of FHIR `$` — Express 4's path-to-regexp 0.1
 *  treats `$` as a regex anchor and never matches.)
 */
router.post(
  '/:id/_brief',
  requireValidId,
  // Brief touches everything — require any active consent (or all).
  requireConsent('*'),
  async (req, res) => {
    const { id } = req.params;
    const { complaint } = req.body ?? {};

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    let aborted = false;
    req.on('close', () => { aborted = true; });

    try {
      await recordAudit({
        req,
        action: 'brief.synthesize',
        patientId: id,
        outcome: 'success',
        details: { complaint },
      });

      const emit = (event) => {
        if (!aborted) send(event);
      };

      await orchestrateBrief({
        patientId: id,
        complaint,
        allowedCategories: req.consent?.grantedCategories ?? null,
      }, emit);
    } catch (err) {
      send({ type: 'error', message: err.message });
      await recordAudit({
        req,
        action: 'brief.synthesize',
        patientId: id,
        outcome: 'error',
        reason: err.message,
      });
    } finally {
      res.end();
    }
  }
);

function requireValidId(req, _res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new HttpError(400, 'Invalid patient id');
  }
  next();
}

export default router;
