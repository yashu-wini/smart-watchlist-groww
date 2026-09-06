import dotenv from 'dotenv';

// Load environment variables from .env if present
dotenv.config();

export interface AppConfig {
  nodeEnv: string;
  port: number;
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password?: string;
    testDatabase: string;
  };
  jwtSecret: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const port = parseInt(env.BACKEND_PORT ?? env.PORT ?? '3000', 10);

  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT configuration: "${env.BACKEND_PORT ?? env.PORT}"`);
  }

  const pgHost = env.POSTGRES_HOST ?? 'localhost';
  const pgPort = parseInt(env.POSTGRES_PORT ?? '5432', 10);
  if (isNaN(pgPort) || pgPort <= 0 || pgPort > 65535) {
    throw new Error(`Invalid POSTGRES_PORT configuration: "${env.POSTGRES_PORT}"`);
  }

  const pgDb = env.POSTGRES_DB ?? 'market_watchlist';
  const pgUser = env.POSTGRES_USER ?? 'postgres';
  const pgPassword = env.POSTGRES_PASSWORD ?? 'postgres';
  const pgTestDb = env.POSTGRES_TEST_DB ?? 'market_watchlist_test';
  let jwtSecret: string;
  if (nodeEnv === 'production') {
    if (!env.JWT_SECRET || env.JWT_SECRET.trim().length === 0) {
      throw new Error('JWT_SECRET must be explicitly provided in production mode (NODE_ENV="production")');
    }
    jwtSecret = env.JWT_SECRET.trim();
  } else {
    jwtSecret = env.JWT_SECRET ?? 'dev-jwt-secret-key-32chars-minimum-for-hackathon';
  }

  return {
    nodeEnv,
    port,
    postgres: {
      host: pgHost,
      port: pgPort,
      database: pgDb,
      user: pgUser,
      password: pgPassword,
      testDatabase: pgTestDb,
    },
    jwtSecret,
  };
}

export const config = loadConfig();
