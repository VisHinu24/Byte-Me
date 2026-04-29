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
    <div className="space-y-6">
      {!isOwnRecord && (
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <Link to="/patients" className="hover:text-clinical-accent transition">← Patients</Link>
        </div>
      )}

      <header className="panel p-7 flex items-start justify-between gap-6 flex-wrap">
        <div className="space-y-3 min-w-0">
          <h1>{displayName(patient)}</h1>
          <div className="text-sm text-slate-400 flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500">Age</span>
              <span className="text-slate-200 font-medium">{ageFromBirth(patient.birthDate)}</span>
            </span>
            <span className="flex items-center gap-1.5 capitalize">
              <span className="text-slate-500">Sex</span>
              <span className="text-slate-200 font-medium">{patient.gender ?? '—'}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500">DOB</span>
              <span className="text-slate-200 font-medium">{fmtDate(patient.birthDate)}</span>
            </span>
            {patient.identifier?.[0]?.value && (
              <span className="font-mono text-xs text-slate-500 truncate">{patient.identifier[0].value}</span>
            )}
          </div>
          {patient.address?.[0] && (
            <div className="text-xs text-slate-500">
              📍 {[patient.address[0].city, patient.address[0].state, patient.address[0].country].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 text-right">
          <span className="text-xs text-slate-500">
            <span className="text-slate-300 font-medium">{counts.encounters}</span> encounters · last update {fmtDate(patient.updatedAt)}
          </span>
          <button
            onClick={() => navigator.clipboard?.writeText(patient._id)}
            className="text-xs text-slate-500 hover:text-clinical-accent font-mono transition"
            title="Copy patient ObjectId"
          >
            id: {patient._id.slice(0, 10)}…
          </button>
        </div>
      </header>

      <div className="tab-strip flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`tab-pill ${activeTab === t.key ? 'tab-pill-active' : ''}`}
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
