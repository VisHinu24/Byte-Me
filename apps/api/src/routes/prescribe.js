import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';

import { MedicationRequest } from '../models/index.js';
import { requireConsent } from '../middleware/consent.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/error.js';

const router = Router();

const medicationSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().optional(),
  frequency: z.string().optional(),
  duration: z.string().optional(),
  route: z.string().optional(),
  instructions: z.string().optional(),
  reason: z.string().optional(),
});

const bodySchema = z.object({
  medications: z.array(medicationSchema).min(1),
  notes: z.string().optional(),
});

/**
 * POST /api/Patient/:id/_prescribe
 *
 * Authors a prescription. Both clinicians and patients can call this
 * (cross-patient access is still blocked by the consent middleware).
 * Persists one MedicationRequest per row.
 */
router.post(
  '/:id/_prescribe',
  requireValidPatient,
  requireConsent('medications'),
  async (req, res) => {
    const { medications, notes } = bodySchema.parse(req.body);
    const patientId = req.params.id;
    const now = new Date();
    const requesterRef = req.user.providerId ?? `Patient/${req.user.sub}`;

    const docs = medications.map((m) => ({
      status: 'active',
      intent: 'order',
      medicationCodeableConcept: { text: m.name },
      subject: { reference: `Patient/${patientId}` },
      authoredOn: now,
      requester: { reference: requesterRef, display: req.user.name },
      dosageInstruction: [{ text: composeDosageText(m) }],
      reasonCode: m.reason ? [{ text: m.reason }] : undefined,
      note: notes ? [{ text: notes, time: now }] : undefined,
      provenance: [{ sourceSystem: 'manual-prescription', sourceFormat: 'MANUAL', ingestedAt: now }],
    }));

    let inserted;
    try {
      inserted = await MedicationRequest.insertMany(docs);
    } catch (err) {
      throw new HttpError(400, `Prescribe failed: ${err.message}`);
    }

    await recordAudit({
      req,
      action: 'medication.prescribe',
      patientId,
      details: { count: inserted.length, names: medications.map((m) => m.name) },
    });

    res.json({
      created: inserted.length,
      ids: inserted.map((d) => d._id.toString()),
      preview: inserted.map((d, i) => ({
        _id: d._id.toString(),
        name: medications[i].name,
        dosage: medications[i].dosage,
        at: now,
      })),
    });
  }
);

function composeDosageText(m) {
  return [m.dosage, m.frequency, m.duration, m.route, m.instructions].filter(Boolean).join(' · ');
}

function requireValidPatient(req, _res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new HttpError(400, 'Invalid patient id');
  }
  next();
}

export default router;
