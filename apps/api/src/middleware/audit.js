import { AuditLog } from '../models/index.js';
import { logger } from '../config/logger.js';

export async function recordAudit({ req, action, patientId, outcome = 'success', reason, details }) {
  try {
    await AuditLog.create({
      actor: req?.user
        ? { kind: 'user', id: req.user.sub, role: req.user.role }
        : { kind: 'system', id: 'system', role: 'system' },
      action,
      patient: patientId ? { reference: `Patient/${patientId}` } : undefined,
      outcome,
      reason,
      details,
      ip: req?.ip,
    });
  } catch (err) {
    logger.warn({ err, action }, 'audit log write failed');
  }
}
