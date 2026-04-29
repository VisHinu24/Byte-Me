import { Router } from 'express';
import mongoose from 'mongoose';
import {
  Patient,
  Encounter,
  Condition,
  MedicationRequest,
  Observation,
  AllergyIntolerance,
  DerivedMemory,
} from '../models/index.js';
import { Consent, AuditLog } from '../models/index.js';
import { HttpError } from '../middleware/error.js';
import { env } from '../config/env.js';

/**
 * Generic FHIR resource lookup — used by the brief's [cite:Type/id]
 * provenance pins. Looks up the resource, infers the patient ref, and
 * applies the right consent gate per resource type.
 */
const router = Router();

const MODELS = {
  Patient,
  Encounter,
  Condition,
  MedicationRequest,
  Observation,
  AllergyIntolerance,
  DerivedMemory,
};

// Resource type → consent category required to read it.
const CATEGORY_BY_TYPE = {
  Patient: 'demographics',
  Encounter: 'encounters',
  Condition: 'conditions',
  MedicationRequest: 'medications',
  Observation: 'observations',
  AllergyIntolerance: 'allergies',
  DerivedMemory: '*', // any consent suffices to view a derived memory
};

router.get('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const Model = MODELS[type];
  if (!Model) throw new HttpError(404, `Unknown resource type: ${type}`);
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Invalid id');

  const resource = await Model.findById(id).lean();
  if (!resource) throw new HttpError(404, `${type}/${id} not found`);

  // Patient ref lives on different fields per type. DerivedMemory carries
  // it on `patient.reference` like AllergyIntolerance.
  const patientRef =
    type === 'Patient'
      ? `Patient/${id}`
      : resource.subject?.reference ?? resource.patient?.reference;

  const patientId = patientRef?.replace(/^Patient\//, '');
  const category = CATEGORY_BY_TYPE[type];

  await enforceConsent(req, patientId, category);

  res.json(resource);
});

async function enforceConsent(req, patientId, category) {
  if (!patientId) return; // unattached resource — allow
  if (!req.user) throw new HttpError(401, 'Not authenticated');

  // Patient self-access
  if (req.user.role === 'patient' && req.user.sub === patientId) return;

  const patientRef = `Patient/${patientId}`;
  const granteeRef = req.user.providerId ?? `Practitioner/${req.user.sub}`;

  const consents = await Consent.find({
    'patient.reference': patientRef,
    'grantee.reference': granteeRef,
    status: 'active',
  });
  const live = consents.filter((c) => c.isCurrentlyActive());
  const allowed =
    category === '*'
      ? live.length > 0
      : live.some((c) => c.coversCategory(category));

  if (!allowed && env.demoMode && !req.user.impersonated) {
    return; // demo bypass for default identity
  }

  await AuditLog.create({
    actor: { kind: 'user', id: req.user.sub, role: req.user.role },
    action: 'consent.check',
    patient: { reference: patientRef },
    outcome: allowed ? 'allowed' : 'denied',
    reason: allowed ? 'consent-grant' : 'no-consent',
    details: { category, granteeRef, source: 'resource-cite-lookup' },
    ip: req.ip,
  }).catch(() => {});

  if (!allowed) throw new HttpError(403, `Consent required: ${category}`);
}

export default router;
