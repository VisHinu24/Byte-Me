import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env, isDev } from './config/env.js';
import { logger } from './config/logger.js';
import healthRouter from './routes/health.js';
import patientRouter from './routes/patient.js';
import briefRouter from './routes/brief.js';
import consentRouter from './routes/consent.js';
import auditRouter from './routes/audit.js';
import resourceRouter from './routes/resource.js';
import memoryRouter, { memoryStatusRouter } from './routes/memory.js';
import ingestRouter from './routes/ingest.js';
import prescribeRouter from './routes/prescribe.js';
import meRouter from './routes/me.js';
import demoRouter from './routes/demo.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(isDev ? 'dev' : 'combined'));

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    })
  );

  app.use('/health', healthRouter);

  // Authenticate all /api/* routes (dev mode auto-injects a demo clinician).
  app.use('/api', authenticate);

  app.use('/api/me', meRouter);
  app.use('/api/_demo', demoRouter);
  app.use('/api/Patient', patientRouter);
  app.use('/api/Patient', briefRouter);
  app.use('/api/Patient', memoryRouter);
  app.use('/api/Patient', ingestRouter);
  app.use('/api/Patient', prescribeRouter);
  app.use('/api/DerivedMemory', memoryStatusRouter);
  app.use('/api/Consent', consentRouter);
  app.use('/api/AuditLog', auditRouter);
  app.use('/api/Resource', resourceRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/**
 * CORS policy:
 *   - In dev (no FRONTEND_ORIGIN set): permissive — `origin: true` echoes
 *     whatever origin the browser sent. Lets `localhost:5173` work alongside
 *     other dev hosts without manual allowlisting.
 *   - In prod (FRONTEND_ORIGIN set): only the configured origin(s) +
 *     localhost are allowed. FRONTEND_ORIGIN supports a comma-separated list
 *     so a staging + prod URL can coexist.
 */
function corsOptions() {
  if (!env.frontendOrigin) {
    return { origin: true, credentials: true };
  }
  const allowed = env.frontendOrigin
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  logger.info({ allowedOrigins: allowed }, 'cors policy: restricted to configured origins (+ localhost)');

  return {
    credentials: true,
    origin(origin, cb) {
      // Allow requests with no origin (curl, server-to-server, health probes).
      if (!origin) return cb(null, true);
      // Always allow localhost for local-against-prod debugging.
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      // Silent rejection: omit Access-Control-Allow-Origin so the browser
      // blocks. We don't surface a 500 — that just leaks server error logs
      // for what's a routine cross-origin probe.
      logger.warn({ origin }, 'cors: origin rejected');
      return cb(null, false);
    },
  };
}
