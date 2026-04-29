import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { SAMPLE_HL7V2, SAMPLE_HL7V2_ADT, SAMPLE_CCDA } from '../lib/samples.js';
import { fmtDate } from '../lib/format.js';

const FORMAT_TABS = [
  { key: 'hl7v2', label: 'HL7 v2', desc: 'Pipe-delimited messages (ORU lab, ADT admit/discharge)' },
  { key: 'ccda', label: 'C-CDA XML', desc: 'Continuity of care document' },
];

export function IngestPanel({ patientId }) {
  const qc = useQueryClient();
  const [format, setFormat] = useState('hl7v2');
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);

  const ingestText = useMutation({
    mutationFn: ({ format, content }) => api.ingestText(patientId, format, content),
    onSuccess: (res) => {
      setResult(res);
      invalidatePatientCaches(qc, patientId);
    },
    onError: () => setResult(null),
  });

  const handleFormat = (key) => {
    setFormat(key);
    setText('');
    setResult(null);
    ingestText.reset?.();
  };

  const submitText = () => {
    if (!text.trim()) return;
    setResult(null);
    ingestText.mutate({ format, content: text });
  };

  const loading = ingestText.isPending;
  const error = ingestText.error;

  return (
    <div className="space-y-6">
      <header className="panel p-7 space-y-2 max-w-3xl">
        <h2>Ingest non-FHIR sources</h2>
        <p className="text-sm text-slate-400">
          Bring data from systems that don't speak FHIR. Each source gets parsed, normalized to FHIR R4, tagged with provenance, and merged into this patient's record.
        </p>
      </header>

      <div className="space-y-3">
        <div className="tab-strip">
          {FORMAT_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => handleFormat(t.key)}
              className={`tab-pill ${format === t.key ? 'tab-pill-active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 px-1">{FORMAT_TABS.find((t) => t.key === format)?.desc}</p>
      </div>

      {format === 'hl7v2' && (
        <TextIngest
          format="HL7 v2"
          mono
          placeholder="Paste an HL7v2 message (MSH|^~\\&|... )"
          text={text}
          onTextChange={setText}
          samples={[
            { label: 'Load lab result (ORU^R01)', value: SAMPLE_HL7V2 },
            { label: 'Load admission (ADT^A01)', value: SAMPLE_HL7V2_ADT },
          ]}
          onSubmit={submitText}
          loading={loading}
        />
      )}

      {format === 'ccda' && (
        <TextIngest
          format="C-CDA XML"
          mono
          placeholder="Paste a CCDA XML document..."
          text={text}
          onTextChange={setText}
          samples={[{ label: 'Load discharge summary', value: SAMPLE_CCDA }]}
          onSubmit={submitText}
          loading={loading}
        />
      )}

      {error && (
        <div className="rounded-lg border border-clinical-danger/40 bg-clinical-danger/10 p-3 text-sm text-clinical-danger">
          {error.message}
        </div>
      )}

      {result && <IngestResult result={result} />}
    </div>
  );
}

function TextIngest({ format, mono, placeholder, text, onTextChange, samples, onSubmit, loading }) {
  return (
    <div className="panel p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="section-heading">{format} payload</span>
        <div className="flex gap-2">
          {samples?.map((s) => (
            <button key={s.label} onClick={() => onTextChange(s.value)} className="btn text-xs">
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder={placeholder}
        rows={16}
        className={`w-full rounded-xl border border-clinical-border bg-clinical-bg/40 px-4 py-3 text-sm focus:border-clinical-accent focus:outline-none focus:ring-2 focus:ring-clinical-accent/20 ${mono ? 'font-mono text-xs leading-relaxed' : ''}`}
      />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <span className="text-xs text-slate-500">{text.length.toLocaleString()} characters</span>
        <button
          onClick={onSubmit}
          disabled={!text.trim() || loading}
          className="btn-primary btn-lg"
        >
          {loading ? 'Ingesting…' : 'Parse & ingest →'}
        </button>
      </div>
    </div>
  );
}

function IngestResult({ result }) {
  return (
    <section className="panel p-6 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-1">
          <h3 className="section-heading">Ingestion result</h3>
          <p className="text-xs text-slate-500 font-mono">
            format: {result.format} {result.sourceMeta?.messageType ? `· ${result.sourceMeta.messageType}` : ''}
            {result.sourceMeta?.title ? ` · ${result.sourceMeta.title}` : ''}
            {result.sourceMeta?.filename ? ` · ${result.sourceMeta.filename}` : ''}
          </p>
        </div>
        <span className="pill border-clinical-ok/40 text-clinical-ok">{totalCount(result.counts)} resources inserted</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        {Object.entries(result.counts ?? {}).map(([type, n]) => (
          n > 0 && (
            <div key={type} className="rounded-md border border-clinical-border bg-clinical-bg/40 p-2">
              <div className="text-xs text-slate-400">{type}</div>
              <div className="text-lg font-semibold text-clinical-accent">{n}</div>
            </div>
          )
        ))}
      </div>

      {result.preview && Object.keys(result.preview).length > 0 && (
        <details className="rounded-lg border border-clinical-border bg-clinical-bg/30" open>
          <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 hover:text-clinical-accent">
            Inserted records preview
          </summary>
          <div className="px-3 py-2 space-y-3 border-t border-clinical-border">
            {Object.entries(result.preview).map(([type, items]) => (
              <div key={type}>
                <div className="text-xs text-clinical-accent font-medium mb-1">{type}</div>
                <ul className="text-xs space-y-0.5">
                  {items.map((item, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span>{item.label}</span>
                      <span className="text-slate-500 text-[10px] font-mono">{fmtDate(item.at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}


      <p className="text-xs text-slate-500 italic">
        These records are now part of the patient's longitudinal record. Re-run distillation in the Memory tab to incorporate them.
      </p>
    </section>
  );
}

function totalCount(counts = {}) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function invalidatePatientCaches(qc, patientId) {
  qc.invalidateQueries({ queryKey: ['summary', patientId] });
  qc.invalidateQueries({ queryKey: ['memories', patientId] });
  qc.invalidateQueries({ queryKey: ['audit', patientId] });
}
