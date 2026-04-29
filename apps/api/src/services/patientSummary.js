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
 * This is intentionally _structured_, not narrative. The Synthesis agent
 * turns this into clinician-facing prose with citations.
 */
export async function buildPatientSummary(patientId) {
  const patient = await Patient.findById(patientId).lean();
  if (!patient) throw new HttpError(404, `Patient ${patientId} not found`);

  const ref = `Patient/${patientId}`;

  const [encounters, conditions, medications, observations, allergies] = await Promise.all([
    Encounter.find({ 'subject.reference': ref })
      .sort({ 'period.start': -1 })
      .limit(50)
      .lean(),
    Condition.find({ 'subject.reference': ref })
      .sort({ recordedDate: -1 })
      .lean(),
    MedicationRequest.find({ 'subject.reference': ref })
      .sort({ authoredOn: -1 })
      .lean(),
    Observation.find({ 'subject.reference': ref })
      .sort({ effectiveDateTime: -1 })
      .limit(200)
      .lean(),
    AllergyIntolerance.find({ 'patient.reference': ref }).lean(),
  ]);

  const activeConditions = conditions.filter(
    (c) => textOf(c.clinicalStatus) === 'active' || !c.abatementDateTime
  );
  const activeMedications = medications.filter((m) => m.status === 'active');

  const labTrends = groupLabsByCode(observations.filter((o) => isLab(o)));

  return {
    patient,
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
