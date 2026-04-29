import mongoose, { Schema } from 'mongoose';
import {
  codeableConceptSchema,
  referenceSchema,
  periodSchema,
  provenanceSchema,
} from './fhirCommon.js';

const medicationRequestSchema = new Schema(
  {
    resourceType: { type: String, default: 'MedicationRequest', immutable: true },
    status: {
      type: String,
      enum: [
        'active',
        'on-hold',
        'cancelled',
        'completed',
        'entered-in-error',
        'stopped',
        'draft',
        'unknown',
      ],
      default: 'active',
    },
    intent: {
      type: String,
      enum: ['proposal', 'plan', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order'],
      default: 'order',
    },
    medicationCodeableConcept: codeableConceptSchema, // RxNorm / ATC / generic name
    subject: referenceSchema,
    encounter: referenceSchema,
    authoredOn: Date,
    requester: referenceSchema, // Practitioner
    reasonReference: [referenceSchema], // Conditions
    dosageInstruction: [
      {
        text: String,
        timing: {
          repeat: {
            frequency: Number,
            period: Number,
            periodUnit: String, // h | d | wk | mo
          },
        },
        doseAndRate: [
          {
            doseQuantity: { value: Number, unit: String },
            _id: false,
          },
        ],
        _id: false,
      },
    ],
    dispenseRequest: {
      validityPeriod: periodSchema,
      numberOfRepeatsAllowed: Number,
      quantity: { value: Number, unit: String },
    },

    provenance: [provenanceSchema],
  },
  { timestamps: true, collection: 'MedicationRequest' }
);

medicationRequestSchema.index({ 'subject.reference': 1, authoredOn: -1 });
medicationRequestSchema.index({ 'medicationCodeableConcept.text': 'text' });

export const MedicationRequest = mongoose.model('MedicationRequest', medicationRequestSchema);
