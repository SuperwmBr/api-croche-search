import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';
const server = app.listen(env.PORT, env.HOST, () => logger.info({ host: env.HOST, port: env.PORT }, 'search_api_started'));
const shutdown = (signal) => { logger.info({ signal }, 'shutdown_started'); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
