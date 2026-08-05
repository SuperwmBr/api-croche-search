import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.x-admin-key', '*.token', '*.apiKey', '*.key'],
    censor: '[REDACTED]'
  }
});
