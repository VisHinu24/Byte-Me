import mongoose, { Schema } from 'mongoose';

/**
 * Patient-granted consent record. Each consent grants a clinician/provider
 * access to a specific set of FHIR data categories for a bounded time window.
 *
 * The Consent Gate middleware checks every request against these.
 * Modeled loosely on FHIR Consent resource.
 */
const consentSchema = new Schema(
  {
    resourceType: { type: String, default: 'Consent', immutable: true },
    status: {
      type: String,
      enum: ['draft', 'active', 'rejected', 'inactive', 'entered-in-error'],
      default: 'active',
    },
    patient: { reference: String, display: String }, // Patient/{id}
    grantee: {
      type: { type: String, enum: ['Practitioner', 'Organization', 'PatientSelf'] },
      reference: String, // Practitioner/{id} or Organization/{id}
      display: String,
    },
    scope: {
      // Categories of FHIR data this consent covers.
      categories: [
        {
          type: String,
          enum: [
            'demographics',
            'conditions',
            'medications',
            'allergies',
            'observations',
            'encounters',
            'mental-health',
            'reproductive-health',
            'genetic',
            'all',
          ],
        },
      ],
    },
    purpose: [String], // e.g. "treatment", "emergency", "research"
    period: {
      start: { type: Date, default: Date.now },
      end: Date,
    },
    revokedAt: Date,
  },
  { timestamps: true, collection: 'Consent' }
);

consentSchema.index({ 'patient.reference': 1, status: 1 });
consentSchema.index({ 'grantee.reference': 1, status: 1 });

consentSchema.methods.isCurrentlyActive = function () {
  if (this.status !== 'active') return false;
  if (this.revokedAt) return false;
  const now = new Date();
  if (this.period?.end && this.period.end < now) return false;
  if (this.period?.start && this.period.start > now) return false;
  return true;
};

consentSchema.methods.coversCategory = function (category) {
  const cats = this.scope?.categories ?? [];
  return cats.includes('all') || cats.includes(category);
};

export const Consent = mongoose.model('Consent', consentSchema);
