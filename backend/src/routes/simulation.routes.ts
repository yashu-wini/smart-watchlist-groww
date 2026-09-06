import { Router, type Request, type Response } from 'express';
import { getPostgresPool } from '../infrastructure/postgres.js';
import type { DbClient } from './watchlist.routes.js';
import type { MarketScenario } from '../market/market-simulator.js';
import { simulateStockSnapshot } from '../market/market-feed.js';
import { config } from '../config.js';

const ALLOWED_SCENARIOS: readonly MarketScenario[] = ['STABLE', 'PRICE_MOVE', 'VOLUME_SPIKE'] as const;

export function createSimulationRouter(db: DbClient = getPostgresPool()): Router {
  const router = Router();

  // POST /api/market/simulate (Development-only endpoint)
  router.post('/simulate', async (req: Request, res: Response) => {
    const currentEnv = process.env.NODE_ENV ?? config.nodeEnv ?? 'development';

    // Development-only guard
    if (currentEnv !== 'development' && currentEnv !== 'test') {
      return res.status(404).json({ error: 'Not Found' });
    }

    try {
      const { stockId, scenario, marketTime } = req.body ?? {};

      // 1. Validate stockId
      if (stockId === undefined || stockId === null || typeof stockId !== 'number' || !Number.isInteger(stockId) || stockId <= 0) {
        return res.status(400).json({ error: 'Invalid or missing stockId: must be a positive integer' });
      }

      // 2. Validate scenario
      if (scenario === undefined || scenario === null || typeof scenario !== 'string' || !ALLOWED_SCENARIOS.includes(scenario as MarketScenario)) {
        return res.status(400).json({ error: 'Invalid scenario. Allowed: STABLE, PRICE_MOVE, VOLUME_SPIKE' });
      }

      // 3. Verify stock exists
      const stockCheck = await db.query('SELECT id FROM stocks WHERE id = $1;', [stockId]);
      if (stockCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Stock not found' });
      }

      // 4. Generate and persist snapshot
      const savedSnapshot = await simulateStockSnapshot(
        db,
        stockId,
        scenario as MarketScenario,
        marketTime
      );

      return res.status(201).json({
        stockId: savedSnapshot.stockId,
        price: savedSnapshot.price,
        openPrice: savedSnapshot.openPrice,
        highPrice: savedSnapshot.highPrice,
        lowPrice: savedSnapshot.lowPrice,
        previousClose: savedSnapshot.previousClose,
        volume: savedSnapshot.volume,
        marketTime:
          savedSnapshot.marketTime instanceof Date
            ? savedSnapshot.marketTime.toISOString()
            : new Date(savedSnapshot.marketTime).toISOString(),
        createdAt:
          savedSnapshot.createdAt instanceof Date
            ? savedSnapshot.createdAt.toISOString()
            : new Date(savedSnapshot.createdAt).toISOString(),
      });
    } catch (error) {
      console.error('[Simulation API] Error generating simulated snapshot:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
}

export const simulationRouter = createSimulationRouter();
