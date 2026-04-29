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
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Patients</h1>
          <p className="text-sm text-slate-400">
            {isImpersonatedClinician
              ? "Patients who've granted you access. The consent gate filters this list — patients without consent for you don't appear."
              : 'Search the longitudinal record. Click a patient to see the synthesized brief.'}
          </p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or ABHA id..."
          className="w-80 rounded-lg border border-clinical-border bg-clinical-panel px-3 py-2 text-sm focus:border-clinical-accent focus:outline-none"
        />
      </div>

      <div className="panel overflow-hidden">
        {isLoading && <div className="p-8 text-center text-slate-400">Loading…</div>}
        {error && <div className="p-8 text-center text-clinical-danger">Failed to load: {error.message}</div>}
        {data && data.items.length === 0 && (
          <div className="p-8 text-center text-slate-400">
            {isImpersonatedClinician ? (
              <>
                No patients have granted you access yet.
                <p className="text-xs text-slate-500 mt-2">
                  Patients use their consent portal to grant providers access. Switch to a patient identity (top right)
                  to grant yourself access for the demo.
                </p>
              </>
            ) : (
              <>No patients yet. Run <code className="text-clinical-accent">npm run seed</code> to load demo data.</>
            )}
          </div>
        )}
        {data && data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-clinical-panel border-b border-clinical-border text-left">
              <tr className="text-slate-400">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Age</th>
                <th className="px-4 py-2 font-medium">Gender</th>
                <th className="px-4 py-2 font-medium">ABHA / ID</th>
                <th className="px-4 py-2 font-medium">Last update</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr
                  key={p._id}
                  className="border-b border-clinical-border/60 hover:bg-clinical-accent/5"
                >
                  <td className="px-4 py-3">
                    <Link to={`/patients/${p._id}`} className="font-medium text-clinical-accent hover:underline">
                      {displayName(p)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{ageFromBirth(p.birthDate) ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-300 capitalize">{p.gender ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {p.identifier?.[0]?.value ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{fmtDate(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
