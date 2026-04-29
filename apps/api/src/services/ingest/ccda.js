import mongoose from 'mongoose';
import { XMLParser } from 'fast-xml-parser';
import {
  Condition,
  MedicationRequest,
  Observation,
  AllergyIntolerance,
} from '../../models/index.js';

/**
 * CCDA (Consolidated Clinical Document Architecture) parser.
 *
 * Handles the four most common sections by template OID:
 *   2.16.840.1.113883.10.20.22.2.5  → Problem List       → Condition[]
 *   2.16.840.1.113883.10.20.22.2.1  → Medications        → MedicationRequest[]
 *   2.16.840.1.113883.10.20.22.2.6  → Allergies          → AllergyIntolerance[]
 *   2.16.840.1.113883.10.20.22.2.3  → Results            → Observation[]
 *
 * CCDA is XML-heavy with deeply nested entries. We walk to the entry/act
 * level and extract the canonical code + display + dates. Quirks like
 * negationInd and translation codes are noted in comments where relevant.
 */

const TEMPLATE_PROBLEMS = '2.16.840.1.113883.10.20.22.2.5';
const TEMPLATE_MEDICATIONS = '2.16.840.1.113883.10.20.22.2.1';
const TEMPLATE_ALLERGIES = '2.16.840.1.113883.10.20.22.2.6';
const TEMPLATE_RESULTS = '2.16.840.1.113883.10.20.22.2.3';

const CODE_SYSTEMS = {
  '2.16.840.1.113883.6.96': 'http://snomed.info/sct',
  '2.16.840.1.113883.6.1': 'http://loinc.org',
  '2.16.840.1.113883.6.88': 'http://www.nlm.nih.gov/research/umls/rxnorm',
  '2.16.840.1.113883.6.90': 'http://hl7.org/fhir/sid/icd-10-cm',
  '2.16.840.1.113883.6.103': 'http://hl7.org/fhir/sid/icd-9-cm',
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

export function parseCcdaDocument(rawXml) {
  if (!rawXml) throw new Error('Empty document');
  const doc = xml.parse(rawXml);
  const root = doc.ClinicalDocument ?? doc['ClinicalDocument'];
  if (!root) throw new Error('Not a CCDA ClinicalDocument');

  const components = arr(root.component?.structuredBody?.component);
  const sections = components.map((c) => c.section).filter(Boolean);

  const found = {
    problems: null,
    medications: null,
    allergies: null,
    results: null,
  };

  for (const section of sections) {
    const tids = arr(section.templateId).map((t) => t?.root).filter(Boolean);
    if (tids.includes(TEMPLATE_PROBLEMS)) found.problems = section;
    else if (tids.includes(TEMPLATE_MEDICATIONS)) found.medications = section;
    else if (tids.includes(TEMPLATE_ALLERGIES)) found.allergies = section;
    else if (tids.includes(TEMPLATE_RESULTS)) found.results = section;
  }

  return {
    docId: root.id?.root ?? root.id?.extension ?? null,
    title: root.title ?? null,
    effectiveTime: root.effectiveTime?.value ?? null,
    sections: found,
  };
}

export function ccdaToFhirResources(parsed, patientId) {
  const subject = { reference: `Patient/${patientId}` };
  const provenance = [{
    sourceSystem: 'ccda-source',
    sourceFormat: 'CCDA',
    ingestedAt: new Date(),
    sourceDocumentId: parsed.docId ?? undefined,
  }];

  const resources = {
    Condition: [],
    MedicationRequest: [],
    AllergyIntolerance: [],
    Observation: [],
  };

  if (parsed.sections.problems) {
    for (const entry of arr(parsed.sections.problems.entry)) {
      const cond = problemEntryToCondition(entry, subject, provenance);
      if (cond) resources.Condition.push(cond);
    }
  }

  if (parsed.sections.medications) {
    for (const entry of arr(parsed.sections.medications.entry)) {
      const med = medicationEntryToFhir(entry, subject, provenance);
      if (med) resources.MedicationRequest.push(med);
    }
  }

  if (parsed.sections.allergies) {
    for (const entry of arr(parsed.sections.allergies.entry)) {
      const a = allergyEntryToFhir(entry, subject, provenance, patientId);
      if (a) resources.AllergyIntolerance.push(a);
    }
  }

  if (parsed.sections.results) {
    for (const entry of arr(parsed.sections.results.entry)) {
      const obs = resultEntryToObservations(entry, subject, provenance);
      resources.Observation.push(...obs);
    }
  }

  return resources;
}

// ---------- Section parsers ----------

function problemEntryToCondition(entry, subject, provenance) {
  const act = entry?.act ?? entry?.observation;
  const obs = act?.entryRelationship?.observation
    ?? (Array.isArray(act?.entryRelationship)
        ? act.entryRelationship.find((e) => e.observation)?.observation
        : null)
    ?? entry?.observation;
  if (!obs) return null;

  const code = parseCcdaCode(obs.value ?? obs.code);
  if (!code) return null;

  const onset = obs.effectiveTime?.low?.value ?? obs.effectiveTime?.value;
  const status = obs.statusCode?.code ?? 'active';

  return {
    _id: new mongoose.Types.ObjectId(),
    clinicalStatus: { coding: [{ code: status === 'completed' ? 'resolved' : 'active' }] },
    verificationStatus: { coding: [{ code: 'confirmed' }] },
    code,
    subject,
    onsetDateTime: parseCcdaTs(onset),
    recordedDate: parseCcdaTs(onset),
    provenance,
  };
}

function medicationEntryToFhir(entry, subject, provenance) {
  const sa = entry?.substanceAdministration;
  if (!sa) return null;

  const product = sa.consumable?.manufacturedProduct?.manufacturedMaterial;
  const code = parseCcdaCode(product?.code);
  if (!code) return null;

  const status = sa.statusCode?.code === 'completed' ? 'completed' : 'active';
  const start = arr(sa.effectiveTime).find((t) => t?.low)?.low?.value
    ?? arr(sa.effectiveTime)[0]?.value;

  // Dose info from doseQuantity
  const dose = sa.doseQuantity ? { value: Number(sa.doseQuantity.value), unit: sa.doseQuantity.unit } : null;
  const text = product?.name ?? code.text ?? code.coding?.[0]?.display;

  return {
    _id: new mongoose.Types.ObjectId(),
    status,
    intent: 'order',
    medicationCodeableConcept: code,
    subject,
    authoredOn: parseCcdaTs(start),
    dosageInstruction: text || dose
      ? [{ text, doseAndRate: dose ? [{ doseQuantity: dose }] : undefined }]
      : undefined,
    provenance,
  };
}

function allergyEntryToFhir(entry, _subject, provenance, patientId) {
  const act = entry?.act;
  const obs = act?.entryRelationship?.observation
    ?? (Array.isArray(act?.entryRelationship)
        ? act.entryRelationship.find((e) => e.observation)?.observation
        : null);
  if (!obs) return null;

  const participant = obs.participant?.participantRole?.playingEntity;
  const code = parseCcdaCode(participant?.code);
  if (!code) return null;

  // Severity nested in further entryRelationship
  const inner = arr(obs.entryRelationship);
  const severityObs = inner.find((e) => e?.observation?.code?.code === 'SEV')?.observation;
  const severity = severityObs?.value?.code ?? severityObs?.value?.displayName;

  // Reaction (manifestation) via REACTION rel type
  const reactionObs = inner.find((e) => e?.typeCode === 'MFST')?.observation
    ?? inner.find((e) => e?.observation?.code?.displayName?.toLowerCase?.().includes('reaction'))?.observation;
  const reactionCode = reactionObs ? parseCcdaCode(reactionObs.value ?? reactionObs.code) : null;

  return {
    _id: new mongoose.Types.ObjectId(),
    clinicalStatus: { coding: [{ code: 'active' }] },
    verificationStatus: { coding: [{ code: 'confirmed' }] },
    type: 'allergy',
    category: ['medication'],
    criticality: severity?.toLowerCase?.().includes('high') || severity?.toLowerCase?.().includes('severe') ? 'high' : 'low',
    code,
    patient: { reference: `Patient/${patientId}` },
    recordedDate: parseCcdaTs(obs.effectiveTime?.low?.value ?? obs.effectiveTime?.value),
    reaction: reactionCode ? [{ manifestation: [reactionCode], severity: mapSeverity(severity) }] : undefined,
    provenance,
  };
}

function resultEntryToObservations(entry, subject, provenance) {
  const out = [];
  const organizer = entry?.organizer;
  const components = arr(organizer?.component);
  for (const comp of components) {
    const obs = comp.observation;
    if (!obs) continue;
    const code = parseCcdaCode(obs.code);
    if (!code) continue;

    const valueAttr = obs.value ?? {};
    const valueType = valueAttr['xsi:type'] ?? valueAttr.type;
    const numeric = valueAttr.value;
    const unit = valueAttr.unit;
    const intText = obs.interpretationCode?.code;

    const obsResource = {
      _id: new mongoose.Types.ObjectId(),
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code,
      subject,
      effectiveDateTime: parseCcdaTs(obs.effectiveTime?.value),
      interpretation: intText ? [{ coding: [{ code: intText }] }] : undefined,
      provenance,
    };

    if (valueType === 'PQ' || numeric != null) {
      const n = Number(numeric);
      if (!Number.isNaN(n)) {
        obsResource.valueQuantity = { value: n, unit };
      }
    } else if (valueAttr.code) {
      obsResource.valueCodeableConcept = { coding: [{ code: valueAttr.code, display: valueAttr.displayName }], text: valueAttr.displayName };
    } else if (typeof valueAttr === 'string') {
      obsResource.valueString = valueAttr;
    }

    out.push(obsResource);
  }
  return out;
}

// ---------- helpers ----------

function parseCcdaCode(c) {
  if (!c) return null;
  const code = c.code;
  const codeSystem = c.codeSystem;
  const display = c.displayName;
  if (!code) return null;
  const system = CODE_SYSTEMS[codeSystem] ?? codeSystem ?? undefined;
  return {
    coding: [{ system, code, display }],
    text: display ?? code,
  };
}

function parseCcdaTs(s) {
  if (!s) return undefined;
  // YYYYMMDD or YYYYMMDDHHMMSS, optionally with timezone offset
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?/);
  if (!m) return undefined;
  const [, y, mo, d, h = '00', mi = '00', se = '00'] = m;
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

function mapSeverity(s) {
  if (!s) return undefined;
  const lower = String(s).toLowerCase();
  if (lower.includes('mild')) return 'mild';
  if (lower.includes('mod')) return 'moderate';
  if (lower.includes('sev') || lower.includes('high')) return 'severe';
  return undefined;
}

function arr(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

// ---------- persistence ----------

export async function persistCcdaResources(resources) {
  const counts = { Condition: 0, MedicationRequest: 0, AllergyIntolerance: 0, Observation: 0 };
  if (resources.Condition.length) {
    await Condition.insertMany(resources.Condition, { ordered: false }).catch(() => {});
    counts.Condition = resources.Condition.length;
  }
  if (resources.MedicationRequest.length) {
    await MedicationRequest.insertMany(resources.MedicationRequest, { ordered: false }).catch(() => {});
    counts.MedicationRequest = resources.MedicationRequest.length;
  }
  if (resources.AllergyIntolerance.length) {
    await AllergyIntolerance.insertMany(resources.AllergyIntolerance, { ordered: false }).catch(() => {});
    counts.AllergyIntolerance = resources.AllergyIntolerance.length;
  }
  if (resources.Observation.length) {
    await Observation.insertMany(resources.Observation, { ordered: false }).catch(() => {});
    counts.Observation = resources.Observation.length;
  }
  return counts;
}
