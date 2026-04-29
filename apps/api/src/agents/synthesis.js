import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const SYNTHESIS_MODEL = 'claude-opus-4-7';

const SYSTEM_PROMPT = `You are a clinical context synthesizer assisting a physician at the point of care.

Your job: turn a patient's structured longitudinal record + persisted derived memories + risk findings into a concise, scannable brief that helps the clinician make a better decision in the next 60 seconds.

Strict rules:
1. Be concise. The clinician will scan, not read.
2. Lead with what changes their plan: critical risks, allergies, recent decisions.
3. Cite every clinical claim with the source id in this format: [cite:ResourceType/id] — never invent ids; only use ids present in the input.
4. Derived memories are agent-distilled prior insights. When relevant, prefer citing the memory ([cite:DerivedMemory/id]) AND its underlying source — this reuses prior reasoning instead of redoing it.
5. Never invent diagnoses, medications, or values. If something is uncertain, say so.
6. Use markdown sections exactly: **Snapshot**, **Active issues**, **Risks & alerts**, **Memory recall**, **Treatment-response patterns**, **Suggested attention**.
7. The **Memory recall** section surfaces the 1-3 most relevant derived memories as bullets; skip the section entirely if no useful memories exist.
8. Keep total length under 400 words.
9. If a risk flag exists, surface it prominently. Do not soften critical alerts.
10. Treatment-response patterns: highlight discontinuations and what worked vs. didn't.
11. If a complaintFocus is provided, the **Snapshot** section MUST open with one short sentence connecting the complaint to the most relevant prior context (cite it). Use the relevantToComplaint list — it's already ranked by BM25 + clinical synonym expansion.
`;

/**
 * Streams a synthesized brief. If ANTHROPIC_API_KEY is missing, emits a
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
  if (!env.anthropicApiKey) {
    return mockSynthesis({ findings, risks, patient }, onToken);
  }

  const client = new Anthropic({ apiKey: env.anthropicApiKey });

  // Big static context — eligible for prompt caching across multiple agent
  // calls in the same session. Patient record changes slowly; risks change.
  const cachedContext = JSON.stringify(
    {
      patient: trimPatient(patient),
      findings,
    },
    null,
    2
  );

  const liveContext = JSON.stringify(
    {
      risks,
      complaintFocus: findings.complaintFocus ?? null,
      relevantToComplaint: findings.relevantToComplaint ?? [],
    },
    null,
    2
  );

  let full = '';
  try {
    const stream = await client.messages.stream({
      model: SYNTHESIS_MODEL,
      max_tokens: 1024,
      system: [
        { type: 'text', text: SYSTEM_PROMPT },
        {
          type: 'text',
          text: `## Patient longitudinal record\n\n${cachedContext}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `## Live signals (risks + complaint focus)\n\n${liveContext}\n\nIf complaintFocus is non-null, lead the brief with what's most relevant to that complaint, drawing from relevantToComplaint first. Otherwise, do a generic point-of-care brief. Produce it now.`,
        },
      ],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta' &&
        event.delta.text
      ) {
        full += event.delta.text;
        onToken?.(event.delta.text);
      }
    }
    return { text: full, mocked: false };
  } catch (err) {
    logger.error({ err: err.message }, 'synthesis claude call failed, falling back to mock');
    return mockSynthesis({ findings, risks, patient }, onToken);
  }
}

function trimPatient(patient) {
  if (!patient) return null;
  return {
    id: patient._id?.toString(),
    name: patient.name,
    gender: patient.gender,
    birthDate: patient.birthDate,
    identifier: patient.identifier,
  };
}

// ---------- Mock fallback ----------
async function mockSynthesis({ findings, risks }, onToken) {
  const lines = [];

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

  lines.push('**Active issues**\n');
  for (const c of findings.activeProblems ?? []) {
    lines.push(`- ${c.label}${c.severity ? ` (${c.severity})` : ''} [cite:Condition/${c.cite?.id}]`);
  }
  lines.push('');

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

  lines.push('**Suggested attention**\n');
  const critical = (risks.flags ?? []).filter((f) => f.severity === 'critical' || f.severity === 'high');
  if (critical.length) {
    lines.push(`- Address ${critical.length} high/critical alert${critical.length > 1 ? 's' : ''} before prescribing.`);
  }
  if (trends.some((t) => t.direction === 'increasing' && t.everFlagged)) {
    lines.push('- Lab trends rising — consider therapy review.');
  }
  if (!critical.length) {
    lines.push('- Routine review; no urgent agent-detected concerns.');
  }

  lines.push('\n_Synthesized in offline-mock mode (no Anthropic API key configured)._');

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
