import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('Configuration Loader', () => {
  it('loads valid default configuration when environment variables are omitted', () => {
    const loaded = loadConfig({});
    expect(loaded.nodeEnv).toBe('development');
    expect(loaded.port).toBe(3000);
    expect(loaded.postgres.host).toBe('localhost');
    expect(loaded.postgres.port).toBe(5432);
    expect(loaded.postgres.database).toBe('market_watchlist');
    expect(loaded.postgres.user).toBe('postgres');
    expect(loaded.postgres.testDatabase).toBe('market_watchlist_test');
  });

  it('correctly parses custom environment variables', () => {
    const customEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      BACKEND_PORT: '4000',
      POSTGRES_HOST: 'pg.internal',
      POSTGRES_PORT: '5433',
      POSTGRES_DB: 'custom_market_watchlist',
      POSTGRES_USER: 'test_user',
      POSTGRES_PASSWORD: 'secretpassword',
      POSTGRES_TEST_DB: 'custom_test_db',
    };

    const loaded = loadConfig(customEnv);
    expect(loaded.nodeEnv).toBe('test');
    expect(loaded.port).toBe(4000);
    expect(loaded.postgres.host).toBe('pg.internal');
    expect(loaded.postgres.port).toBe(5433);
    expect(loaded.postgres.database).toBe('custom_market_watchlist');
    expect(loaded.postgres.user).toBe('test_user');
    expect(loaded.postgres.password).toBe('secretpassword');
    expect(loaded.postgres.testDatabase).toBe('custom_test_db');
  });

  it('throws a descriptive error on invalid PORT configuration', () => {
    expect(() => loadConfig({ BACKEND_PORT: 'invalid-port' })).toThrow(
      /Invalid PORT configuration/
    );
    expect(() => loadConfig({ BACKEND_PORT: '-1' })).toThrow(
      /Invalid PORT configuration/
    );
  });

  it('throws a descriptive error on invalid POSTGRES_PORT configuration', () => {
    expect(() => loadConfig({ POSTGRES_PORT: 'invalid' })).toThrow(
      /Invalid POSTGRES_PORT configuration/
    );
  });

  it('enforces explicit JWT_SECRET in production mode', () => {
    // Missing JWT_SECRET in production
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      /JWT_SECRET must be explicitly provided in production mode/
    );

    // Empty/whitespace JWT_SECRET in production
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: '   ' })).toThrow(
      /JWT_SECRET must be explicitly provided in production mode/
    );

    // Valid JWT_SECRET in production
    const prodConfig = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-super-secret-key-32-chars-long!',
    });
    expect(prodConfig.nodeEnv).toBe('production');
    expect(prodConfig.jwtSecret).toBe('production-super-secret-key-32-chars-long!');
  });

  it('falls back to development JWT_SECRET in non-production environments', () => {
    const devConfig = loadConfig({ NODE_ENV: 'development' });
    expect(devConfig.jwtSecret).toBe('dev-jwt-secret-key-32chars-minimum-for-hackathon');

    const testConfig = loadConfig({ NODE_ENV: 'test' });
    expect(testConfig.jwtSecret).toBe('dev-jwt-secret-key-32chars-minimum-for-hackathon');
  });
});
