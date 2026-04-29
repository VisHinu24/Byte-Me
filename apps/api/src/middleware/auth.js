import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from './error.js';

/**
 * Demo auth: clinicians and patients authenticate, get a JWT carrying their
 * role + identity. When DEMO_MODE is on (default), an `X-Dev-User` header
 * impersonates an identity, and unauthenticated requests fall through to a
 * default demo-clinician identity so the open demo URL works without login.
 *
 * Set DEMO_MODE=false to require real bearer tokens on every request — flip
 * this when you wire up real auth (OAuth / SMART-on-FHIR).
 *
 * Token payload: { sub, role, name, providerId? }
 *  - role: 'clinician' | 'patient' | 'admin'
 *  - sub: user id
 */
export function authenticate(req, _res, next) {
  // Explicit impersonation via header (demo only). Treated as a real
  // identity — the consent gate WILL enforce for impersonated users so
  // the demo can show consent enforcement working.
  if (env.demoMode && req.headers['x-dev-user']) {
    const [role, id, name] = String(req.headers['x-dev-user']).split(':');
    req.user = {
      sub: id ?? 'dev',
      role: role ?? 'clinician',
      name: name ?? 'Dev User',
      providerId: role === 'clinician' ? `Practitioner/${id ?? 'dev'}` : undefined,
      impersonated: true,
    };
    return next();
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    // No auth header. In demo mode, fall through to a default demo clinician
    // who DOES get the consent bypass (so first-run experience works).
    if (env.demoMode) {
      req.user = {
        sub: 'demo-clinician',
        role: 'clinician',
        name: 'Dr. Demo',
        providerId: 'Practitioner/demo',
        impersonated: false,
      };
      return next();
    }
    throw new HttpError(401, 'Missing bearer token');
  }

  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret);
    req.user = { ...payload, impersonated: false };
    next();
  } catch (err) {
    throw new HttpError(401, 'Invalid token');
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, `Requires role: ${roles.join(' or ')}`);
    }
    next();
  };
}

export function signToken(payload, opts = {}) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn, ...opts });
}
