import { connectDb } from '../config/db.js';
import { logger } from '../config/logger.js';
import {
  Patient,
  Encounter,
  Condition,
  MedicationRequest,
  Observation,
  AllergyIntolerance,
} from '../models/index.js';
import mongoose from 'mongoose';

const SOURCE = { sourceSystem: 'demo-seed', sourceFormat: 'MANUAL', ingestedAt: new Date() };

const PERSONAS = [
  {
    name: { given: ['Aarav'], family: 'Sharma' },
    gender: 'male',
    birthDate: new Date('1968-03-12'),
    identifier: [{ system: 'https://abdm.gov.in/abha', value: '12-3456-7890-1111' }],
    profile: 'diabetic-polypharmacy',
    address: { city: 'Bengaluru', state: 'KA', country: 'IN' },
  },
  {
    name: { given: ['Priya'], family: 'Iyer' },
    gender: 'female',
    birthDate: new Date('1985-07-22'),
    identifier: [{ system: 'https://abdm.gov.in/abha', value: '12-3456-7890-2222' }],
    profile: 'asthma-stable',
    address: { city: 'Chennai', state: 'TN', country: 'IN' },
  },
  {
    name: { given: ['Rohan'], family: 'Patel' },
    gender: 'male',
    birthDate: new Date('1992-11-04'),
    identifier: [{ system: 'https://abdm.gov.in/abha', value: '12-3456-7890-3333' }],
    profile: 'post-surgical',
    address: { city: 'Mumbai', state: 'MH', country: 'IN' },
  },
];

const PROFILES = {
  'diabetic-polypharmacy': buildDiabeticHistory,
  'asthma-stable': buildAsthmaHistory,
  'post-surgical': buildPostSurgicalHistory,
};

async function main() {
  await connectDb();
  logger.info('clearing existing demo data');

  await Promise.all([
    Patient.deleteMany({ 'provenance.sourceSystem': 'demo-seed' }),
    Encounter.deleteMany({ 'provenance.sourceSystem': 'demo-seed' }),
    Condition.deleteMany({ 'provenance.sourceSystem': 'demo-seed' }),
    MedicationRequest.deleteMany({ 'provenance.sourceSystem': 'demo-seed' }),
    Observation.deleteMany({ 'provenance.sourceSystem': 'demo-seed' }),
    AllergyIntolerance.deleteMany({ 'provenance.sourceSystem': 'demo-seed' }),
  ]);

  for (const persona of PERSONAS) {
    const patient = await Patient.create({
      identifier: persona.identifier,
      active: true,
      name: [{ given: persona.name.given, family: persona.name.family, use: 'official' }],
      gender: persona.gender,
      birthDate: persona.birthDate,
      address: [persona.address],
      provenance: [SOURCE],
    });

    const builder = PROFILES[persona.profile];
    await builder(patient._id);

    logger.info(
      { id: patient._id.toString(), name: `${persona.name.given.join(' ')} ${persona.name.family}` },
      `seeded ${persona.profile}`
    );
  }

  logger.info('seed complete');
  await mongoose.disconnect();
}

// ---------- Profile builders ----------

async function buildDiabeticHistory(patientId) {
  const ref = `Patient/${patientId}`;

  await AllergyIntolerance.create({
    patient: { reference: ref },
    type: 'allergy',
    category: ['medication'],
    criticality: 'high',
    code: { text: 'Penicillin', coding: [{ system: 'http://snomed.info/sct', code: '764146007', display: 'Penicillin' }] },
    clinicalStatus: { text: 'active' },
    reaction: [{ manifestation: [{ text: 'Hives' }], severity: 'moderate' }],
    recordedDate: yearsAgo(8),
    provenance: [SOURCE],
  });

  await Condition.insertMany([
    {
      subject: { reference: ref },
      code: { text: 'Type 2 diabetes mellitus', coding: [{ system: 'http://snomed.info/sct', code: '44054006' }] },
      clinicalStatus: { text: 'active' },
      onsetDateTime: yearsAgo(6),
      recordedDate: yearsAgo(6),
      severity: { text: 'moderate' },
      provenance: [SOURCE],
    },
    {
      subject: { reference: ref },
      code: { text: 'Essential hypertension', coding: [{ system: 'http://snomed.info/sct', code: '59621000' }] },
      clinicalStatus: { text: 'active' },
      onsetDateTime: yearsAgo(4),
      recordedDate: yearsAgo(4),
      provenance: [SOURCE],
    },
    {
      subject: { reference: ref },
      code: { text: 'Hyperlipidemia', coding: [{ system: 'http://snomed.info/sct', code: '55822004' }] },
      clinicalStatus: { text: 'active' },
      onsetDateTime: yearsAgo(3),
      recordedDate: yearsAgo(3),
      provenance: [SOURCE],
    },
  ]);

  await MedicationRequest.insertMany([
    {
      subject: { reference: ref },
      status: 'active',
      medicationCodeableConcept: { text: 'Metformin 500mg', coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '860975' }] },
      authoredOn: yearsAgo(6),
      dosageInstruction: [{ text: '500mg twice daily with meals' }],
      provenance: [SOURCE],
    },
    {
      subject: { reference: ref },
      status: 'active',
      medicationCodeableConcept: { text: 'Telmisartan 40mg', coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '73494' }] },
      authoredOn: yearsAgo(4),
      dosageInstruction: [{ text: '40mg once daily' }],
      provenance: [SOURCE],
    },
    {
      subject: { reference: ref },
      status: 'active',
      medicationCodeableConcept: { text: 'Atorvastatin 20mg', coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '617314' }] },
      authoredOn: yearsAgo(3),
      dosageInstruction: [{ text: '20mg once at night' }],
      provenance: [SOURCE],
    },
    {
      subject: { reference: ref },
      status: 'completed',
      medicationCodeableConcept: { text: 'Glimepiride 2mg' },
      authoredOn: yearsAgo(2),
      dosageInstruction: [{ text: '2mg once daily — discontinued due to hypoglycemia' }],
      provenance: [SOURCE],
    },
  ]);

  // HbA1c trend over 5 years — bumpy
  const a1cValues = [
    [yearsAgo(5), 8.6, 'H'],
    [yearsAgo(4), 7.9, 'H'],
    [yearsAgo(3), 7.4, 'H'],
    [yearsAgo(2), 8.1, 'H'],
    [yearsAgo(1), 7.2, 'H'],
    [monthsAgo(6), 6.9, 'H'],
    [monthsAgo(2), 7.1, 'H'],
  ];
  await Observation.insertMany(
    a1cValues.map(([at, value, interp]) => ({
      subject: { reference: ref },
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: { text: 'HbA1c', coding: [{ system: 'http://loinc.org', code: '4548-4', display: 'Hemoglobin A1c' }] },
      effectiveDateTime: at,
      issued: at,
      valueQuantity: { value, unit: '%', system: 'http://unitsofmeasure.org', code: '%' },
      interpretation: [{ coding: [{ code: interp }] }],
      referenceRange: [{ low: { value: 4, unit: '%' }, high: { value: 5.7, unit: '%' } }],
      provenance: [SOURCE],
    }))
  );

  // BP trend
  const bpValues = [
    [monthsAgo(12), 148, 92, 'H'],
    [monthsAgo(9), 142, 88, 'H'],
    [monthsAgo(6), 138, 86, 'H'],
    [monthsAgo(3), 134, 82, 'N'],
    [monthsAgo(1), 132, 80, 'N'],
  ];
  for (const [at, sys, dia, interp] of bpValues) {
    await Observation.create({
      subject: { reference: ref },
      status: 'final',
      category: [{ coding: [{ code: 'vital-signs' }] }],
      code: { text: 'Systolic BP', coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
      effectiveDateTime: at,
      valueQuantity: { value: sys, unit: 'mmHg' },
      interpretation: [{ coding: [{ code: interp }] }],
      provenance: [SOURCE],
    });
    await Observation.create({
      subject: { reference: ref },
      status: 'final',
      category: [{ coding: [{ code: 'vital-signs' }] }],
      code: { text: 'Diastolic BP', coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
      effectiveDateTime: at,
      valueQuantity: { value: dia, unit: 'mmHg' },
      interpretation: [{ coding: [{ code: interp }] }],
      provenance: [SOURCE],
    });
  }

  await Encounter.insertMany([
    {
      subject: { reference: ref },
      status: 'finished',
      class: { code: 'AMB', display: 'ambulatory' },
      type: [{ text: 'Endocrinology follow-up' }],
      period: { start: monthsAgo(2), end: monthsAgo(2) },
      reasonCode: [{ text: 'Diabetes follow-up' }],
      provenance: [SOURCE],
    },
    {
      subject: { reference: ref },
      status: 'finished',
      class: { code: 'EMER', display: 'emergency' },
      type: [{ text: 'Emergency department visit' }],
      period: { start: yearsAgo(2), end: yearsAgo(2) },
      reasonCode: [{ text: 'Symptomatic hypoglycemia on glimepiride' }],
      provenance: [SOURCE],
    },
  ]);
}

async function buildAsthmaHistory(patientId) {
  const ref = `Patient/${patientId}`;

  await Condition.create({
    subject: { reference: ref },
    code: { text: 'Asthma', coding: [{ system: 'http://snomed.info/sct', code: '195967001' }] },
    clinicalStatus: { text: 'active' },
    severity: { text: 'mild persistent' },
    onsetDateTime: yearsAgo(15),
    recordedDate: yearsAgo(15),
    provenance: [SOURCE],
  });

  await MedicationRequest.insertMany([
    {
      subject: { reference: ref },
      status: 'active',
      medicationCodeableConcept: { text: 'Salbutamol inhaler 100mcg', coding: [{ code: '435' }] },
      authoredOn: yearsAgo(2),
      dosageInstruction: [{ text: '2 puffs as needed for shortness of breath' }],
      provenance: [SOURCE],
    },
    {
      subject: { reference: ref },
      status: 'active',
      medicationCodeableConcept: { text: 'Budesonide-Formoterol inhaler' },
      authoredOn: yearsAgo(1),
      dosageInstruction: [{ text: '1 puff twice daily' }],
      provenance: [SOURCE],
    },
  ]);

  await Observation.insertMany([
    {
      subject: { reference: ref },
      status: 'final',
      category: [{ coding: [{ code: 'laboratory' }] }],
      code: { text: 'Peak Expiratory Flow', coding: [{ system: 'http://loinc.org', code: '33452-4' }] },
      effectiveDateTime: monthsAgo(3),
      valueQuantity: { value: 380, unit: 'L/min' },
      provenance: [SOURCE],
    },
  ]);
}

async function buildPostSurgicalHistory(patientId) {
  const ref = `Patient/${patientId}`;

  await Encounter.create({
    subject: { reference: ref },
    status: 'finished',
    class: { code: 'IMP', display: 'inpatient' },
    type: [{ text: 'Laparoscopic appendectomy' }],
    period: { start: monthsAgo(4), end: monthsAgo(4) },
    reasonCode: [{ text: 'Acute appendicitis' }],
    provenance: [SOURCE],
  });

  await Condition.create({
    subject: { reference: ref },
    code: { text: 'Acute appendicitis', coding: [{ system: 'http://snomed.info/sct', code: '85189001' }] },
    clinicalStatus: { text: 'resolved' },
    onsetDateTime: monthsAgo(4),
    abatementDateTime: monthsAgo(4),
    recordedDate: monthsAgo(4),
    provenance: [SOURCE],
  });

  await MedicationRequest.insertMany([
    {
      subject: { reference: ref },
      status: 'completed',
      medicationCodeableConcept: { text: 'Ceftriaxone 1g IV' },
      authoredOn: monthsAgo(4),
      dosageInstruction: [{ text: '1g IV daily x 3 days' }],
      provenance: [SOURCE],
    },
    {
      subject: { reference: ref },
      status: 'completed',
      medicationCodeableConcept: { text: 'Paracetamol 500mg' },
      authoredOn: monthsAgo(4),
      dosageInstruction: [{ text: '500mg q6h prn pain' }],
      provenance: [SOURCE],
    },
  ]);
}

function yearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
}
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

main().catch((err) => {
  logger.error({ err }, 'seed failed');
  process.exit(1);
});
