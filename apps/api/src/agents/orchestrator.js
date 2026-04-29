import { runRetrievalAgent } from './retrieval.js';
import { runRiskAgent } from './risk.js';
import { runSynthesisAgent } from './synthesis.js';
import { logger } from '../config/logger.js';

/**
 * Orchestrator — coordinates the agent flow for a point-of-care brief.
 *
 * Flow:
 *   retrieval (deterministic) → risk (deterministic) → synthesis (LLM, streamed)
 *
 * Emits structured events to the caller so the UI can show the agent steps:
 *   { type: 'step.start', step }
 *   { type: 'step.complete', step, payload }
 *   { type: 'token', text }
 *   { type: 'done', brief, durationMs }
 *   { type: 'error', message }
 */
export async function orchestrateBrief({ patientId, complaint, allowedCategories = null }, emit) {
  const t0 = Date.now();

  try {
    // 1. Retrieval (scoped to allowedCategories — null = unrestricted)
    emit({ type: 'step.start', step: 'retrieval' });
    const retrieval = await runRetrievalAgent({ patientId, complaint, allowedCategories });
    emit({
      type: 'step.complete',
      step: 'retrieval',
      payload: {
        allowedCategories,
        counts: {
          activeProblems: retrieval.findings.activeProblems.length,
          currentMedications: retrieval.findings.currentMedications.length,
          allergies: retrieval.findings.allergies.length,
          labTrends: retrieval.findings.labTrendInsights.length,
          memories: retrieval.findings.derivedMemories?.length ?? 0,
          memoriesFiltered: retrieval.findings.memoriesFiltered ?? 0,
        },
        complaintRelevant: retrieval.findings.relevantToComplaint?.length ?? 0,
        topRelevance: (retrieval.findings.relevantToComplaint ?? []).slice(0, 3).map((r) => ({
          label: r.title ?? r.label ?? r.substance ?? r.type,
          score: r._relevance?.score,
          matches: r._relevance?.matches,
        })),
      },
    });

    // 2. Risk
    emit({ type: 'step.start', step: 'risk' });
    const risks = runRiskAgent({ findings: retrieval.findings });
    emit({
      type: 'step.complete',
      step: 'risk',
      payload: {
        counts: risks.counts,
        topFlags: risks.flags.slice(0, 3).map((f) => ({
          severity: f.severity,
          title: f.title,
        })),
      },
    });

    // 3. Synthesis (streamed)
    emit({ type: 'step.start', step: 'synthesis' });
    const { text, mocked, refused } = await runSynthesisAgent(
      {
        findings: retrieval.findings,
        risks,
        patient: retrieval.summary.patient,
      },
      (chunk) => emit({ type: 'token', text: chunk })
    );
    emit({ type: 'step.complete', step: 'synthesis', payload: { mocked, refused: !!refused } });

    const durationMs = Date.now() - t0;
    emit({
      type: 'done',
      brief: text,
      mocked,
      refused: !!refused,
      risks,
      findings: retrieval.findings,
      durationMs,
    });

    return {
      brief: text,
      mocked,
      refused: !!refused,
      risks,
      findings: retrieval.findings,
      durationMs,
    };
  } catch (err) {
    logger.error({ err }, 'orchestrator failed');
    emit({ type: 'error', message: err.message ?? 'Orchestration failed' });
    throw err;
  }
}
