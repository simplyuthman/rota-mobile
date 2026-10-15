/**
 * =============================================================================
 * Rota API — Server Entry Point
 * =============================================================================
 * Starts the HTTP server, registers SIGTERM/SIGINT handlers for graceful
 * shutdown (closes DB pools and Redis before exiting).
 * =============================================================================
 */

import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabases } from './db/index.js';
import { closeRedis } from './db/redis.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutdown signal received');
    try {
      await app.close();
      await Promise.all([closeDatabases(), closeRedis()]);
      app.log.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(
      { port: env.PORT, host: env.HOST, nodeEnv: env.NODE_ENV },
      'Rota API server started',
    );
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

void main();
