import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const ROUTE_OPTIONS = ['oral', 'IV', 'IM', 'topical', 'inhaled', 'other'];

const emptyRow = () => ({
  name: '',
  dosage: '',
  frequency: '',
  duration: '',
  route: '',
  instructions: '',
  reason: '',
});

const inputClass =
  'w-full rounded-xl border border-clinical-border bg-clinical-bg/40 px-4 py-3 text-sm focus:border-clinical-accent focus:outline-none focus:ring-2 focus:ring-clinical-accent/20';

export function PrescribePanel({ patientId }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState([emptyRow()]);
  const [notes, setNotes] = useState('');
  const [success, setSuccess] = useState(null);

  const prescribe = useMutation({
    mutationFn: (body) => api.prescribe(patientId, body),
    onSuccess: (res) => {
      setRows([emptyRow()]);
      setNotes('');
      setSuccess(`Prescribed ${res.created} medication${res.created === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['summary', patientId] });
      qc.invalidateQueries({ queryKey: ['audit', patientId] });
    },
  });

  const updateRow = (i, field, value) => {
    setSuccess(null);
    prescribe.reset?.();
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };
  const addRow = () => {
    setSuccess(null);
    setRows((rs) => [...rs, emptyRow()]);
  };
  const removeRow = (i) => {
    if (rows.length === 1) return;
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };

  const submit = () => {
    setSuccess(null);
    const cleaned = rows
      .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v && String(v).trim())))
      .filter((r) => r.name);
    if (!cleaned.length) return;
    const body = { medications: cleaned };
    if (notes.trim()) body.notes = notes.trim();
    prescribe.mutate(body);
  };

  const loading = prescribe.isPending;
  const error = prescribe.error;
  const canSubmit = rows.some((r) => r.name.trim()) && !loading;

  return (
    <div className="space-y-6">
      <header className="panel p-7 space-y-2 max-w-3xl">
        <h2>Author a prescription</h2>
        <p className="text-sm text-slate-400">
          Compose one or more medication orders for this patient. Each row becomes a `MedicationRequest`
          with provenance `manual-prescription` and your identity as the requester.
        </p>
      </header>

      <div className="panel p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="section-heading">Medications</span>
          <button onClick={addRow} className="btn text-xs">+ Add medication</button>
        </div>

        <div className="space-y-4">
          {rows.map((row, i) => (
            <MedicationRow
              key={i}
              row={row}
              index={i}
              canRemove={rows.length > 1}
              onChange={(field, value) => updateRow(i, field, value)}
              onRemove={() => removeRow(i)}
            />
          ))}
        </div>
      </div>

      <div className="panel p-6 space-y-3">
        <span className="section-heading">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSuccess(null);
            prescribe.reset?.();
          }}
          placeholder="Free-text notes for this prescription batch (e.g. follow-up plan, monitoring instructions)"
          rows={4}
          className={inputClass}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-clinical-danger/40 bg-clinical-danger/10 p-3 text-sm text-clinical-danger">
          {error.message}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-clinical-ok/40 bg-clinical-ok/10 p-3 text-sm text-clinical-ok">
          {success}. The medications now appear in this patient's clinical record.
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <span className="text-xs text-slate-500">
          {rows.length} medication{rows.length === 1 ? '' : 's'} ready to prescribe
        </span>
        <button onClick={submit} disabled={!canSubmit} className="btn-primary btn-lg">
          {loading ? 'Prescribing…' : 'Prescribe →'}
        </button>
      </div>
    </div>
  );
}

function MedicationRow({ row, index, canRemove, onChange, onRemove }) {
  return (
    <div className="rounded-xl border border-clinical-border bg-clinical-bg/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-clinical-accent font-medium">Medication {index + 1}</span>
        <button
          onClick={onRemove}
          disabled={!canRemove}
          title={canRemove ? 'Remove medication' : 'At least one medication is required'}
          className="text-slate-500 hover:text-clinical-danger disabled:opacity-30 disabled:hover:text-slate-500 transition text-sm"
        >
          🗑
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Name *">
          <input
            value={row.name}
            onChange={(e) => onChange('name', e.target.value)}
            placeholder="e.g. Amoxicillin"
            className={inputClass}
          />
        </Field>
        <Field label="Dosage">
          <input
            value={row.dosage}
            onChange={(e) => onChange('dosage', e.target.value)}
            placeholder="e.g. 500mg"
            className={inputClass}
          />
        </Field>
        <Field label="Frequency">
          <input
            value={row.frequency}
            onChange={(e) => onChange('frequency', e.target.value)}
            placeholder="e.g. twice daily"
            className={inputClass}
          />
        </Field>
        <Field label="Duration">
          <input
            value={row.duration}
            onChange={(e) => onChange('duration', e.target.value)}
            placeholder="e.g. 7 days"
            className={inputClass}
          />
        </Field>
        <Field label="Route">
          <select
            value={row.route}
            onChange={(e) => onChange('route', e.target.value)}
            className={inputClass}
          >
            <option value="">— select route —</option>
            {ROUTE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Reason">
          <input
            value={row.reason}
            onChange={(e) => onChange('reason', e.target.value)}
            placeholder="e.g. acute bacterial sinusitis"
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Instructions">
        <input
          value={row.instructions}
          onChange={(e) => onChange('instructions', e.target.value)}
          placeholder="e.g. take with food"
          className={inputClass}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}
