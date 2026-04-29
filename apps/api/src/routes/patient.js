import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import {
  Patient,
  Encounter,
  Condition,
  MedicationRequest,
  Observation,
  AllergyIntolerance,
} from '../models/index.js';
import { HttpError } from '../middleware/error.js';
import { buildPatientSummary } from '../services/patientSummary.js';
import { requireConsent } from '../middleware/consent.js';
import { Consent } from '../models/index.js';
import { isDev } from '../config/env.js';

const router = Router();

const listQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  skip: z.coerce.number().int().min(0).default(0),
});

/**
 * Patient list — role-aware:
 *   - patient role: only their own record
 *   - clinician role: only patients who actively granted them consent
 *     (so doctors can't even see other patients exist)
 *   - default unnamed Dr. Demo (dev-bypass): sees all (so first-run dev works)
 *
 * The search/pagination only applies within whatever the role allows.
 */
router.get('/', async (req, res) => {
  const { q, limit, skip } = listQuerySchema.parse(req.query);
  const user = req.user;

  let allowedFilter;

  if (user?.role === 'patient') {
    if (!mongoose.isValidObjectId(user.sub)) return res.json({ total: 0, limit, skip, items: [] });
    allowedFilter = { _id: new mongoose.Types.ObjectId(user.sub) };
  } else if (user?.role === 'clinician' && user.impersonated) {
    // Real-identity clinician — restrict to patients with active consent.
    const granteeRef = user.providerId ?? `Practitioner/${user.sub}`;
    const consents = await Consent.find({
      'grantee.reference': granteeRef,
      status: 'active',
    }).lean();
    const consentedPatientIds = consents
      .filter((c) => {
        const now = new Date();
        if (c.revokedAt) return false;
        if (c.period?.end && new Date(c.period.end) < now) return false;
        if (c.period?.start && new Date(c.period.start) > now) return false;
        return true;
      })
      .map((c) => c.patient.reference?.split('/')[1])
      .filter(Boolean)
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (consentedPatientIds.length === 0) {
      return res.json({ total: 0, limit, skip, items: [] });
    }
    allowedFilter = { _id: { $in: consentedPatientIds } };
  } else if (isDev && user?.role === 'clinician') {
    // Default Dr. Demo identity (non-impersonated, dev mode) — sees all.
    allowedFilter = {};
  } else {
    return res.json({ total: 0, limit, skip, items: [] });
  }

  const searchFilter = q
    ? {
        $or: [
          { 'name.family': { $regex: q, $options: 'i' } },
          { 'name.given': { $regex: q, $options: 'i' } },
          { 'identifier.value': q },
        ],
      }
    : {};

  const filter = { $and: [allowedFilter, searchFilter] };

  const [items, total] = await Promise.all([
    Patient.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    Patient.countDocuments(filter),
  ]);

  res.json({ total, limit, skip, items });
});

router.get('/:id', requireValidId, requireConsent('demographics'), async (req, res) => {
  const patient = await Patient.findById(req.params.id).lean({ virtuals: true });
  if (!patient) throw new HttpError(404, 'Patient not found');
  res.json(patient);
});

router.get('/:id/_summary', requireValidId, requireConsent('*'), async (req, res) => {
  const summary = await buildPatientSummary(req.params.id);
  res.json(summary);
});

router.get('/:id/Encounter', requireValidId, requireConsent('encounters'), async (req, res) => {
  const items = await Encounter.find({ 'subject.reference': `Patient/${req.params.id}` })
    .sort({ 'period.start': -1 })
    .lean();
  res.json({ total: items.length, items });
});

router.get('/:id/Condition', requireValidId, requireConsent('conditions'), async (req, res) => {
  const items = await Condition.find({ 'subject.reference': `Patient/${req.params.id}` })
    .sort({ recordedDate: -1 })
    .lean();
  res.json({ total: items.length, items });
});

router.get('/:id/MedicationRequest', requireValidId, requireConsent('medications'), async (req, res) => {
  const items = await MedicationRequest.find({ 'subject.reference': `Patient/${req.params.id}` })
    .sort({ authoredOn: -1 })
    .lean();
  res.json({ total: items.length, items });
});

router.get('/:id/Observation', requireValidId, requireConsent('observations'), async (req, res) => {
  const code = req.query.code;
  const filter = { 'subject.reference': `Patient/${req.params.id}` };
  if (code) filter['code.coding.code'] = code;
  const items = await Observation.find(filter)
    .sort({ effectiveDateTime: -1 })
    .limit(500)
    .lean();
  res.json({ total: items.length, items });
});

router.get('/:id/AllergyIntolerance', requireValidId, requireConsent('allergies'), async (req, res) => {
  const items = await AllergyIntolerance.find({
    patient: { reference: `Patient/${req.params.id}` },
  }).lean();
  res.json({ total: items.length, items });
});

function requireValidId(req, _res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new HttpError(400, 'Invalid patient id');
  }
  next();
}

export default router;
