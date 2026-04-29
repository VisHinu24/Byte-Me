import mongoose, { Schema } from 'mongoose';

/**
 * Append-only audit log. Every read of patient data, every agent invocation,
 * every consent decision lands here. Visible to the patient via their portal.
 */
const auditLogSchema = new Schema(
  {
    at: { type: Date, default: Date.now, index: true },
    actor: {
      kind: { type: String, enum: ['user', 'agent', 'system'] },
      id: String, // userId or agent name
      role: String, // clinician, patient, admin, agent-name
    },
    action: {
      type: String,
      enum: [
        'patient.read',
        'patient.search',
        'summary.read',
        'brief.synthesize',
        'consent.grant',
        'consent.revoke',
        'consent.check',
        'agent.retrieval',
        'agent.risk',
        'agent.synthesis',
      ],
      required: true,
    },
    patient: { reference: String }, // Patient/{id}
    outcome: { type: String, enum: ['allowed', 'denied', 'success', 'error'], default: 'success' },
    reason: String,
    details: Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: true, collection: 'AuditLog' }
);

auditLogSchema.index({ 'patient.reference': 1, at: -1 });
auditLogSchema.index({ 'actor.id': 1, at: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
