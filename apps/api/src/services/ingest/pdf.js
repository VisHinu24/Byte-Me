import mongoose from 'mongoose';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  Condition,
  MedicationRequest,
  Observation,
  AllergyIntolerance,
} from '../../models/index.js';

/**
 * PDF / scanned-prescription ingestion via Claude vision.
 *
 * Flow:
 *   1. Caller uploads a PDF or image (jpeg/png).
 *   2. Claude extracts a structured JSON of FHIR-shaped resources, citing
 *      the visible regions of the document.
 *   3. We map those resources to our Mongoose models and insert.
 *
 * If no API key is configured, we return a "needs API key" error rather than
 * a misleading mock — the value of this path is the actual extraction.
 */

const VISION_MODEL = 'claude-opus-4-7';

const SYSTEM_PROMPT = `You extract FHIR resources from clinical documents.

Read the document image/PDF and produce a JSON object with these arrays:
{
  "medications":  [{ "name": string, "dosage": string?, "status": "active"|"completed"?, "startDate": ISO?, "rxnormCode": string? }],
  "conditions":   [{ "name": string, "snomedCode": string?, "onsetDate": ISO?, "status": "active"|"resolved"? }],
  "allergies":    [{ "substance": string, "criticality": "low"|"high"?, "reaction": string?, "snomedCode": string? }],
  "observations": [{ "name": string, "loincCode": string?, "value": number?, "valueString": string?, "unit": string?, "effectiveDate": ISO?, "interpretation": "H"|"L"|"N"? }]
}

Strict rules:
1. JSON only, no prose, no markdown fences.
2. Only include items you can read with confidence — never guess.
3. Use ISO 8601 dates. If only a year is visible, use YYYY-01-01.
4. If the document is not clinical or you can't extract anything, return an object with empty arrays.
5. Don't merge or interpret — extract what's literally on the page.`;

/**
 * @param {object} args
 * @param {Buffer} args.buffer  raw file bytes
 * @param {string} args.mediaType  e.g. application/pdf, image/jpeg, image/png
 * @returns {Promise<object>}  the structured extraction
 */
export async function extractFromDocument({ buffer, mediaType }) {
  if (!env.anthropicApiKey) {
    throw new Error('PDF ingestion requires ANTHROPIC_API_KEY (Claude vision). Configure it in apps/api/.env to enable this path.');
  }

  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const base64 = buffer.toString('base64');

  // Claude vision content blocks: 'document' for PDF, 'image' for images.
  const isPdf = mediaType === 'application/pdf';
  const sourceBlock = isPdf
    ? {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 },
      }
    : {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      };

  const res = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          sourceBlock,
          { type: 'text', text: 'Extract the FHIR JSON now. JSON only.' },
        ],
      },
    ],
  });

  const text = res.content?.[0]?.type === 'text' ? res.content[0].text : '';
  return parseStrictJson(text);
}

function parseStrictJson(text) {
  const cleaned = String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return { medications: [], conditions: [], allergies: [], observations: [] };
    try { return JSON.parse(m[0]); } catch { return { medications: [], conditions: [], allergies: [], observations: [] }; }
  }
}

/**
 * Map an extraction object to FHIR-shaped Mongoose docs and persist.
 */
export async function persistDocumentExtraction(extraction, patientId, sourceMeta = {}) {
  const subject = { reference: `Patient/${patientId}` };
  const provenance = [{
    sourceSystem: sourceMeta.sourceSystem ?? 'pdf-vision',
    sourceFormat: 'PDF',
    ingestedAt: new Date(),
    sourceDocumentId: sourceMeta.filename ?? undefined,
  }];

  const counts = { Condition: 0, MedicationRequest: 0, AllergyIntolerance: 0, Observation: 0 };

  for (const m of extraction.medications ?? []) {
    if (!m?.name) continue;
    await MedicationRequest.create({
      _id: new mongoose.Types.ObjectId(),
      status: m.status ?? 'active',
      intent: 'order',
      medicationCodeableConcept: {
        coding: m.rxnormCode ? [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: m.rxnormCode, display: m.name }] : undefined,
        text: m.name,
      },
      subject,
      authoredOn: parseDate(m.startDate),
      dosageInstruction: m.dosage ? [{ text: m.dosage }] : undefined,
      provenance,
    }).catch((err) => logger.warn({ err: err.message }, 'med insert failed'));
    counts.MedicationRequest += 1;
  }

  for (const c of extraction.conditions ?? []) {
    if (!c?.name) continue;
    await Condition.create({
      _id: new mongoose.Types.ObjectId(),
      clinicalStatus: { coding: [{ code: c.status === 'resolved' ? 'resolved' : 'active' }] },
      verificationStatus: { coding: [{ code: 'confirmed' }] },
      code: {
        coding: c.snomedCode ? [{ system: 'http://snomed.info/sct', code: c.snomedCode, display: c.name }] : undefined,
        text: c.name,
      },
      subject,
      onsetDateTime: parseDate(c.onsetDate),
      recordedDate: parseDate(c.onsetDate),
      provenance,
    }).catch((err) => logger.warn({ err: err.message }, 'condition insert failed'));
    counts.Condition += 1;
  }

  for (const a of extraction.allergies ?? []) {
    if (!a?.substance) continue;
    await AllergyIntolerance.create({
      _id: new mongoose.Types.ObjectId(),
      clinicalStatus: { coding: [{ code: 'active' }] },
      verificationStatus: { coding: [{ code: 'confirmed' }] },
      type: 'allergy',
      category: ['medication'],
      criticality: a.criticality ?? 'low',
      code: {
        coding: a.snomedCode ? [{ system: 'http://snomed.info/sct', code: a.snomedCode, display: a.substance }] : undefined,
        text: a.substance,
      },
      patient: subject,
      reaction: a.reaction ? [{ manifestation: [{ text: a.reaction }] }] : undefined,
      provenance,
    }).catch((err) => logger.warn({ err: err.message }, 'allergy insert failed'));
    counts.AllergyIntolerance += 1;
  }

  for (const o of extraction.observations ?? []) {
    if (!o?.name && !o?.loincCode) continue;
    await Observation.create({
      _id: new mongoose.Types.ObjectId(),
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: {
        coding: o.loincCode ? [{ system: 'http://loinc.org', code: o.loincCode, display: o.name }] : undefined,
        text: o.name ?? o.loincCode,
      },
      subject,
      effectiveDateTime: parseDate(o.effectiveDate),
      valueQuantity: typeof o.value === 'number' ? { value: o.value, unit: o.unit } : undefined,
      valueString: typeof o.value !== 'number' ? o.valueString ?? undefined : undefined,
      interpretation: o.interpretation ? [{ coding: [{ code: o.interpretation }] }] : undefined,
      provenance,
    }).catch((err) => logger.warn({ err: err.message }, 'observation insert failed'));
    counts.Observation += 1;
  }

  return counts;
}

function parseDate(d) {
  if (!d) return undefined;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? undefined : t;
}
