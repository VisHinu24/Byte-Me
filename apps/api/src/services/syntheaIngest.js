import { promises as fs } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import {
  Patient,
  Encounter,
  Condition,
  MedicationRequest,
  Observation,
  AllergyIntolerance,
} from '../models/index.js';
import { logger } from '../config/logger.js';

const SOURCE_SYSTEM = 'synthea';
const SOURCE_FORMAT = 'SYNTHEA';

/**
 * Resources we care about. Anything else in a Synthea bundle (Provenance,
 * Goal, CarePlan, ImagingStudy, Procedure, DiagnosticReport, Immunization,
 * Claim, ExplanationOfBenefit, Device, etc.) is ignored for now.
 */
const HANDLED = new Set([
  'Patient',
  'Encounter',
  'Condition',
  'MedicationRequest',
  'Observation',
  'AllergyIntolerance',
]);

/**
 * Ingest a single FHIR Bundle (Synthea-shaped or vanilla R4 transaction).
 *
 * Two-pass:
 *   1. Walk entries → assign each a Mongo ObjectId, build urnUuid→ObjectId map
 *   2. Walk again → map this to that, rewrite references, insert
 *
 * Returns counts per resource type.
 */
export async function ingestBundle(bundle, opts = {}) {
  if (!bundle || bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) {
    throw new Error('Not a FHIR Bundle');
  }

  const counts = { Patient: 0, Encounter: 0, Condition: 0, MedicationRequest: 0, Observation: 0, AllergyIntolerance: 0, _skipped: 0 };
  const idMap = new Map(); // urn:uuid:... -> ObjectId, also Synthea id -> ObjectId

  // Pass 1: assign IDs and track resource type per fullUrl/sourceId
  for (const entry of bundle.entry) {
    const r = entry.resource;
    if (!r || !HANDLED.has(r.resourceType)) {
      counts._skipped += 1;
      continue;
    }
    const oid = new mongoose.Types.ObjectId();
    const ref = { id: oid, type: r.resourceType };
    if (entry.fullUrl) idMap.set(entry.fullUrl, ref);
    if (r.id) idMap.set(`${r.resourceType}/${r.id}`, ref);
    entry._mongoId = oid;
  }

  // Pass 2: transform + insert. Group by collection to use insertMany.
  const buckets = {
    Patient: [], Encounter: [], Condition: [],
    MedicationRequest: [], Observation: [], AllergyIntolerance: [],
  };

  for (const entry of bundle.entry) {
    const r = entry.resource;
    if (!r || !HANDLED.has(r.resourceType) || !entry._mongoId) continue;

    const transformed = transformResource(r, entry._mongoId, idMap, opts);
    if (transformed) buckets[r.resourceType].push(transformed);
  }

  // Insert in a sane order so referenced docs land first
  for (const type of ['Patient', 'Encounter', 'Condition', 'MedicationRequest', 'Observation', 'AllergyIntolerance']) {
    if (!buckets[type].length) continue;
    const Model = MODELS[type];
    try {
      await Model.insertMany(buckets[type], { ordered: false });
      counts[type] += buckets[type].length;
    } catch (err) {
      // Allow partial inserts on dup-key etc.
      const written = err.insertedDocs?.length ?? 0;
      counts[type] += written;
      logger.warn({ type, written, attempted: buckets[type].length, msg: err.message }, 'partial insert');
    }
  }

  return counts;
}

const MODELS = {
  Patient,
  Encounter,
  Condition,
  MedicationRequest,
  Observation,
  AllergyIntolerance,
};

// ---------- Resource transforms ----------

function transformResource(r, _id, idMap, opts) {
  const provenance = [{
    sourceSystem: opts.sourceSystem ?? SOURCE_SYSTEM,
    sourceFormat: SOURCE_FORMAT,
    ingestedAt: new Date(),
    sourceDocumentId: r.id ? `${r.resourceType}/${r.id}` : undefined,
  }];

  switch (r.resourceType) {
    case 'Patient':
      return {
        _id,
        identifier: cleanIdentifiers(r.identifier),
        active: r.active ?? true,
        name: r.name,
        telecom: r.telecom,
        gender: r.gender,
        birthDate: parseDate(r.birthDate),
        address: r.address,
        maritalStatus: r.maritalStatus,
        communication: r.communication,
        deceasedBoolean: r.deceasedBoolean,
        deceasedDateTime: parseDate(r.deceasedDateTime),
        provenance,
      };

    case 'Encounter':
      return {
        _id,
        status: r.status,
        class: r.class,
        type: r.type,
        subject: mapRef(r.subject, idMap),
        period: { start: parseDate(r.period?.start), end: parseDate(r.period?.end) },
        reasonCode: r.reasonCode,
        diagnosis: (r.diagnosis ?? []).map((d) => ({ ...d, condition: mapRef(d.condition, idMap) })),
        location: r.location?.map((l) => ({ ...l, location: mapRef(l.location, idMap) })),
        serviceProvider: mapRef(r.serviceProvider, idMap),
        provenance,
      };

    case 'Condition':
      return {
        _id,
        clinicalStatus: r.clinicalStatus,
        verificationStatus: r.verificationStatus,
        category: r.category,
        severity: r.severity,
        code: r.code,
        subject: mapRef(r.subject, idMap),
        encounter: mapRef(r.encounter, idMap),
        onsetDateTime: parseDate(r.onsetDateTime),
        abatementDateTime: parseDate(r.abatementDateTime),
        recordedDate: parseDate(r.recordedDate),
        note: r.note,
        provenance,
      };

    case 'MedicationRequest':
      return {
        _id,
        status: r.status,
        intent: r.intent,
        medicationCodeableConcept:
          r.medicationCodeableConcept ??
          (r.medicationReference?.display ? { text: r.medicationReference.display } : undefined),
        subject: mapRef(r.subject, idMap),
        encounter: mapRef(r.encounter, idMap),
        authoredOn: parseDate(r.authoredOn),
        requester: mapRef(r.requester, idMap),
        reasonReference: r.reasonReference?.map((ref) => mapRef(ref, idMap)),
        dosageInstruction: r.dosageInstruction,
        dispenseRequest: r.dispenseRequest,
        provenance,
      };

    case 'Observation':
      return {
        _id,
        status: r.status,
        category: r.category,
        code: r.code,
        subject: mapRef(r.subject, idMap),
        encounter: mapRef(r.encounter, idMap),
        effectiveDateTime: parseDate(r.effectiveDateTime),
        issued: parseDate(r.issued),
        valueQuantity: r.valueQuantity,
        valueString: r.valueString,
        valueCodeableConcept: r.valueCodeableConcept,
        interpretation: r.interpretation,
        referenceRange: r.referenceRange,
        note: r.note,
        provenance,
      };

    case 'AllergyIntolerance':
      return {
        _id,
        clinicalStatus: r.clinicalStatus,
        verificationStatus: r.verificationStatus,
        type: r.type,
        category: r.category,
        criticality: r.criticality,
        code: r.code,
        patient: mapRef(r.patient, idMap),
        onsetDateTime: parseDate(r.onsetDateTime),
        recordedDate: parseDate(r.recordedDate),
        reaction: r.reaction,
        provenance,
      };

    default:
      return null;
  }
}

function mapRef(ref, idMap) {
  if (!ref?.reference) return ref ?? undefined;
  const target = idMap.get(ref.reference);
  if (target) {
    return { reference: `${target.type}/${target.id.toString()}`, display: ref.display };
  }
  // External reference (not in this bundle) — leave as-is. The "Patient/abc"
  // form survives, urn:uuid:... that we couldn't resolve is preserved verbatim
  // so we can debug later.
  return ref;
}

function parseDate(d) {
  if (!d) return undefined;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? undefined : t;
}

function cleanIdentifiers(idents) {
  if (!Array.isArray(idents)) return idents;
  return idents.map(({ system, value }) => ({ system, value })).filter((i) => i.value);
}

// ---------- Directory ingestion ----------

export async function ingestDirectory(dir, opts = {}) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && /\.json$/i.test(e.name))
    .map((e) => path.join(dir, e.name));

  if (files.length === 0) {
    throw new Error(`No .json files found in ${dir}`);
  }

  logger.info({ dir, files: files.length }, 'starting Synthea ingest');

  const total = { bundles: 0, Patient: 0, Encounter: 0, Condition: 0, MedicationRequest: 0, Observation: 0, AllergyIntolerance: 0, _skipped: 0, _failed: 0 };

  for (const file of files) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      const bundle = JSON.parse(raw);

      // Some Synthea outputs put hospitalInformation/practitionerInformation
      // bundles alongside patient bundles. Skip those (no Patient resource).
      const hasPatient = bundle.entry?.some((e) => e.resource?.resourceType === 'Patient');
      if (!hasPatient) {
        logger.debug({ file: path.basename(file) }, 'skipping non-patient bundle');
        continue;
      }

      const counts = await ingestBundle(bundle, opts);
      total.bundles += 1;
      for (const k of Object.keys(counts)) total[k] = (total[k] ?? 0) + counts[k];
      logger.info({ file: path.basename(file), counts }, 'bundle ingested');
    } catch (err) {
      total._failed += 1;
      logger.error({ file: path.basename(file), msg: err.message }, 'bundle ingest failed');
    }
  }

  return total;
}

/**
 * Reset all Synthea-sourced data. Safe — only deletes records tagged with
 * sourceSystem matching the configured value.
 */
export async function resetSyntheaData(sourceSystem = SOURCE_SYSTEM) {
  const filter = { 'provenance.sourceSystem': sourceSystem };
  const results = await Promise.all([
    Patient.deleteMany(filter),
    Encounter.deleteMany(filter),
    Condition.deleteMany(filter),
    MedicationRequest.deleteMany(filter),
    Observation.deleteMany(filter),
    AllergyIntolerance.deleteMany(filter),
  ]);
  return {
    Patient: results[0].deletedCount,
    Encounter: results[1].deletedCount,
    Condition: results[2].deletedCount,
    MedicationRequest: results[3].deletedCount,
    Observation: results[4].deletedCount,
    AllergyIntolerance: results[5].deletedCount,
  };
}
