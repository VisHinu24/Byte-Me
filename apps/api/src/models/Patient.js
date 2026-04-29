import mongoose, { Schema } from 'mongoose';
import {
  humanNameSchema,
  contactPointSchema,
  addressSchema,
  codeableConceptSchema,
  provenanceSchema,
} from './fhirCommon.js';

const patientSchema = new Schema(
  {
    resourceType: { type: String, default: 'Patient', immutable: true },
    identifier: [
      {
        system: String, // e.g. "https://abdm.gov.in/abha"
        value: String,
        _id: false,
      },
    ],
    active: { type: Boolean, default: true },
    name: [humanNameSchema],
    telecom: [contactPointSchema],
    gender: { type: String, enum: ['male', 'female', 'other', 'unknown'] },
    birthDate: Date,
    address: [addressSchema],
    maritalStatus: codeableConceptSchema,
    communication: [
      {
        language: codeableConceptSchema,
        preferred: Boolean,
        _id: false,
      },
    ],
    deceasedBoolean: Boolean,
    deceasedDateTime: Date,

    // Internal fields
    provenance: [provenanceSchema],
  },
  { timestamps: true, collection: 'Patient' }
);

patientSchema.index({ 'identifier.value': 1 });
patientSchema.index({ 'name.family': 1, 'name.given': 1 });

patientSchema.virtual('displayName').get(function () {
  const n = this.name?.[0];
  if (!n) return 'Unknown';
  if (n.text) return n.text;
  return [...(n.given ?? []), n.family].filter(Boolean).join(' ');
});

patientSchema.set('toJSON', { virtuals: true });

export const Patient = mongoose.model('Patient', patientSchema);
