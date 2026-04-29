import { useEffect, useRef, useState } from 'react';
import { streamBrief } from '../lib/api.js';
import { renderBriefMarkdown } from '../lib/briefMarkdown.js';
import { ProvenanceModal } from './ProvenanceModal.jsx';

const STEPS = [
  { key: 'retrieval', label: 'Retrieval', desc: 'Gathering longitudinal context' },
  { key: 'risk', label: 'Risk', desc: 'Checking interactions, allergies, lab ranges' },
  { key: 'synthesis', label: 'Synthesis', desc: 'Composing point-of-care brief' },
];

export function BriefPanel({ patientId }) {
  const [running, setRunning] = useState(false);
  const [text, setText] = useState('');
  const [stepState, setStepState] = useState({}); // { retrieval: 'running'|'done', ... }
  const [stepPayloads, setStepPayloads] = useState({});
  const [risks, setRisks] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [citation, setCitation] = useState(null); // { type, id }
  const [complaint, setComplaint] = useState('');
  const abortRef = useRef(null);

  const start = () => {
    setRunning(true);
    setText('');
    setStepState({});
    setStepPayloads({});
    setRisks(null);
    setMeta(null);
    setError(null);

    abortRef.current = streamBrief(patientId, {
      complaint: complaint.trim() || null,
      onEvent: (evt) => {
        if (evt.type === 'step.start') {
          setStepState((s) => ({ ...s, [evt.step]: 'running' }));
        } else if (evt.type === 'step.complete') {
          setStepState((s) => ({ ...s, [evt.step]: 'done' }));
          setStepPayloads((p) => ({ ...p, [evt.step]: evt.payload }));
        } else if (evt.type === 'token') {
          setText((t) => t + evt.text);
        } else if (evt.type === 'done') {
          setRisks(evt.risks);
          setMeta({ durationMs: evt.durationMs, mocked: evt.mocked });
          setRunning(false);
        } else if (evt.type === 'error') {
          setError(evt.message);
          setRunning(false);
        }
      },
      onError: (err) => {
        setError(err.message);
        setRunning(false);
      },
      onClose: () => setRunning(false),
    });
  };

  const cancel = () => {
    abortRef.current?.();
    setRunning(false);
  };

  useEffect(() => () => abortRef.current?.(), []);

  return (
    <section className="panel p-7 space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2>Synthesized brief</h2>
          <p className="text-sm text-slate-400">
            Orchestrated agents produce a point-of-care summary with cited provenance.
          </p>
        </div>
      </div>

      <ComplaintBar
        complaint={complaint}
        onChange={setComplaint}
        running={running}
        onStart={start}
        onCancel={cancel}
        hasOutput={!!text}
      />

      <AccessScopeBanner allowedCategories={stepPayloads?.retrieval?.allowedCategories} />

      <StepStrip stepState={stepState} stepPayloads={stepPayloads} />

      {error && (
        <div className="rounded-lg border border-clinical-danger/40 bg-clinical-danger/10 p-3 text-sm text-clinical-danger">
          {error}
        </div>
      )}

      {risks && <RiskSummary risks={risks} onCite={setCitation} />}

      <BriefBody text={text} running={running} meta={meta} onCite={setCitation} />

      {citation && (
        <ProvenanceModal
          resourceType={citation.type}
          resourceId={citation.id}
          onClose={() => setCitation(null)}
        />
      )}
    </section>
  );
}

function AccessScopeBanner({ allowedCategories }) {
  // null/undefined = unrestricted access (patient self or default Dr. Demo).
  // We only show the banner when the brief is actually scope-limited.
  if (allowedCategories == null) return null;

  const cats = Array.isArray(allowedCategories) ? allowedCategories : [];
  const isEmpty = cats.length === 0;

  return (
    <div
      className={`rounded-lg border p-3 text-xs flex items-start gap-3 ${
        isEmpty
          ? 'border-clinical-danger/40 bg-clinical-danger/10'
          : 'border-clinical-warn/30 bg-clinical-warn/5'
      }`}
    >
      <span className={isEmpty ? 'text-clinical-danger' : 'text-clinical-warn'}>🔒</span>
      <div className="flex-1">
        <div className="font-medium text-slate-200">
          {isEmpty
            ? 'No data scope granted to you for this patient.'
            : 'Restricted access scope — patient grants determine what you see.'}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {isEmpty ? (
            <span className="text-clinical-danger">The brief cannot include any clinical content.</span>
          ) : (
            cats.map((c) => (
              <span key={c} className="pill border-clinical-warn/40 text-clinical-warn">
                {c}
              </span>
            ))
          )}
        </div>
        <div className="mt-1 text-slate-500">
          Anything outside this scope is intentionally omitted from the brief and synthesis.
        </div>
      </div>
    </div>
  );
}

function ComplaintBar({ complaint, onChange, running, onStart, onCancel, hasOutput }) {
  const examples = [
    'shortness of breath on exertion',
    'sugar levels rising',
    'rash after taking new antibiotic',
    'chest pain radiating to left arm',
  ];
  return (
    <div className="rounded-xl border border-clinical-border bg-clinical-bg/40 p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <label className="section-heading">Patient's stated concern (optional)</label>
        <span className="text-xs text-slate-500">Drives ranked retrieval — blank = generic brief</span>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={complaint}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. 'patient reports shortness of breath, started two weeks ago'"
          className="input flex-1 min-w-[280px]"
          disabled={running}
        />
        {running ? (
          <button onClick={onCancel} className="btn btn-lg">Stop</button>
        ) : (
          <button onClick={onStart} className="btn-primary btn-lg">
            {hasOutput ? 'Re-synthesize →' : 'Synthesize brief →'}
          </button>
        )}
      </div>
      {!complaint && !running && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-slate-500 mr-1">try:</span>
          {examples.map((e) => (
            <button
              key={e}
              onClick={() => onChange(e)}
              className="text-xs px-3 py-1 rounded-full border border-clinical-border text-slate-400 hover:border-clinical-accent hover:text-clinical-accent transition"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepStrip({ stepState, stepPayloads }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {STEPS.map((s, i) => {
        const state = stepState[s.key] ?? 'pending';
        const payload = stepPayloads[s.key];
        return (
          <div
            key={s.key}
            className={`rounded-xl border p-4 transition ${
              state === 'done'
                ? 'border-clinical-accent/40 bg-clinical-accent/5'
                : state === 'running'
                ? 'border-clinical-warn/40 bg-clinical-warn/5 animate-pulse'
                : 'border-clinical-border bg-clinical-bg/40 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-semibold">Step {i + 1}</span>
              <StatusDot state={state} />
            </div>
            <div className="text-base font-semibold mt-2 text-slate-100">{s.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.desc}</div>
            {payload && (
              <div className="mt-3 pt-3 border-t border-clinical-border/40 text-xs text-slate-300 leading-relaxed">
                {renderPayload(s.key, payload)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderPayload(key, p) {
  if (key === 'retrieval' && p.counts) {
    const parts = [
      `${p.counts.activeProblems} problems`,
      `${p.counts.currentMedications} meds`,
      `${p.counts.allergies} allergies`,
      `${p.counts.labTrends} trends`,
    ];
    if (p.counts.memories > 0) parts.push(`${p.counts.memories} memories`);
    if (p.counts.memoriesFiltered > 0) parts.push(`${p.counts.memoriesFiltered} memories withheld (out of scope)`);
    const summary = parts.join(' · ');

    if (p.complaintRelevant > 0) {
      const top = (p.topRelevance ?? []).slice(0, 3);
      return (
        <span className="block">
          <span>{summary}</span>
          <span className="block mt-1 text-clinical-accent">
            ⌘ {p.complaintRelevant} relevant to complaint
          </span>
          {top.length > 0 && (
            <span className="block mt-1 space-y-0.5 text-[10px] text-slate-300">
              {top.map((r, i) => (
                <span key={i} className="block truncate">
                  {(r.score ?? 0).toFixed(2)} · {r.label} {r.matches?.length ? <span className="text-slate-500">({r.matches.join(',')})</span> : null}
                </span>
              ))}
            </span>
          )}
        </span>
      );
    }
    return summary;
  }
  if (key === 'risk' && p.counts) {
    const parts = [];
    if (p.counts.critical) parts.push(`${p.counts.critical} critical`);
    if (p.counts.high) parts.push(`${p.counts.high} high`);
    if (p.counts.moderate) parts.push(`${p.counts.moderate} moderate`);
    if (parts.length === 0) parts.push('no risks');
    return parts.join(' · ');
  }
  if (key === 'synthesis') {
    return p.mocked ? 'mock mode (no API key)' : 'Groq streamed';
  }
  return null;
}

function StatusDot({ state }) {
  const cls =
    state === 'done' ? 'bg-clinical-accent' :
    state === 'running' ? 'bg-clinical-warn' :
    'bg-slate-600';
  return <span className={`h-2 w-2 rounded-full ${cls}`} />;
}

function RiskSummary({ risks, onCite }) {
  if (!risks?.flags?.length) return null;
  return (
    <div className="space-y-3">
      <div className="section-heading">Risk flags</div>
      <ul className="space-y-2">
        {risks.flags.map((f, i) => (
          <li
            key={i}
            className={`rounded-xl border p-4 ${severityClass(f.severity)}`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`pill ${severityPill(f.severity)}`}>{f.severity}</span>
              <span className="font-semibold text-slate-100">{f.title}</span>
            </div>
            <div className="text-sm text-slate-300 mt-1.5">{f.message}</div>
            {f.cites?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {f.cites.filter((c) => c.id).map((c, j) => (
                  <button
                    key={j}
                    onClick={() => onCite?.({ type: c.resourceType, id: c.id })}
                    className="cite-btn"
                    title={`View ${c.resourceType}/${c.id}`}
                  >
                    📌 {c.resourceType.toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function severityClass(s) {
  return {
    critical: 'border-clinical-danger/50 bg-clinical-danger/10',
    high: 'border-clinical-danger/40 bg-clinical-danger/5',
    moderate: 'border-clinical-warn/40 bg-clinical-warn/5',
    low: 'border-clinical-border bg-clinical-bg/40',
    info: 'border-clinical-border',
  }[s] ?? 'border-clinical-border';
}
function severityPill(s) {
  return {
    critical: 'border-clinical-danger/60 text-clinical-danger',
    high: 'border-clinical-danger/40 text-clinical-danger',
    moderate: 'border-clinical-warn/40 text-clinical-warn',
    low: 'border-clinical-border text-slate-400',
    info: 'border-clinical-border text-slate-400',
  }[s] ?? 'border-clinical-border text-slate-400';
}

function BriefBody({ text, running, meta, onCite }) {
  const handleClick = (e) => {
    const el = e.target.closest?.('.cite');
    if (!el) return;
    e.preventDefault();
    const type = el.dataset.resourceType;
    const id = el.dataset.resourceId;
    if (type && id) onCite?.({ type, id });
  };

  if (!text && !running) {
    return (
      <div className="rounded-xl border border-dashed border-clinical-border bg-clinical-bg/40 p-10 text-center">
        <div className="text-sm text-slate-400">
          Click <span className="text-clinical-accent font-medium">Synthesize brief</span> to generate a
          streaming clinical brief from the longitudinal record.
        </div>
      </div>
    );
  }
  return (
    <article className="rounded-xl border border-clinical-border bg-clinical-bg/40 p-6">
      <div
        className="prose-brief"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: renderBriefMarkdown(text) + (running ? '<span class="cursor">▍</span>' : '') }}
      />
      {meta && (
        <div className="mt-5 pt-4 border-t border-clinical-border/60 text-xs text-slate-500 flex items-center gap-3 flex-wrap">
          <span>Generated in <span className="text-slate-300 font-medium">{(meta.durationMs / 1000).toFixed(1)}s</span></span>
          {meta.mocked && (
            <span className="pill border-clinical-warn/40 text-clinical-warn">offline mock</span>
          )}
          <span className="text-slate-500">· Click any 📌 pin to view source FHIR resource</span>
        </div>
      )}
    </article>
  );
}
