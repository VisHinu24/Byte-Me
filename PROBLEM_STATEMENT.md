# Problem statement → implementation mapping

This document maps every claim in the original problem brief to the specific files / endpoints / agents that implement it. Useful for evaluators who want to verify the system actually delivers what the brief asks for.

---

## The brief

> Build an AI-agent-powered system that establishes a persistent, privacy-preserving patient memory layer — a unified longitudinal health record that follows the patient, not the provider. This layer must intelligently surface the most clinically relevant context at the point of care: prior episodes, treatment-response patterns, medication histories, and risk signals — all synthesized in real time by an orchestrated network of specialized agents operating under explicit patient consent and granular data governance controls.

---

## Requirement → Implementation

### 1. "A unified longitudinal health record that follows the patient, not the provider"

**Where it lives:**
- FHIR R4 schema in [`apps/api/src/models/`](apps/api/src/models/) — `Patient`, `Encounter`, `Condition`, `MedicationRequest`, `Observation`, `AllergyIntolerance`. All keyed on `patient.reference`, not provider.
- Aggregation in [`services/patientSummary.js`](apps/api/src/services/patientSummary.js) — pulls every resource for a patient regardless of source provider.
- Multi-provider ingestion: same patient can have records tagged `sourceFormat: 'SYNTHEA' | 'HL7v2' | 'CCDA' | 'PDF' | 'MANUAL'` from different `sourceSystem` values, all linked to one `Patient` ObjectId.
- Provenance schema [`models/fhirCommon.js`](apps/api/src/models/fhirCommon.js#L70) preserves source attribution per record.

**Demo proof:**
- Open Aarav Sharma → Ingest tab → load HL7v2 lab → load CCDA discharge summary → all merged into the same patient. The brief now cites resources from three different `sourceFormat` tags.

---

### 2. "Intelligently surface the most clinically relevant context at the point of care"

**Where it lives:**
- [`agents/orchestrator.js`](apps/api/src/agents/orchestrator.js) — coordinates the three-agent flow.
- [`agents/retrieval.js`](apps/api/src/agents/retrieval.js) — builds findings, ranks by complaint relevance.
- [`services/keywordRetrieval.js`](apps/api/src/services/keywordRetrieval.js) — BM25 + clinical synonym table (16 concept clusters, 60+ expanded terms).
- [`agents/synthesis.js`](apps/api/src/agents/synthesis.js) — Groq-streamed brief with section-by-section structure.

**Demo proof:**
- Brief panel: type "sugar levels rising" → retrieval shows `⌘ 4 relevant to complaint` with top-3 ranked items + matched terms. Brief opens with `Re: "sugar levels rising" — most relevant prior context: ...`.

---

### 3. "Prior episodes" — i.e. discrete clinical events recallable on subsequent visits

**Where it lives:**
- [`models/DerivedMemory.js`](apps/api/src/models/DerivedMemory.js) with `kind: 'episode'`.
- [`agents/distillation.js`](apps/api/src/agents/distillation.js) — distillation agent; rule-based fallback explicitly creates episode memories from ER encounters.
- Brief integration: synthesis system prompt + mock both surface a `**Memory recall**` section with `[cite:DerivedMemory/...]` provenance.

**Demo proof:**
- Memory tab → Run distillation → see *"ER visit: Symptomatic hypoglycemia on glimepiride"* memory citing the source `Encounter`. Re-run brief → episode appears under Memory recall.

---

### 4. "Treatment-response patterns"

**Where it lives:**
- Synthesis system prompt rule #10: *"Treatment-response patterns: highlight discontinuations and what worked vs. didn't."*
- Synthesis mock has explicit `**Treatment-response patterns**` section.
- DerivedMemory `kind: 'treatment-response'` and `kind: 'discontinuation'`.
- Aarav's seed data has the canonical case: Glimepiride 2mg → discontinued due to hypoglycemia (ER visit), now on Metformin alone.

**Demo proof:**
- Brief on Aarav surfaces "ER visit for hypoglycemia on glimepiride" linked to the discontinued med. Memory layer persists this as a `discontinuation` memory after distillation.

---

### 5. "Medication histories"

**Where it lives:**
- [`models/MedicationRequest.js`](apps/api/src/models/MedicationRequest.js) — full FHIR R4 medication shape, RxNorm codes, dosage instructions, dispense quantities.
- Three ingestion paths: HL7v2 (no direct support — would need RXA segment), CCDA (`substanceAdministration`), PDF vision.
- Status field captures lifecycle: `active`, `completed`, `cancelled`, `stopped`.
- Brief surfaces `currentMedications` with start dates; mock includes "On N active medications."
- Risk agent flags drug-allergy conflicts and drug-drug interactions.

**Demo proof:**
- Aarav: Metformin (active 6yr), Telmisartan, Atorvastatin, Glimepiride (completed/discontinued). All visible on Clinical view + on the brief's Active medications section.

---

### 6. "Risk signals"

**Where it lives:**
- [`agents/risk.js`](apps/api/src/agents/risk.js) — fully rule-based, deterministic:
  - **Drug-allergy** — class-aware (Penicillin allergy → flags Amoxicillin/Ampicillin/Augmentin/Piperacillin)
  - **Drug-drug** — pair lookup table (Warfarin+Aspirin → bleeding; Metformin+Contrast → lactic acidosis; ACE-I+Spironolactone → hyperkalemia; Sulfonylurea+Insulin → hypoglycemia; Statin+Macrolide → myopathy)
  - **Lab out-of-range** — threshold map for HbA1c, BP, Creatinine, Potassium, PEF
  - **Trend concern** — rising lab trends with abnormal flag → moderate alert
- Severity ranking: `critical | high | moderate | low | info`.
- Surfaced in BriefPanel with severity-colored cards + clickable cite chips.

**Demo proof:**
- Run brief on a patient with active Amoxicillin + Penicillin allergy → critical drug-allergy flag with citations to both source resources.
- Aarav has rising HbA1c + diabetes → trend warning fires.

---

### 7. "All synthesized in real time"

**Where it lives:**
- SSE streaming endpoint [`routes/brief.js`](apps/api/src/routes/brief.js) — `POST /api/Patient/:id/_brief` emits structured events as each agent runs.
- Synthesis uses `client.chat.completions.create({ stream: true })` from Groq SDK with token-by-token forwarding.
- Frontend [`api.js#streamBrief`](apps/web/src/lib/api.js) parses SSE events and updates UI mid-flight.
- BriefPanel shows step indicators that animate as each agent completes; brief body has a blinking cursor while tokens stream.

**Demo proof:**
- Click "Synthesize brief" → watch retrieval/risk/synthesis steps light up sequentially, then text streams character-by-character into the brief panel.

---

### 8. "Orchestrated network of specialized agents"

**Where it lives:**
- [`agents/orchestrator.js`](apps/api/src/agents/orchestrator.js) — explicit DAG: retrieval → risk → synthesis with structured event emission.
- Plus on-demand [`agents/distillation.js`](apps/api/src/agents/distillation.js) for memory persistence.
- Each agent in its own module with a single responsibility:
  - **Retrieval** — context assembly + ranking (deterministic + BM25)
  - **Risk** — rule-based clinical safety checks (deterministic, transparent)
  - **Synthesis** — narrative composition (Groq `llama-3.1-8b-instant`, streaming)
  - **Distillation** — memory extraction (Groq `llama-3.1-8b-instant` with strict JSON output, rule-based fallback)
- Why this split is documented in [`ARCHITECTURE.md`](ARCHITECTURE.md#why-this-split).

**Demo proof:**
- Brief panel shows the three-step strip — three named, distinct agent invocations per request. Memory tab triggers a fourth distinct agent.

---

### 9. "Operating under explicit patient consent"

The brief says *patient consent*, not *clinician consent* or *administrator consent*. PML enforces this structurally: only the patient can grant or revoke. Doctors literally cannot — neither in the UI (Consent tab is hidden) nor in the API (`requirePatient` middleware returns 403).

**Where it lives:**
- [`models/Consent.js`](apps/api/src/models/Consent.js) — FHIR-shaped consent record with patient × grantee × scope.categories × period × purpose.
- [`middleware/consent.js`](apps/api/src/middleware/consent.js) — `requireConsent(category)` middleware applied to **every** patient-data route (read path).
- [`routes/consent.js`](apps/api/src/routes/consent.js) — REST API for grant / revoke / list, all gated by `requirePatient` (role check + patient-self check). Doctors hit 403 with `"Only patients can manage their own consent"`.
- [`components/ConsentPanel.jsx`](apps/web/src/components/ConsentPanel.jsx) — patient-facing consent portal: provider × 9 categories × 6 duration options × 4 purposes.
- [`pages/PatientDetailPage.jsx`](apps/web/src/pages/PatientDetailPage.jsx) — Consent tab is filtered out for non-patient roles via `ALL_TABS[].roles`.
- [`routes/patient.js`](apps/api/src/routes/patient.js) — patient list itself is role-aware: a doctor without consent literally doesn't see the patient exist; the list is filtered to only patients who actively granted them.
- [`routes/me.js`](apps/api/src/routes/me.js) — `GET /api/me` exposes role to the frontend so UI gates correctly.

**Role matrix:**
| | Patient (self) | Doctor with consent | Doctor without consent |
| --- | --- | --- | --- |
| Sees other patients exist | n/a | filtered to consented only | empty list |
| Sees Consent tab | ✅ | ❌ hidden | n/a |
| Can grant / revoke consent | ✅ self only | ❌ blocked at API + UI | n/a |
| Can read consented data | n/a (own) | ✅ within scope | ❌ 403 |

**Demo proof:**
- Switch impersonation to Dr. Mehta (no grant) → patient list goes empty (not just "Consent required" on individual charts — the patients vanish entirely from her view).
- Switch to patient identity → auto-redirects to own chart → Consent tab appears → grant Dr. Mehta access → switch back → patient list now shows that one patient.
- Doctor calling `POST /api/Consent` directly via curl → 403 with role-violation message (verified in smoke tests, see commit history).

---

### 10. "Granular data governance controls"

**Where it lives:**
- 9 consent categories defined in [`lib/providers.js`](apps/web/src/lib/providers.js): `demographics`, `conditions`, `medications`, `allergies`, `observations`, `encounters`, `mental-health`, `reproductive-health`, `genetic`. The last three are flagged `sensitive: true` in the UI (amber tint, opt-in).
- Per-resource gating on every read endpoint:
  - `Patient/:id` → demographics
  - `Encounter` → encounters
  - `Condition` → conditions
  - `MedicationRequest` → medications
  - `Observation` → observations
  - `AllergyIntolerance` → allergies
  - `_summary`, `_brief`, `_distill`, `_ingest` → `*` (any active consent)
- Bounded duration: 24h / 7d / 30d / 90d / 1y / open-ended grants.
- **Real-time revocation**: revoking a consent flips its `status` to `'inactive'` and sets `revokedAt`; the patient list filter drops that patient from the doctor's view on the next request, and any in-flight reads start failing the gate.
- Append-only audit trail: every consent decision (allow / deny / grant / revoke) lands in [`AuditLog`](apps/api/src/models/AuditLog.js) collection. Patients see the full log for their own record; doctors see the log for patients they currently have consent for.

**Demo proof:**
- Grant Dr. Mehta `[conditions, medications]` only — Dr. Mehta tries to read `/AllergyIntolerance` → blocked. `/Condition` → allowed. Both events logged.
- Revoke → patient vanishes from Dr. Mehta's list and next read attempt is 403'd.

---

## Beyond the brief — additional capabilities

These weren't explicitly required but strengthen the system:

### Multi-format interoperability
The brief mentions "incompatible systems, proprietary formats" as the problem. PML responds with three concrete ingestion paths:
- **HL7 v2** ([`services/ingest/hl7v2.js`](apps/api/src/services/ingest/hl7v2.js)) — pipe-delimited, dominant production format
- **C-CDA XML** ([`services/ingest/ccda.js`](apps/api/src/services/ingest/ccda.js)) — discharge summary lingua franca
- **Image** ([`services/ingest/pdf.js`](apps/api/src/services/ingest/pdf.js)) — Groq vision (`llama-3.2-11b-vision-preview`) for scanned prescriptions; images only (PDFs require conversion)

Plus the FHIR Bundle path via [`services/syntheaIngest.js`](apps/api/src/services/syntheaIngest.js) for modern systems.

### Provenance everywhere
Every clinical claim in the brief carries a `[cite:ResourceType/id]` pin. Clicking opens a modal showing the actual source resource — type-aware view with raw FHIR JSON underneath. See [`components/ProvenanceModal.jsx`](apps/web/src/components/ProvenanceModal.jsx).

This goes beyond "explainable AI" — it's auditable AI. Every claim is traceable.

### Persistent memory across visits
The DerivedMemory layer is what makes this a "memory layer" rather than just "another EHR aggregator." Memories persist across sessions, get loaded into every future brief, and can be explicitly rejected by clinicians/patients (with reason). See [`agents/distillation.js`](apps/api/src/agents/distillation.js) + [`models/DerivedMemory.js`](apps/api/src/models/DerivedMemory.js).

### Dev mode with realistic enforcement
The impersonation switcher ([`components/ImpersonationSwitcher.jsx`](apps/web/src/components/ImpersonationSwitcher.jsx)) lets demo leads switch between five named clinicians + the patient. The consent gate enforces real grants per identity — `req.user.impersonated = true` disables the dev bypass. This makes the consent demo crisp without setting up real auth.

---

## What we deliberately deferred

| Capability | Why | Future path |
| --- | --- | --- |
| Real OAuth + SMART-on-FHIR | Demo uses dev JWTs + impersonation header. | Plug in NextAuth / Keycloak; wire SMART-on-FHIR scopes onto Consent. |
| Vector embeddings | At ≤30 memories per patient, BM25 with synonym expansion is faster + cheaper. | `services/keywordRetrieval.js` interface is shaped to swap in Voyage AI / Atlas Vector Search. |
| Off-the-shelf FHIR server | Picked Mongo (document fit) over Postgres (Medplum/HAPI native). | If choice were re-evaluated, Medplum + Postgres saves ~2 days of REST plumbing. |
| HIPAA / DPDP / GDPR audit | Not in hackathon scope. | Architecture is consent-first and audit-by-default — formal review would build on, not replace. |
| Multi-patient cross-search | "Have we seen this pattern across patients" requires real vector retrieval. | Post-MVP: Atlas Vector Search across DerivedMemory.summary. |
| Cross-bundle reference resolution | Synthea bundles can reference `Practitioner` in a sibling bundle. We currently leave external refs verbatim. | Two-phase ingest with provider directory pre-load. |

---

## Code organization quick-reference

If you want to verify a specific requirement, jump directly to:

| Requirement | Primary file |
| --- | --- |
| Unified longitudinal record | [`apps/api/src/services/patientSummary.js`](apps/api/src/services/patientSummary.js) |
| Three-agent orchestration | [`apps/api/src/agents/orchestrator.js`](apps/api/src/agents/orchestrator.js) |
| Real-time streaming | [`apps/api/src/routes/brief.js`](apps/api/src/routes/brief.js) |
| Risk signals (rule-based) | [`apps/api/src/agents/risk.js`](apps/api/src/agents/risk.js) |
| Treatment-response patterns | [`apps/api/src/agents/synthesis.js`](apps/api/src/agents/synthesis.js#L24) (system prompt rule #10) |
| Persistent memory | [`apps/api/src/models/DerivedMemory.js`](apps/api/src/models/DerivedMemory.js) + [`agents/distillation.js`](apps/api/src/agents/distillation.js) |
| Patient consent | [`apps/api/src/middleware/consent.js`](apps/api/src/middleware/consent.js) + [`models/Consent.js`](apps/api/src/models/Consent.js) |
| Granular controls | [`apps/web/src/lib/providers.js`](apps/web/src/lib/providers.js) + [`components/ConsentPanel.jsx`](apps/web/src/components/ConsentPanel.jsx) |
| Audit trail | [`apps/api/src/models/AuditLog.js`](apps/api/src/models/AuditLog.js) + [`middleware/audit.js`](apps/api/src/middleware/audit.js) |
| Multi-format ingestion | [`apps/api/src/services/ingest/`](apps/api/src/services/ingest/) |
| Provenance / cite-click | [`apps/api/src/routes/resource.js`](apps/api/src/routes/resource.js) + [`components/ProvenanceModal.jsx`](apps/web/src/components/ProvenanceModal.jsx) |
