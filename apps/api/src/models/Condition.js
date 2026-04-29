import mongoose, { Schema } from 'mongoose';
import {
  codeableConceptSchema,
  referenceSchema,
  provenanceSchema,
} from './fhirCommon.js';

const conditionSchema = new Schema(
  {
    resourceType: { type: String, default: 'Condition', immutable: true },
    clinicalStatus: codeableConceptSchema, // active | resolved | recurrence...
    verificationStatus: codeableConceptSchema,
    category: [codeableConceptSchema],
    severity: codeableConceptSchema,
    code: codeableConceptSchema, // SNOMED / ICD-10
    subject: referenceSchema,
    encounter: referenceSchema,
    onsetDateTime: Date,
    abatementDateTime: Date,
    recordedDate: Date,
    note: [
      {
        text: String,
        time: Date,
        _id: false,
      },
    ],

    provenance: [provenanceSchema],
  },
  { timestamps: true, collection: 'Condition' }
);

conditionSchema.index({ 'subject.reference': 1, recordedDate: -1 });

export const Condition = mongoose.model('Condition', conditionSchema);
