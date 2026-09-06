import { Router, type Request, type Response } from 'express';
import { getPostgresPool } from '../infrastructure/postgres.js';
import type { DbClient } from './watchlist.routes.js';
import { getLatestMarketSnapshot } from '../market/market-data.js';

export function createMarketRouter(db: DbClient = getPostgresPool()): Router {
  const router = Router();

  // GET /api/stocks (List available stock catalog)
  router.get('/', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      let queryText = `SELECT id, symbol, company_name AS "companyName", exchange FROM stocks`;
      const params: any[] = [];
      if (q) {
        queryText += ` WHERE symbol ILIKE $1 OR company_name ILIKE $1`;
        params.push(`%${q}%`);
      }
      queryText += ` ORDER BY id ASC;`;
      const result = await db.query(queryText, params);
      const stocks = result.rows.map((row) => ({
        id: Number(row.id),
        symbol: row.symbol,
        companyName: row.companyName,
        exchange: row.exchange,
      }));
      return res.status(200).json({ stocks });
    } catch (error) {
      console.error('[Market API] Error listing stocks:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // GET /api/stocks/:stockId/market
  router.get('/:stockId/market', async (req: Request, res: Response) => {
    try {
      const stockId = parseInt(req.params.stockId as string, 10);

      if (isNaN(stockId) || stockId <= 0) {
        return res.status(400).json({ error: 'Invalid stock ID' });
      }

      const result = await getLatestMarketSnapshot(db, stockId);

      if (!result) {
        return res.status(404).json({ error: 'Stock not found' });
      }

      if (!result.market) {
        return res.status(404).json({ error: 'Market data not found' });
      }

      return res.status(200).json({
        stockId: result.stockId,
        symbol: result.symbol,
        exchange: result.exchange,
        market: result.market,
      });
    } catch (error) {
      console.error('[Market API] Error retrieving market data:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
}

export const marketRouter = createMarketRouter();
