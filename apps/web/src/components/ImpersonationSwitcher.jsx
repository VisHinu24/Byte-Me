import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getImpersonation, setImpersonation } from '../lib/api.js';
import { DEMO_PROVIDERS } from '../lib/providers.js';
import { ageFromBirth } from '../lib/format.js';

/**
 * Demo-only role switcher. Sets the X-Dev-User header used by the dev-mode
 * auth middleware so a hackathon judge can see the consent gate behave
 * differently per requester without a real login flow.
 *
 * Header shape: "role:id:displayName"
 *   role = clinician | patient | admin
 *   id   = matches Practitioner reference or Patient ObjectId
 */
export function ImpersonationSwitcher() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const current = parse(getImpersonation());

  // Always-on list of patients to impersonate as. Uses the demo-only endpoint
  // so it works regardless of current identity (the regular /api/Patient
  // would be filtered when impersonating a doctor without consent).
  const { data: patientsData } = useQuery({
    queryKey: ['demo-patients'],
    queryFn: api.demoListPatients,
    enabled: open,
    staleTime: 60_000,
  });
  const patients = patientsData?.items ?? [];

  const apply = (value) => {
    setImpersonation(value);
    qc.invalidateQueries();
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn text-xs"
        title="Switch demo identity"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${current ? roleDotColor(current.role) : 'bg-clinical-accent'}`} />
        {current?.label ?? 'Default clinician'}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setOpen(false)}
        />
      )}

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 panel z-20 p-2 shadow-xl max-h-[80vh] overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 px-2 pb-1">Switch identity (demo)</div>

          <button
            onClick={() => apply(null)}
            className={`w-full text-left px-2 py-1.5 rounded text-sm ${!current ? 'bg-clinical-accent/10' : 'hover:bg-clinical-accent/5'}`}
          >
            <div className="font-medium">Default clinician</div>
            <div className="text-xs text-slate-400">Dr. Demo · sees all (dev bypass)</div>
          </button>

          <div className="text-[10px] uppercase tracking-wide text-slate-500 px-2 pt-3 pb-1">
            Clinicians <span className="text-slate-600">· consent-gated</span>
          </div>
          {DEMO_PROVIDERS.map((p) => {
            const refId = p.ref.split('/')[1];
            const value = `clinician:${refId}:${p.name}`;
            const active = current?.value === value;
            return (
              <button
                key={p.ref}
                onClick={() => apply(value)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm ${active ? 'bg-clinical-accent/10 text-clinical-accent' : 'hover:bg-clinical-accent/5'}`}
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-slate-400">{p.specialty} · {p.org}</div>
              </button>
            );
          })}

          <div className="text-[10px] uppercase tracking-wide text-slate-500 px-2 pt-3 pb-1">
            Patients <span className="text-slate-600">· own record only</span>
          </div>
          {patients.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-slate-500 italic">
              No patients yet. Run <code className="text-clinical-accent">npm run seed</code>.
            </div>
          )}
          {patients.map((p) => {
            const value = `patient:${p._id}:${p.displayName}`;
            const active = current?.value === value;
            const age = ageFromBirth(p.birthDate);
            return (
              <button
                key={p._id}
                onClick={() => apply(value)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm ${active ? 'bg-clinical-accent/10 text-clinical-accent' : 'hover:bg-clinical-accent/5'}`}
              >
                <div className="font-medium">{p.displayName}</div>
                <div className="text-xs text-slate-400">
                  {age != null ? `${age} yrs` : ''}{p.gender ? ` · ${p.gender}` : ''}
                </div>
              </button>
            );
          })}

          <div className="text-[10px] uppercase tracking-wide text-slate-500 px-2 pt-3 pb-1">Custom</div>
          <CustomPatientImpersonator current={current} apply={apply} />

          <div className="border-t border-clinical-border mt-2 pt-2 px-2 text-[10px] text-slate-500 leading-relaxed">
            Switching identity reroutes API calls under that user. Patients land on their own chart;
            doctors see only patients who granted them access.
          </div>
        </div>
      )}
    </div>
  );
}

function CustomPatientImpersonator({ current, apply }) {
  const [pid, setPid] = useState('');
  return (
    <div className="px-2">
      <div className="flex gap-1">
        <input
          value={pid}
          onChange={(e) => setPid(e.target.value)}
          placeholder="Patient ObjectId"
          className="flex-1 rounded border border-clinical-border bg-clinical-bg px-2 py-1 text-xs font-mono"
        />
        <button
          disabled={!pid.trim()}
          onClick={() => apply(`patient:${pid.trim()}:Custom Patient`)}
          className="btn text-xs px-2 py-1"
        >
          Use
        </button>
      </div>
      {current?.role === 'patient' && current?.name === 'Custom Patient' && (
        <div className="text-xs text-slate-400 mt-1 truncate">→ {current.id}</div>
      )}
    </div>
  );
}

function parse(value) {
  if (!value) return null;
  const [role, id, name] = value.split(':');
  return { role, id, name, value, label: name ?? `${role}:${id}` };
}

function roleDotColor(role) {
  if (role === 'patient') return 'bg-clinical-ok';
  if (role === 'clinician') return 'bg-clinical-warn';
  return 'bg-clinical-accent';
}
