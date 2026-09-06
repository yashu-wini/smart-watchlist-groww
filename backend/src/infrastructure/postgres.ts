import pg from 'pg';
import { config, type AppConfig } from '../config.js';

const { Pool } = pg;

let defaultPool: pg.Pool | null = null;

export function getPostgresPool(customConfig?: Partial<AppConfig['postgres']>): pg.Pool {
  if (customConfig) {
    return new Pool({
      host: customConfig.host ?? config.postgres.host,
      port: customConfig.port ?? config.postgres.port,
      database: customConfig.database ?? config.postgres.database,
      user: customConfig.user ?? config.postgres.user,
      password: customConfig.password ?? config.postgres.password,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      max: 10,
    });
  }

  if (!defaultPool) {
    defaultPool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      max: 10,
    });

    defaultPool.on('error', (err) => {
      console.error('[PostgreSQL] Unexpected client error:', err.message);
    });
  }
  return defaultPool;
}

export async function checkPostgresHealth(
  poolInstance?: pg.Pool,
  timeoutMs = 2500
): Promise<boolean> {
  const pool = poolInstance ?? getPostgresPool();
  try {
    const checkPromise = pool.query('SELECT 1 AS health_check');
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PostgreSQL health check timed out')), timeoutMs)
    );

    const result = await Promise.race([checkPromise, timeoutPromise]);
    return Boolean(result && result.rows && result.rows.length > 0);
  } catch (error) {
    console.error('[PostgreSQL] Health check failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

export async function closePostgres(poolInstance?: pg.Pool): Promise<void> {
  const targetPool = poolInstance ?? defaultPool;
  if (targetPool) {
    try {
      await targetPool.end();
    } catch (error) {
      console.error('[PostgreSQL] Error closing pool:', error instanceof Error ? error.message : error);
    } finally {
      if (!poolInstance || poolInstance === defaultPool) {
        defaultPool = null;
      }
    }
  }
}
