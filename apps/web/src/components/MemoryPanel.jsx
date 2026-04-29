import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtDate, fmtRelative } from '../lib/format.js';
import { ProvenanceModal } from './ProvenanceModal.jsx';

const KIND_META = {
  episode: { label: 'Episode', color: 'border-clinical-accent/40 text-clinical-accent' },
  'treatment-response': { label: 'Treatment response', color: 'border-clinical-ok/40 text-clinical-ok' },
  preference: { label: 'Preference', color: 'border-slate-400/40 text-slate-300' },
  'risk-pattern': { label: 'Risk pattern', color: 'border-clinical-danger/40 text-clinical-danger' },
  'long-term-trend': { label: 'Long-term trend', color: 'border-clinical-warn/40 text-clinical-warn' },
  discontinuation: { label: 'Discontinuation', color: 'border-clinical-warn/40 text-clinical-warn' },
  'family-history': { label: 'Family history', color: 'border-slate-400/40 text-slate-300' },
  social: { label: 'Social', color: 'border-slate-400/40 text-slate-300' },
};

const STATUS_FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export function MemoryPanel({ patientId }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('active');
  const [citation, setCitation] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['memories', patientId, statusFilter],
    queryFn: () => api.listMemories(patientId, { status: statusFilter }),
  });

  const distill = useMutation({
    mutationFn: () => api.distillMemories(patientId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['memories', patientId] });
      qc.invalidateQueries({ queryKey: ['summary', patientId] });
      window.__lastDistillResult = result;
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, body }) => api.updateMemoryStatus(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memories', patientId] }),
  });

  const memories = data?.items ?? [];
  const lastDistill = distill.data;

  const grouped = useMemo(() => groupByKind(memories), [memories]);

  return (
    <div className="space-y-6">
      <header className="panel p-7">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-2 max-w-2xl">
            <h2>Derived memories</h2>
            <p className="text-sm text-slate-400">
              Agent-distilled, persistent observations across the longitudinal record. Each memory carries
              citations to source FHIR resources and is loaded into every future point-of-care brief.
            </p>
          </div>
          <button
            onClick={() => distill.mutate()}
            disabled={distill.isPending}
            className="btn-primary btn-lg"
          >
            {distill.isPending ? 'Distilling…' : 'Run distillation →'}
          </button>
        </div>

        {distill.error && (
          <div className="mt-4 rounded-lg border border-clinical-danger/40 bg-clinical-danger/10 p-3 text-sm text-clinical-danger">
            {distill.error.message}
          </div>
        )}
        {lastDistill && (
          <div className="mt-4 rounded-lg border border-clinical-accent/30 bg-clinical-accent/5 p-4 text-sm space-y-1">
            <div>
              <strong className="text-clinical-accent text-base">{lastDistill.created}</strong> new memories created
              {lastDistill.skipped > 0 && <span className="text-slate-400"> · {lastDistill.skipped} duplicates skipped</span>}
              {lastDistill.proposed === 0 && <span className="text-slate-400"> · agent had nothing new to add</span>}
            </div>
            <div className="text-xs text-slate-500 font-mono">model: {lastDistill.modelHint}</div>
          </div>
        )}
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`px-4 py-2 rounded-full text-sm border transition ${
              statusFilter === f.key
                ? 'border-clinical-accent text-clinical-accent bg-clinical-accent/10'
                : 'border-clinical-border text-slate-400 hover:text-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">{memories.length} memories</span>
      </div>

      {isLoading && <div className="text-slate-400">Loading memories…</div>}
      {error && <div className="text-clinical-danger">Failed: {error.message}</div>}

      {memories.length === 0 && !isLoading && (
        <div className="panel p-8 text-center text-slate-500">
          <p className="text-sm">No memories yet.</p>
          <p className="text-xs mt-2">
            Click <span className="text-clinical-accent">Run distillation</span> to have the agent analyze the
            longitudinal record and propose persistent observations.
          </p>
        </div>
      )}

      {Object.entries(grouped).map(([kind, items]) => (
        <section key={kind} className="space-y-2">
          <KindHeader kind={kind} count={items.length} />
          <div className="grid grid-cols-1 gap-2">
            {items.map((m) => (
              <MemoryCard
                key={m._id}
                memory={m}
                onCite={setCitation}
                onReject={() => {
                  const reason = window.prompt('Why is this memory wrong?');
                  if (reason !== null) updateStatus.mutate({ id: m._id, body: { status: 'rejected', rejectedReason: reason } });
                }}
                onRestore={() => updateStatus.mutate({ id: m._id, body: { status: 'active' } })}
              />
            ))}
          </div>
        </section>
      ))}

      {citation && (
        <ProvenanceModal
          resourceType={citation.type}
          resourceId={citation.id}
          onClose={() => setCitation(null)}
        />
      )}
    </div>
  );
}

function KindHeader({ kind, count }) {
  const meta = KIND_META[kind] ?? { label: kind, color: 'border-clinical-border text-slate-400' };
  return (
    <div className="flex items-center gap-2">
      <span className={`pill ${meta.color}`}>{meta.label}</span>
      <span className="text-xs text-slate-500">{count}</span>
    </div>
  );
}

function MemoryCard({ memory, onCite, onReject, onRestore }) {
  const meta = KIND_META[memory.kind];
  const isRejected = memory.status === 'rejected';
  const tw = memory.timeWindow;

  return (
    <article
      className={`panel p-4 ${isRejected ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base">{memory.title}</h3>
          <p className="text-sm text-slate-300 mt-1.5">{memory.summary}</p>

          <div className="flex flex-wrap gap-1.5 mt-3">
            {memory.sources?.filter((s) => s.id).map((s, i) => (
              <button
                key={i}
                onClick={() => onCite?.({ type: s.resourceType, id: s.id })}
                className="cite-btn"
                title={`View source ${s.resourceType}/${s.id}`}
              >
                📌 {s.resourceType.toLowerCase()}
                {s.role && <span className="opacity-60"> · {s.role}</span>}
              </button>
            ))}
            {memory.tags?.map((t) => (
              <span key={t} className="pill border-clinical-border text-slate-400">{t}</span>
            ))}
          </div>

          <div className="text-xs text-slate-500 mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <span>by {memory.createdBy?.kind ?? 'agent'}{memory.createdBy?.id ? ` · ${memory.createdBy.id}` : ''}</span>
            {memory.createdBy?.modelHint && (
              <span className="font-mono">{memory.createdBy.modelHint}</span>
            )}
            <span>confidence {(memory.confidence * 100).toFixed(0)}%</span>
            <span>{fmtRelative(memory.createdAt)}</span>
            {(tw?.start || tw?.end) && (
              <span>window: {fmtDate(tw.start)} – {fmtDate(tw.end)}</span>
            )}
          </div>

          {isRejected && memory.rejectedReason && (
            <div className="text-xs text-clinical-danger mt-2 italic">Rejected: {memory.rejectedReason}</div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {!isRejected ? (
            <button
              onClick={onReject}
              className="btn text-xs hover:border-clinical-danger hover:text-clinical-danger"
            >
              Reject
            </button>
          ) : (
            <button onClick={onRestore} className="btn text-xs">Restore</button>
          )}
        </div>
      </div>
    </article>
  );
}

function groupByKind(memories) {
  const order = [
    'risk-pattern', 'discontinuation', 'long-term-trend', 'episode',
    'treatment-response', 'preference', 'family-history', 'social',
  ];
  const groups = {};
  for (const m of memories) {
    if (!groups[m.kind]) groups[m.kind] = [];
    groups[m.kind].push(m);
  }
  const sorted = {};
  for (const k of order) if (groups[k]) sorted[k] = groups[k];
  for (const k of Object.keys(groups)) if (!sorted[k]) sorted[k] = groups[k];
  return sorted;
}
