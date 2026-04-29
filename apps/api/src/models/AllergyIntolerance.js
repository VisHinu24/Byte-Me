import mongoose, { Schema } from 'mongoose';
import {
  codeableConceptSchema,
  referenceSchema,
  provenanceSchema,
} from './fhirCommon.js';

const allergyIntoleranceSchema = new Schema(
  {
    resourceType: { type: String, default: 'AllergyIntolerance', immutable: true },
    clinicalStatus: codeableConceptSchema,
    verificationStatus: codeableConceptSchema,
    type: { type: String, enum: ['allergy', 'intolerance'] },
    category: [{ type: String, enum: ['food', 'medication', 'environment', 'biologic'] }],
    criticality: { type: String, enum: ['low', 'high', 'unable-to-assess'] },
    code: codeableConceptSchema,
    patient: referenceSchema,
    onsetDateTime: Date,
    recordedDate: Date,
    reaction: [
      {
        substance: codeableConceptSchema,
        manifestation: [codeableConceptSchema],
        severity: { type: String, enum: ['mild', 'moderate', 'severe'] },
        _id: false,
      },
    ],

    provenance: [provenanceSchema],
  },
  { timestamps: true, collection: 'AllergyIntolerance' }
);

allergyIntoleranceSchema.index({ 'patient.reference': 1 });

export const AllergyIntolerance = mongoose.model('AllergyIntolerance', allergyIntoleranceSchema);
