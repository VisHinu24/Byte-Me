import mongoose, { Schema } from 'mongoose';
import {
  codeableConceptSchema,
  codingSchema,
  referenceSchema,
  periodSchema,
  provenanceSchema,
} from './fhirCommon.js';

const encounterSchema = new Schema(
  {
    resourceType: { type: String, default: 'Encounter', immutable: true },
    status: {
      type: String,
      enum: [
        'planned',
        'arrived',
        'triaged',
        'in-progress',
        'onleave',
        'finished',
        'cancelled',
        'entered-in-error',
        'unknown',
      ],
      default: 'finished',
    },
    class: codingSchema, // ambulatory, inpatient, emergency...
    type: [codeableConceptSchema],
    subject: referenceSchema, // Patient/...
    period: periodSchema,
    reasonCode: [codeableConceptSchema],
    diagnosis: [
      {
        condition: referenceSchema,
        rank: Number,
        _id: false,
      },
    ],
    location: [
      {
        location: referenceSchema,
        period: periodSchema,
        _id: false,
      },
    ],
    serviceProvider: referenceSchema, // Organization/...

    provenance: [provenanceSchema],
  },
  { timestamps: true, collection: 'Encounter' }
);

encounterSchema.index({ 'subject.reference': 1, 'period.start': -1 });

export const Encounter = mongoose.model('Encounter', encounterSchema);
