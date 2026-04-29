import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { isDev } from './config/env.js';
import healthRouter from './routes/health.js';
import patientRouter from './routes/patient.js';
import briefRouter from './routes/brief.js';
import consentRouter from './routes/consent.js';
import auditRouter from './routes/audit.js';
import resourceRouter from './routes/resource.js';
import memoryRouter, { memoryStatusRouter } from './routes/memory.js';
import ingestRouter from './routes/ingest.js';
import meRouter from './routes/me.js';
import demoRouter from './routes/demo.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
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
  app.use('/api/DerivedMemory', memoryStatusRouter);
  app.use('/api/Consent', consentRouter);
  app.use('/api/AuditLog', auditRouter);
  app.use('/api/Resource', resourceRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
