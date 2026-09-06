import { Router, type Request, type Response } from 'express';
import { getPostgresPool } from '../infrastructure/postgres.js';
import type { DbClient } from './watchlist.routes.js';
import { detectMarketChange, type MarketSnapshotInput } from '../market/change-detector.js';
import { classifyAttention, type AttentionResult } from '../market/attention-engine.js';
import { requireAuth } from '../middleware/auth.middleware.js';

function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function createIntelligenceRouter(db: DbClient = getPostgresPool()): Router {
  const router = Router();

  // GET /api/watchlists/:id/intelligence
  router.get('/:id/intelligence', requireAuth, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const watchlistId = parseInt(req.params.id as string, 10);

    if (isNaN(watchlistId) || watchlistId <= 0) {
      return res.status(400).json({ error: 'Invalid watchlist ID' });
    }

    try {
      // 1. Fetch watchlist & check state in one query
      const wlRes = await db.query(
        `SELECT 
           w.id,
           w.name,
           cs.last_checked_at AS "lastCheckedAt",
           cs.last_checked_market_time AS "lastCheckedMarketTime"
         FROM watchlists w
         LEFT JOIN watchlist_check_state cs ON cs.watchlist_id = w.id
         WHERE w.id = $1 AND w.user_id = $2;`,
        [watchlistId, userId]
      );

      if (wlRes.rows.length === 0) {
        return res.status(404).json({ error: 'Watchlist not found' });
      }

      const wlRow = wlRes.rows[0];
      const watchlist = {
        id: Number(wlRow.id),
        name: wlRow.name,
      };

      const hasCheckState = wlRow.lastCheckedAt !== null && wlRow.lastCheckedAt !== undefined;
      const previousCheckedAt = hasCheckState ? new Date(wlRow.lastCheckedAt) : null;
      const lastCheckedMarketTime = hasCheckState ? new Date(wlRow.lastCheckedMarketTime) : null;

      // 2. Fetch all stocks in the watchlist
      const stocksRes = await db.query(
        `SELECT 
           s.id AS "stockId",
           s.symbol,
           s.company_name AS "companyName",
           s.exchange,
           ws.added_at AS "addedAt"
         FROM watchlist_stocks ws
         JOIN stocks s ON s.id = ws.stock_id
         WHERE ws.watchlist_id = $1
         ORDER BY ws.added_at ASC, s.id ASC;`,
        [watchlistId]
      );

      if (stocksRes.rows.length === 0) {
        return res.status(200).json({
          watchlist,
          summary: {
            needsAttention: 0,
            worthWatching: 0,
            noMeaningfulChange: 0,
          },
          stocks: [],
        });
      }

      const formattedStocks = [];

      // 3. For each stock, compute latest market observation and attention classification
      for (const stock of stocksRes.rows) {
        const stockId = Number(stock.stockId);
        const addedAt = new Date(stock.addedAt);

        // Fetch latest market snapshot ordered by market_time DESC
        const latestRes = await db.query(
          `SELECT * FROM market_snapshots
           WHERE stock_id = $1
           ORDER BY market_time DESC
           LIMIT 1;`,
          [stockId]
        );

        if (latestRes.rows.length === 0) {
          // No market data available for this stock
          formattedStocks.push({
            stockId,
            symbol: stock.symbol,
            companyName: stock.companyName,
            exchange: stock.exchange,
            market: null,
            attention: {
              level: 'NO_MEANINGFUL_CHANGE',
              reason: 'Market data unavailable',
            },
          });
          continue;
        }

        const latestRow = latestRes.rows[0];
        const price = parseFloat(latestRow.price);
        const previousClose = parseFloat(latestRow.previous_close);
        const currMarketTime = new Date(latestRow.market_time);

        // Display changePercent = ((price - previous_close) / previous_close) * 100
        const displayChangePercent =
          previousClose > 0 ? roundToTwo(((price - previousClose) / previousClose) * 100) : 0;

        const market = {
          price,
          previousClose,
          changePercent: displayChangePercent,
          volume: Number(latestRow.volume),
          marketTime: currMarketTime.toISOString(),
        };

        // Determine attention
        let attention: AttentionResult;

        if (!hasCheckState || !previousCheckedAt || !lastCheckedMarketTime) {
          // Watchlist has never been checked
          attention = {
            level: 'NO_MEANINGFUL_CHANGE',
            reason: 'No previous check available',
          };
        } else {
          // Check baseline based on added_at vs last checkpoint
          const isNewlyAdded =
            addedAt.getTime() > previousCheckedAt.getTime() ||
            addedAt.getTime() > lastCheckedMarketTime.getTime();

          let baselineRow: any = null;

          if (isNewlyAdded) {
            const baselineRes = await db.query(
              `SELECT * FROM market_snapshots
               WHERE stock_id = $1 AND market_time >= $2
               ORDER BY market_time ASC
               LIMIT 1;`,
              [stockId, addedAt]
            );
            if (baselineRes.rows.length > 0) {
              baselineRow = baselineRes.rows[0];
            }
          } else {
            const baselineRes = await db.query(
              `SELECT * FROM market_snapshots
               WHERE stock_id = $1 AND market_time <= $2
               ORDER BY market_time DESC
               LIMIT 1;`,
              [stockId, lastCheckedMarketTime]
            );
            if (baselineRes.rows.length > 0) {
              baselineRow = baselineRes.rows[0];
            }
          }

          if (baselineRow) {
            const baseMarketTime = new Date(baselineRow.market_time);

            if (currMarketTime.getTime() > baseMarketTime.getTime()) {
              const baselineInput: MarketSnapshotInput = {
                id: Number(baselineRow.id),
                stockId: Number(baselineRow.stock_id),
                price: parseFloat(baselineRow.price),
                openPrice: parseFloat(baselineRow.open_price),
                highPrice: parseFloat(baselineRow.high_price),
                lowPrice: parseFloat(baselineRow.low_price),
                previousClose: parseFloat(baselineRow.previous_close),
                volume: Number(baselineRow.volume),
                marketTime: baseMarketTime,
              };

              const currentInput: MarketSnapshotInput = {
                id: Number(latestRow.id),
                stockId: Number(latestRow.stock_id),
                price: parseFloat(latestRow.price),
                openPrice: parseFloat(latestRow.open_price),
                highPrice: parseFloat(latestRow.high_price),
                lowPrice: parseFloat(latestRow.low_price),
                previousClose: parseFloat(latestRow.previous_close),
                volume: Number(latestRow.volume),
                marketTime: currMarketTime,
              };

              const event = detectMarketChange(baselineInput, currentInput);
              attention = classifyAttention(event);
            } else {
              attention = {
                level: 'NO_MEANINGFUL_CHANGE',
                reason: 'No significant market change detected',
              };
            }
          } else {
            attention = {
              level: 'NO_MEANINGFUL_CHANGE',
              reason: 'No significant market change detected',
            };
          }
        }

        formattedStocks.push({
          stockId,
          symbol: stock.symbol,
          companyName: stock.companyName,
          exchange: stock.exchange,
          market,
          attention,
        });
      }

      // 4. Derive summary counts
      let needsAttention = 0;
      let worthWatching = 0;
      let noMeaningfulChange = 0;

      for (const s of formattedStocks) {
        if (s.attention.level === 'NEEDS_ATTENTION') {
          needsAttention++;
        } else if (s.attention.level === 'WORTH_WATCHING') {
          worthWatching++;
        } else {
          noMeaningfulChange++;
        }
      }

      return res.status(200).json({
        watchlist,
        summary: {
          needsAttention,
          worthWatching,
          noMeaningfulChange,
        },
        stocks: formattedStocks,
      });
    } catch (error) {
      console.error('[Intelligence API] Error retrieving intelligence:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
}

export const intelligenceRouter = createIntelligenceRouter();
