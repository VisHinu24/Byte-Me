import { logger } from '../config/logger.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: 'NotFound', path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status ?? 500;
  if (status >= 500) logger.error({ err }, 'request failed');
  else logger.debug({ err: err.message, status }, 'request rejected');

  res.status(status).json({
    error: err.name ?? 'Error',
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
