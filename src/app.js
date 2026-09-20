import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';
import { rateLimit } from './security/rate-limit.js';
import { router } from './routes/index.js';

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(pinoHttp({ logger }));
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
    const error = new Error('CORS origin denied');
    error.statusCode = 403;
    error.code = 'cors_origin_denied';
    return callback(error);
  },
  credentials: true
}));
app.use(express.json({ limit: '64kb' }));
app.use(rateLimit);
app.use('/api', router);
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
app.use((error, req, res, _next) => {
  req.log.error({ err: error }, 'request_failed');
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const body = status === 403
    ? { error: error.code || 'forbidden' }
    : { error: 'internal_error' };
  res.status(status).json(body);
});
