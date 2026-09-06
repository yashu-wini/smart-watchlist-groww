import { Router, type Request, type Response } from 'express';
import { getPostgresPool } from '../infrastructure/postgres.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export interface DbClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export function createWatchlistRouter(db: DbClient = getPostgresPool()): Router {
  const router = Router();

  // All watchlist routes require authentication
  router.use(requireAuth);

  // ENDPOINT 0: GET /api/watchlists (List all user-owned watchlists)
  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const result = await db.query(
        `SELECT id, name, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM watchlists
         WHERE user_id = $1
         ORDER BY id ASC;`,
        [userId]
      );

      const watchlists = result.rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      return res.status(200).json({ watchlists });
    } catch (error) {
      console.error('[Watchlist API] Error retrieving watchlists:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ENDPOINT 1: POST /api/watchlists
  router.post('/', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const { name } = req.body ?? {};

      if (name === undefined || name === null || typeof name !== 'string') {
        return res.status(400).json({ error: 'Name is required and must be a string' });
      }

      const trimmedName = name.trim();

      if (trimmedName.length === 0) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }

      if (trimmedName.length > 100) {
        return res.status(400).json({ error: 'Name must not exceed 100 characters' });
      }

      const result = await db.query(
        `INSERT INTO watchlists (user_id, name)
         VALUES ($1, $2)
         RETURNING id, name, created_at AS "createdAt", updated_at AS "updatedAt";`,
        [userId, trimmedName]
      );

      const row = result.rows[0];
      return res.status(201).json({
        id: Number(row.id),
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    } catch (error) {
      console.error('[Watchlist API] Error creating watchlist:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ENDPOINT 2: GET /api/watchlists/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const id = parseInt(req.params.id as string, 10);

      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid watchlist ID' });
      }

      const result = await db.query(
        `SELECT 
           w.id,
           w.name,
           w.created_at AS "createdAt",
           w.updated_at AS "updatedAt",
           s.id AS "stockId",
           s.symbol,
           s.company_name AS "companyName",
           s.exchange,
           ws.added_at AS "addedAt"
         FROM watchlists w
         LEFT JOIN watchlist_stocks ws ON ws.watchlist_id = w.id
         LEFT JOIN stocks s ON s.id = ws.stock_id
         WHERE w.id = $1 AND w.user_id = $2
         ORDER BY ws.added_at ASC, s.id ASC;`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Watchlist not found' });
      }

      const firstRow = result.rows[0];
      const stocks = result.rows
        .filter((r) => r.stockId !== null && r.stockId !== undefined)
        .map((r) => ({
          id: Number(r.stockId),
          symbol: r.symbol,
          companyName: r.companyName,
          exchange: r.exchange,
          addedAt: r.addedAt,
        }));

      return res.status(200).json({
        id: Number(firstRow.id),
        name: firstRow.name,
        createdAt: firstRow.createdAt,
        updatedAt: firstRow.updatedAt,
        stocks,
      });
    } catch (error) {
      console.error('[Watchlist API] Error retrieving watchlist:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ENDPOINT 3: DELETE /api/watchlists/:id
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const id = parseInt(req.params.id as string, 10);

      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid watchlist ID' });
      }

      const result = await db.query(
        `DELETE FROM watchlists WHERE id = $1 AND user_id = $2 RETURNING id;`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Watchlist not found' });
      }

      return res.status(204).send();
    } catch (error) {
      console.error('[Watchlist API] Error deleting watchlist:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ENDPOINT 4: POST /api/watchlists/:id/stocks
  router.post('/:id/stocks', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const watchlistId = parseInt(req.params.id as string, 10);

      if (isNaN(watchlistId) || watchlistId <= 0) {
        return res.status(400).json({ error: 'Invalid watchlist ID' });
      }

      const { stockId } = req.body ?? {};

      if (stockId === undefined || stockId === null) {
        return res.status(400).json({ error: 'stockId is required' });
      }

      const parsedStockId = Number(stockId);
      if (!Number.isInteger(parsedStockId) || parsedStockId <= 0) {
        return res.status(400).json({ error: 'stockId must be a positive integer' });
      }

      // Check if watchlist exists and belongs to authenticated user
      const wlCheck = await db.query(
        `SELECT id FROM watchlists WHERE id = $1 AND user_id = $2;`,
        [watchlistId, userId]
      );

      if (wlCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Watchlist not found' });
      }

      // Check if stock exists in global catalog
      const stockCheck = await db.query(
        `SELECT id FROM stocks WHERE id = $1;`,
        [parsedStockId]
      );

      if (stockCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Stock not found' });
      }

      // Check if stock is already in the watchlist
      const duplicateCheck = await db.query(
        `SELECT 1 FROM watchlist_stocks WHERE watchlist_id = $1 AND stock_id = $2;`,
        [watchlistId, parsedStockId]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.status(409).json({ error: 'Stock already exists in watchlist' });
      }

      // Insert stock into watchlist
      const insertResult = await db.query(
        `INSERT INTO watchlist_stocks (watchlist_id, stock_id)
         VALUES ($1, $2)
         RETURNING watchlist_id AS "watchlistId", stock_id AS "stockId", added_at AS "addedAt";`,
        [watchlistId, parsedStockId]
      );

      const row = insertResult.rows[0];
      return res.status(201).json({
        watchlistId: Number(row.watchlistId),
        stockId: Number(row.stockId),
        addedAt: row.addedAt,
      });
    } catch (error: any) {
      if (error && (error.code === '23505' || String(error.message).includes('unique'))) {
        return res.status(409).json({ error: 'Stock already exists in watchlist' });
      }
      console.error('[Watchlist API] Error adding stock to watchlist:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // ENDPOINT 5: DELETE /api/watchlists/:id/stocks/:stockId
  router.delete('/:id/stocks/:stockId', async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const watchlistId = parseInt(req.params.id as string, 10);
      const stockId = parseInt(req.params.stockId as string, 10);

      if (isNaN(watchlistId) || watchlistId <= 0) {
        return res.status(400).json({ error: 'Invalid watchlist ID' });
      }

      if (isNaN(stockId) || stockId <= 0) {
        return res.status(400).json({ error: 'Invalid stock ID' });
      }

      // Check if watchlist exists and belongs to authenticated user
      const wlCheck = await db.query(
        `SELECT id FROM watchlists WHERE id = $1 AND user_id = $2;`,
        [watchlistId, userId]
      );

      if (wlCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Watchlist not found' });
      }

      // Delete relationship
      const deleteResult = await db.query(
        `DELETE FROM watchlist_stocks WHERE watchlist_id = $1 AND stock_id = $2 RETURNING watchlist_id, stock_id;`,
        [watchlistId, stockId]
      );

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Stock not found in watchlist' });
      }

      return res.status(204).send();
    } catch (error) {
      console.error('[Watchlist API] Error removing stock from watchlist:', error instanceof Error ? error.message : error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
}

export const watchlistRouter = createWatchlistRouter();
