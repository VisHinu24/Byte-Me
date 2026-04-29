import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useMe } from '../hooks/useMe.js';
import { ageFromBirth, displayName, fmtDate } from '../lib/format.js';

export function PatientListPage() {
  const [q, setQ] = useState('');
  const { data: me, isLoading: meLoading } = useMe();
  const { data, isLoading, error } = useQuery({
    queryKey: ['patients', q],
    queryFn: () => api.listPatients(q),
    enabled: !meLoading && me?.role !== 'patient',
  });

  // Patients land directly on their own record. The patient list isn't useful
  // for them — they only have one record (their own).
  if (me?.role === 'patient') {
    return <Navigate to={`/patients/${me.sub}`} replace />;
  }

  const isImpersonatedClinician = me?.role === 'clinician' && me?.impersonated;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2">
          <h1>Patients</h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            {isImpersonatedClinician
              ? "Patients who've granted you access. The consent gate filters this list — patients without consent for you don't appear."
              : 'Search the longitudinal record. Click a patient to see the synthesized brief.'}
          </p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or ABHA id..."
          className="input w-96"
        />
      </div>

      {isLoading && (
        <div className="panel p-12 text-center text-slate-400">Loading patients…</div>
      )}
      {error && (
        <div className="panel p-12 text-center text-clinical-danger">Failed to load: {error.message}</div>
      )}
      {data && data.items.length === 0 && (
        <div className="panel p-16 text-center">
          {isImpersonatedClinician ? (
            <>
              <div className="text-base text-slate-200 mb-2">No patients have granted you access yet.</div>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                Patients use their consent portal to grant providers access. Switch to a patient identity (top right)
                to grant yourself access for the demo.
              </p>
            </>
          ) : (
            <>
              <div className="text-base text-slate-200 mb-2">No patients yet.</div>
              <p className="text-sm text-slate-400">
                Run <code className="text-clinical-accent font-mono">npm run seed</code> to load demo data.
              </p>
            </>
          )}
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.items.map((p) => (
            <Link
              key={p._id}
              to={`/patients/${p._id}`}
              className="panel p-6 transition hover:border-clinical-accent/50 hover:shadow-clinical-accent/10 hover:shadow-lg group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold text-slate-100 group-hover:text-clinical-accent transition truncate">
                    {displayName(p)}
                  </div>
                  <div className="text-sm text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{ageFromBirth(p.birthDate) ?? '—'} yrs</span>
                    <span className="capitalize">{p.gender ?? '—'}</span>
                  </div>
                </div>
                <span className="text-clinical-accent opacity-0 group-hover:opacity-100 transition">→</span>
              </div>
              <div className="mt-4 pt-3 border-t border-clinical-border/60 flex items-center justify-between text-xs">
                <span className="font-mono text-slate-500 truncate">{p.identifier?.[0]?.value ?? '—'}</span>
                <span className="text-slate-500">Updated {fmtDate(p.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
