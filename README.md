# Patient Memory Layer (PML)

**An AI-agent-powered, consent-mediated longitudinal patient memory layer.** A unified FHIR-shaped record that follows the patient — not the provider — with an orchestrated network of LLM agents (Groq · `llama-3.1-8b-instant`) that synthesize the most clinically relevant context at the point of care, all under explicit patient consent and granular data governance.

> **Status: feature-complete demo.** Six milestones shipped — FHIR record + agent orchestration, ranked retrieval with complaint focus, derived memory layer, multi-format ingestion (FHIR / HL7v2 / CCDA / PDF), patient consent portal, cite-click provenance.

---

## What this solves

EHRs are siloed across institutions. Clinicians make decisions without complete longitudinal context. Patients reconstruct their own medical history at every new touchpoint.

PML establishes:

1. **A unified longitudinal record** that follows the patient across providers
2. **An intelligent context layer** — orchestrated agents surface prior episodes, treatment-response patterns, medication history, and risk signals at the point of care, **synthesized in real time**
3. **Explicit patient consent** with granular per-provider × per-category × per-duration grants, hard-gated on every read
4. **An auditable trail** — every agent call, every consent check, every data access logged

📖 See [PROBLEM_STATEMENT.md](PROBLEM_STATEMENT.md) for how each requirement from the original brief maps to specific implementation files.

---

## Quick start

```bash
# 1. install all workspace deps
npm install

# 2. set up env files (Atlas MongoDB connection string required)
cp .env.example .env
cp .env.example apps/api/.env
# then edit apps/api/.env and set MONGO_URI to your Atlas URI
# (Cluster → Connect → Drivers → Node.js → copy the URI;
#  add /patient_memory before the query string)

# 3. seed three demo patients with realistic 5-15yr histories
npm run seed

# 4. start API + web with hot reload
npm run dev
```

- **API**: http://localhost:4000 (health: `/health`)
- **Web**: http://localhost:5173

> 🎭 For a guided demo flow, see [DEMO.md](DEMO.md). For architecture details, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 18 + Vite + Tailwind + TanStack Query | Fast dev, no TS overhead per spec, JSX-native shadcn-style components |
| Backend | Node.js 20 + Express 4 | Async runtime, REST + SSE streaming, ecosystem fit |
| Database | MongoDB Atlas | FHIR resources are JSON documents — natural fit; flexible schema for messy real-world EHR variants. Hosted on Atlas, so no local DB setup. |
| Agents | Groq SDK + `llama-3.1-8b-instant` | Sub-second streaming on a free hosted endpoint; OpenAI-compatible API surface so it's swappable |
| FHIR | R4-shaped Mongoose models | Industry standard, no off-the-shelf FHIR-server-on-Mongo so we shape our own |
| Ranked retrieval | BM25 + clinical synonym expansion | Right tool for the scale; interface lets production swap to Voyage AI / Atlas Vector Search |
| Vision OCR | Groq vision (`llama-3.2-11b-vision-preview`) | Scanned prescription / lab photos → structured FHIR. Images only (jpg/png/webp). |

---

## Repo layout

```
apps/
  api/                    Express backend
    src/
      routes/             REST + SSE endpoints (Patient, Brief, Memory, Consent, Audit, Resource, Ingest)
      models/             Mongoose schemas (Patient, Encounter, Condition, Med, Obs, Allergy, Consent, AuditLog, DerivedMemory)
      agents/              retrieval · risk · synthesis · distillation · orchestrator
      services/           patientSummary · syntheaIngest · keywordRetrieval · ingest/{hl7v2,ccda,pdf}
      middleware/         auth · consent · audit · error
      scripts/            seed · ingest-synthea
  web/                    Vite + React clinician dashboard
    src/
      pages/              PatientListPage · PatientDetailPage
      components/         BriefPanel · MemoryPanel · ConsentPanel · IngestPanel · AuditLogPanel
                          · ClinicalView · LabTrendChart · ProvenanceModal · ImpersonationSwitcher
      lib/                api · format · briefMarkdown · providers · samples
data/
  synthea/fhir/           Sample Synthea bundle for ingestion
  samples/                HL7v2 + CCDA examples
```

---

## Demo personas (after `npm run seed`)

| Patient | Profile | Why it's interesting |
| --- | --- | --- |
| **Aarav Sharma** | Diabetic polypharmacy | 5-yr HbA1c trend (8.6 → 6.9), BP trend, Penicillin allergy, prior ER visit for hypoglycemia on glimepiride (now discontinued), 4 active meds. Rich for risk + memory + complaint demos. |
| **Priya Iyer** | Stable asthma | Long-standing (15+ yrs), inhaler regimen — minimal complexity, good control case. |
| **Rohan Patel** | Post-surgical | Resolved appendicitis with completed antibiotic course — discharged-and-fine baseline. |

---

## Loading more patients (Synthea)

The seed script creates 3 hand-crafted personas. A bundled Synthea-shaped FHIR Bundle ships in `data/synthea/fhir/sample_patient_001.json` — load it with:

```bash
npm run ingest:synthea -- --reset
```

To get hundreds more realistic synthetic patients, download pre-generated bundles from [Synthea sample data](https://synthea.mitre.org/downloads), drop the `.json` files into `data/synthea/fhir/`, and re-run the same command.

The ingester walks every `.json` bundle, normalizes references (`urn:uuid:…` → Mongo ObjectIds), and inserts the resource types we care about (`Patient`, `Encounter`, `Condition`, `MedicationRequest`, `Observation`, `AllergyIntolerance`). Everything is tagged with `provenance.sourceFormat: 'SYNTHEA'` so you can wipe just the synthetic data without touching seed personas.

CLI flags:

| Flag | Effect |
| --- | --- |
| `--input <dir>` | Custom bundle directory |
| `--reset` | Wipe existing Synthea-sourced data before ingesting |
| `--source <name>` | Override `sourceSystem` tag (default `synthea`) |

---

## Multi-format ingestion (the interoperability story)

Most legacy EHR data isn't FHIR. PML handles three real-world sources via the **Ingest** tab on every patient page:

| Format | Parser | Maps to |
| --- | --- | --- |
| **HL7 v2** (pipe-delimited) | Custom parser, MSH/PID/PV1/OBR/OBX | `Observation[]` (ORU^R01 lab) · `Encounter` (ADT^A01/A03/A08) |
| **C-CDA** (XML) | `fast-xml-parser` + template-OID dispatch | `Condition` (Problem List) · `MedicationRequest` (Medications) · `AllergyIntolerance` (Allergies) · `Observation` (Results) |
| **Image** (scanned prescription, lab photo) | Groq vision (`llama-3.2-11b-vision-preview`) → strict JSON | All of the above. Images only (jpg/png/webp); native PDF requires conversion. |

Every ingested record carries `provenance.sourceFormat` so the brief, the memory layer, and the cite-click modal all honestly attribute the source.

**Sample files** in `data/samples/`:
- `hl7v2/lab-result-oru-r01.hl7` — lipid panel + CMP (8 LOINC observations)
- `hl7v2/admit-adt-a01.hl7` — inpatient admission encounter
- `ccda/discharge-summary.xml` — full C-CDA: T2DM + hyperlipidemia + Metformin + Atorvastatin + Penicillin allergy + HbA1c/creatinine

The Ingest UI has "Load sample" buttons that paste these into the parser textarea.

---

## API surface

### Identity
| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/me` | anyone authenticated — returns `{ role, sub, name, providerId, impersonated }` |
| GET | `/health` | public |

### Read paths (consent-gated)
| Method | Path | Required consent category |
| --- | --- | --- |
| GET | `/api/Patient?q=…` | role-filtered: patient → self only · doctor → only patients with active consent for them |
| GET | `/api/Patient/:id` | `demographics` |
| GET | `/api/Patient/:id/_summary` | `*` (any active consent) |
| GET | `/api/Patient/:id/Encounter` | `encounters` |
| GET | `/api/Patient/:id/Condition` | `conditions` |
| GET | `/api/Patient/:id/MedicationRequest` | `medications` |
| GET | `/api/Patient/:id/Observation` | `observations` |
| GET | `/api/Patient/:id/AllergyIntolerance` | `allergies` |
| POST | `/api/Patient/:id/_brief` | `*` — SSE stream |
| GET | `/api/Patient/:id/DerivedMemory` | `*` |
| GET | `/api/Resource/:type/:id` | category derived from `:type` |
| GET | `/api/AuditLog?patientId=…` | `*` |

### Write paths (consent-gated)
| Method | Path | Required |
| --- | --- | --- |
| POST | `/api/Patient/:id/_distill` | `*` |
| POST | `/api/Patient/:id/_ingest` | `*` (HL7v2 / CCDA payload) |
| POST | `/api/Patient/:id/_ingest/file` | `*` (PDF / image multipart) |
| PATCH | `/api/DerivedMemory/:id/status` | `*` |

### Patient-only paths (role-locked)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/Consent` | Returns only the calling patient's grants |
| POST | `/api/Consent` | `body.patientId` must equal `req.user.sub` |
| DELETE | `/api/Consent/:id` | Consent must belong to calling patient |

Doctors hitting any patient-only path get `403 "Only patients can manage their own consent"`.

> **Note on `/_op` paths**: FHIR convention is `$op` (e.g., `$summary`, `$brief`), but Express 4's path-to-regexp 0.1 treats `$` as a regex anchor and never matches. We use `_op` instead and call it out in code comments. Behavior is identical to FHIR semantics; only the URL differs.

---

## Agent architecture

Three specialist agents behind one orchestrator:

```
                     ┌──── retrieval (deterministic + BM25-ranked) ────┐
clinician complaint ─┤                                                  │
+ patient id         ├──── risk (rule-based: drug-allergy, ddi, OOR) ──┼─→ SSE brief
                     │                                                  │
                     └──── synthesis (Groq llama-3.1-8b-instant, streaming) ┘
```

A separate **distillation** agent runs on demand from the Memory tab — it reads the patient's findings and persists 3-8 derived memories (long-term trends, allergies, polypharmacy, ER episodes, treatment-response patterns), each carrying citations to source FHIR resources. Subsequent briefs see these memories in context.

📖 Full architecture in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Roles & consent — patient is the data controller

The system has two roles, enforced server-side:

| | Patient (self) | Doctor with consent | Doctor without consent |
| --- | --- | --- | --- |
| Lands on `/` | own chart (auto-redirect) | filtered patient list | empty list |
| Sees other patients exist | n/a (one record only) | filtered to consented | none |
| Tabs visible | Brief · Memory · Ingest · **Consent** · Audit | Brief · Memory · Ingest · Audit | n/a |
| Can grant / revoke consent | ✅ self only | ❌ blocked at API + UI | n/a |
| Can read consented data | n/a (own) | ✅ within scope | ❌ 403 |

**Patient grants are the only source of write authority for consent records.** Doctors calling `POST /api/Consent` (or DELETE) get `403 Only patients can manage their own consent`. The Consent tab is also hidden in the UI for non-patient roles.

**Impersonation switcher** (top right) lets demo leads toggle identities. The default unnamed "Dr. Demo" identity is a dev-bypass — sees all patients (so first-run dev works without setting up grants). Any *named* identity (Dr. Mehta, Dr. Khan, the patient) triggers full role + consent enforcement.

**Per-resource read gating** (after role checks pass): the patient chooses which categories to share — `conditions`, `medications`, `observations`, etc. — and the consent gate matches each request's required category against the active grant. 9 categories total, 3 flagged sensitive (`mental-health`, `reproductive-health`, `genetic`).

**Audit trail** ([AuditLog](apps/api/src/models/AuditLog.js)) captures every consent decision (allow / deny / grant / revoke). Patient sees the full log for their record; doctors see entries for patients they currently have consent for.

---

## Useful commands

```bash
npm run dev                          # api + web concurrently
npm run dev:api                      # api only
npm run dev:web                      # web only
npm run seed                         # reset + reseed 3 demo patients
npm run ingest:synthea -- --reset    # load all bundles from data/synthea/fhir
```

---

## Configuration

`apps/api/.env`:

```
PORT=4000
NODE_ENV=development

# MongoDB Atlas — get from cloud.mongodb.com → Cluster → Connect → Drivers
MONGO_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/patient_memory?retryWrites=true&w=majority

JWT_SECRET=change-me-in-prod
JWT_EXPIRES_IN=7d

# Optional — without this, agent layer runs in deterministic mock mode
# (rule-based brief synthesis, rule-based distillation). All of the demo
# works without it; with it you get streaming LLM prose + vision OCR.
# Get a key at console.groq.com → API Keys.
GROQ_API_KEY=
```

---

## What's built — milestone log

- **M1** — Monorepo, FHIR-shaped Mongo models, REST API, seed personas, clinician dashboard with lab trend charts.
- **M2** — Auth + consent middleware, audit log, Retrieval/Risk/Synthesis agents, orchestrator, SSE-streamed `_brief`, BriefPanel UI with provenance pins.
- **M3-1** — Synthea bundle ingestion: FHIR Bundle parser with two-pass `urn:uuid` reference mapping, idempotent reset.
- **M3-2** — Patient consent portal (granular toggles), AuditLogPanel, ImpersonationSwitcher, gate enforcement per category, ranked retrieval with complaint focus.
- **M3-3** — Cite-click drill-down: `GET /api/Resource/:type/:id` + ProvenanceModal with type-specific renderers (Condition, MedicationRequest, Observation, AllergyIntolerance, Encounter, Patient, DerivedMemory).
- **M3-4** — HL7v2 / CCDA / image ingestion: pipe-delimited parser, template-OID-dispatch CCDA parser, Groq vision image extractor. Plus the latent `$op` route bug fix.
- **M3-5** — Derived memory layer: 8 memory kinds, distillation agent (LLM + rule-based fallback), MemoryPanel with reject/restore, brief integration with `[cite:DerivedMemory/...]` provenance.

---

## License & disclaimers

This is a hackathon project. **Not for clinical use.** All seed data is synthetic. The system is structured around explicit patient consent and audit-by-default, but production deployment would require formal HIPAA / GDPR / DPDP review, real authentication (this uses dev-mode JWTs), and a hardened FHIR server.
