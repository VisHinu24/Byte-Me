import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtDate, fmtRelative } from '../lib/format.js';
import { findProvider } from '../lib/providers.js';

const ACTION_LABEL = {
  'patient.read': 'Read patient',
  'patient.search': 'Searched patients',
  'summary.read': 'Read summary',
  'brief.synthesize': 'Synthesized brief',
  'consent.grant': 'Granted consent',
  'consent.revoke': 'Revoked consent',
  'consent.check': 'Consent check',
  'agent.retrieval': 'Agent: retrieval',
  'agent.risk': 'Agent: risk',
  'agent.synthesis': 'Agent: synthesis',
};

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'access', label: 'Data access', match: (e) => e.action === 'consent.check' || e.action.startsWith('summary.') || e.action.startsWith('brief.') },
  { key: 'consent', label: 'Consent changes', match: (e) => e.action === 'consent.grant' || e.action === 'consent.revoke' },
  { key: 'denied', label: 'Denied', match: (e) => e.outcome === 'denied' },
];

export function AuditLogPanel({ patientId }) {
  const [filter, setFilter] = useState('all');
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['audit', patientId],
    queryFn: () => api.getAudit(patientId),
    refetchInterval: 10_000,
  });

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    const fn = FILTERS.find((f) => f.key === filter)?.match ?? (() => true);
    return items.filter(fn);
  }, [items, filter]);

  return (
    <div className="space-y-4">
      <div className="panel p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Audit log</h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Append-only record of every access to this patient's data. Updates every 10 seconds.
            </p>
          </div>
          <button onClick={() => refetch()} className="btn text-xs">
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md text-sm border transition ${
              filter === f.key
                ? 'border-clinical-accent text-clinical-accent bg-clinical-accent/5'
                : 'border-clinical-border text-slate-400 hover:text-slate-200'
            }`}
          >
            {f.label}
            {f.key !== 'all' && (
              <span className="ml-2 text-xs text-slate-500">
                {items.filter(f.match).length}
              </span>
            )}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">{filtered.length} of {items.length} entries</span>
      </div>

      {isLoading && <div className="text-slate-400">Loading audit log…</div>}
      {error && <div className="text-clinical-danger">Failed: {error.message}</div>}

      <div className="panel overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No entries match this filter.
          </div>
        ) : (
          <ul className="divide-y divide-clinical-border/50">
            {filtered.map((e) => (
              <AuditRow key={e._id} entry={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AuditRow({ entry }) {
  const actor = entry.actor ?? {};
  const provider = actor.id ? findProvider(`Practitioner/${actor.id}`) : null;
  const actorLabel =
    provider?.name ??
    (actor.role === 'patient' ? 'Patient (self)' :
     actor.role === 'agent' ? `Agent · ${actor.id}` :
     actor.id ?? 'unknown');

  return (
    <li className="px-4 py-2.5 flex items-start justify-between gap-3 hover:bg-clinical-accent/5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`pill ${outcomeColor(entry.outcome)}`}>{entry.outcome}</span>
          <span className="font-medium text-sm">{ACTION_LABEL[entry.action] ?? entry.action}</span>
          <span className="text-xs text-slate-400">by {actorLabel}</span>
          {actor.role && (
            <span className="text-xs text-slate-500">({actor.role})</span>
          )}
        </div>
        {entry.reason && (
          <div className="text-xs text-slate-400 mt-0.5 truncate" title={entry.reason}>
            Reason: <span className="font-mono">{entry.reason}</span>
          </div>
        )}
        {entry.details && Object.keys(entry.details).length > 0 && (
          <div className="text-xs text-slate-500 mt-0.5 font-mono truncate" title={JSON.stringify(entry.details)}>
            {Object.entries(entry.details).slice(0, 3).map(([k, v]) => (
              <span key={k} className="mr-2">{k}={typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
            ))}
          </div>
        )}
      </div>
      <div className="text-xs text-slate-400 whitespace-nowrap text-right">
        <div>{fmtRelative(entry.at)}</div>
        <div className="text-slate-500 text-[10px]">{fmtDate(entry.at)}</div>
      </div>
    </li>
  );
}

function outcomeColor(o) {
  return {
    allowed: 'border-clinical-ok/40 text-clinical-ok',
    success: 'border-clinical-ok/40 text-clinical-ok',
    denied: 'border-clinical-danger/40 text-clinical-danger',
    error: 'border-clinical-danger/40 text-clinical-danger',
  }[o] ?? 'border-clinical-border text-slate-400';
}
