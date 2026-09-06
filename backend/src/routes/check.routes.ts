import { Router, type Request, type Response } from 'express';
import { getPostgresPool } from '../infrastructure/postgres.js';
import type { DbClient } from './watchlist.routes.js';
import { detectMarketChange, type MarketSnapshotInput } from '../market/change-detector.js';
import { classifyAttention } from '../market/attention-engine.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export function createCheckRouter(db: DbClient = getPostgresPool()): Router {
  const router = Router();

  // POST /api/watchlists/:id/check
  router.post('/:id/check', requireAuth, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const watchlistId = parseInt(req.params.id as string, 10);

    if (isNaN(watchlistId) || watchlistId <= 0) {
      return res.status(400).json({ error: 'Invalid watchlist ID' });
    }

    try {
      // 1. Verify watchlist ownership
      const wlCheck = await db.query(
        'SELECT id FROM watchlists WHERE id = $1 AND user_id = $2;',
        [watchlistId, userId]
      );

      if (wlCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Watchlist not found' });
      }

      // Begin transaction for concurrency and checkpoint safety
      await db.query('BEGIN;');

      try {
        // Lock existing check-state row if present
        const stateRes = await db.query(
          'SELECT watchlist_id, last_checked_at, last_checked_market_time FROM watchlist_check_state WHERE watchlist_id = $1 FOR UPDATE;',
          [watchlistId]
        );

        const isFirstCheck = stateRes.rows.length === 0;
        const currentAppTime = new Date();

        // Query all stocks currently in the watchlist
        const stocksRes = await db.query(
          `SELECT 
             s.id AS "stockId",
             s.symbol,
             ws.added_at AS "addedAt"
           FROM watchlist_stocks ws
           JOIN stocks s ON s.id = ws.stock_id
           WHERE ws.watchlist_id = $1
           ORDER BY s.id ASC;`,
          [watchlistId]
        );

        if (isFirstCheck) {
          // ==========================================
          // FIRST CHECK SEMANTICS
          // ==========================================
          // Find the latest available market_time among available snapshots for stocks in watchlist
          const maxTimeRes = await db.query(
            `SELECT MAX(ms.market_time) AS "maxMarketTime"
             FROM market_snapshots ms
             JOIN watchlist_stocks ws ON ws.stock_id = ms.stock_id
             WHERE ws.watchlist_id = $1;`,
            [watchlistId]
          );

          const maxMarketTimeRaw = maxTimeRes.rows[0]?.maxMarketTime;
          const initialMarketWatermark = maxMarketTimeRaw ? new Date(maxMarketTimeRaw) : currentAppTime;

          await db.query(
            `INSERT INTO watchlist_check_state (watchlist_id, last_checked_at, last_checked_market_time, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (watchlist_id) DO UPDATE
             SET last_checked_at = EXCLUDED.last_checked_at,
                 last_checked_market_time = EXCLUDED.last_checked_market_time,
                 updated_at = NOW();`,
            [watchlistId, currentAppTime, initialMarketWatermark]
          );

          await db.query('COMMIT;');

          return res.status(200).json({
            watchlistId,
            previouslyCheckedAt: null,
            checkedAt: currentAppTime.toISOString(),
            changes: [],
          });
        } else {
          // ==========================================
          // SUBSEQUENT CHECK SEMANTICS
          // ==========================================
          const checkState = stateRes.rows[0];
          const previousCheckedAt = new Date(checkState.last_checked_at);
          const lastCheckedMarketTime = new Date(checkState.last_checked_market_time);

          const changes: Array<{
            stockId: number;
            symbol: string;
            event: {
              type: string;
              severity: string;
              previousPrice: number;
              currentPrice: number;
              priceChangePercent: number;
              previousVolume: number;
              currentVolume: number;
              volumeChangePercent: number | null;
            };
            attention: {
              level: string;
              reason: string;
            };
          }> = [];

          let maxObservedMarketTime = lastCheckedMarketTime;

          for (const stock of stocksRes.rows) {
            const stockId = Number(stock.stockId);
            const addedAt = new Date(stock.addedAt);

            let baselineRow: any = null;

            // Check if stock was added after the previous check
            const isNewlyAdded = addedAt.getTime() > previousCheckedAt.getTime() || addedAt.getTime() > lastCheckedMarketTime.getTime();

            if (isNewlyAdded) {
              // Stock added after the previous check: baseline is the earliest snapshot at or after added_at
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
              // Standard stock: baseline is the latest snapshot at or before lastCheckedMarketTime
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

            // Current snapshot is latest available overall for the stock
            const currentRes = await db.query(
              `SELECT * FROM market_snapshots
               WHERE stock_id = $1
               ORDER BY market_time DESC
               LIMIT 1;`,
              [stockId]
            );

            if (currentRes.rows.length > 0) {
              const currentRow = currentRes.rows[0];
              const currMarketTime = new Date(currentRow.market_time);

              if (currMarketTime.getTime() > maxObservedMarketTime.getTime()) {
                maxObservedMarketTime = currMarketTime;
              }

              if (baselineRow) {
                const baseMarketTime = new Date(baselineRow.market_time);

                // Only compare if current is strictly newer than baseline
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
                    id: Number(currentRow.id),
                    stockId: Number(currentRow.stock_id),
                    price: parseFloat(currentRow.price),
                    openPrice: parseFloat(currentRow.open_price),
                    highPrice: parseFloat(currentRow.high_price),
                    lowPrice: parseFloat(currentRow.low_price),
                    previousClose: parseFloat(currentRow.previous_close),
                    volume: Number(currentRow.volume),
                    marketTime: currMarketTime,
                  };

                  const event = detectMarketChange(baselineInput, currentInput);

                  // Only return meaningful changes (SIGNIFICANT or WATCH)
                  if (event.severity === 'SIGNIFICANT' || event.severity === 'WATCH') {
                    const attention = classifyAttention(event);
                    changes.push({
                      stockId,
                      symbol: stock.symbol,
                      event: {
                        type: event.type,
                        severity: event.severity,
                        previousPrice: event.previousPrice,
                        currentPrice: event.currentPrice,
                        priceChangePercent: event.priceChangePercent,
                        previousVolume: event.previousVolume,
                        currentVolume: event.currentVolume,
                        volumeChangePercent: event.volumeChangePercent,
                      },
                      attention: {
                        level: attention.level,
                        reason: attention.reason,
                      },
                    });
                  }
                }
              }
            }
          }

          // Advance check state
          await db.query(
            `UPDATE watchlist_check_state
             SET last_checked_at = $1,
                 last_checked_market_time = $2,
                 updated_at = NOW()
             WHERE watchlist_id = $3;`,
            [currentAppTime, maxObservedMarketTime, watchlistId]
          );

          await db.query('COMMIT;');

          return res.status(200).json({
            watchlistId,
            previouslyCheckedAt: previousCheckedAt.toISOString(),
            checkedAt: currentAppTime.toISOString(),
            changes,
          });
        }
      } catch (err) {
        await db.query('ROLLBACK;').catch(() => {});
        throw err;
      }
    } catch (error) {
      console.error('[Check API] Error checking watchlist:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Failed to process watchlist check' });
    }
  });

  return router;
}

export const checkRouter = createCheckRouter();
