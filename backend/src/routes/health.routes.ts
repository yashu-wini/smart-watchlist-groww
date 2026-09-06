import { Router, type Request, type Response } from 'express';
import { checkPostgresHealth } from '../infrastructure/postgres.js';

export interface HealthCheckers {
  checkPostgres: () => Promise<boolean>;
}

export function createHealthRouter(
  checkers: HealthCheckers = {
    checkPostgres: checkPostgresHealth,
  }
): Router {
  const router = Router();

  router.get('/health', async (_req: Request, res: Response) => {
    const postgresOk = await checkers.checkPostgres().catch(() => false);

    const dependencies = {
      postgres: postgresOk ? ('ok' as const) : ('error' as const),
    };

    const isHealthy = postgresOk;

    const responsePayload = {
      status: isHealthy ? ('ok' as const) : ('error' as const),
      service: 'backend' as const,
      dependencies,
    };

    const statusCode = isHealthy ? 200 : 503;
    res.status(statusCode).json(responsePayload);
  });

  return router;
}

export const healthRouter = createHealthRouter();
