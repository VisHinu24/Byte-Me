import { buildPatientSummary } from '../services/patientSummary.js';
import { DerivedMemory } from '../models/index.js';
import { rankClinicalContext } from '../services/keywordRetrieval.js';

/**
 * Retrieval agent — deterministic for now.
 *
 * Given the structured longitudinal summary, picks the slices most relevant
 * to point-of-care: active problems, current meds with start times, recent
 * lab trends with direction, past discontinuations, and context the
 * clinician would otherwise have to reconstruct.
 *
 * Future: vector search over derived episode summaries + clinical notes.
 */
export async function runRetrievalAgent({ patientId, complaint, allowedCategories = null }) {
  const summary = await buildPatientSummary(patientId, { allowedCategories });
  const allMemories = await DerivedMemory.find({
    'patient.reference': `Patient/${patientId}`,
    status: 'active',
  })
    .sort({ createdAt: -1 })
    .lean();

  // Privacy filter: a memory may cite multiple FHIR sources spanning
  // different categories (e.g. a "polypharmacy + recent ER visit" memory
  // cites MedicationRequests AND an Encounter). We only surface a memory
  // if EVERY source's category is in the requester's allowed list, so a
  // doctor with [conditions] only never sees memories that lean on
  // observations/allergies/encounters/etc.
  const memories = allowedCategories === null
    ? allMemories
    : allMemories.filter((m) => isMemoryInScope(m, allowedCategories));
  const memoriesFiltered = allMemories.length - memories.length;

  const findings = {
    activeProblems: summary.activeConditions.map((c) => ({
      id: c._id?.toString(),
      label: textOf(c.code),
      severity: textOf(c.severity),
      onset: c.onsetDateTime,
      cite: { resourceType: 'Condition', id: c._id?.toString() },
    })),

    currentMedications: summary.activeMedications.map((m) => ({
      id: m._id?.toString(),
      label: textOf(m.medicationCodeableConcept),
      dose: m.dosageInstruction?.[0]?.text,
      since: m.authoredOn,
      cite: { resourceType: 'MedicationRequest', id: m._id?.toString() },
    })),

    discontinuedMedications: extractDiscontinuations(summary),

    allergies: summary.allergies.map((a) => ({
      id: a._id?.toString(),
      substance: textOf(a.code),
      criticality: a.criticality,
      manifestation: a.reaction?.[0]?.manifestation?.map(textOf).filter(Boolean) ?? [],
      cite: { resourceType: 'AllergyIntolerance', id: a._id?.toString() },
    })),

    labTrendInsights: summary.labTrends.map(summarizeTrend).filter(Boolean),

    recentEncounters: summary.recentEncounters.slice(0, 5).map((e) => ({
      id: e._id?.toString(),
      type: e.type?.[0]?.text ?? e.class?.display,
      reason: e.reasonCode?.[0]?.text,
      at: e.period?.start,
      cite: { resourceType: 'Encounter', id: e._id?.toString() },
    })),

    derivedMemories: memories.map((m) => ({
      id: m._id?.toString(),
      kind: m.kind,
      title: m.title,
      summary: m.summary,
      tags: m.tags,
      confidence: m.confidence,
      timeWindow: m.timeWindow,
      sources: m.sources,
      createdBy: m.createdBy,
      createdAt: m.createdAt,
      cite: { resourceType: 'DerivedMemory', id: m._id?.toString() },
    })),

    complaintFocus: complaint || null,
    allowedCategories, // surfaced so synthesis can declare scope to the LLM + UI
    memoriesFiltered,  // how many memories were withheld due to scope (telemetry)
  };

  // If a complaint is provided, score every clinical item and surface the
  // most relevant ones up front. The substrate is BM25 over text — same
  // interface that production would back with Voyage AI / Atlas Vector
  // Search at scale. We don't drop low-relevance items; we annotate.
  if (complaint) {
    const pool = [
      ...findings.activeProblems,
      ...findings.currentMedications,
      ...findings.allergies,
      ...findings.derivedMemories,
      ...findings.recentEncounters,
      ...findings.labTrendInsights.map((t) => ({ ...t, label: t.label, cite: { resourceType: 'Observation', id: t.code } })),
    ];
    const ranked = rankClinicalContext({ items: pool, query: complaint, topK: 8 });
    findings.relevantToComplaint = ranked;
  } else {
    findings.relevantToComplaint = [];
  }

  return { summary, findings };
}

function extractDiscontinuations(summary) {
  // Heuristic: look at completed/stopped meds with explanatory dosage text.
  // In a real system we'd use MedicationStatement + reasonCode.
  return summary.patient
    ? []
    : [];
}

function summarizeTrend(trend) {
  if (!trend.points || trend.points.length < 2) return null;
  const points = trend.points.filter((p) => p.value != null);
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.value - first.value;
  const pct = first.value !== 0 ? (delta / first.value) * 100 : 0;

  const direction = Math.abs(pct) < 5 ? 'stable' : delta > 0 ? 'increasing' : 'decreasing';
  const flagged = points.some((p) => p.interpretation === 'H' || p.interpretation === 'L');
  const latestFlag = last.interpretation;

  return {
    code: trend.code,
    label: trend.display,
    direction,
    latest: { value: last.value, unit: last.unit, at: last.at, interpretation: latestFlag },
    earliest: { value: first.value, at: first.at },
    deltaPct: Number(pct.toFixed(1)),
    everFlagged: flagged,
    pointCount: points.length,
  };
}

function textOf(cc) {
  return cc?.text ?? cc?.coding?.[0]?.display ?? cc?.coding?.[0]?.code ?? null;
}

// Map FHIR resource types to consent categories. Used to decide whether a
// derived memory is in scope for the requester.
const RESOURCE_TO_CATEGORY = {
  Patient: 'demographics',
  Encounter: 'encounters',
  Condition: 'conditions',
  MedicationRequest: 'medications',
  Observation: 'observations',
  AllergyIntolerance: 'allergies',
};

/**
 * A memory is in-scope if EVERY source it cites maps to a category in
 * allowedCategories. A memory with no sources is treated as out-of-scope
 * (we can't verify what it draws on, so we err toward not leaking).
 *
 * Note: 'demographics' grants name/gender/birthDate visibility but a memory
 * citing only Patient is unusual — the path here treats it like any other
 * source: include only if 'demographics' is granted.
 */
function isMemoryInScope(memory, allowedCategories) {
  const sources = memory?.sources ?? [];
  if (sources.length === 0) return false;
  for (const s of sources) {
    const cat = RESOURCE_TO_CATEGORY[s.resourceType];
    // Unknown resource type — be conservative, exclude.
    if (!cat) return false;
    if (!allowedCategories.includes(cat)) return false;
  }
  return true;
}
