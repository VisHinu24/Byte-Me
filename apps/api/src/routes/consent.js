import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Consent } from '../models/index.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/error.js';

const router = Router();

const grantSchema = z.object({
  patientId: z.string(),
  granteeRef: z.string(), // e.g. "Practitioner/123"
  granteeDisplay: z.string().optional(),
  granteeType: z.enum(['Practitioner', 'Organization', 'PatientSelf']).default('Practitioner'),
  categories: z
    .array(
      z.enum([
        'demographics',
        'conditions',
        'medications',
        'allergies',
        'observations',
        'encounters',
        'mental-health',
        'reproductive-health',
        'genetic',
        'all',
      ])
    )
    .min(1),
  purpose: z.array(z.string()).default(['treatment']),
  expiresAt: z.string().datetime().optional(),
});

/**
 * Consent endpoints are PATIENT-ONLY. Only the patient themselves can list,
 * grant, or revoke their own grants. Doctors must not see (or be able to
 * mutate) consent records — patients are the data controllers.
 *
 * Enforced by checking req.user.role === 'patient' AND the patient ref on
 * each operation matches req.user.sub.
 */
function requirePatient(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
  if (req.user.role !== 'patient') {
    throw new HttpError(403, 'Only patients can manage their own consent');
  }
  next();
}

router.get('/', requirePatient, async (req, res) => {
  // Patient sees only their own grants. Ignore any patientId query param —
  // the only valid one is their own.
  const items = await Consent.find({ 'patient.reference': `Patient/${req.user.sub}` })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ total: items.length, items });
});

router.post('/', requirePatient, async (req, res) => {
  const body = grantSchema.parse(req.body);
  if (!mongoose.isValidObjectId(body.patientId)) {
    throw new HttpError(400, 'Invalid patientId');
  }
  if (body.patientId !== req.user.sub) {
    throw new HttpError(403, 'You can only grant consent for your own record');
  }

  const patientRef = `Patient/${body.patientId}`;
  const now = new Date();

  // Single-active-grant invariant: one active Consent per (patient, grantee).
  // If the patient is updating an existing active grant, revoke the prior
  // one before creating the new one. This preserves the full audit trail
  // (prior grant lives on with status=inactive, revokedAt=now) while keeping
  // the active list clean.
  const supersededIds = [];
  const existing = await Consent.find({
    'patient.reference': patientRef,
    'grantee.reference': body.granteeRef,
    status: 'active',
  });
  for (const prior of existing) {
    prior.status = 'inactive';
    prior.revokedAt = now;
    await prior.save();
    supersededIds.push(prior._id.toString());
    await recordAudit({
      req,
      action: 'consent.revoke',
      patientId: body.patientId,
      details: { consentId: prior._id.toString(), reason: 'superseded-by-new-grant' },
    });
  }

  const consent = await Consent.create({
    status: 'active',
    patient: { reference: patientRef },
    grantee: {
      type: body.granteeType,
      reference: body.granteeRef,
      display: body.granteeDisplay,
    },
    scope: { categories: body.categories },
    purpose: body.purpose,
    period: { start: now, end: body.expiresAt ? new Date(body.expiresAt) : undefined },
  });

  await recordAudit({
    req,
    action: 'consent.grant',
    patientId: body.patientId,
    details: {
      granteeRef: body.granteeRef,
      categories: body.categories,
      supersededIds: supersededIds.length ? supersededIds : undefined,
    },
  });

  res.status(201).json({ ...consent.toObject(), supersededIds });
});

router.delete('/:id', requirePatient, async (req, res) => {
  const consent = await Consent.findById(req.params.id);
  if (!consent) throw new HttpError(404, 'Consent not found');

  const consentPatientId = consent.patient.reference?.split('/')[1];
  if (consentPatientId !== req.user.sub) {
    throw new HttpError(403, 'You can only revoke your own consents');
  }

  consent.status = 'inactive';
  consent.revokedAt = new Date();
  await consent.save();

  await recordAudit({
    req,
    action: 'consent.revoke',
    patientId: consentPatientId,
    details: { consentId: consent._id.toString() },
  });

  res.json(consent);
});

export default router;
