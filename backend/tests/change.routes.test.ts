import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import type { DbClient } from '../src/routes/watchlist.routes.js';
import { saveMarketSnapshot } from '../src/market/market-data.js';
import type { Express } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

describe('Change Detection API Route Tests (GET /api/stocks/:stockId/change)', () => {
  let db: DbClient & { end?: () => Promise<void> };
  let app: Express;
  let realPool: pg.Pool | null = null;
  let testStockId: number;

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
      client.release();

      realPool = testPool;
      db = realPool;
      console.log(`[Change Routes Tests] Connected to live PostgreSQL test DB: "${config.postgres.testDatabase}"`);
    } catch {
      console.log('[Change Routes Tests] Using pg-mem in-memory PostgreSQL engine.');
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
    // Clean up tables
    await db.query('DELETE FROM market_snapshots;');
    await db.query('DELETE FROM watchlist_stocks;');
    await db.query('DELETE FROM watchlists;');
    await db.query('DELETE FROM stocks;');
    await db.query('DELETE FROM users;');

    // Insert baseline test stock
    const stockRes = await db.query(
      "INSERT INTO stocks (symbol, company_name, exchange) VALUES ('TCS', 'Tata Consultancy Services', 'NSE') RETURNING id;"
    );
    testStockId = Number(stockRes.rows[0].id);
  });

  // Test 1: Existing stock with two snapshots -> 200
  it('Test 1 — Existing stock with two snapshots returns 200', async () => {
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3400.0,
      openPrice: 3400.0,
      highPrice: 3410.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 100000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });

    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3550.0,
      openPrice: 3400.0,
      highPrice: 3560.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 120000,
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    const res = await request(app).get(`/api/stocks/${testStockId}/change`);
    expect(res.status).toBe(200);
    expect(res.body.stockId).toBe(testStockId);
    expect(res.body.symbol).toBe('TCS');
    expect(res.body).toHaveProperty('event');
  });

  // Test 2: Correct event type returned
  it('Test 2 — Correct event type returned for price movement', async () => {
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 1000.0,
      openPrice: 1000.0,
      highPrice: 1010.0,
      lowPrice: 990.0,
      previousClose: 1000.0,
      volume: 100000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });

    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 1050.0, // +5.0%
      openPrice: 1000.0,
      highPrice: 1060.0,
      lowPrice: 990.0,
      previousClose: 1000.0,
      volume: 120000, // 1.2x (not a spike)
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    const res = await request(app).get(`/api/stocks/${testStockId}/change`);
    expect(res.status).toBe(200);
    expect(res.body.event.type).toBe('PRICE_MOVEMENT');
    expect(res.body.event.severity).toBe('SIGNIFICANT');
  });

  // Test 3: Correct signed price change returned
  it('Test 3 — Correct signed price change returned (negative and positive)', async () => {
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 100.0,
      openPrice: 100.0,
      highPrice: 105.0,
      lowPrice: 95.0,
      previousClose: 100.0,
      volume: 1000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });

    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 96.0, // -4.00%
      openPrice: 100.0,
      highPrice: 100.0,
      lowPrice: 95.0,
      previousClose: 100.0,
      volume: 1000,
      marketTime: new Date('2026-09-05T10:10:00Z'),
    });

    const res = await request(app).get(`/api/stocks/${testStockId}/change`);
    expect(res.status).toBe(200);
    expect(res.body.event.priceChangePercent).toBe(-4);
    expect(res.body.event.previousPrice).toBe(100);
    expect(res.body.event.currentPrice).toBe(96);
  });

  // Test 4: Correct volume change returned
  it('Test 4 — Correct volume change returned', async () => {
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 100.0,
      openPrice: 100.0,
      highPrice: 105.0,
      lowPrice: 95.0,
      previousClose: 100.0,
      volume: 100000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });

    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 100.5,
      openPrice: 100.0,
      highPrice: 105.0,
      lowPrice: 95.0,
      previousClose: 100.0,
      volume: 300000, // +200% (3x)
      marketTime: new Date('2026-09-05T10:10:00Z'),
    });

    const res = await request(app).get(`/api/stocks/${testStockId}/change`);
    expect(res.status).toBe(200);
    expect(res.body.event.type).toBe('VOLUME_SPIKE');
    expect(res.body.event.severity).toBe('WATCH');
    expect(res.body.event.volumeChangePercent).toBe(200);
  });

  // Test 5: API chooses latest two snapshots using market_time
  it('Test 5 — API chooses latest two snapshots using market_time, not insertion order', async () => {
    // Snapshot 1 (10:00)
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3000.0,
      openPrice: 3000.0,
      highPrice: 3010.0,
      lowPrice: 2990.0,
      previousClose: 3000.0,
      volume: 10000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });

    // Snapshot 3 (10:30) inserted second
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3500.0,
      openPrice: 3000.0,
      highPrice: 3510.0,
      lowPrice: 2990.0,
      previousClose: 3000.0,
      volume: 10000,
      marketTime: new Date('2026-09-05T10:30:00Z'),
    });

    // Snapshot 2 (10:15) inserted third (older market_time than Snapshot 3)
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3400.0,
      openPrice: 3000.0,
      highPrice: 3410.0,
      lowPrice: 2990.0,
      previousClose: 3000.0,
      volume: 10000,
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    // The two latest by market_time are 10:30 (current: 3500) and 10:15 (previous: 3400)
    const res = await request(app).get(`/api/stocks/${testStockId}/change`);
    expect(res.status).toBe(200);
    expect(res.body.event.currentPrice).toBe(3500);
    expect(res.body.event.previousPrice).toBe(3400);
    expect(res.body.event.priceChangePercent).toBe(2.94); // ((3500 - 3400) / 3400) * 100 = 2.941% -> 2.94%
    expect(res.body.event.type).toBe('NO_SIGNIFICANT_CHANGE');
  });

  // Test 6: Stock with only one snapshot returns 404
  it('Test 6 — Stock with only one snapshot returns 404', async () => {
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3400.0,
      openPrice: 3400.0,
      highPrice: 3410.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 100000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });

    const res = await request(app).get(`/api/stocks/${testStockId}/change`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Insufficient market data' });
  });

  // Test 7: Nonexistent stock returns 404
  it('Test 7 — Nonexistent stock returns 404', async () => {
    const res = await request(app).get('/api/stocks/99999/change');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Stock not found' });
  });

  // Test 8: Error response uses { "error": "..." }
  it('Test 8 — Error response uses standard { "error": "..." } format', async () => {
    const res404 = await request(app).get('/api/stocks/88888/change');
    expect(res404.status).toBe(404);
    expect(res404.body).toHaveProperty('error');
    expect(typeof res404.body.error).toBe('string');

    const res400 = await request(app).get('/api/stocks/invalid/change');
    expect(res400.status).toBe(400);
    expect(res400.body).toEqual({ error: 'Invalid stock ID' });
  });

  // Test 9: Significant price + volume returns ONE PRICE_AND_VOLUME event
  it('Test 9 — Significant price + volume returns ONE PRICE_AND_VOLUME event', async () => {
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 100.0,
      openPrice: 100.0,
      highPrice: 105.0,
      lowPrice: 95.0,
      previousClose: 100.0,
      volume: 100000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });

    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 105.0, // +5.0%
      openPrice: 100.0,
      highPrice: 106.0,
      lowPrice: 95.0,
      previousClose: 100.0,
      volume: 250000, // 2.5x volume
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    const res = await request(app).get(`/api/stocks/${testStockId}/change`);
    expect(res.status).toBe(200);
    expect(res.body.event.type).toBe('PRICE_AND_VOLUME');
    expect(res.body.event.severity).toBe('SIGNIFICANT');
  });
});
