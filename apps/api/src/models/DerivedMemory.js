import mongoose, { Schema } from 'mongoose';
import { provenanceSchema } from './fhirCommon.js';

/**
 * DerivedMemory — agent-distilled, persistent observation about a patient
 * that emerges from synthesizing across raw FHIR records.
 *
 * Examples (each carrying citations to source FHIR resources):
 *   - "Sept 2024 pneumonia episode — responded to Augmentin, no readmission"
 *   - "HbA1c trend: 8.6 → 6.9 over 5 yrs — long-term improving control"
 *   - "Polypharmacy alert: 7 active meds across 3 prescribers"
 *   - "Documented Penicillin allergy — confirmed 2010, hives reaction"
 *
 * Memories are append-only with supersession. Editing replaces the prior
 * memory (status=superseded, supersededBy=new._id) so the audit chain is
 * preserved.
 */
const memorySchema = new Schema(
  {
    patient: { reference: { type: String, required: true } },

    kind: {
      type: String,
      enum: [
        'episode',           // discrete clinical event with start/end
        'treatment-response', // what worked / didn't for which condition
        'preference',         // dosing schedule, communication style, etc
        'risk-pattern',       // recurring risk signal (allergy, OOR labs)
        'long-term-trend',    // multi-year trajectory
        'discontinuation',    // why a med/treatment was stopped
        'family-history',
        'social',
      ],
      required: true,
    },

    title: { type: String, required: true, maxlength: 140 },
    summary: { type: String, required: true, maxlength: 1000 },

    timeWindow: {
      start: Date,
      end: Date,
    },

    // Citations — every memory must point back to source FHIR records.
    sources: [
      {
        resourceType: {
          type: String,
          enum: ['Patient', 'Encounter', 'Condition', 'MedicationRequest', 'Observation', 'AllergyIntolerance'],
          required: true,
        },
        id: { type: String, required: true },
        role: String, // e.g. "primary", "context", "evidence"
        _id: false,
      },
    ],

    tags: [String], // free-form: 'cardiac', 'diabetes', 'allergy', etc
    confidence: { type: Number, min: 0, max: 1, default: 0.7 },

    createdBy: {
      kind: { type: String, enum: ['agent', 'clinician', 'patient'], default: 'agent' },
      id: String, // agent name or user id
      modelHint: String, // e.g. 'llama-3.1-8b-instant', 'rule-based-mock'
    },

    status: {
      type: String,
      enum: ['active', 'superseded', 'flagged-stale', 'rejected'],
      default: 'active',
    },
    supersededBy: { type: Schema.Types.ObjectId, ref: 'DerivedMemory' },
    rejectedReason: String,

    provenance: [provenanceSchema], // optional — distillation run metadata
  },
  { timestamps: true, collection: 'DerivedMemory' }
);

memorySchema.index({ 'patient.reference': 1, status: 1, createdAt: -1 });
memorySchema.index({ 'patient.reference': 1, kind: 1 });

memorySchema.virtual('citationKey').get(function () {
  // Deterministic dedup key from kind + title + first source — used by
  // distillation to avoid duplicating memories on re-runs.
  const src = this.sources?.[0];
  return `${this.kind}::${this.title}::${src?.resourceType ?? ''}/${src?.id ?? ''}`;
});

memorySchema.set('toJSON', { virtuals: true });

export const DerivedMemory = mongoose.model('DerivedMemory', memorySchema);
