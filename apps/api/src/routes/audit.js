import { Router } from 'express';
import { AuditLog } from '../models/index.js';

const router = Router();

router.get('/', async (req, res) => {
  const { patientId, limit = 100 } = req.query;
  const filter = patientId ? { 'patient.reference': `Patient/${patientId}` } : {};
  const items = await AuditLog.find(filter)
    .sort({ at: -1 })
    .limit(Math.min(Number(limit), 500))
    .lean();
  res.json({ total: items.length, items });
});

export default router;
