import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createHealthRouter, type HealthCheckers, healthRouter } from './routes/health.routes.js';
import { createAuthRouter, authRouter } from './routes/auth.routes.js';
import { createWatchlistRouter, type DbClient, watchlistRouter } from './routes/watchlist.routes.js';
import { createMarketRouter, marketRouter } from './routes/market.routes.js';
import { createChangeRouter, changeRouter } from './routes/change.routes.js';
import { createCheckRouter, checkRouter } from './routes/check.routes.js';
import { createIntelligenceRouter, intelligenceRouter } from './routes/intelligence.routes.js';
import { createSimulationRouter, simulationRouter } from './routes/simulation.routes.js';

export interface AppOptions {
  healthCheckers?: HealthCheckers;
  db?: DbClient;
}

export function createApp(options?: AppOptions | HealthCheckers): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Determine options structure
  let healthCheckers: HealthCheckers | undefined;
  let db: DbClient | undefined;

  if (options) {
    if ('checkPostgres' in options) {
      healthCheckers = options;
    } else {
      healthCheckers = options.healthCheckers;
      db = options.db;
    }
  }

  // Health routes
  if (healthCheckers) {
    app.use(createHealthRouter(healthCheckers));
  } else {
    app.use(healthRouter);
  }

  // API routes
  if (db) {
    app.use('/api/auth', createAuthRouter(db));
    app.use('/api/watchlists', createWatchlistRouter(db));
    app.use('/api/watchlists', createCheckRouter(db));
    app.use('/api/watchlists', createIntelligenceRouter(db));
    app.use('/api/stocks', createMarketRouter(db));
    app.use('/api/stocks', createChangeRouter(db));
    app.use('/api/market', createSimulationRouter(db));
  } else {
    app.use('/api/auth', authRouter);
    app.use('/api/watchlists', watchlistRouter);
    app.use('/api/watchlists', checkRouter);
    app.use('/api/watchlists', intelligenceRouter);
    app.use('/api/stocks', marketRouter);
    app.use('/api/stocks', changeRouter);
    app.use('/api/market', simulationRouter);
  }

  // 404 Handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Global Error Handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[App] Unhandled error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

export const app = createApp();
