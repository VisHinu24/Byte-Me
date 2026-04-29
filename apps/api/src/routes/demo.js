import { Router } from 'express';
import { Patient } from '../models/index.js';

const router = Router();

/**
 * Demo-only endpoints that bypass role/consent filtering. These exist solely
 * to power the impersonation switcher in the UI — the user has to know all
 * available patient identities to switch into. NOT for production.
 *
 * In a real deployment this would be feature-flagged off and replaced with
 * a real authentication / SSO flow.
 */

router.get('/patients', async (_req, res) => {
  const items = await Patient.find({})
    .sort({ createdAt: 1 })
    .limit(50)
    .select({ name: 1, gender: 1, birthDate: 1 })
    .lean();

  res.json({
    total: items.length,
    items: items.map((p) => ({
      _id: p._id,
      displayName: buildDisplayName(p),
      gender: p.gender,
      birthDate: p.birthDate,
    })),
  });
});

function buildDisplayName(p) {
  const n = p.name?.[0];
  if (!n) return 'Unknown';
  if (n.text) return n.text;
  return [...(n.given ?? []), n.family].filter(Boolean).join(' ') || 'Unknown';
}

export default router;
