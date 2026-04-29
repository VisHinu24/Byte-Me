import { Router } from 'express';

const router = Router();

/**
 * GET /api/me — current user identity, used by the frontend to gate UI by
 * role. The auth middleware has already populated req.user; we just expose
 * a sanitized view (no secrets).
 */
router.get('/', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const { sub, role, name, providerId, impersonated } = req.user;
  res.json({ sub, role, name, providerId, impersonated: !!impersonated });
});

export default router;
