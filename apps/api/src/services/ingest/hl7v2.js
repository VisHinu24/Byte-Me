import mongoose from 'mongoose';
import {
  Encounter,
  Observation,
} from '../../models/index.js';
import { logger } from '../../config/logger.js';

/**
 * Minimal HL7 v2.x parser. Handles the most common pipe-delimited messages:
 *   ORU^R01 — observation/lab result
 *   ADT^A01/A03/A08 — admit/discharge/update
 *
 * Real production parsers handle escape sequences, repeating fields, custom
 * z-segments, etc. This is intentionally narrow but correct for the
 * canonical message shapes used in interoperability demos.
 */

export function parseHl7Message(raw) {
  if (!raw) throw new Error('Empty HL7 message');
  const text = raw.replace(/\r\n/g, '\r').replace(/\n/g, '\r').trim();
  const segments = text.split('\r').filter(Boolean);
  if (!segments.length) throw new Error('No segments found');

  const msh = segments[0];
  if (!msh.startsWith('MSH')) throw new Error('First segment must be MSH');

  // MSH delimiters: position 3 is field separator, position 4-7 are encoding chars
  const fieldSep = msh[3];           // typically |
  const encoding = msh.slice(4, 8);  // typically ^~\&
  const compSep = encoding[0];       // ^
  // const repSep = encoding[1];     // ~ (we don't handle repeats)
  // const escChar = encoding[2];    // \
  // const subSep = encoding[3];     // &

  const parsed = {
    delimiters: { fieldSep, compSep },
    segments: segments.map((s) => splitSegment(s, fieldSep, compSep)),
  };

  // Pull header info from MSH. Keep both bare type ('ORU') and full
  // 'ORU^R01' for downstream consumers.
  const mshFields = parsed.segments[0].fields;
  const typeComponents = mshFields[8] ?? [];
  parsed.messageType = typeComponents[0] ?? null;
  parsed.triggerEvent = typeComponents[1] ?? null;
  parsed.fullMessageType = parsed.triggerEvent
    ? `${parsed.messageType}^${parsed.triggerEvent}`
    : parsed.messageType;
  parsed.controlId = mshFields[9]?.[0] ?? null;
  parsed.sendingApp = mshFields[2]?.[0] ?? null;

  return parsed;
}

function splitSegment(segText, fieldSep, compSep) {
  const fields = segText.split(fieldSep);
  const segId = fields[0];
  // For MSH, fields[1] is the encoding-character bundle, but logically it
  // starts at fields[1] = field 1 of the segment. Conventional indexing
  // matches the HL7 spec: segment[0] = name, fields[1] = field-1.
  const out = [segId];
  for (let i = 1; i < fields.length; i++) {
    const components = fields[i].split(compSep);
    out.push(components);
  }
  return { id: segId, fields: out };
}

/**
 * Convert a parsed HL7 message into FHIR-shaped resources scoped to a
 * specific patient (we don't trust the document's patient identity).
 */
export function hl7ToFhirResources(parsed, patientId) {
  const resources = { Encounter: [], Observation: [] };
  const subject = { reference: `Patient/${patientId}` };
  const provenance = [{
    sourceSystem: parsed.sendingApp ?? 'hl7v2-source',
    sourceFormat: 'HL7v2',
    ingestedAt: new Date(),
    sourceDocumentId: parsed.controlId ?? undefined,
  }];

  const messageType = parsed.messageType;

  if (messageType === 'ORU' || messageType === 'ORU^R01') {
    let currentObr = null;
    for (const seg of parsed.segments) {
      if (seg.id === 'OBR') {
        currentObr = obrToFhirContext(seg);
      } else if (seg.id === 'OBX') {
        const obs = obxToObservation(seg, currentObr, subject, provenance);
        if (obs) resources.Observation.push(obs);
      }
    }
  } else if (messageType === 'ADT' || (messageType && messageType.startsWith('ADT'))) {
    const enc = adtToEncounter(parsed, subject, provenance);
    if (enc) resources.Encounter.push(enc);
  } else {
    logger.warn({ messageType }, 'unsupported HL7 message type');
  }

  return resources;
}

function obrToFhirContext(seg) {
  // OBR-4: universal service id, OBR-7: observation date/time
  return {
    serviceId: seg.fields[4],
    effectiveDateTime: parseHl7Ts(seg.fields[7]?.[0]),
  };
}

function obxToObservation(seg, obrCtx, subject, provenance) {
  // OBX-2: value type, OBX-3: observation identifier (LOINC), OBX-5: value,
  // OBX-6: units, OBX-7: reference range, OBX-8: abnormal flag, OBX-14: time
  const valueType = seg.fields[2]?.[0];
  const idCmp = seg.fields[3];
  const value = seg.fields[5]?.[0];
  const units = seg.fields[6]?.[0];
  const refRange = seg.fields[7]?.[0];
  const flag = seg.fields[8]?.[0];
  const ts = parseHl7Ts(seg.fields[14]?.[0]) ?? obrCtx?.effectiveDateTime;

  if (!idCmp || !idCmp[0]) return null;

  const obs = {
    _id: new mongoose.Types.ObjectId(),
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: {
      coding: [{
        system: idCmp[2]?.toLowerCase().includes('loinc') ? 'http://loinc.org' : (idCmp[2] ?? undefined),
        code: idCmp[0],
        display: idCmp[1],
      }],
      text: idCmp[1] ?? idCmp[0],
    },
    subject,
    effectiveDateTime: ts,
    interpretation: flag ? [{ coding: [{ code: flag }] }] : undefined,
    referenceRange: refRange ? [{ text: refRange }] : undefined,
    provenance,
  };

  if (valueType === 'NM') {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      obs.valueQuantity = { value: num, unit: units, system: 'http://unitsofmeasure.org', code: units };
    } else {
      obs.valueString = value;
    }
  } else if (valueType === 'ST' || valueType === 'TX') {
    obs.valueString = value;
  } else if (valueType === 'CE' || valueType === 'CWE') {
    const valCmp = seg.fields[5];
    obs.valueCodeableConcept = { coding: [{ code: valCmp[0], display: valCmp[1] }], text: valCmp[1] ?? valCmp[0] };
  } else {
    obs.valueString = value;
  }

  return obs;
}

function adtToEncounter(parsed, subject, provenance) {
  const evt = parsed.triggerEvent ?? '';
  const pv1 = parsed.segments.find((s) => s.id === 'PV1');
  if (!pv1) return null;

  // PV1-2: patient class (I/O/E/P), PV1-44: admit date/time, PV1-45: discharge
  // Fall back to EVN-2 (event time) or MSH-7 (message time) for short messages.
  const patientClass = pv1.fields[2]?.[0];
  const evn = parsed.segments.find((s) => s.id === 'EVN');
  const msh = parsed.segments[0];
  const admit =
    parseHl7Ts(pv1.fields[44]?.[0]) ??
    parseHl7Ts(evn?.fields[2]?.[0]) ??
    parseHl7Ts(msh.fields[7]?.[0]);
  const discharge = parseHl7Ts(pv1.fields[45]?.[0]);

  const classMap = {
    I: { code: 'IMP', display: 'inpatient' },
    O: { code: 'AMB', display: 'ambulatory' },
    E: { code: 'EMER', display: 'emergency' },
    P: { code: 'PRENC', display: 'pre-admission' },
  };

  return {
    _id: new mongoose.Types.ObjectId(),
    status: evt === 'A03' ? 'finished' : 'in-progress',
    class: classMap[patientClass] ?? { code: patientClass ?? 'AMB' },
    type: [{ text: parsed.fullMessageType ? `HL7 ${parsed.fullMessageType}` : 'HL7 ADT' }],
    subject,
    period: { start: admit, end: discharge },
    provenance,
  };
}

function parseHl7Ts(s) {
  if (!s) return undefined;
  // HL7 timestamps: YYYYMMDDHHMMSS or YYYYMMDD
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?/);
  if (!m) return undefined;
  const [, y, mo, d, h = '00', mi = '00', se = '00'] = m;
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

/**
 * Persist parsed FHIR resources to Mongo. Returns counts.
 */
export async function persistHl7Resources(resources) {
  const counts = { Encounter: 0, Observation: 0 };
  if (resources.Encounter.length) {
    await Encounter.insertMany(resources.Encounter, { ordered: false }).catch(() => {});
    counts.Encounter = resources.Encounter.length;
  }
  if (resources.Observation.length) {
    await Observation.insertMany(resources.Observation, { ordered: false }).catch(() => {});
    counts.Observation = resources.Observation.length;
  }
  return counts;
}
