import { Router, type Request, type Response } from 'express';
import { getPostgresPool } from '../infrastructure/postgres.js';
import type { DbClient } from './watchlist.routes.js';
import { detectMarketChange, type MarketSnapshotInput } from '../market/change-detector.js';

export function createChangeRouter(db: DbClient = getPostgresPool()): Router {
  const router = Router();

  // GET /api/stocks/:stockId/change
  router.get('/:stockId/change', async (req: Request, res: Response) => {
    try {
      const stockId = parseInt(req.params.stockId as string, 10);

      if (isNaN(stockId) || stockId <= 0) {
        return res.status(400).json({ error: 'Invalid stock ID' });
      }

      // 1. Verify stock exists
      const stockRes = await db.query(
        'SELECT id, symbol, company_name AS "companyName", exchange FROM stocks WHERE id = $1;',
        [stockId]
      );

      if (stockRes.rows.length === 0) {
        return res.status(404).json({ error: 'Stock not found' });
      }

      const stock = stockRes.rows[0];

      // 2. Query two latest market snapshots ordered by market_time DESC
      const snapshotsRes = await db.query(
        `SELECT
           id,
           stock_id AS "stockId",
           price,
           open_price AS "openPrice",
           high_price AS "highPrice",
           low_price AS "lowPrice",
           previous_close AS "previousClose",
           volume,
           market_time AS "marketTime",
           created_at AS "createdAt"
         FROM market_snapshots
         WHERE stock_id = $1
         ORDER BY market_time DESC
         LIMIT 2;`,
        [stockId]
      );

      if (snapshotsRes.rows.length < 2) {
        return res.status(404).json({ error: 'Insufficient market data' });
      }

      const currentRow = snapshotsRes.rows[0];
      const previousRow = snapshotsRes.rows[1];

      const current: MarketSnapshotInput = {
        id: Number(currentRow.id),
        stockId: Number(currentRow.stockId),
        price: parseFloat(currentRow.price),
        openPrice: parseFloat(currentRow.openPrice),
        highPrice: parseFloat(currentRow.highPrice),
        lowPrice: parseFloat(currentRow.lowPrice),
        previousClose: parseFloat(currentRow.previousClose),
        volume: Number(currentRow.volume),
        marketTime: currentRow.marketTime,
      };

      const previous: MarketSnapshotInput = {
        id: Number(previousRow.id),
        stockId: Number(previousRow.stockId),
        price: parseFloat(previousRow.price),
        openPrice: parseFloat(previousRow.openPrice),
        highPrice: parseFloat(previousRow.highPrice),
        lowPrice: parseFloat(previousRow.lowPrice),
        previousClose: parseFloat(previousRow.previousClose),
        volume: Number(previousRow.volume),
        marketTime: previousRow.marketTime,
      };

      const event = detectMarketChange(previous, current);

      return res.status(200).json({
        stockId: Number(stock.id),
        symbol: stock.symbol,
        event: {
          type: event.type,
          severity: event.severity,
          priceChangePercent: event.priceChangePercent,
          volumeChangePercent: event.volumeChangePercent,
          previousPrice: event.previousPrice,
          currentPrice: event.currentPrice,
          previousVolume: event.previousVolume,
          currentVolume: event.currentVolume,
          previousMarketTime: event.previousMarketTime,
          currentMarketTime: event.currentMarketTime,
        },
      });
    } catch (error) {
      console.error('[Change API] Error detecting market change:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Failed to retrieve market data' });
    }
  });

  return router;
}

export const changeRouter = createChangeRouter();
