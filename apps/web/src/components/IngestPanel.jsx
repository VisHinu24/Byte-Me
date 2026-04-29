import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { SAMPLE_HL7V2, SAMPLE_HL7V2_ADT, SAMPLE_CCDA } from '../lib/samples.js';
import { fmtDate } from '../lib/format.js';

const FORMAT_TABS = [
  { key: 'hl7v2', label: 'HL7 v2', desc: 'Pipe-delimited messages (ORU lab, ADT admit/discharge)' },
  { key: 'ccda', label: 'C-CDA XML', desc: 'Continuity of care document' },
  { key: 'pdf', label: 'PDF / image', desc: 'Scanned prescription or report (Claude vision)' },
];

export function IngestPanel({ patientId }) {
  const qc = useQueryClient();
  const [format, setFormat] = useState('hl7v2');
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const ingestText = useMutation({
    mutationFn: ({ format, content }) => api.ingestText(patientId, format, content),
    onSuccess: (res) => {
      setResult(res);
      invalidatePatientCaches(qc, patientId);
    },
    onError: () => setResult(null),
  });

  const ingestFile = useMutation({
    mutationFn: (file) => api.ingestFile(patientId, file),
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
    ingestFile.reset?.();
  };

  const submitText = () => {
    if (!text.trim()) return;
    setResult(null);
    ingestText.mutate({ format, content: text });
  };

  const submitFile = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setResult(null);
    ingestFile.mutate(file);
  };

  const loading = ingestText.isPending || ingestFile.isPending;
  const error = ingestText.error || ingestFile.error;

  return (
    <div className="space-y-5">
      <header className="panel p-5">
        <h2 className="text-lg font-semibold">Ingest non-FHIR sources</h2>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">
          Bring data from systems that don't speak FHIR. Each source gets parsed, normalized to FHIR R4, tagged with provenance, and merged into this patient's record.
        </p>
      </header>

      <div className="flex items-center gap-2 border-b border-clinical-border">
        {FORMAT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleFormat(t.key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
              format === t.key
                ? 'border-clinical-accent text-clinical-accent'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500">{FORMAT_TABS.find((t) => t.key === format)?.desc}</p>

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

      {format === 'pdf' && (
        <PdfIngest
          fileRef={fileRef}
          onSubmit={submitFile}
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{format} payload</span>
        <div className="flex gap-1">
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
        rows={14}
        className={`w-full rounded-lg border border-clinical-border bg-clinical-bg/40 px-3 py-2 text-sm focus:border-clinical-accent focus:outline-none ${mono ? 'font-mono text-xs leading-relaxed' : ''}`}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{text.length.toLocaleString()} characters</span>
        <button
          onClick={onSubmit}
          disabled={!text.trim() || loading}
          className="btn border-clinical-accent text-clinical-accent"
        >
          {loading ? 'Ingesting…' : 'Parse & ingest →'}
        </button>
      </div>
    </div>
  );
}

function PdfIngest({ fileRef, onSubmit, loading }) {
  const [filename, setFilename] = useState('');
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-dashed border-clinical-border p-6 text-center bg-clinical-bg/30">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => setFilename(e.target.files?.[0]?.name ?? '')}
          className="block w-full text-sm text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded file:border file:border-clinical-border file:bg-clinical-panel file:text-slate-200 hover:file:border-clinical-accent"
        />
        {filename && (
          <p className="text-xs text-slate-400 mt-2 font-mono">selected: {filename}</p>
        )}
        <p className="text-xs text-slate-500 mt-3">
          Claude vision extracts medications, conditions, allergies, and observations.<br />
          Requires <span className="font-mono">ANTHROPIC_API_KEY</span> on the API server.
        </p>
      </div>
      <div className="flex items-center justify-end">
        <button
          onClick={onSubmit}
          disabled={!filename || loading}
          className="btn border-clinical-accent text-clinical-accent"
        >
          {loading ? 'Extracting…' : 'Extract & ingest →'}
        </button>
      </div>
    </div>
  );
}

function IngestResult({ result }) {
  return (
    <section className="panel p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Ingestion result</h3>
          <p className="text-xs text-slate-500 font-mono mt-1">
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

      {result.extraction && (
        <details className="rounded-lg border border-clinical-border bg-clinical-bg/30">
          <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 hover:text-clinical-accent">
            Raw vision extraction
          </summary>
          <pre className="px-3 py-2 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed border-t border-clinical-border max-h-80">
            {JSON.stringify(result.extraction, null, 2)}
          </pre>
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
