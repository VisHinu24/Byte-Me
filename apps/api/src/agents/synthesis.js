import Groq from 'groq-sdk';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const SYNTHESIS_MODEL = 'llama-3.1-8b-instant';

const SYSTEM_PROMPT = `You are a clinical context synthesizer assisting a physician at the point of care.

═══════════════════════════════════════════════════════════════════════════════
ACCESS POLICY — read this first.
═══════════════════════════════════════════════════════════════════════════════

Each user message starts with an "## ACCESS POLICY" block declaring
\`allowedCategories\` — the categories the patient has shared with this clinician.

Decision flow (do this BEFORE writing anything):

  Step 1. Read the "complaintInScope" flag in the live signals.
           - true OR null  → access is OK, produce the normal brief
                              (skip Step 2, go to Step 3).
           - false         → access is denied for this complaint, go to Step 2.

  Step 2. ACCESS DENIED RESPONSE (only when complaintInScope === false).
          Output ONLY these lines and stop. Do not include any other section.

              **Access denied**
              The patient has not granted access to: <missing-categories>.
              Granted scope: <allowedCategories, or "none">.
              Request consent from the patient before this brief can address it.

  Step 3. NORMAL BRIEF.
          - allowedCategories is the ONLY clinical scope you may discuss.
            Patient name, gender, age are always allowed (they're identity, not a
            clinical category).
          - Every section must draw ONLY from data in the allowed list.
            For example: include "Active issues" only if "conditions" is allowed;
            include "Treatment-response patterns" only if "observations" is allowed.
          - Omit sections whose category isn't allowed — don't stub them with
            "no data". Just leave them out.
          - allowedCategories: null = unrestricted (patient self / admin).

═══════════════════════════════════════════════════════════════════════════════
OUTPUT RULES (Step 3 — normal brief)
═══════════════════════════════════════════════════════════════════════════════

Produce a concise, scannable brief that helps the clinician make a better
decision in the next 60 seconds.

1. Under 400 words. Clinicians scan, not read.
2. Lead with what changes their plan: critical risks, allergies, recent decisions.
3. Cite every clinical claim with [cite:ResourceType/id] — never invent ids.
4. Derived memories are agent-distilled prior insights. Cite the memory
   ([cite:DerivedMemory/id]) AND its underlying source — reuse prior reasoning.
5. Never invent diagnoses, medications, or values. If uncertain, say so.
6. Use exact markdown section headers when included: **Snapshot**,
   **Active issues**, **Risks & alerts**, **Memory recall**,
   **Treatment-response patterns**, **Suggested attention**.
7. **Memory recall**: 1-3 most relevant; skip section if none.
8. Surface critical risk flags prominently. Do not soften.
9. Treatment-response patterns: highlight discontinuations and what worked vs. didn't.
10. If complaintFocus is non-null AND complaintInScope is true, **Snapshot** opens
    with one sentence linking the complaint to the most relevant prior context
    (cite it). Use the relevantToComplaint list — already BM25-ranked.
`;

/**
 * Streams a synthesized brief. If GROQ_API_KEY is missing, emits a
 * deterministic mock so the demo still works.
 *
 * @param {object} ctx
 * @param {object} ctx.findings   from retrieval agent
 * @param {object} ctx.risks      from risk agent
 * @param {object} ctx.patient    Patient resource
 * @param {(text:string)=>void} onToken  called for each streamed token
 * @returns {Promise<{text:string, mocked:boolean}>}
 */
export async function runSynthesisAgent({ findings, risks, patient }, onToken) {
  // Pre-check: if the complaint clearly references a category outside the
  // requester's grants, refuse deterministically. We don't waste tokens on
  // a question the consent layer already says we can't answer.
  if (findings.allowedCategories && findings.complaintFocus) {
    const wanted = detectComplaintCategories(findings.complaintFocus);
    const missing = wanted.filter((c) => !findings.allowedCategories.includes(c));
    if (missing.length > 0) {
      return refuseOutOfScope({ missing, allowed: findings.allowedCategories, complaint: findings.complaintFocus }, onToken);
    }
  }

  if (!env.groqApiKey) {
    return mockSynthesis({ findings, risks, patient }, onToken);
  }

  const client = new Groq({ apiKey: env.groqApiKey });

  // Compute complaint-in-scope deterministically. If the complaint mentions
  // a forbidden category, the deterministic pre-check at the top of this
  // function already refused — so anything reaching this point is in scope.
  // We pass complaintInScope=true explicitly so the model doesn't have to
  // guess. (When the complaint is null, it's null too — no decision needed.)
  const allowed = findings.allowedCategories;
  const complaintInScope = findings.complaintFocus
    ? true                  // pre-check passed → in scope
    : null;                 // no complaint → no decision

  const accessBlock = allowed === null
    ? `allowedCategories: null  (unrestricted — patient self-view or admin)`
    : `allowedCategories: ${JSON.stringify(allowed)}`;

  // Compact context — Groq's free-tier llama-3.1-8b-instant has a 6000 TPM
  // budget. Verbose FHIR resources blow past it. We strip to the essentials
  // (labels, codes, dates, citation ids) and cap each section.
  const patientContext = JSON.stringify(
    { patient: trimPatient(patient), findings: compactFindings(findings) },
  );

  const liveContext = JSON.stringify({
    risks: compactRisks(risks),
    complaintFocus: findings.complaintFocus ?? null,
    complaintInScope,
    relevantToComplaint: compactRelevant(findings.relevantToComplaint ?? []),
  });

  // ACCESS POLICY block leads, before any clinical data, so the model reads
  // the scope first. complaintInScope tells the model whether to refuse or
  // produce a brief — no inference required.
  const userMessage =
    `## ACCESS POLICY\n` +
    `${accessBlock}\n` +
    `complaintInScope: ${JSON.stringify(complaintInScope)}\n\n` +
    `→ If complaintInScope is false, refuse with the Access Denied template (system prompt, Step 2).\n` +
    `→ Otherwise (true or null), produce the brief drawing only from allowedCategories (system prompt, Step 3).\n\n` +
    `## Patient longitudinal record (already filtered to allowed categories)\n\n` +
    `${patientContext}\n\n` +
    `## Live signals\n\n` +
    `${liveContext}\n\n` +
    `Produce the brief per the system prompt now.`;

  let full = '';
  try {
    const stream = await client.chat.completions.create({
      model: SYNTHESIS_MODEL,
      temperature: 0.2,
      max_completion_tokens: 1024,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onToken?.(delta);
      }
    }
    return { text: full, mocked: false };
  } catch (err) {
    logger.error({ err: err.message }, 'synthesis groq call failed, falling back to mock');
    return mockSynthesis({ findings, risks, patient }, onToken);
  }
}

function trimPatient(patient) {
  if (!patient) return null;
  const n = patient.name?.[0];
  const display = n?.text ?? [...(n?.given ?? []), n?.family].filter(Boolean).join(' ');
  return {
    id: patient._id?.toString(),
    name: display,
    gender: patient.gender,
    birthDate: patient.birthDate,
  };
}

function compactFindings(f) {
  return {
    activeProblems: (f.activeProblems ?? []).slice(0, 10).map((p) => ({
      id: p.cite?.id, label: p.label, severity: p.severity, onset: p.onset,
    })),
    currentMedications: (f.currentMedications ?? []).slice(0, 10).map((m) => ({
      id: m.cite?.id, label: m.label, dose: m.dose, since: m.since,
    })),
    allergies: (f.allergies ?? []).map((a) => ({
      id: a.cite?.id, substance: a.substance, criticality: a.criticality,
      manifestation: (a.manifestation ?? []).slice(0, 2).join(', '),
    })),
    labTrendInsights: (f.labTrendInsights ?? []).slice(0, 6).map((t) => ({
      code: t.code, label: t.label, direction: t.direction, deltaPct: t.deltaPct,
      latest: t.latest ? { value: t.latest.value, unit: t.latest.unit, interpretation: t.latest.interpretation } : null,
      pointCount: t.pointCount, everFlagged: t.everFlagged,
    })),
    recentEncounters: (f.recentEncounters ?? []).slice(0, 5).map((e) => ({
      id: e.cite?.id, type: e.type, reason: e.reason, at: e.at,
    })),
    derivedMemories: (f.derivedMemories ?? []).slice(0, 6).map((m) => ({
      id: m.cite?.id, kind: m.kind, title: m.title, summary: m.summary,
      sources: (m.sources ?? []).slice(0, 3),
    })),
  };
}

function compactRisks(r) {
  return {
    counts: r?.counts,
    flags: (r?.flags ?? []).slice(0, 8).map((f) => ({
      severity: f.severity, title: f.title, message: f.message,
      cites: (f.cites ?? []).slice(0, 3),
    })),
  };
}

function compactRelevant(list) {
  return list.slice(0, 6).map((r) => ({
    cite: r.cite,
    label: r.title ?? r.label ?? r.substance,
    score: r._relevance?.score,
    matches: r._relevance?.matches,
  }));
}

const ALL_CATEGORIES = [
  'demographics', 'conditions', 'medications', 'allergies',
  'observations', 'encounters',
  'mental-health', 'reproductive-health', 'genetic',
];

// Inverse of allowedCategories — what the clinician explicitly does NOT have.
// Surfaces in the prompt so the model can refuse precisely.
function deniedCategories(allowed) {
  if (!allowed) return [];
  return ALL_CATEGORIES.filter((c) => !allowed.includes(c));
}

// ---------- Mock fallback ----------
const SENSITIVE_KEYWORDS = {
  'mental-health': /(mental health|depress|anxiety|psych|suicid|self.harm|panic attack|bipolar|ptsd|ocd)/i,
  'reproductive-health': /(reproduc|pregnan|abortion|menstrua|fertil|sti |std |sexual)/i,
  'genetic': /(genetic|hereditary|brca|family history)/i,
  conditions: /(condition|diagnos|problem)/i,
  medications: /(medication|prescrib|drug|pill|dose)/i,
  allergies: /(allerg|reaction|sensitiv)/i,
  observations: /(lab|blood|urine|cholesterol|sugar|hba1c|hemoglobin|vital|bp )/i,
  encounters: /(visit|admit|er |hospital|encounter)/i,
};

function detectComplaintCategories(complaint) {
  if (!complaint) return [];
  const matches = [];
  for (const [cat, re] of Object.entries(SENSITIVE_KEYWORDS)) {
    if (re.test(complaint)) matches.push(cat);
  }
  return matches;
}

async function refuseOutOfScope({ missing, allowed, complaint }, onToken) {
  const lines = [
    '**Access scope**',
    '',
    `> ⚠ The clinician's stated concern *"${complaint}"* references **${missing.join(', ')}**, but the patient has not granted consent for ${missing.length > 1 ? 'these categories' : 'this category'}.`,
    `> No brief content can be produced about ${missing.join(' or ')} for this patient.`,
    `> Granted scope: ${(allowed ?? []).join(', ') || 'none'}.`,
    `> Ask the patient to extend consent if you need this information.`,
    '',
    '_Refused at the consent layer — no LLM call was made for this query._',
  ];
  const text = lines.join('\n');
  for (const chunk of chunkText(text, 8)) {
    onToken?.(chunk);
    await sleep(10);
  }
  return { text, mocked: true, refused: true };
}

async function mockSynthesis({ findings, risks }, onToken) {
  const lines = [];
  const allowed = findings.allowedCategories; // null = unrestricted

  if (allowed) {
    lines.push(`_Access scope: ${allowed.join(', ')} (granted by patient)._`);
    lines.push('');
  }

  lines.push('**Snapshot**\n');

  // If a complaint is set, lead with the most relevant prior context.
  if (findings.complaintFocus && findings.relevantToComplaint?.length) {
    const top = findings.relevantToComplaint.slice(0, 2);
    const bits = top.map((r) => {
      const label = r.title ?? r.label ?? r.substance ?? r.type ?? 'context';
      const cite = r.cite ? `[cite:${r.cite.resourceType}/${r.cite.id}]` : '';
      return `${label} ${cite}`.trim();
    });
    lines.push(`Re: "${findings.complaintFocus}" — most relevant prior context: ${bits.join('; ')}.`);
  }
  if (findings.activeProblems?.length) {
    const top = findings.activeProblems
      .slice(0, 3)
      .map((p) => `${p.label} [cite:Condition/${p.cite?.id}]`)
      .join(', ');
    lines.push(`Active problems: ${top}.`);
  }
  if (findings.currentMedications?.length) {
    lines.push(`On ${findings.currentMedications.length} active medications.`);
  }
  if (findings.allergies?.length) {
    lines.push(
      `Allergies: ${findings.allergies.map((a) => a.substance).join(', ')}.`
    );
  }
  lines.push('');

  // Each section conditionally included only when its category is in scope.
  if (!allowed || allowed.includes('conditions')) {
    lines.push('**Active issues**\n');
    if ((findings.activeProblems ?? []).length === 0) {
      lines.push('_No active issues._');
    } else {
      for (const c of findings.activeProblems) {
        lines.push(`- ${c.label}${c.severity ? ` (${c.severity})` : ''} [cite:Condition/${c.cite?.id}]`);
      }
    }
    lines.push('');
  }

  lines.push('**Risks & alerts**\n');
  if (!risks.flags?.length) {
    lines.push('_No automated risk flags detected._');
  } else {
    for (const f of risks.flags) {
      const cites = (f.cites ?? [])
        .map((c) => `[cite:${c.resourceType}/${c.id ?? c.code}]`)
        .join(' ');
      lines.push(`- **${f.severity.toUpperCase()}** — ${f.title}: ${f.message} ${cites}`);
    }
  }
  lines.push('');

  const memories = findings.derivedMemories ?? [];
  if (memories.length > 0) {
    lines.push('**Memory recall**\n');
    for (const m of memories.slice(0, 3)) {
      const memCite = `[cite:DerivedMemory/${m.cite?.id ?? m.id}]`;
      const srcCite = (m.sources ?? [])
        .slice(0, 2)
        .map((s) => `[cite:${s.resourceType}/${s.id}]`)
        .join(' ');
      lines.push(`- _${m.kind}_ — **${m.title}**: ${m.summary} ${memCite} ${srcCite}`);
    }
    lines.push('');
  }

  if (!allowed || allowed.includes('observations')) {
    lines.push('**Treatment-response patterns**\n');
    const trends = findings.labTrendInsights ?? [];
    if (trends.length === 0) {
      lines.push('_No lab trend signal._');
    } else {
      for (const t of trends.slice(0, 3)) {
        lines.push(
          `- ${t.label}: ${t.direction}, ${t.deltaPct >= 0 ? '+' : ''}${t.deltaPct}% across ${t.pointCount} readings (latest ${t.latest.value} ${t.latest.unit ?? ''}).`
        );
      }
    }
    lines.push('');
  }

  lines.push('**Suggested attention**\n');
  const critical = (risks.flags ?? []).filter((f) => f.severity === 'critical' || f.severity === 'high');
  if (critical.length) {
    lines.push(`- Address ${critical.length} high/critical alert${critical.length > 1 ? 's' : ''} before prescribing.`);
  }
  const risingTrends = (findings.labTrendInsights ?? []).some((t) => t.direction === 'increasing' && t.everFlagged);
  if (risingTrends && (!allowed || allowed.includes('observations'))) {
    lines.push('- Lab trends rising — consider therapy review.');
  }
  if (!critical.length) {
    lines.push('- Routine review; no urgent agent-detected concerns.');
  }

  lines.push('\n_Synthesized in offline-mock mode (no GROQ_API_KEY configured)._');

  const text = lines.join('\n');
  // Stream char-by-char to mimic real streaming for the UI
  for (const chunk of chunkText(text, 8)) {
    onToken?.(chunk);
    await sleep(15);
  }
  return { text, mocked: true };
}

function chunkText(s, size) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
