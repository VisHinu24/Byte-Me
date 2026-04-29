import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useMe } from '../hooks/useMe.js';
import { ageFromBirth, displayName, fmtDate } from '../lib/format.js';
import { ClinicalView } from '../components/ClinicalView.jsx';
import { ConsentPanel } from '../components/ConsentPanel.jsx';
import { AuditLogPanel } from '../components/AuditLogPanel.jsx';
import { MemoryPanel } from '../components/MemoryPanel.jsx';
import { IngestPanel } from '../components/IngestPanel.jsx';

const ALL_TABS = [
  { key: 'clinical', label: 'Clinical record & brief', roles: ['patient', 'clinician'] },
  { key: 'memory', label: 'Memory', roles: ['patient'] }, // patient-only — doctors don't curate memory
  { key: 'ingest', label: 'Ingest', roles: ['patient', 'clinician'] },
  { key: 'consent', label: 'Consent', roles: ['patient'] }, // patient-only
  { key: 'audit', label: 'Audit log', roles: ['patient', 'clinician'] },
];

export function PatientDetailPage() {
  const { id } = useParams();
  const [tab, setTab] = useState('clinical');
  const { data: me } = useMe();

  const tabs = useMemo(
    () => ALL_TABS.filter((t) => !me?.role || t.roles.includes(me.role)),
    [me?.role]
  );

  // If the active tab isn't allowed for this role, fall back to clinical.
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'clinical';

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ['summary', id],
    queryFn: () => api.getSummary(id),
  });

  if (isLoading) return <div className="text-slate-400">Loading patient…</div>;
  if (error) {
    const isDenied = /consent/i.test(error.message);
    return (
      <div className="space-y-4">
        <Link to="/patients" className="text-sm text-slate-400 hover:text-clinical-accent">← Patients</Link>
        <div className={`panel p-6 ${isDenied ? 'border-clinical-warn/40' : 'border-clinical-danger/40'}`}>
          <h2 className="text-lg font-semibold mb-1">
            {isDenied ? 'Consent required' : 'Failed to load'}
          </h2>
          <p className="text-sm text-slate-400">{error.message}</p>
          {isDenied && (
            <p className="text-xs text-slate-500 mt-3">
              The current identity has no active consent for this patient. Switch to the patient (top right)
              and grant access via the Consent tab, or switch back to the default clinician for dev bypass.
            </p>
          )}
        </div>
      </div>
    );
  }
  if (!summary) return null;

  const { patient, counts } = summary;

  const isOwnRecord = me?.role === 'patient' && me?.sub === patient._id;

  return (
    <div className="space-y-5">
      {!isOwnRecord && (
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <Link to="/patients" className="hover:text-clinical-accent">← Patients</Link>
        </div>
      )}

      <header className="panel p-5 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold">{displayName(patient)}</h1>
          <div className="text-sm text-slate-400 mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span>{ageFromBirth(patient.birthDate)} yrs</span>
            <span className="capitalize">{patient.gender}</span>
            <span>DOB {fmtDate(patient.birthDate)}</span>
            <span className="font-mono text-xs">{patient.identifier?.[0]?.value}</span>
          </div>
          {patient.address?.[0] && (
            <div className="text-xs text-slate-500 mt-1">
              {[patient.address[0].city, patient.address[0].state, patient.address[0].country].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className="text-xs text-slate-500">{counts.encounters} encounters · last update {fmtDate(patient.updatedAt)}</span>
          <button
            onClick={() => navigator.clipboard?.writeText(patient._id)}
            className="text-xs text-slate-500 hover:text-clinical-accent font-mono"
            title="Copy patient ObjectId (for impersonation)"
          >
            id: {patient._id.slice(0, 8)}…
          </button>
        </div>
      </header>

      <div className="border-b border-clinical-border flex items-center gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
              activeTab === t.key
                ? 'border-clinical-accent text-clinical-accent'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'clinical' && <ClinicalView summary={summary} />}
      {activeTab === 'memory' && <MemoryPanel patientId={patient._id} />}
      {activeTab === 'ingest' && <IngestPanel patientId={patient._id} />}
      {activeTab === 'consent' && <ConsentPanel patientId={patient._id} />}
      {activeTab === 'audit' && <AuditLogPanel patientId={patient._id} />}
    </div>
  );
}
