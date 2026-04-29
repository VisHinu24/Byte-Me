import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtDate, fmtRelative, textOf } from '../lib/format.js';

/**
 * Provenance modal — opens when the clinician clicks a [cite:Type/id] pin in
 * the brief. Fetches the source FHIR resource and renders it with type-aware
 * formatting + raw JSON for the auditable trail.
 */
export function ProvenanceModal({ resourceType, resourceId, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['resource', resourceType, resourceId],
    queryFn: () => api.getResource(resourceType, resourceId),
    enabled: !!resourceType && !!resourceId,
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-3xl mt-8 mb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between p-5 border-b border-clinical-border">
          <div>
            <div className="text-xs uppercase tracking-wide text-clinical-accent">Provenance · {resourceType}</div>
            <div className="font-mono text-xs text-slate-500 mt-1">{resourceType}/{resourceId}</div>
          </div>
          <button onClick={onClose} className="btn text-xs" aria-label="Close">Close ✕</button>
        </header>

        <div className="p-5 space-y-4">
          {isLoading && <div className="text-slate-400">Loading source resource…</div>}
          {error && <ErrorView error={error} />}
          {data && <ResourceRenderer resource={data} />}
        </div>
      </div>
    </div>
  );
}

function ErrorView({ error }) {
  const isDenied = /consent/i.test(error.message);
  return (
    <div className={`rounded-lg border p-4 ${isDenied ? 'border-clinical-warn/40 bg-clinical-warn/5' : 'border-clinical-danger/40 bg-clinical-danger/5'}`}>
      <div className="font-medium mb-1">{isDenied ? 'Consent required' : 'Failed to load'}</div>
      <div className="text-sm text-slate-300">{error.message}</div>
      {isDenied && (
        <p className="text-xs text-slate-400 mt-2">
          The current identity does not have consent to read this resource type. Audit log records this denial.
        </p>
      )}
    </div>
  );
}

function ResourceRenderer({ resource }) {
  const Renderer = RENDERERS[resource.resourceType] ?? GenericRenderer;
  return (
    <>
      <Renderer resource={resource} />
      <Provenance resource={resource} />
      <RawJson resource={resource} />
    </>
  );
}

// ---------- Type-specific views ----------

function ConditionView({ resource: r }) {
  return (
    <Section title="Condition">
      <Field label="Diagnosis" value={textOf(r.code)} mono="snomed" code={r.code?.coding?.[0]} />
      <Field label="Status" value={textOf(r.clinicalStatus) ?? '—'} />
      <Field label="Verification" value={textOf(r.verificationStatus) ?? '—'} />
      <Field label="Severity" value={textOf(r.severity) ?? '—'} />
      <Field label="Onset" value={fmtDate(r.onsetDateTime)} />
      <Field label="Recorded" value={fmtDate(r.recordedDate)} />
      {r.abatementDateTime && <Field label="Abatement" value={fmtDate(r.abatementDateTime)} />}
    </Section>
  );
}

function MedicationRequestView({ resource: r }) {
  return (
    <Section title="Medication Request">
      <Field label="Medication" value={textOf(r.medicationCodeableConcept)} mono="rxnorm" code={r.medicationCodeableConcept?.coding?.[0]} />
      <Field label="Status" value={r.status ?? '—'} />
      <Field label="Intent" value={r.intent ?? '—'} />
      <Field label="Authored on" value={fmtDate(r.authoredOn)} />
      {r.dosageInstruction?.[0]?.text && (
        <Field label="Dosage" value={r.dosageInstruction[0].text} />
      )}
      {r.dispenseRequest?.quantity && (
        <Field label="Dispense" value={`${r.dispenseRequest.quantity.value} ${r.dispenseRequest.quantity.unit ?? ''}`} />
      )}
    </Section>
  );
}

function ObservationView({ resource: r }) {
  const v = r.valueQuantity;
  return (
    <Section title="Observation">
      <Field label="Code" value={textOf(r.code)} mono="loinc" code={r.code?.coding?.[0]} />
      <Field label="Status" value={r.status ?? '—'} />
      <Field
        label="Value"
        value={v ? `${v.value} ${v.unit ?? ''}` : (r.valueString ?? textOf(r.valueCodeableConcept) ?? '—')}
      />
      {r.interpretation?.[0] && (
        <Field label="Interpretation" value={textOf(r.interpretation[0])} />
      )}
      <Field label="Effective" value={fmtDate(r.effectiveDateTime)} />
      {r.referenceRange?.[0] && (
        <Field
          label="Reference range"
          value={`${r.referenceRange[0].low?.value ?? '—'} – ${r.referenceRange[0].high?.value ?? '—'} ${r.referenceRange[0].low?.unit ?? r.referenceRange[0].high?.unit ?? ''}`}
        />
      )}
    </Section>
  );
}

function AllergyIntoleranceView({ resource: r }) {
  return (
    <Section title="Allergy / Intolerance">
      <Field label="Substance" value={textOf(r.code)} mono="snomed" code={r.code?.coding?.[0]} />
      <Field label="Type" value={r.type ?? '—'} />
      <Field label="Category" value={r.category?.join(', ') ?? '—'} />
      <Field label="Criticality" value={r.criticality ?? '—'} />
      <Field label="Recorded" value={fmtDate(r.recordedDate)} />
      {r.reaction?.[0] && (
        <Field
          label="Reaction"
          value={`${r.reaction[0].manifestation?.map(textOf).filter(Boolean).join(', ') ?? '—'}${r.reaction[0].severity ? ` (${r.reaction[0].severity})` : ''}`}
        />
      )}
    </Section>
  );
}

function EncounterView({ resource: r }) {
  return (
    <Section title="Encounter">
      <Field label="Type" value={r.type?.[0]?.text ?? r.class?.display ?? '—'} />
      <Field label="Class" value={`${r.class?.display ?? r.class?.code ?? '—'}`} />
      <Field label="Status" value={r.status ?? '—'} />
      <Field label="Period" value={`${fmtDate(r.period?.start)} – ${fmtDate(r.period?.end)}`} />
      <Field label="Reason" value={r.reasonCode?.[0]?.text ?? '—'} />
    </Section>
  );
}

function PatientView({ resource: r }) {
  const name = r.name?.[0];
  return (
    <Section title="Patient">
      <Field label="Name" value={name?.text ?? [...(name?.given ?? []), name?.family].filter(Boolean).join(' ')} />
      <Field label="Gender" value={r.gender ?? '—'} />
      <Field label="DOB" value={fmtDate(r.birthDate)} />
      {r.identifier?.map((i, idx) => (
        <Field key={idx} label={i.system?.split('/').pop() ?? 'identifier'} value={i.value} mono />
      ))}
    </Section>
  );
}

function DerivedMemoryView({ resource: r }) {
  return (
    <>
      <Section title="Derived memory">
        <Field label="Kind" value={r.kind} />
        <Field label="Confidence" value={r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : '—'} />
        <Field label="Created" value={fmtDate(r.createdAt)} />
        <Field label="By" value={`${r.createdBy?.kind ?? 'agent'}${r.createdBy?.modelHint ? ` · ${r.createdBy.modelHint}` : ''}`} />
        {(r.timeWindow?.start || r.timeWindow?.end) && (
          <Field label="Time window" value={`${fmtDate(r.timeWindow.start)} – ${fmtDate(r.timeWindow.end)}`} />
        )}
        <Field label="Status" value={r.status ?? '—'} />
      </Section>

      <section className="space-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Memory content</h3>
        <div className="rounded-lg border border-clinical-border bg-clinical-bg/40 p-3">
          <div className="font-medium">{r.title}</div>
          <p className="text-sm text-slate-300 mt-1">{r.summary}</p>
          {r.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {r.tags.map((t) => (
                <span key={t} className="pill border-clinical-border text-slate-400">{t}</span>
              ))}
            </div>
          )}
        </div>
      </section>

      {r.sources?.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Sources</h3>
          <ul className="space-y-1 text-sm">
            {r.sources.map((s, i) => (
              <li key={i} className="font-mono text-xs text-slate-400">
                {s.resourceType}/{s.id}{s.role ? ` · ${s.role}` : ''}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            Open the brief to view these sources interactively, or use the cite pins on the brief itself.
          </p>
        </section>
      )}
    </>
  );
}

function GenericRenderer({ resource }) {
  return (
    <Section title={resource.resourceType ?? 'Resource'}>
      <div className="text-sm text-slate-400">No specialized renderer for this type. See raw JSON below.</div>
    </Section>
  );
}

const RENDERERS = {
  Condition: ConditionView,
  MedicationRequest: MedicationRequestView,
  Observation: ObservationView,
  AllergyIntolerance: AllergyIntoleranceView,
  Encounter: EncounterView,
  Patient: PatientView,
  DerivedMemory: DerivedMemoryView,
};

// ---------- Bits ----------

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">{children}</div>
    </section>
  );
}

function Field({ label, value, mono, code }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={mono ? 'font-mono text-sm' : 'text-sm'}>
        {value ?? '—'}
        {code?.system && code?.code && (
          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
            {systemShort(code.system)}:{code.code}
          </div>
        )}
      </div>
    </div>
  );
}

function Provenance({ resource: r }) {
  const p = r.provenance?.[0];
  if (!p) return null;
  return (
    <section className="rounded-lg border border-clinical-border bg-clinical-bg/40 p-3 space-y-1.5">
      <h3 className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Source provenance</h3>
      <div className="text-xs text-slate-300 grid grid-cols-2 gap-x-6 gap-y-1 font-mono">
        <span>format: {p.sourceFormat ?? '—'}</span>
        <span>system: {p.sourceSystem ?? '—'}</span>
        <span>ingested: {fmtRelative(p.ingestedAt)}</span>
        {p.sourceDocumentId && <span>source-id: {p.sourceDocumentId}</span>}
      </div>
    </section>
  );
}

function RawJson({ resource }) {
  return (
    <details className="rounded-lg border border-clinical-border bg-clinical-bg/30">
      <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 hover:text-clinical-accent">
        Raw FHIR JSON
      </summary>
      <pre className="px-3 py-2 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed border-t border-clinical-border max-h-96">
        {JSON.stringify(resource, null, 2)}
      </pre>
    </details>
  );
}

function systemShort(s) {
  if (!s) return '';
  if (s.includes('snomed')) return 'SNOMED CT';
  if (s.includes('loinc')) return 'LOINC';
  if (s.includes('rxnorm')) return 'RxNorm';
  if (s.includes('icd-10')) return 'ICD-10';
  return s.split('/').pop();
}
