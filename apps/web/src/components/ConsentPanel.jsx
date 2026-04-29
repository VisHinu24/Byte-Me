import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtDate, fmtRelative } from '../lib/format.js';
import { DEMO_PROVIDERS, DATA_CATEGORIES, DURATION_OPTIONS, findProvider } from '../lib/providers.js';

export function ConsentPanel({ patientId }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['consents', patientId],
    queryFn: () => api.listConsents(patientId),
  });

  const grant = useMutation({
    mutationFn: (body) => api.grantConsent(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consents', patientId] }),
  });
  const revoke = useMutation({
    mutationFn: (id) => api.revokeConsent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consents', patientId] }),
  });

  const grants = data?.items ?? [];
  const active = grants.filter((c) => c.status === 'active');
  const inactive = grants.filter((c) => c.status !== 'active');

  return (
    <div className="space-y-6">
      <div className="panel p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Patient consent portal</h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Decide who can see what, and for how long. Each grant is enforced by the consent gate on every read.
              Revoking is instant — the next agent call will be blocked at the gate.
            </p>
          </div>
        </div>
      </div>

      <GrantForm
        patientId={patientId}
        existing={active}
        onSubmit={(body) => grant.mutate(body)}
        submitting={grant.isPending}
        error={grant.error}
      />

      {isLoading && <div className="text-slate-400">Loading consents…</div>}
      {error && <div className="text-clinical-danger">Failed: {error.message}</div>}

      <ConsentList
        title="Active grants"
        grants={active}
        onRevoke={(id) => revoke.mutate(id)}
        emptyText="No one currently has access. Use the form above to grant access."
      />

      {inactive.length > 0 && (
        <ConsentList
          title="Past / revoked"
          grants={inactive}
          inactive
        />
      )}
    </div>
  );
}

function GrantForm({ patientId, existing, onSubmit, submitting, error }) {
  const [granteeRef, setGranteeRef] = useState(DEMO_PROVIDERS[0].ref);
  const [categories, setCategories] = useState(['conditions', 'medications', 'allergies', 'observations']);
  const [duration, setDuration] = useState('30d');
  const [purpose, setPurpose] = useState('treatment');

  const grantee = useMemo(() => findProvider(granteeRef), [granteeRef]);
  const alreadyGranted = existing?.some((g) => g.grantee?.reference === granteeRef);

  const toggle = (cat) => {
    setCategories((c) => (c.includes(cat) ? c.filter((x) => x !== cat) : [...c, cat]));
  };

  const submit = (e) => {
    e.preventDefault();
    if (!categories.length) return;
    const dur = DURATION_OPTIONS.find((d) => d.value === duration);
    const expiresAt = dur?.ms ? new Date(Date.now() + dur.ms).toISOString() : undefined;
    onSubmit({
      patientId,
      granteeRef,
      granteeDisplay: grantee?.name,
      granteeType: 'Practitioner',
      categories,
      purpose: [purpose],
      expiresAt,
    });
  };

  return (
    <form onSubmit={submit} className="panel p-5 space-y-4">
      <div className="text-sm font-semibold uppercase tracking-wide text-slate-300">Grant new access</div>

      {/* Provider picker */}
      <div className="space-y-2">
        <label className="text-xs text-slate-400">Provider</label>
        <div className="grid grid-cols-2 gap-2">
          {DEMO_PROVIDERS.map((p) => (
            <button
              type="button"
              key={p.ref}
              onClick={() => setGranteeRef(p.ref)}
              className={`text-left rounded-lg border p-3 transition ${
                granteeRef === p.ref
                  ? 'border-clinical-accent bg-clinical-accent/5'
                  : 'border-clinical-border hover:border-clinical-accent/40'
              }`}
            >
              <div className="font-medium text-sm">{p.name}</div>
              <div className="text-xs text-slate-400">{p.specialty}</div>
              <div className="text-xs text-slate-500">{p.org}</div>
            </button>
          ))}
        </div>
        {alreadyGranted && (
          <div className="text-xs text-clinical-warn">
            Note: an active grant already exists for this provider. Submitting will create an additional record.
          </div>
        )}
      </div>

      {/* Categories */}
      <div className="space-y-2">
        <label className="text-xs text-slate-400">Data categories ({categories.length} selected)</label>
        <div className="grid grid-cols-3 gap-2">
          {DATA_CATEGORIES.map((c) => {
            const active = categories.includes(c.value);
            return (
              <button
                type="button"
                key={c.value}
                onClick={() => toggle(c.value)}
                className={`text-left rounded-lg border p-2 text-sm transition ${
                  active
                    ? c.sensitive
                      ? 'border-clinical-warn bg-clinical-warn/5'
                      : 'border-clinical-accent bg-clinical-accent/5'
                    : 'border-clinical-border hover:border-clinical-accent/40 opacity-80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">{c.label}</div>
                  {c.sensitive && (
                    <span className="pill border-clinical-warn/40 text-clinical-warn text-[10px]">sensitive</span>
                  )}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{c.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Duration + purpose */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-xs text-slate-400">Duration</label>
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full rounded-lg border border-clinical-border bg-clinical-panel px-3 py-2 text-sm"
          >
            {DURATION_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-slate-400">Purpose</label>
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="w-full rounded-lg border border-clinical-border bg-clinical-panel px-3 py-2 text-sm"
          >
            <option value="treatment">Treatment</option>
            <option value="emergency">Emergency</option>
            <option value="research">Research</option>
            <option value="second-opinion">Second opinion</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-clinical-danger/40 bg-clinical-danger/10 p-2 text-sm text-clinical-danger">
          {error.message}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {grantee && categories.length > 0 ? (
            <>Granting <strong className="text-slate-300">{grantee.name}</strong> access to <strong className="text-slate-300">{categories.length}</strong> categories for <strong className="text-slate-300">{DURATION_OPTIONS.find((d) => d.value === duration)?.label}</strong>.</>
          ) : 'Pick a provider and at least one category.'}
        </div>
        <button
          type="submit"
          disabled={submitting || categories.length === 0}
          className="btn border-clinical-accent text-clinical-accent"
        >
          {submitting ? 'Granting…' : 'Grant access'}
        </button>
      </div>
    </form>
  );
}

function ConsentList({ title, grants, onRevoke, inactive, emptyText }) {
  return (
    <section className="panel p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300 mb-3">{title}</h3>
      {grants.length === 0 ? (
        <div className="text-sm text-slate-500 italic">{emptyText ?? 'None.'}</div>
      ) : (
        <ul className="space-y-2">
          {grants.map((c) => {
            const provider = findProvider(c.grantee?.reference);
            const expiresAt = c.period?.end ? new Date(c.period.end) : null;
            const expired = expiresAt && expiresAt < new Date();
            return (
              <li
                key={c._id}
                className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
                  inactive ? 'border-clinical-border/50 opacity-70' : 'border-clinical-border'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">
                      {provider?.name ?? c.grantee?.display ?? c.grantee?.reference ?? 'Unknown grantee'}
                    </div>
                    {provider && (
                      <span className="text-xs text-slate-500">{provider.specialty} · {provider.org}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(c.scope?.categories ?? []).map((cat) => (
                      <span key={cat} className="pill border-clinical-accent/30 text-clinical-accent">{cat}</span>
                    ))}
                  </div>
                  <div className="text-xs text-slate-400 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>Purpose: {c.purpose?.join(', ') ?? '—'}</span>
                    <span>Granted {fmtRelative(c.createdAt)}</span>
                    {expiresAt ? (
                      <span className={expired ? 'text-clinical-danger' : ''}>
                        {expired ? 'Expired' : 'Expires'} {fmtDate(expiresAt)}
                      </span>
                    ) : (
                      <span>No expiry</span>
                    )}
                    {c.revokedAt && <span className="text-clinical-danger">Revoked {fmtRelative(c.revokedAt)}</span>}
                  </div>
                </div>
                {!inactive && c.status === 'active' && (
                  <button
                    onClick={() => onRevoke?.(c._id)}
                    className="btn text-xs hover:border-clinical-danger hover:text-clinical-danger"
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
