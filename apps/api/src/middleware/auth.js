import jwt from 'jsonwebtoken';
import { env, isDev } from '../config/env.js';
import { HttpError } from './error.js';

/**
 * Demo auth: clinicians and patients authenticate, get a JWT carrying their
 * role + identity. In dev, an `X-Dev-User` header bypasses real auth so we can
 * iterate without a login flow.
 *
 * Token payload: { sub, role, name, providerId? }
 *  - role: 'clinician' | 'patient' | 'admin'
 *  - sub: user id
 */
export function authenticate(req, _res, next) {
  // Explicit impersonation via header — dev only, and treated as a real
  // identity. The consent gate will NOT bypass for impersonated users
  // (so the demo can show consent enforcement working).
  if (isDev && req.headers['x-dev-user']) {
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
    // No auth header. In dev, fall through to a default demo clinician
    // who DOES get the consent bypass (so first-run experience works).
    if (isDev) {
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
