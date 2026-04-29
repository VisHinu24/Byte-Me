import { fmtDate, fmtRelative, textOf } from '../lib/format.js';
import { LabTrendChart } from './LabTrendChart.jsx';
import { BriefPanel } from './BriefPanel.jsx';

export function ClinicalView({ summary }) {
  const { patient, counts, activeConditions, activeMedications, recentEncounters, allergies, labTrends } = summary;

  return (
    <div className="space-y-6">
      <BriefPanel patientId={patient._id} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Encounters" value={counts.encounters} />
        <Stat label="Conditions" value={counts.conditions} />
        <Stat label="Medications" value={counts.medications} />
        <Stat label="Observations" value={counts.observations} />
        <Stat label="Allergies" value={counts.allergies} accent={counts.allergies > 0 ? 'danger' : null} />
      </div>

      {allergies.length > 0 && (
        <Section title="Allergies & intolerances" tone="danger">
          <ul className="space-y-3">
            {allergies.map((a) => (
              <li key={a._id} className="flex items-start justify-between gap-3 pb-3 border-b border-clinical-border/50 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-100">{textOf(a.code)}</div>
                  <div className="text-sm text-slate-400 mt-0.5">
                    {a.reaction?.[0]?.manifestation?.map(textOf).filter(Boolean).join(', ')}
                    {a.reaction?.[0]?.severity ? ` · ${a.reaction[0].severity}` : ''}
                  </div>
                </div>
                <span className={`pill shrink-0 ${a.criticality === 'high' ? 'border-clinical-danger/40 text-clinical-danger' : 'border-clinical-warn/40 text-clinical-warn'}`}>
                  {a.criticality ?? 'unknown'}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Active conditions">
          {activeConditions.length === 0 ? (
            <Empty>No active conditions</Empty>
          ) : (
            <ul className="space-y-3">
              {activeConditions.map((c) => (
                <li key={c._id} className="flex items-start justify-between gap-3 pb-3 border-b border-clinical-border/50 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100">{textOf(c.code)}</div>
                    <div className="text-sm text-slate-400 mt-0.5">
                      Onset {fmtDate(c.onsetDateTime)}
                      {c.severity ? ` · ${textOf(c.severity)}` : ''}
                    </div>
                  </div>
                  <span className="pill shrink-0 border-clinical-accent/40 text-clinical-accent">{textOf(c.clinicalStatus)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Active medications">
          {activeMedications.length === 0 ? (
            <Empty>No active medications</Empty>
          ) : (
            <ul className="space-y-3">
              {activeMedications.map((m) => (
                <li key={m._id} className="pb-3 border-b border-clinical-border/50 last:border-0 last:pb-0">
                  <div className="font-semibold text-slate-100">{textOf(m.medicationCodeableConcept)}</div>
                  <div className="text-sm text-slate-400 mt-0.5">
                    {m.dosageInstruction?.[0]?.text ?? ''}
                    {m.authoredOn ? <span className="text-slate-500"> · started {fmtRelative(m.authoredOn)}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {labTrends.length > 0 && (
        <Section title="Lab trends">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {labTrends.slice(0, 4).map((trend) => (
              <LabTrendChart key={trend.code} trend={trend} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Recent encounters">
        {recentEncounters.length === 0 ? (
          <Empty>No encounters recorded</Empty>
        ) : (
          <ul className="space-y-3">
            {recentEncounters.map((e) => (
              <li key={e._id} className="flex items-start justify-between gap-3 pb-3 border-b border-clinical-border/50 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-100">
                    {e.type?.[0]?.text ?? e.class?.display ?? 'Encounter'}
                  </div>
                  <div className="text-sm text-slate-400 mt-0.5">
                    {fmtDate(e.period?.start)}
                    {e.reasonCode?.[0]?.text ? <span> · {e.reasonCode[0].text}</span> : null}
                  </div>
                </div>
                <span className="pill shrink-0 border-clinical-border text-slate-400 capitalize">{e.class?.display ?? e.class?.code}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, tone, children }) {
  const toneClass = tone === 'danger' ? 'border-clinical-danger/30' : '';
  return (
    <section className={`panel p-6 space-y-4 ${toneClass}`}>
      <h3 className="section-heading">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, accent }) {
  const valueClass = accent === 'danger' ? 'text-clinical-danger' : 'text-slate-100';
  return (
    <div className="panel p-5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500 font-semibold">{label}</div>
      <div className={`text-3xl font-semibold mt-2 ${valueClass}`}>{value}</div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="text-sm text-slate-500 italic">{children}</div>;
}
