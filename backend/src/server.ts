import { app } from './app.js';
import { config } from './config.js';
import { closePostgres } from './infrastructure/postgres.js';

const server = app.listen(config.port, () => {
  console.log(`[Server] Smart Market Watchlist Backend running in "${config.nodeEnv}" mode on port ${config.port}`);
  console.log(`[Server] Health endpoint: http://localhost:${config.port}/health`);
});

let isShuttingDown = false;

async function handleShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    console.log('[Server] HTTP server closed.');

    await Promise.allSettled([
      closePostgres().then(() => console.log('[PostgreSQL] Connection pool closed.')),
    ]);

    console.log('[Server] Graceful shutdown complete. Exiting.');
    process.exit(0);
  });

  // Force shutdown after 5s if pool fails to close
  setTimeout(() => {
    console.error('[Server] Forced shutdown timeout exceeded. Exiting immediately.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => void handleShutdown('SIGINT'));
process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
