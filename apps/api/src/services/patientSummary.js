import {
  Patient,
  Encounter,
  Condition,
  MedicationRequest,
  Observation,
  AllergyIntolerance,
} from '../models/index.js';
import { HttpError } from '../middleware/error.js';

/**
 * Build a longitudinal summary for a patient — the raw structured input that
 * downstream agents (retrieval / synthesis / risk) consume.
 *
 * Privacy scoping: callers can pass `allowedCategories` to restrict which
 * resource types are loaded. This honors the consent grants — a doctor with
 * only [conditions, medications] gets only those sections; everything else
 * comes back as empty arrays. Pass `null` (default) for unrestricted access
 * (patient self, dev-bypass).
 */
export async function buildPatientSummary(patientId, opts = {}) {
  const allowedCategories = opts.allowedCategories ?? null; // null = unrestricted

  const can = (cat) => allowedCategories === null || allowedCategories.includes(cat);

  // Patient identity (name, gender, birthDate) is always visible to anyone who
  // has any active consent — a clinician needs to know WHO they're treating,
  // and the patient's name appears in the patient-list view anyway. The
  // privacy-sensitive `demographics` category gates the rest: address,
  // telecom, full identifier set (SSN, ABHA id, etc).
  const patientPromise = can('demographics')
    ? Patient.findById(patientId).lean()
    : Patient.findById(patientId)
        .select({ _id: 1, name: 1, gender: 1, birthDate: 1 })
        .lean();

  const patient = await patientPromise;
  if (!patient) throw new HttpError(404, `Patient ${patientId} not found`);

  const ref = `Patient/${patientId}`;
  const empty = async () => [];

  const [encounters, conditions, medications, observations, allergies] = await Promise.all([
    can('encounters')
      ? Encounter.find({ 'subject.reference': ref }).sort({ 'period.start': -1 }).limit(50).lean()
      : empty(),
    can('conditions')
      ? Condition.find({ 'subject.reference': ref }).sort({ recordedDate: -1 }).lean()
      : empty(),
    can('medications')
      ? MedicationRequest.find({ 'subject.reference': ref }).sort({ authoredOn: -1 }).lean()
      : empty(),
    can('observations')
      ? Observation.find({ 'subject.reference': ref }).sort({ effectiveDateTime: -1 }).limit(200).lean()
      : empty(),
    can('allergies')
      ? AllergyIntolerance.find({ 'patient.reference': ref }).lean()
      : empty(),
  ]);

  const activeConditions = conditions.filter(
    (c) => textOf(c.clinicalStatus) === 'active' || !c.abatementDateTime
  );
  const activeMedications = medications.filter((m) => m.status === 'active');
  const labTrends = groupLabsByCode(observations.filter((o) => isLab(o)));

  return {
    patient,
    allowedCategories, // surfaces scope to downstream consumers
    counts: {
      encounters: encounters.length,
      conditions: conditions.length,
      medications: medications.length,
      observations: observations.length,
      allergies: allergies.length,
    },
    activeConditions,
    activeMedications,
    recentEncounters: encounters.slice(0, 10),
    allergies,
    labTrends,
  };
}

function textOf(cc) {
  return cc?.text ?? cc?.coding?.[0]?.code ?? null;
}

function isLab(obs) {
  return obs.category?.some((c) =>
    c.coding?.some((cd) => cd.code === 'laboratory')
  );
}

function groupLabsByCode(labs) {
  const byCode = new Map();
  for (const lab of labs) {
    const code = lab.code?.coding?.[0]?.code ?? lab.code?.text ?? 'unknown';
    const display = lab.code?.text ?? lab.code?.coding?.[0]?.display ?? code;
    if (!byCode.has(code)) byCode.set(code, { code, display, points: [] });
    byCode.get(code).points.push({
      at: lab.effectiveDateTime,
      value: lab.valueQuantity?.value ?? null,
      unit: lab.valueQuantity?.unit ?? null,
      interpretation: lab.interpretation?.[0]?.coding?.[0]?.code ?? null,
    });
  }
  return Array.from(byCode.values()).map((trend) => ({
    ...trend,
    points: trend.points
      .filter((p) => p.value != null && p.at)
      .sort((a, b) => new Date(a.at) - new Date(b.at)),
  }));
}
