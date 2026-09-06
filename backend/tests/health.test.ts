import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { HealthCheckers } from '../src/routes/health.routes.js';

describe('GET /health endpoint', () => {
  it('returns 200 and healthy status when PostgreSQL is available', async () => {
    const mockCheckers: HealthCheckers = {
      checkPostgres: vi.fn().mockResolvedValue(true),
    };

    const testApp = createApp(mockCheckers);
    const response = await request(testApp).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'backend',
      dependencies: {
        postgres: 'ok',
      },
    });
    expect(mockCheckers.checkPostgres).toHaveBeenCalledTimes(1);
  });

  it('returns 503 and reports postgres as error when postgres is unavailable', async () => {
    const mockCheckers: HealthCheckers = {
      checkPostgres: vi.fn().mockResolvedValue(false),
    };

    const testApp = createApp(mockCheckers);
    const response = await request(testApp).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'error',
      service: 'backend',
      dependencies: {
        postgres: 'error',
      },
    });
  });

  it('returns 503 and reports postgres as error when postgres health check throws', async () => {
    const mockCheckers: HealthCheckers = {
      checkPostgres: vi.fn().mockRejectedValue(new Error('Connection timeout')),
    };

    const testApp = createApp(mockCheckers);
    const response = await request(testApp).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'error',
      service: 'backend',
      dependencies: {
        postgres: 'error',
      },
    });
  });

  it('returns 404 on unmapped routes', async () => {
    const testApp = createApp();
    const response = await request(testApp).get('/unknown-endpoint');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not Found' });
  });
});
