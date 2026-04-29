import mongoose, { Schema } from 'mongoose';
import {
  codeableConceptSchema,
  referenceSchema,
  provenanceSchema,
} from './fhirCommon.js';

const observationSchema = new Schema(
  {
    resourceType: { type: String, default: 'Observation', immutable: true },
    status: {
      type: String,
      enum: [
        'registered',
        'preliminary',
        'final',
        'amended',
        'corrected',
        'cancelled',
        'entered-in-error',
        'unknown',
      ],
      default: 'final',
    },
    category: [codeableConceptSchema], // vital-signs | laboratory | imaging | ...
    code: codeableConceptSchema, // LOINC code (e.g. HbA1c)
    subject: referenceSchema,
    encounter: referenceSchema,
    effectiveDateTime: Date,
    issued: Date,
    valueQuantity: {
      value: Number,
      unit: String,
      system: String,
      code: String,
    },
    valueString: String,
    valueCodeableConcept: codeableConceptSchema,
    interpretation: [codeableConceptSchema], // H | L | N | A
    referenceRange: [
      {
        low: { value: Number, unit: String },
        high: { value: Number, unit: String },
        text: String,
        _id: false,
      },
    ],
    note: [{ text: String, time: Date, _id: false }],

    provenance: [provenanceSchema],
  },
  { timestamps: true, collection: 'Observation' }
);

// Time-series-friendly index for "trend HbA1c over time"
observationSchema.index({
  'subject.reference': 1,
  'code.coding.code': 1,
  effectiveDateTime: -1,
});

export const Observation = mongoose.model('Observation', observationSchema);
