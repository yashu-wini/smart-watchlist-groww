import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { signToken } from '../src/auth/jwt.js';
import type { DbClient } from '../src/routes/watchlist.routes.js';
import type { Express } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

describe('Watchlist REST API Tests', () => {
  let db: DbClient & { end?: () => Promise<void> };
  let app: Express;
  let realPool: pg.Pool | null = null;
  const devToken = signToken({ id: 1, email: 'dev@example.com' });

  beforeAll(async () => {
    const schemaPath = path.join(__dirname, '../src/infrastructure/schema.sql');
    const schemaSql = await fs.readFile(schemaPath, 'utf-8');

    try {
      const testPool = new Pool({
        host: config.postgres.host,
        port: config.postgres.port,
        database: config.postgres.testDatabase,
        user: config.postgres.user,
        password: config.postgres.password,
        connectionTimeoutMillis: 1500,
      });

      const client = await testPool.connect();
      await client.query('SELECT 1;');
      await client.query(schemaSql);
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
      `);
      client.release();

      realPool = testPool;
      db = realPool;
      console.log(`[Watchlist Routes Tests] Connected to live PostgreSQL test DB: "${config.postgres.testDatabase}"`);
    } catch {
      console.log('[Watchlist Routes Tests] Using pg-mem in-memory PostgreSQL engine.');
      const memDb = newDb();
      memDb.public.none(schemaSql);
      const pgAdapter = memDb.adapters.createPg();
      db = new pgAdapter.Pool();
    }

    app = createApp({ db });
  });

  afterAll(async () => {
    if (realPool) {
      await realPool.end();
    }
  });

  beforeEach(async () => {
    // Clean up all tables
    await db.query('DELETE FROM watchlist_stocks;');
    await db.query('DELETE FROM watchlists;');
    await db.query('DELETE FROM stocks;');
    await db.query('DELETE FROM users;');

    // Seed User 1 (default dev user) and User 2 (for ownership testing)
    await db.query(`
      INSERT INTO users (id, email, password_hash, created_at)
      VALUES 
        (1, 'dev@example.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', NOW()),
        (2, 'user2@example.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', NOW())
      ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email;
    `);
  });

  // ==========================================
  // WATCHLIST CREATION TESTS
  // ==========================================

  // Test 1: Valid watchlist name creates a watchlist
  it('Test 1 — Valid watchlist name creates a watchlist (201)', async () => {
    const res = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ name: 'My Tech Stocks' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('My Tech Stocks');
    expect(res.body).toHaveProperty('createdAt');
    expect(res.body).toHaveProperty('updatedAt');

    // Verify persisted in database
    const dbCheck = await db.query('SELECT * FROM watchlists WHERE id = $1;', [res.body.id]);
    expect(dbCheck.rows.length).toBe(1);
    expect(String(dbCheck.rows[0].user_id)).toBe('1');
  });

  // Test 2: Missing name returns 400
  it('Test 2 — Missing name returns 400', async () => {
    const res = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${devToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  // Test 3: Empty name returns 400
  it('Test 3 — Empty name returns 400', async () => {
    const res = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Name cannot be empty' });
  });

  // Test 4: Whitespace-only name returns 400
  it('Test 4 — Whitespace-only name returns 400', async () => {
    const res = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ name: '     ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Name cannot be empty' });
  });

  // Test 5: Name longer than 100 characters returns 400
  it('Test 5 — Name longer than 100 characters returns 400', async () => {
    const longName = 'A'.repeat(101);
    const res = await request(app)
      .post('/api/watchlists')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ name: longName });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Name must not exceed 100 characters' });
  });

  // ==========================================
  // WATCHLIST RETRIEVAL TESTS
  // ==========================================

  // Test 6: Existing watchlist can be retrieved
  it('Test 6 — Existing watchlist can be retrieved (200)', async () => {
    const createRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (1, $1) RETURNING id;',
      ['Growth Portfolio']
    );
    const watchlistId = createRes.rows[0].id;

    const res = await request(app)
      .get(`/api/watchlists/${watchlistId}`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(Number(watchlistId));
    expect(res.body.name).toBe('Growth Portfolio');
    expect(Array.isArray(res.body.stocks)).toBe(true);
    expect(res.body.stocks.length).toBe(0);
  });

  // Test 7: Retrieved watchlist includes its stocks
  it('Test 7 — Retrieved watchlist includes its stocks', async () => {
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (1, $1) RETURNING id;',
      ['Indian Bluechips']
    );
    const watchlistId = wlRes.rows[0].id;

    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['TCS', 'Tata Consultancy Services', 'NSE']
    );
    const stockId = stockRes.rows[0].id;

    await db.query(
      'INSERT INTO watchlist_stocks (watchlist_id, stock_id) VALUES ($1, $2);',
      [watchlistId, stockId]
    );

    const res = await request(app)
      .get(`/api/watchlists/${watchlistId}`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stocks.length).toBe(1);
    expect(res.body.stocks[0].id).toBe(Number(stockId));
    expect(res.body.stocks[0].symbol).toBe('TCS');
    expect(res.body.stocks[0].companyName).toBe('Tata Consultancy Services');
    expect(res.body.stocks[0].exchange).toBe('NSE');
    expect(res.body.stocks[0]).toHaveProperty('addedAt');
  });

  // Test 8: Nonexistent watchlist returns 404
  it('Test 8 — Nonexistent watchlist returns 404', async () => {
    const res = await request(app)
      .get('/api/watchlists/99999')
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Watchlist not found' });
  });

  // ==========================================
  // STOCK TESTS
  // ==========================================

  // Test 9: Existing stock can be added to a watchlist
  it('Test 9 — Existing stock can be added to a watchlist (201)', async () => {
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (1, $1) RETURNING id;',
      ['Banking Stocks']
    );
    const watchlistId = wlRes.rows[0].id;

    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['HDFCBANK', 'HDFC Bank Ltd', 'NSE']
    );
    const stockId = stockRes.rows[0].id;

    const res = await request(app)
      .post(`/api/watchlists/${watchlistId}/stocks`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ stockId: Number(stockId) });

    expect(res.status).toBe(201);
    expect(res.body.watchlistId).toBe(Number(watchlistId));
    expect(res.body.stockId).toBe(Number(stockId));
    expect(res.body).toHaveProperty('addedAt');
  });

  // Test 10: Nonexistent stock returns 404
  it('Test 10 — Nonexistent stock returns 404', async () => {
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (1, $1) RETURNING id;',
      ['Tech Stocks']
    );
    const watchlistId = wlRes.rows[0].id;

    const res = await request(app)
      .post(`/api/watchlists/${watchlistId}/stocks`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ stockId: 888888 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Stock not found' });
  });

  // Test 11: Nonexistent watchlist returns 404
  it('Test 11 — Nonexistent watchlist returns 404', async () => {
    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['INFY', 'Infosys Ltd', 'NSE']
    );
    const stockId = stockRes.rows[0].id;

    const res = await request(app)
      .post('/api/watchlists/99999/stocks')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ stockId: Number(stockId) });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Watchlist not found' });
  });

  // Test 12: Adding the same stock twice returns 409
  it('Test 12 — Adding the same stock twice returns 409', async () => {
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (1, $1) RETURNING id;',
      ['EV Stocks']
    );
    const watchlistId = wlRes.rows[0].id;

    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['TATAMOTORS', 'Tata Motors Ltd', 'NSE']
    );
    const stockId = stockRes.rows[0].id;

    // First addition -> 201
    const res1 = await request(app)
      .post(`/api/watchlists/${watchlistId}/stocks`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ stockId: Number(stockId) });
    expect(res1.status).toBe(201);

    // Second addition -> 409
    const res2 = await request(app)
      .post(`/api/watchlists/${watchlistId}/stocks`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ stockId: Number(stockId) });
    expect(res2.status).toBe(409);
    expect(res2.body).toEqual({ error: 'Stock already exists in watchlist' });
  });

  // Test 13: Multiple different stocks can be added
  it('Test 13 — Multiple different stocks can be added', async () => {
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (1, $1) RETURNING id;',
      ['Diversified']
    );
    const watchlistId = wlRes.rows[0].id;

    const s1 = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['RELIANCE', 'Reliance Industries', 'NSE']
    );
    const s2 = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['ITC', 'ITC Limited', 'NSE']
    );

    const res1 = await request(app)
      .post(`/api/watchlists/${watchlistId}/stocks`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ stockId: Number(s1.rows[0].id) });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post(`/api/watchlists/${watchlistId}/stocks`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ stockId: Number(s2.rows[0].id) });
    expect(res2.status).toBe(201);

    const checkRes = await request(app)
      .get(`/api/watchlists/${watchlistId}`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.stocks.length).toBe(2);
  });

  // ==========================================
  // STOCK REMOVAL TESTS
  // ==========================================

  // Test 14: Existing watchlist-stock relationship can be removed
  it('Test 14 — Existing watchlist-stock relationship can be removed (204)', async () => {
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (1, $1) RETURNING id;',
      ['Pharma']
    );
    const watchlistId = wlRes.rows[0].id;

    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['SUNPHARMA', 'Sun Pharmaceutical', 'NSE']
    );
    const stockId = stockRes.rows[0].id;

    await db.query(
      'INSERT INTO watchlist_stocks (watchlist_id, stock_id) VALUES ($1, $2);',
      [watchlistId, stockId]
    );

    const res = await request(app)
      .delete(`/api/watchlists/${watchlistId}/stocks/${stockId}`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res.status).toBe(204);

    // Verify relationship was removed
    const dbCheck = await db.query(
      'SELECT * FROM watchlist_stocks WHERE watchlist_id = $1 AND stock_id = $2;',
      [watchlistId, stockId]
    );
    expect(dbCheck.rows.length).toBe(0);
  });

  // Test 15: Removing a stock that is not in the watchlist returns 404
  it('Test 15 — Removing a stock that is not in the watchlist returns 404', async () => {
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (1, $1) RETURNING id;',
      ['Metals']
    );
    const watchlistId = wlRes.rows[0].id;

    const res = await request(app)
      .delete(`/api/watchlists/${watchlistId}/stocks/9999`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Stock not found in watchlist' });
  });

  // ==========================================
  // WATCHLIST DELETION TESTS
  // ==========================================

  // Test 16: Existing watchlist can be deleted
  it('Test 16 — Existing watchlist can be deleted (204)', async () => {
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (1, $1) RETURNING id;',
      ['Temporary Watchlist']
    );
    const watchlistId = wlRes.rows[0].id;

    const res = await request(app)
      .delete(`/api/watchlists/${watchlistId}`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res.status).toBe(204);

    const dbCheck = await db.query('SELECT * FROM watchlists WHERE id = $1;', [watchlistId]);
    expect(dbCheck.rows.length).toBe(0);
  });

  // Test 17: Deleting a nonexistent watchlist returns 404
  it('Test 17 — Deleting a nonexistent watchlist returns 404', async () => {
    const res = await request(app)
      .delete('/api/watchlists/99999')
      .set('Authorization', `Bearer ${devToken}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Watchlist not found' });
  });

  // Test 18: Deleting a watchlist removes its watchlist_stocks relationships
  it('Test 18 — Deleting a watchlist removes its watchlist_stocks relationships', async () => {
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (1, $1) RETURNING id;',
      ['Automotive']
    );
    const watchlistId = wlRes.rows[0].id;

    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['MARUTI', 'Maruti Suzuki India', 'NSE']
    );
    const stockId = stockRes.rows[0].id;

    await db.query(
      'INSERT INTO watchlist_stocks (watchlist_id, stock_id) VALUES ($1, $2);',
      [watchlistId, stockId]
    );

    const deleteRes = await request(app)
      .delete(`/api/watchlists/${watchlistId}`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(deleteRes.status).toBe(204);

    // Verify join table cascade deletion
    const linksCheck = await db.query(
      'SELECT * FROM watchlist_stocks WHERE watchlist_id = $1;',
      [watchlistId]
    );
    expect(linksCheck.rows.length).toBe(0);

    // Verify stock record remains intact
    const stockCheck = await db.query('SELECT * FROM stocks WHERE id = $1;', [stockId]);
    expect(stockCheck.rows.length).toBe(1);
  });

  // ==========================================
  // OWNERSHIP TESTS
  // ==========================================

  // Test 19: A watchlist belonging to another user cannot be retrieved by user 1
  it('Test 19 — A watchlist belonging to another user cannot be retrieved by user 1 (404)', async () => {
    // Watchlist created for User 2
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (2, $1) RETURNING id;',
      ['User 2 Secret Watchlist']
    );
    const user2WatchlistId = wlRes.rows[0].id;

    const res = await request(app)
      .get(`/api/watchlists/${user2WatchlistId}`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Watchlist not found' });
  });

  // Test 20: A watchlist belonging to another user cannot be deleted by user 1
  it('Test 20 — A watchlist belonging to another user cannot be deleted by user 1 (404)', async () => {
    // Watchlist created for User 2
    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES (2, $1) RETURNING id;',
      ['User 2 Protected Watchlist']
    );
    const user2WatchlistId = wlRes.rows[0].id;

    const res = await request(app)
      .delete(`/api/watchlists/${user2WatchlistId}`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Watchlist not found' });

    // Verify watchlist was NOT deleted
    const dbCheck = await db.query('SELECT * FROM watchlists WHERE id = $1;', [user2WatchlistId]);
    expect(dbCheck.rows.length).toBe(1);
  });
});
