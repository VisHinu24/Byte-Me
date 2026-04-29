import { Consent, AuditLog } from '../models/index.js';
import { HttpError } from './error.js';
import { logger } from '../config/logger.js';
import { isDev } from '../config/env.js';

/**
 * Hard gate. For any route that touches a specific patient's data, enforce:
 *   - the requester is the patient themselves, OR
 *   - an active Consent grants this requester access to the requested category.
 *
 * Pass a category ('conditions', 'medications', ...) to require coverage of
 * that specific category. Pass '*' to require ANY active consent — useful
 * for the patient summary / brief endpoints where the gate is binary.
 *
 * Dev mode bypasses for the default unauthenticated identity but enforces
 * for impersonated users (so the demo can show real consent behavior).
 */
export function requireConsent(category) {
  return async function consentGate(req, _res, next) {
    const patientId = req.params.id;
    if (!patientId) throw new HttpError(400, 'Patient id required on path');
    if (!req.user) throw new HttpError(401, 'Not authenticated');

    const patientRef = `Patient/${patientId}`;

    // 1. Patient accessing their own record — unrestricted
    if (req.user.role === 'patient' && req.user.sub === patientId) {
      req.consent = { grantedCategories: null, scope: 'self' };
      await AuditLog.create({
        actor: { kind: 'user', id: req.user.sub, role: req.user.role },
        action: 'consent.check',
        patient: { reference: patientRef },
        outcome: 'allowed',
        reason: 'patient-self',
        details: { category },
        ip: req.ip,
      }).catch((err) => logger.warn({ err }, 'audit log write failed'));
      return next();
    }

    // 2. Find active Consents for this requester + category
    const granteeRef = req.user.providerId ?? `Practitioner/${req.user.sub}`;
    const consents = await Consent.find({
      'patient.reference': patientRef,
      'grantee.reference': granteeRef,
      status: 'active',
    });

    const live = consents.filter((c) => c.isCurrentlyActive());

    let allowed = false;
    let reason = 'no-consent';
    if (live.length === 0 && consents.length > 0) {
      reason = 'consent-inactive';
    } else if (live.length > 0) {
      // '*' means any active consent suffices.
      if (category === '*') {
        allowed = true;
        reason = 'any-consent';
      } else if (live.some((c) => c.coversCategory(category))) {
        allowed = true;
        reason = 'consent-grant';
      } else {
        reason = `consent-active-but-category-not-covered:${category}`;
      }
    }

    // Dev bypass applies only for the default (non-impersonated) demo
    // identity, so first-run dev works smoothly. Impersonated users go
    // through the real gate so the demo can show enforcement.
    if (!allowed && isDev && !req.user.impersonated) {
      req.consent = { grantedCategories: null, scope: 'dev-bypass' };
      await AuditLog.create({
        actor: { kind: 'user', id: req.user.sub, role: req.user.role },
        action: 'consent.check',
        patient: { reference: patientRef },
        outcome: 'allowed',
        reason: `dev-bypass:${reason}`,
        details: { category, granteeRef },
        ip: req.ip,
      }).catch((err) => logger.warn({ err }, 'audit log write failed'));
      logger.warn({ patientRef, granteeRef, category, reason }, 'consent dev-bypass');
      return next();
    }

    if (allowed) {
      // Aggregate the union of granted categories across all live grants.
      // 'all' on any grant means unrestricted.
      const cats = new Set();
      for (const c of live) {
        for (const k of c.scope?.categories ?? []) cats.add(k);
      }
      const grantedCategories = cats.has('all') ? null : [...cats];
      req.consent = {
        grantedCategories,
        scope: 'consent-grant',
        grants: live.map((c) => ({
          id: c._id?.toString(),
          categories: c.scope?.categories ?? [],
          period: c.period,
        })),
      };
    }

    await AuditLog.create({
      actor: { kind: 'user', id: req.user.sub, role: req.user.role },
      action: 'consent.check',
      patient: { reference: patientRef },
      outcome: allowed ? 'allowed' : 'denied',
      reason,
      details: { category, granteeRef },
      ip: req.ip,
    }).catch((err) => logger.warn({ err }, 'audit log write failed'));

    if (!allowed) throw new HttpError(403, `Consent required: ${category}`, { reason });
    next();
  };
}
