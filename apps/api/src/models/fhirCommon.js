import { Schema } from 'mongoose';

// Reusable FHIR primitives — kept liberal to handle messy real-world data.

export const codingSchema = new Schema(
  {
    system: String,
    code: String,
    display: String,
  },
  { _id: false }
);

export const codeableConceptSchema = new Schema(
  {
    coding: [codingSchema],
    text: String,
  },
  { _id: false }
);

export const referenceSchema = new Schema(
  {
    reference: String, // e.g. "Patient/123"
    display: String,
  },
  { _id: false }
);

export const periodSchema = new Schema(
  {
    start: Date,
    end: Date,
  },
  { _id: false }
);

export const humanNameSchema = new Schema(
  {
    use: String,
    text: String,
    family: String,
    given: [String],
    prefix: [String],
    suffix: [String],
  },
  { _id: false }
);

export const contactPointSchema = new Schema(
  {
    system: { type: String, enum: ['phone', 'email', 'fax', 'pager', 'url', 'sms', 'other'] },
    value: String,
    use: String,
  },
  { _id: false }
);

export const addressSchema = new Schema(
  {
    use: String,
    line: [String],
    city: String,
    state: String,
    postalCode: String,
    country: String,
  },
  { _id: false }
);

export const provenanceSchema = new Schema(
  {
    sourceSystem: String, // hospital / EHR identifier
    sourceFormat: { type: String, enum: ['FHIR', 'HL7v2', 'CCDA', 'PDF', 'MANUAL', 'SYNTHEA'] },
    ingestedAt: { type: Date, default: Date.now },
    sourceDocumentId: String, // GridFS pointer or external id
  },
  { _id: false }
);
