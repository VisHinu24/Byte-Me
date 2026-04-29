# Architecture

Technical reference for evaluators / contributors. Pairs with [README.md](README.md) (overview + run instructions) and [DEMO.md](DEMO.md) (live walkthrough).

---

## High-level system

```
                     ┌──────────────────────────────────────────────────┐
                     │                 Clinician Dashboard              │
                     │  React 18 + Vite + Tailwind + TanStack Query     │
                     │                                                  │
                     │  PatientList → PatientDetail (5 tabs):           │
                     │    Brief · Memory · Ingest · Consent · Audit     │
                     └────────────────────────┬─────────────────────────┘
                                              │ REST + SSE
                                              ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                         Express API (Node 20)                       │
   │                                                                     │
   │   ┌─ middleware ──────────────────────────────────────────────┐    │
   │   │   authenticate → consent gate → audit log                 │    │
   │   └────────────────────────────────────────────────────────────┘    │
   │                                                                     │
   │   ┌─ routes ──────────────────────┐  ┌─ agents ────────────────┐  │
   │   │ Patient   _summary  _brief    │  │  Orchestrator           │  │
   │   │ Resource  _distill  _ingest   │──▶ Retrieval (ranked)      │  │
   │   │ Consent   AuditLog            │  │  Risk      (rule-based) │  │
   │   │ DerivedMemory                 │  │  Synthesis (Claude)     │  │
   │   └────────────────────────────────┘  │  Distillation (Claude) │  │
   │                                       └─────────┬───────────────┘  │
   │   ┌─ services ────────────────────┐             │                  │
   │   │ patientSummary                │             │                  │
   │   │ keywordRetrieval (BM25)       │ ◀───────────┘                  │
   │   │ ingest/{hl7v2,ccda,pdf}       │                                │
   │   │ syntheaIngest                 │                                │
   │   └────────────────────────────────┘                                │
   └────────────────────────┬─────────────────────────────────┬──────────┘
                            │                                 │
                            ▼                                 ▼
                ┌────────────────────┐              ┌──────────────────┐
                │  MongoDB           │              │  Anthropic API   │
                │  FHIR collections  │              │  Claude Opus 4.7 │
                │  + DerivedMemory   │              │  Claude Haiku    │
                │  + Consent / Audit │              │  + vision        │
                └────────────────────┘              └──────────────────┘
```

---

## Agent topology

```
                                     ┌─────────────────────┐
   POST /api/Patient/:id/_brief ────▶│   Orchestrator      │
   { complaint }                     │ (SSE event emitter) │
                                     └──────────┬──────────┘
                                                │
                       ┌────────────────────────┼────────────────────────┐
                       │                        │                        │
                       ▼                        ▼                        ▼
                ┌──────────────┐         ┌─────────────┐          ┌──────────────┐
                │  Retrieval   │         │    Risk     │          │  Synthesis   │
                │              │         │             │          │              │
                │ • _summary   │         │ • drug-alg  │          │ • Claude     │
                │ • memories   │         │ • drug-drug │          │   Opus 4.7   │
                │ • BM25 rank  │         │ • lab OOR   │          │ • streaming  │
                │   by         │         │ • trends    │          │ • prompt     │
                │   complaint  │         │             │          │   caching    │
                └──────────────┘         └─────────────┘          └──────────────┘
                  deterministic           deterministic              LLM (Opus)

                         + Distillation agent (separate, on-demand from Memory tab)
                           ─ Claude reads findings + existing memories → proposes new
                             memories with citations → persists → loaded by retrieval
                             on the next brief
```

### Why this split

| Concern | Why it's NOT in the LLM |
| --- | --- |
| Drug-allergy match | Clinicians need 100% determinism. A regex over allergies × meds is auditable; an LLM is not. |
| Lab range checks | Same — the threshold map (`HbA1c > 7`, `Creatinine > 1.3`...) is policy, not reasoning. |
| Drug-drug interactions | Pair lookup, no inference. Replace with a real KB in production. |
| Lab trend direction | Math (delta% over readings), not language. |

| Concern | Why it IS in the LLM |
| --- | --- |
| Synthesis prose | "Compose the brief" is a language task. |
| Memory distillation | "Notice patterns across records" benefits from the model's clinical priors. |

| Concern | Hybrid (rule-based fallback) |
| --- | --- |
| Synthesis without API key | Mock leads with snapshot, lists active issues, surfaces risk flags, includes memory recall. Same shape, deterministic content. |
| Distillation without API key | 5 rule-based memory derivers (allergy, long-term-condition, lab-trend, polypharmacy, ER episode). |

---

## Data model

### FHIR-shaped collections (all in MongoDB)

```
Patient
  └─ identifier[] · name[] · gender · birthDate · address[] · provenance[]

Encounter ─── subject ─→ Patient
  └─ status · class (AMB|IMP|EMER) · type[] · period · reasonCode · provenance

Condition ─── subject ─→ Patient
  └─ code (SNOMED) · clinicalStatus · severity · onsetDateTime · provenance

MedicationRequest ─── subject ─→ Patient
  └─ status · medicationCodeableConcept (RxNorm) · authoredOn · dosageInstruction · provenance

Observation ─── subject ─→ Patient
  └─ code (LOINC) · category · valueQuantity · interpretation · effectiveDateTime · provenance

AllergyIntolerance ─── patient ─→ Patient
  └─ code (SNOMED) · criticality · category · reaction[] · provenance
```

### Governance + memory collections

```
Consent ─── patient ─→ Patient
  └─ grantee (Practitioner ref) · scope.categories[] · period · status

AuditLog
  └─ actor · action · patient · outcome · reason · details · at

DerivedMemory ─── patient ─→ Patient
  └─ kind (8 values) · title · summary · sources[] (FHIR refs)
     · createdBy (agent + modelHint) · confidence · status (active/rejected/superseded)
     · timeWindow · tags[]
```

### Provenance (every resource)

```
provenance: [{
  sourceSystem: "synthea" | "ccda-source" | "hl7v2-source" | "pdf-vision" | "demo-seed",
  sourceFormat: "FHIR" | "HL7v2" | "CCDA" | "PDF" | "MANUAL" | "SYNTHEA",
  ingestedAt: Date,
  sourceDocumentId: string,
}]
```

This is what makes the cite-click modal honest — every resource opens with its source attribution.

---

## Brief synthesis flow (the hot path)

```
1. Clinician types complaint → POST /_brief { complaint }
2. authenticate middleware    → req.user (impersonation-aware)
3. requireConsent('*')         → finds active Consent or 403s
4. recordAudit('brief.synthesize')

5. Orchestrator:
   ┌───────────────────────────────────────────────────────────────┐
   │ a. emit step.start retrieval                                  │
   │ b. retrieval agent:                                           │
   │     - load patient summary (Patient + Encounter + Condition + │
   │       Medication + Observation + Allergy)                     │
   │     - load DerivedMemory[] (status=active)                    │
   │     - if complaint → BM25 rank pool, attach _relevance        │
   │ c. emit step.complete retrieval { counts, complaintRelevant,  │
   │                                  topRelevance }               │
   │                                                               │
   │ d. emit step.start risk                                       │
   │ e. risk agent (rule-based):                                   │
   │     - drug-allergy class match (penicillin → amoxicillin etc) │
   │     - drug-drug pair lookup                                   │
   │     - lab OOR vs threshold map (HbA1c, BP, Cr, K)             │
   │     - rising-trend detection                                  │
   │ f. emit step.complete risk { counts, topFlags }               │
   │                                                               │
   │ g. emit step.start synthesis                                  │
   │ h. synthesis agent:                                           │
   │     - if ANTHROPIC_API_KEY: stream from Claude with prompt    │
   │       caching on the patient context block                    │
   │     - else: deterministic mock with same section structure    │
   │     - emits 'token' events as text streams in                 │
   │ i. emit step.complete synthesis { mocked }                    │
   │                                                               │
   │ j. emit done { brief, risks, findings, durationMs }           │
   └───────────────────────────────────────────────────────────────┘

6. UI BriefPanel:
   - StepStrip animates per event
   - RiskSummary renders flag cards with severity colors
   - BriefBody streams tokens with blinking cursor
   - ProvenanceModal opens on cite-click via event delegation
```

---

## Ranked retrieval — why BM25 not vectors

At hackathon scale (≤30 memories per patient, ≤20 active conditions/meds), an in-memory BM25 implementation outperforms an embeddings round-trip on:

- **Latency** — sub-millisecond vs ~300ms per Voyage/OpenAI call
- **Cost** — zero vs cents per session
- **Demo reliability** — no third-party API to fail
- **Setup** — zero vs API key + index management
- **Quality at this scale** — BM25 with synonym expansion is competitively accurate when the corpus is small

The interface in `services/keywordRetrieval.js` is shaped so production can swap in Voyage AI / Atlas Vector Search behind `rankByQuery({ candidates, query })` with no caller changes:

```js
// Today (BM25):
const ranked = rankByQuery({ candidates, query: complaint });

// Tomorrow (vector):
const ranked = await rankByEmbedding({ candidates, query: complaint, embedder });
// Same shape: [{ id, score, matches }]
```

The synonym table (`SYNONYMS` in `keywordRetrieval.js`) covers the 16 highest-yield clinical concept clusters (cardiac, diabetes, renal, pulm, allergy, hypertension, infection). Expanding to 100+ would require a real ontology mapping (UMLS / SNOMED-CT subsumption) — at that point, embeddings start winning.

---

## Consent enforcement (security architecture)

```
Every request flow:

   ┌──────────────┐
   │  HTTP request│
   └──────┬───────┘
          │
          ▼
   ┌──────────────────────────────┐
   │ authenticate middleware      │
   │  - JWT bearer (prod)         │
   │  - X-Dev-User header (demo)  │
   │  - default Dr. Demo (dev)    │
   │ → req.user.{ sub, role,      │
   │     providerId, impersonated}│
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──────────────────────────────────────────────┐
   │ requireConsent(category) middleware          │
   │                                              │
   │ Patient self-access? → ALLOW                 │
   │                                              │
   │ Find active Consent matching:                │
   │   patient.reference = 'Patient/{id}' AND     │
   │   grantee.reference = req.user.providerId    │
   │                                              │
   │ For each consent:                            │
   │   - period.start ≤ now ≤ period.end          │
   │   - status === 'active'                      │
   │   - revokedAt === null                       │
   │   - scope.categories includes <category>     │
   │     OR includes 'all'                        │
   │     OR <category> === '*'                    │
   │                                              │
   │ Match? → ALLOW                               │
   │ No match?                                    │
   │   - !impersonated && isDev → DEV BYPASS      │
   │   - else → 403 + audit denied                │
   └──────────────┬───────────────────────────────┘
                  │
                  ▼
        recordAudit('consent.check', outcome)
                  │
                  ▼
         (route handler runs)
```

### Why dev bypass + impersonated separation

The default unnamed identity ("Dr. Demo") gets the bypass so `npm run dev` works without setting up consents. But the moment you switch to a named identity via the impersonation switcher, `req.user.impersonated = true` and the gate enforces real grants. This is what makes the consent demo crisp: switch identity → get blocked → grant access → unblocked.

---

## Multi-format ingestion architecture

```
                     POST /api/Patient/:id/_ingest
                        body: { format, content }
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
                ▼                   ▼                   ▼
        ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
        │   HL7 v2     │    │   C-CDA XML  │    │   PDF/Image  │
        │              │    │              │    │              │
        │ pipe-delim   │    │ fast-xml-    │    │ Claude vision│
        │ tokenizer    │    │ parser       │    │ → structured │
        │ MSH/PID/PV1  │    │ template OID │    │   FHIR JSON  │
        │ OBR/OBX      │    │ dispatch     │    │              │
        └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
               │                   │                   │
               ▼                   ▼                   ▼
        ┌─────────────────────────────────────────────────────┐
        │          FHIR resource transformation                │
        │  {Encounter, Observation, Condition, Med, Allergy}   │
        │  + provenance.sourceFormat tag                       │
        │  + subject.reference = Patient/{:id}                 │
        └────────────────────────┬────────────────────────────┘
                                 │
                                 ▼
                    Mongoose insertMany / create
                                 │
                                 ▼
                       findings on next brief
                       memories on next distill
```

Each parser produces the same FHIR-shaped output. The downstream agent layer is format-agnostic — it just sees Mongo documents.

---

## What's intentionally NOT here

| Feature | Why it's deferred |
| --- | --- |
| Real authentication | Demo uses dev JWT + impersonation header. Production needs OAuth + SMART-on-FHIR + ABDM. |
| Vector embeddings | Scale doesn't justify the cost/latency/setup. Interface ready for swap. |
| Off-the-shelf FHIR server | We hand-rolled REST endpoints because Medplum / HAPI are Postgres-native and we picked Mongo for document fit. |
| Distributed tracing | Single-node pino logs are enough for a hackathon demo. |
| Rate limit per-user | Global rate limit only. |
| HTTPS | Behind a reverse proxy in production. |
| Schema migrations | Mongoose validates on insert, but no formal migration framework. |
| Background queue | All ingestion is synchronous. Production would offload to BullMQ. |
| Multi-patient cross-search | Vector retrieval would unlock "have we seen this pattern before across patients" — out of scope. |

---

## File-level reference

### Backend (`apps/api/src/`)

| File | Responsibility |
| --- | --- |
| `app.js` | Express app factory, middleware order, router mounting |
| `index.js` | Bootstrap: `connectDb()` then `app.listen()` |
| `config/env.js` | Validated env loader |
| `config/db.js` | Mongoose connection with redacted URI logging |
| `config/logger.js` | pino logger (pretty in dev) |
| `middleware/auth.js` | JWT + `X-Dev-User` impersonation; sets `req.user.impersonated` |
| `middleware/consent.js` | `requireConsent(category)` — the hard gate |
| `middleware/audit.js` | `recordAudit({ action, outcome, ... })` helper |
| `middleware/error.js` | `HttpError` class + final error handler |
| `models/fhirCommon.js` | Reusable Mongoose subschemas (codeableConcept, reference, period, etc.) |
| `models/Patient.js` ... `AllergyIntolerance.js` | Six FHIR resource models |
| `models/Consent.js` | Consent record + `isCurrentlyActive()` / `coversCategory()` |
| `models/AuditLog.js` | Append-only access log |
| `models/DerivedMemory.js` | Agent-distilled memory + supersession chain |
| `routes/patient.js` | List, get, per-resource endpoints (consent-gated per category) |
| `routes/brief.js` | SSE-streamed `_brief` orchestration |
| `routes/memory.js` | `_distill` + memory list + status PATCH |
| `routes/ingest.js` | HL7v2 / CCDA text + multipart PDF endpoints |
| `routes/consent.js` | Grant + revoke + list |
| `routes/audit.js` | Read-only access log |
| `routes/resource.js` | Generic FHIR resource lookup for cite-click |
| `routes/health.js` | Liveness + Mongo state |
| `services/patientSummary.js` | Aggregates 6 collections → unified summary (the agent input) |
| `services/keywordRetrieval.js` | BM25 ranking + clinical synonym expansion |
| `services/syntheaIngest.js` | FHIR Bundle parser with two-pass `urn:uuid` reference mapping |
| `services/ingest/hl7v2.js` | Pipe-delimited HL7 v2 parser (ORU/ADT) |
| `services/ingest/ccda.js` | C-CDA XML parser dispatching on template OIDs |
| `services/ingest/pdf.js` | Claude vision PDF/image extractor |
| `agents/orchestrator.js` | Coordinates retrieval → risk → synthesis with SSE event emission |
| `agents/retrieval.js` | Builds findings + ranks by complaint |
| `agents/risk.js` | Rule-based: drug-allergy, drug-drug, lab OOR, trends |
| `agents/synthesis.js` | Claude streaming + deterministic mock |
| `agents/distillation.js` | Claude JSON output for memories + rule-based 5-rule fallback |
| `scripts/seed.js` | 3 hand-crafted personas with realistic histories |
| `scripts/ingest-synthea.js` | CLI wrapper for syntheaIngest |

### Frontend (`apps/web/src/`)

| File | Responsibility |
| --- | --- |
| `main.jsx` | React root, router, query client |
| `pages/PatientListPage.jsx` | Search + list |
| `pages/PatientDetailPage.jsx` | Tab navigation: Brief / Memory / Ingest / Consent / Audit |
| `components/AppShell.jsx` | Header, nav, health indicator, impersonation switcher |
| `components/BriefPanel.jsx` | Complaint input + step strip + risk summary + streaming brief + cite-click |
| `components/ClinicalView.jsx` | Stats + active conditions/meds + lab trend charts + encounters |
| `components/LabTrendChart.jsx` | Recharts line chart per lab code |
| `components/MemoryPanel.jsx` | Distillation runner + memory cards + reject/restore |
| `components/IngestPanel.jsx` | HL7v2 / CCDA / PDF tabs with sample loader |
| `components/ConsentPanel.jsx` | Grant form + active/past lists + revoke |
| `components/AuditLogPanel.jsx` | Filtered audit feed with auto-refresh |
| `components/ProvenanceModal.jsx` | Type-specific FHIR resource renderers + raw JSON |
| `components/ImpersonationSwitcher.jsx` | Demo identity picker via `X-Dev-User` header |
| `lib/api.js` | Fetch wrapper + SSE stream parser + auth header injection |
| `lib/format.js` | Date / age / display name / textOf helpers |
| `lib/briefMarkdown.js` | Tiny markdown renderer with `[cite:...]` token support |
| `lib/providers.js` | Demo practitioner directory + data category catalog |
| `lib/samples.js` | Inline HL7v2 + CCDA bundles for the Ingest "Load sample" buttons |
