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

describe('Simulated Market Feed API Tests (POST /api/market/simulate)', () => {
  let db: DbClient & { end?: () => Promise<void> };
  let app: Express;
  let realPool: pg.Pool | null = null;
  let testStockId: number;
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
      console.log(`[Simulation Routes Tests] Connected to live PostgreSQL test DB: "${config.postgres.testDatabase}"`);
    } catch {
      console.log('[Simulation Routes Tests] Using pg-mem in-memory PostgreSQL engine.');
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
    // Reset test tables
    await db.query('DELETE FROM watchlist_check_state;');
    await db.query('DELETE FROM market_snapshots;');
    await db.query('DELETE FROM watchlist_stocks;');
    await db.query('DELETE FROM watchlists;');
    await db.query('DELETE FROM stocks;');
    await db.query('DELETE FROM users;');

    await db.query(`
      INSERT INTO users (id, email, password_hash, created_at)
      VALUES (1, 'dev@example.com', 'hash123', NOW())
      ON CONFLICT (id) DO NOTHING;
    `);

    const stockRes = await db.query(
      "INSERT INTO stocks (symbol, company_name, exchange) VALUES ('TCS', 'Tata Consultancy Services', 'NSE') RETURNING id;"
    );
    testStockId = Number(stockRes.rows[0].id);
  });

  // Test 1: Valid STABLE simulation persists snapshot
  it('Test 1 — Valid STABLE simulation persists a snapshot and returns 201 with expected shape', async () => {
    const res = await request(app)
      .post('/api/market/simulate')
      .send({ stockId: testStockId, scenario: 'STABLE' });

    expect(res.status).toBe(201);
    expect(res.body.stockId).toBe(testStockId);
    expect(res.body.price).toBeGreaterThan(0);
    expect(res.body.openPrice).toBeGreaterThan(0);
    expect(res.body.highPrice).toBeGreaterThanOrEqual(res.body.lowPrice);
    expect(res.body.previousClose).toBe(3400.0);
    expect(res.body.volume).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('marketTime');
    expect(res.body).toHaveProperty('createdAt');

    // Verify row exists in DB
    const dbRows = await db.query('SELECT * FROM market_snapshots WHERE stock_id = $1;', [testStockId]);
    expect(dbRows.rows.length).toBe(1);
    expect(parseFloat(dbRows.rows[0].price)).toBe(res.body.price);
  });

  // Test 2: Valid PRICE_MOVE simulation persists snapshot with >=3% jump
  it('Test 2 — Valid PRICE_MOVE simulation persists snapshot with significant price movement', async () => {
    const res = await request(app)
      .post('/api/market/simulate')
      .send({ stockId: testStockId, scenario: 'PRICE_MOVE' });

    expect(res.status).toBe(201);
    expect(res.body.stockId).toBe(testStockId);
    const pctChange = ((res.body.price - res.body.previousClose) / res.body.previousClose) * 100;
    expect(pctChange).toBeGreaterThanOrEqual(3.0);
  });

  // Test 3: Valid VOLUME_SPIKE simulation persists snapshot with high volume
  it('Test 3 — Valid VOLUME_SPIKE simulation persists snapshot with unusually high volume', async () => {
    const res = await request(app)
      .post('/api/market/simulate')
      .send({ stockId: testStockId, scenario: 'VOLUME_SPIKE' });

    expect(res.status).toBe(201);
    expect(res.body.stockId).toBe(testStockId);
    expect(res.body.volume).toBeGreaterThanOrEqual(1000000);
  });

  // Test 4: Invalid/nonexistent stock ID returns 404
  it('Test 4 — Nonexistent stock ID returns 404', async () => {
    const res = await request(app)
      .post('/api/market/simulate')
      .send({ stockId: 99999, scenario: 'STABLE' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Stock not found' });
  });

  // Test 5: Invalid scenario returns 400
  it('Test 5 — Invalid scenario returns 400', async () => {
    const res = await request(app)
      .post('/api/market/simulate')
      .send({ stockId: testStockId, scenario: 'INVALID_SCENARIO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid scenario');
  });

  // Test 6: Malformed stock ID returns 400
  it('Test 6 — Malformed stock ID returns 400', async () => {
    const res1 = await request(app)
      .post('/api/market/simulate')
      .send({ stockId: 'abc', scenario: 'STABLE' });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/api/market/simulate')
      .send({ stockId: -5, scenario: 'STABLE' });
    expect(res2.status).toBe(400);

    const res3 = await request(app)
      .post('/api/market/simulate')
      .send({ scenario: 'STABLE' });
    expect(res3.status).toBe(400);
  });

  // Test 7: Unavailable outside development mode (production returns 404)
  it('Test 7 — Returns 404 when NODE_ENV is production', async () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const res = await request(app)
        .post('/api/market/simulate')
        .send({ stockId: testStockId, scenario: 'STABLE' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not Found' });
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  // Test 8: Persisted snapshot is retrievable via GET /api/stocks/:stockId/market
  it('Test 8 — Simulated snapshot is immediately queryable through GET /api/stocks/:stockId/market', async () => {
    const simRes = await request(app)
      .post('/api/market/simulate')
      .send({ stockId: testStockId, scenario: 'STABLE' });

    expect(simRes.status).toBe(201);

    const getRes = await request(app).get(`/api/stocks/${testStockId}/market`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.stockId).toBe(testStockId);
    expect(getRes.body.market.price).toBe(simRes.body.price);
    expect(getRes.body.market.volume).toBe(simRes.body.volume);
  });

  // Test 9: Subsequent simulations reflect in change detection and intelligence API
  it('Test 9 — Consecutive simulations feed into change detection and Phase 8 intelligence', async () => {
    // 1. Create watchlist and add TCS
    const wlRes = await db.query(
      "INSERT INTO watchlists (user_id, name) VALUES (1, 'Tech Watchlist') RETURNING id;"
    );
    const wlId = Number(wlRes.rows[0].id);
    await db.query(
      "INSERT INTO watchlist_stocks (watchlist_id, stock_id, added_at) VALUES ($1, $2, '2026-09-05T09:00:00.000Z');",
      [wlId, testStockId]
    );

    // 2. Simulate baseline snapshot at 10:00
    await request(app)
      .post('/api/market/simulate')
      .send({
        stockId: testStockId,
        scenario: 'STABLE',
        marketTime: '2026-09-05T10:00:00.000Z',
      });

    // 3. Establish checkpoint
    await request(app)
      .post(`/api/watchlists/${wlId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // 4. Simulate PRICE_MOVE snapshot at 10:15
    await request(app)
      .post('/api/market/simulate')
      .send({
        stockId: testStockId,
        scenario: 'PRICE_MOVE',
        marketTime: '2026-09-05T10:15:00.000Z',
      });

    // 5. Query Intelligence API
    const intelRes = await request(app)
      .get(`/api/watchlists/${wlId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(intelRes.status).toBe(200);
    expect(intelRes.body.summary.needsAttention).toBe(1);
    expect(intelRes.body.stocks[0].attention.level).toBe('NEEDS_ATTENTION');
    expect(intelRes.body.stocks[0].attention.reason).toBe('Significant price movement combined with a volume spike');
  });
});
