import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const DISTILL_MODEL = 'llama-3.1-8b-instant';
const RULE_MODEL = 'rule-based-mock';

const SYSTEM_PROMPT = `You are a clinical memory distiller.

Given a patient's structured longitudinal record, your job is to extract a small set of high-value, persistent observations that emerge across multiple records — observations a clinician would want to recall on every visit but that are NOT obvious from any single FHIR resource.

Strict rules:
1. Each memory MUST cite at least one source FHIR resource by id.
2. Never invent ids. Only use ids present in the input findings.
3. Each memory has a kind from this enum:
   - episode (discrete event with start/end)
   - treatment-response (what worked/didn't for which condition)
   - preference (dosing schedule, communication style)
   - risk-pattern (recurring risk: allergy, OOR labs)
   - long-term-trend (multi-year trajectory)
   - discontinuation (why a med/treatment was stopped)
   - family-history
   - social
4. Title is short (under 80 chars). Summary is 1-3 sentences.
5. Skip the obvious. "Patient has hypertension" is not a memory — that's a Condition. A memory is "BP responding well to telmisartan since 2019, dropped from 148 to 132 over 12 months."
6. Output ONLY JSON, an array of memory objects. No prose, no markdown fences.

Schema:
{
  "kind": "string (one of the enum)",
  "title": "string",
  "summary": "string",
  "tags": ["string"],
  "confidence": 0.0-1.0,
  "timeWindow": { "start": "ISO date or null", "end": "ISO date or null" },
  "sources": [{ "resourceType": "Condition|MedicationRequest|...", "id": "string", "role": "primary|context|evidence" }]
}

Aim for 3-6 high-signal memories. Skip if a candidate would be redundant with an obvious finding.`;

/**
 * Distill memories from a patient's findings.
 *
 * @param {object} ctx
 * @param {object} ctx.findings   from retrieval agent
 * @param {Array}  ctx.existing   existing active memories (avoid duplicating)
 * @returns {Promise<{ candidates: Array, modelHint: string }>}
 */
export async function runDistillationAgent({ findings, existing = [] }) {
  if (!env.groqApiKey) {
    return runRuleBasedDistillation(findings);
  }

  const client = new Groq({ apiKey: env.groqApiKey });

  const findingsContext = JSON.stringify({ findings }, null, 2);
  const liveContext = JSON.stringify(
    {
      existingMemories: existing.map((m) => ({
        kind: m.kind,
        title: m.title,
        sources: m.sources,
      })),
    },
    null,
    2
  );

  try {
    const res = await client.chat.completions.create({
      model: DISTILL_MODEL,
      temperature: 0.3,
      max_completion_tokens: 2048,
      // Ask the API for JSON output where supported. If the model doesn't
      // honor it perfectly, parseJsonArray will salvage what it can.
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + '\n\nReturn JSON shaped as { "memories": [ ... ] }.' },
        {
          role: 'user',
          content: `## Patient longitudinal record\n\n${findingsContext}\n\n## Existing memories (do not duplicate)\n\n${liveContext}\n\nProduce the JSON object { "memories": [...] } now. JSON only, no other text.`,
        },
      ],
    });

    const text = res.choices?.[0]?.message?.content ?? '';
    const candidates = parseJsonArray(text);

    return { candidates, modelHint: DISTILL_MODEL };
  } catch (err) {
    logger.warn({ err: err.message }, 'distillation groq call failed, falling back to rules');
    return runRuleBasedDistillation(findings);
  }
}

function parseJsonArray(text) {
  // Strip code fences if model added them despite instructions.
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  const tryShape = (parsed) => {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.memories)) return parsed.memories;
    if (parsed && Array.isArray(parsed.candidates)) return parsed.candidates;
    return null;
  };
  try {
    const out = tryShape(JSON.parse(cleaned));
    if (out) return out;
  } catch {
    /* fall through */
  }
  // Try to find an object or array substring
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const out = tryShape(JSON.parse(objMatch[0]));
      if (out) return out;
    } catch { /* */ }
  }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]) ?? [];
    } catch { /* */ }
  }
  return [];
}

// ---------- Rule-based fallback ----------

function runRuleBasedDistillation(findings) {
  const candidates = [];

  // 1. Allergy + drug-class memory
  for (const allergy of findings.allergies ?? []) {
    candidates.push({
      kind: 'risk-pattern',
      title: `Documented ${allergy.substance} allergy`,
      summary: `${allergy.criticality === 'high' ? 'High-criticality' : 'Documented'} ${allergy.substance} allergy${allergy.manifestation?.length ? `; reported reaction: ${allergy.manifestation.join(', ')}` : ''}. Avoid related drug classes; verify before prescribing.`,
      tags: ['allergy', allergy.substance?.toLowerCase()].filter(Boolean),
      confidence: 0.95,
      timeWindow: {},
      sources: [{ resourceType: 'AllergyIntolerance', id: allergy.cite?.id, role: 'primary' }].filter((s) => s.id),
    });
  }

  // 2. Long-standing condition (onset > 2 years ago)
  const cutoff = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000;
  for (const c of findings.activeProblems ?? []) {
    if (!c.onset) continue;
    const onsetT = new Date(c.onset).getTime();
    if (Number.isNaN(onsetT) || onsetT > cutoff) continue;
    const years = Math.floor((Date.now() - onsetT) / (365 * 24 * 60 * 60 * 1000));
    candidates.push({
      kind: 'long-term-trend',
      title: `${c.label} — managed for ${years}+ years`,
      summary: `Long-standing ${c.label}, onset around ${new Date(c.onset).getFullYear()}. Continuous management context.`,
      tags: [c.label?.toLowerCase().split(' ')[0]].filter(Boolean),
      confidence: 0.85,
      timeWindow: { start: c.onset },
      sources: [{ resourceType: 'Condition', id: c.cite?.id, role: 'primary' }].filter((s) => s.id),
    });
  }

  // 3. Lab trend pattern (>= 3 readings)
  for (const trend of findings.labTrendInsights ?? []) {
    if (trend.pointCount < 3) continue;
    const directionWord = trend.direction === 'stable' ? 'stable' : trend.direction;
    const flagPart = trend.everFlagged
      ? trend.direction === 'increasing'
        ? 'currently abnormal — concerning trajectory'
        : trend.direction === 'decreasing'
          ? 'previously abnormal, improving'
          : 'recurringly abnormal'
      : 'within range';
    candidates.push({
      kind: 'long-term-trend',
      title: `${trend.label} ${directionWord} (${trend.deltaPct >= 0 ? '+' : ''}${trend.deltaPct}% over ${trend.pointCount} readings)`,
      summary: `${trend.label} latest ${trend.latest.value}${trend.latest.unit ? ' ' + trend.latest.unit : ''}, ${flagPart}. ${trend.pointCount} readings, trend ${directionWord}.`,
      tags: ['lab-trend', trend.code].filter(Boolean),
      confidence: 0.9,
      timeWindow: { start: trend.earliest?.at, end: trend.latest?.at },
      sources: [{ resourceType: 'Observation', id: trend.code, role: 'evidence' }],
    });
  }

  // 4. Polypharmacy
  const meds = findings.currentMedications ?? [];
  if (meds.length >= 4) {
    candidates.push({
      kind: 'risk-pattern',
      title: `Polypharmacy: ${meds.length} active medications`,
      summary: `Patient is on ${meds.length} concurrent active prescriptions. Increased risk of drug-drug interactions and adherence issues. Review for deprescribing opportunities at next visit.`,
      tags: ['polypharmacy'],
      confidence: 0.8,
      timeWindow: {},
      sources: meds.map((m) => ({ resourceType: 'MedicationRequest', id: m.cite?.id, role: 'evidence' })).filter((s) => s.id),
    });
  }

  // 5. Recent ER visit memory (treatment-response signal)
  const erEncounters = (findings.recentEncounters ?? []).filter(
    (e) => /emerg/i.test(e.type ?? '') || /emerg/i.test(e.reason ?? '')
  );
  for (const er of erEncounters.slice(0, 1)) {
    candidates.push({
      kind: 'episode',
      title: `ER visit: ${er.reason ?? er.type ?? 'emergency encounter'}`,
      summary: `Emergency presentation${er.at ? ` in ${new Date(er.at).getFullYear()}` : ''}: ${er.reason ?? 'reason not recorded'}. Relevant for risk-stratifying future presentations.`,
      tags: ['er', 'episode'],
      confidence: 0.85,
      timeWindow: { start: er.at, end: er.at },
      sources: [{ resourceType: 'Encounter', id: er.cite?.id, role: 'primary' }].filter((s) => s.id),
    });
  }

  return { candidates, modelHint: RULE_MODEL };
}
