import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/', (_req, res) => {
  const mongoState = mongoose.connection.readyState; // 1 = connected
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    mongo: states[mongoState] ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
});

export default router;
