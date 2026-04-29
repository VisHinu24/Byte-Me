# Demo script — 7-minute walkthrough

A scripted, narration-ready demo of the Patient Memory Layer. Open http://localhost:5173 and a backup terminal showing API logs.

> ⏱ **Total runtime: ~7 min.** Cuts down to 4 minutes if you skip the ingest section.

## Mental model — who can do what

The system has two roles, enforced server-side:

| | Patient (self) | Doctor with consent | Doctor without consent |
| --- | --- | --- | --- |
| Lands on `/` | their own chart | filtered patient list | empty list |
| Can see Brief, Memory, Ingest, Audit tabs | ✅ | ✅ | n/a |
| Can see Consent tab | ✅ | ❌ hidden | n/a |
| Can grant / revoke consent | ✅ self only | ❌ blocked at API | n/a |
| Can see other patients exist | n/a (only own record) | only patients with active consent | none |

The default unnamed "Dr. Demo" identity (no impersonation) is a dev-bypass — sees all patients, like a logged-out admin view. That's the identity you start the demo with.

---

## Prep (do this once before you present)

```bash
npm install
cp .env.example .env && cp .env.example apps/api/.env
# edit apps/api/.env — set MONGO_URI to your Atlas connection string
npm run seed             # loads 3 hand-crafted personas into Atlas
npm run dev              # api on :4000, web on :5173
```

Open http://localhost:5173. You should see three patients in the list (you're the default Dr. Demo identity). Pick **Aarav Sharma** for the demo — his profile is the richest.

> 💡 **Before the demo, copy Aarav's ObjectId.** On his chart page, click the small `id: 69f2…` text in the top-right of the header — it copies to clipboard. You'll need it to impersonate him during Act 4.

> 💡 **Optional:** set `ANTHROPIC_API_KEY` in `apps/api/.env` to switch synthesis from deterministic mock to streaming Claude prose. The mock is good enough for the demo flow; the real model is more impressive.

> 🎭 **Two voices in the demo.** You'll switch between three identities:
> - **Default clinician (Dr. Demo)** — the dev-bypass admin view, sees everything
> - **Dr. Anita Mehta (Cardiology)** — impersonated; consent-gated, no admin powers
> - **Aarav Sharma (the patient)** — only sees his own record, owns the consent decisions

---

## Act 1 — The brief (90 seconds)

> **Open Aarav Sharma's chart.**

**Narration:**
> "This is what a clinician sees when they open a patient. Demographics up top, but the meat is the agent-synthesized brief. Let me show what happens when I tell the system what the patient is here for."

1. In the **Patient's stated concern** input, type or click the chip:
   ```
   sugar levels rising
   ```
2. Click **Synthesize brief →**.

**What to point out as it runs:**

- **Step 1 (Retrieval)** lights up: `1 problems · 1 meds · 1 allergies · 1 memories · ⌘ 4 relevant to complaint`. Below it, the top-3 ranked items appear with relevance scores: *"2.57 · HbA1c improving over 5 yrs (matches: diabet, hba1c)"*. **Point at this.** *"The retrieval agent didn't just dump everything — it ranked the patient's longitudinal record by what's relevant to this complaint. BM25 with a clinical synonym table — sugar matches glucose, hba1c, metformin."*

- **Step 2 (Risk)** lights up. *"Rule-based, deterministic — drug-allergy conflicts, drug-drug interactions, lab-out-of-range. Critical alerts can't be hallucinated."*

- **Step 3 (Synthesis)** streams tokens. *"This is Claude composing the final brief. In offline mode, it's a deterministic rule-based fallback. With an API key, it's Opus 4.7 streaming."*

3. Read the brief out loud as it lands. The first line will be:
   > *"Re: 'sugar levels rising' — most relevant prior context: HbA1c improving over 5 yrs..."*

   **Point at this.** *"The system led with the prior context most relevant to the complaint — not just dumped everything."*

---

## Act 2 — Provenance (30 seconds)

**Narration:**
> "Clinicians don't trust black-box summaries. Every claim cites the source FHIR resource it came from."

1. Find a `📌 con` pin in the brief. **Click it.**
2. The **ProvenanceModal** opens showing the actual `Condition` resource — diagnosis code (SNOMED), onset date, status, and a collapsible raw FHIR JSON.
3. Scroll to the bottom — *"Source provenance: format SYNTHEA / system synthea / ingested 2 min ago."*
4. Close the modal. Click a `📌 mem` pin (DerivedMemory cite) — the memory opens with its own list of source citations.

**Why this matters:**
> "If we tell a clinician the patient's HbA1c trend is improving, they can drill all the way down to the actual lab observations the agent looked at. No magic, no hallucination."

---

## Act 3 — Derived memory (60 seconds)

**Narration:**
> "Most EHR systems treat data as raw facts. Our system has a memory layer — agent-distilled persistent observations across the longitudinal record."

1. Click the **Memory tab**.
2. If empty: click **Run distillation →**.
3. Memories appear, grouped by kind:
   - 🟦 **Episode** — *"ER visit: Symptomatic hypoglycemia on glimepiride"*
   - 🟥 **Risk pattern** — *"Documented Penicillin allergy"*, *"Polypharmacy: 4 active medications"*
   - 🟨 **Long-term trend** — *"HbA1c decreasing -18% over 5 readings — improving control"*

4. **Point at the citation chips** under each card. *"Every memory carries pins to the source FHIR resources it was derived from. Click any pin to drill down."*

5. Click a memory's **Reject** button → enter "this was actually addressed last visit" → memory greys out.

6. Switch back to **Clinical & brief** tab → re-synthesize → the brief now has a `**Memory recall**` section that surfaces these distilled insights with `[cite:DerivedMemory/...]` provenance.

**Why this matters:**
> "The same memory that another agent wrote two weeks ago is loaded back into context for the next clinician. The agents share state across visits — that's the 'memory layer' in 'patient memory layer.'"

---

## Act 4 — Patient owns access (2 minutes)

**Narration:**
> "Patients are the data controllers — not hospitals, not insurers. Let me show you what that actually means in practice."

### Beat 1 — Doctor without consent can't see anything

1. **Top right**, click the impersonation switcher. **Pick Dr. Anita Mehta (Cardiology).**
2. The patient list **goes empty**. Not "Consent required" on individual charts — the patients literally vanish.
3. *"Dr. Mehta has no consent from any patient yet. From her view, the system has zero patients. That's the privacy story: doctors don't even see other patients exist."*
4. Notice the **Consent tab is gone** from the nav. *"Doctors can't grant consent — only patients can. So the UI hides it. The API also blocks it — even if a doctor crafted the right HTTP request, they'd get 403."*

### Beat 2 — Switch to the patient and grant access

5. Click the impersonation switcher → paste **Aarav's ObjectId** (from your clipboard) into the "Patient ObjectId" field → click **Use**.
6. The header changes to **"My health record"** and the page **auto-redirects straight to Aarav's own chart**. No patient list — patients only have one record.
7. Click the **Consent tab**. *"This is what the patient sees. Five demo doctors to grant, nine data categories, six duration options."*
8. Pick **Dr. Anita Mehta** → toggle `conditions` + `medications` + `observations` (skip `mental-health` — show the sensitive amber tint) → duration **30 days** → click **Grant access**.
9. Active grants list now shows Dr. Mehta with the chosen scope and expiry.

### Beat 3 — Switch back to the doctor — patient now visible

10. Switch impersonation to **Dr. Mehta**.
11. The patient list now shows **one patient: Aarav Sharma**. *"The moment the patient granted access, Aarav appeared in her view. Revoke and he'd vanish again."*
12. Open his chart. **Brief works**. The Consent tab is still hidden — doctors never manage consent.

### Beat 4 — Audit trail (visible to both)

13. Click the **Audit tab**. *"Both patient and doctor see the audit log — but only for patients they have access to."*
14. Filter by **Denied** → see Dr. Mehta's earlier blocked attempts.
15. Filter by **Consent changes** → see the grant event the patient just made.

### Beat 5 — Patient revokes (optional, if time)

16. Switch back to **Aarav patient identity** → Consent tab → click **Revoke** on the Dr. Mehta grant.
17. Switch to **Dr. Mehta** → patient list goes empty again. *"Real-time enforcement. The consent state is the source of truth, not a permission cache."*

**Why this matters:**
> "This isn't a settings page. This is the architecture. The patient is the only entity that can grant or revoke. Doctors literally cannot see records they haven't been granted. Every decision is logged and visible to the patient. That's what 'explicit patient consent and granular data governance' looks like when it's a structural property of the system, not a compliance checkbox."

---

## Act 5 — Multi-format ingestion (90 seconds)

**Narration:**
> "Real-world EHR data isn't FHIR. Most of it is HL7 v2 messages, CCDA XML documents, and scanned PDFs. PML normalizes all of it."

1. Click the **Ingest tab**.
2. **HL7 v2 first**: click **HL7 v2** → **Load sample** → **Parse & ingest →**.
3. Result: *"8 Observations inserted"* with a preview showing Cholesterol, Triglycerides, HDL, LDL, HbA1c, Creatinine, Potassium, Calcium.
4. *"That was a real ORU^R01 message — pipe-delimited HL7 v2.5. We parsed MSH/PID/OBR/OBX, mapped LOINC codes, and inserted 8 FHIR Observations."*

5. Switch to **C-CDA XML** → **Load sample** → **Parse & ingest →**.
6. Result: *"7 resources inserted — 2 Conditions, 2 MedicationRequests, 1 AllergyIntolerance, 2 Observations"*.
7. *"Same patient, now also with structured XML. We dispatched on FHIR template OIDs to extract problem list, medications, allergies, and lab results."*

8. (Optional, if `ANTHROPIC_API_KEY` is set) Switch to **PDF / image** → upload a scanned prescription → result shows extracted structured FHIR with raw vision JSON in the collapsible footer.

9. Go back to **Memory tab** → **Run distillation** again.
10. *"The memory layer just learned from the new data — fresh memories from the HL7 lab panel and the CCDA discharge summary."*

11. Re-run **Synthesize brief**. The brief now references the freshly-ingested labs via `[cite:Observation/...]` pins.

**Why this matters:**
> "We're not waiting for everyone to adopt FHIR. The system meets reality where it is — HL7v2 is still the dominant format in production hospitals; CCDA is what discharge summaries look like; PDFs are what patients hand-carry between providers. All three normalize to the same FHIR layer."

---

## Closer — the architectural story (30 seconds)

> "Three things the system does that no current EHR does:
>
> 1. **The patient is the data controller.** Doctors can't see records they haven't been granted. They can't even see other patients exist. They can't grant or revoke their own access. The patient owns every consent decision — it's enforced in the API, not just the UI.
>
> 2. **Agents synthesize, not aggregate.** Retrieval ranks by complaint relevance. Risk catches drug-allergy conflicts deterministically. Synthesis composes the brief with provenance on every claim. Distillation persists insights so the next clinician benefits.
>
> 3. **Trust through architecture, not claims.** Every cite is clickable. Every consent decision is logged. Every memory is rejectable. The patient sees who accessed what, when, and why."

---

## Recovery — common demo issues

| Issue | Fix |
| --- | --- |
| `npm run dev` fails with mongo error | Check `MONGO_URI` in `apps/api/.env` is set to your Atlas string and Atlas Network Access allows your IP. |
| Brief endpoint times out | Verify `ANTHROPIC_API_KEY` or remove it (mock mode works). |
| Patient list empty when impersonating a clinician | That's correct behavior — the doctor has no consent. Switch to a patient and grant access first. |
| Patient list empty when on Default clinician | Run `npm run seed`. |
| Consent tab missing on chart | You're impersonating a doctor — Consent is patient-only. Switch to the patient identity. |
| Patient ObjectId field doesn't accept input | Make sure you copied the full 24-char hex id (top-right of any patient's header copies it). |
| "Module not found" on first run | `npm install` from repo root, not from a subdirectory. |
| PDF ingest fails with API key | The PDF must be a real document; vision returns empty arrays for non-clinical content. |

---

## What to skip if you only have 4 minutes

1. ✅ **Act 1 — The brief** (mandatory)
2. ✅ **Act 2 — Provenance** (mandatory)
3. ⏭ Skip Act 3 — Derived memory (mention briefly: *"The system also persists agent-distilled memories with citations — separate tab"*)
4. ✅ **Act 4 — Patient owns access** (the differentiator) — do beats 1 + 3 only, skip the patient grant step
5. ⏭ Skip Act 5 — Ingestion (mention: *"It also handles HL7v2 / CCDA / PDF — see the Ingest tab"*)
6. ✅ **Closer**

---

## What to skip if you only have 2 minutes

Just Act 1 + Act 2 + the closer. The brief with provenance pins is the core demo. Mention the patient-controlled consent model in one sentence: *"Doctors can't see records the patient hasn't granted them — and the patient grants come through this same UI under a separate identity."*
