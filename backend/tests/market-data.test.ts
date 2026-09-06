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
import { generateSnapshot } from '../src/market/market-simulator.js';
import { saveMarketSnapshot, getLatestMarketSnapshot } from '../src/market/market-data.js';
import type { Express } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

describe('Market Data Model & Deterministic Simulator Tests', () => {
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
      console.log(`[Market Data Tests] Connected to live PostgreSQL test DB: "${config.postgres.testDatabase}"`);
    } catch {
      console.log('[Market Data Tests] Using pg-mem in-memory PostgreSQL engine.');
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

    // Insert a baseline stock for tests
    const stockRes = await db.query(
      "INSERT INTO stocks (symbol, company_name, exchange) VALUES ('TCS', 'Tata Consultancy Services', 'NSE') RETURNING id;"
    );
    testStockId = Number(stockRes.rows[0].id);
  });

  // ==========================================
  // 1. DATABASE TESTS
  // ==========================================

  // Test 1: Market snapshot can be inserted for an existing stock
  it('Test 1 — Market snapshot can be inserted for an existing stock', async () => {
    const snapshot = generateSnapshot({ id: testStockId, symbol: 'TCS' }, '2026-09-05T10:00:00Z', 'STABLE');
    const saved = await saveMarketSnapshot(db, snapshot);

    expect(saved).toHaveProperty('id');
    expect(saved.stockId).toBe(testStockId);
    expect(saved.price).toBeGreaterThan(0);
    expect(saved.volume).toBeGreaterThan(0);

    const dbCheck = await db.query('SELECT * FROM market_snapshots WHERE id = $1;', [saved.id]);
    expect(dbCheck.rows.length).toBe(1);
  });

  // Test 2: Market snapshot references the correct stock
  it('Test 2 — Market snapshot references the correct stock', async () => {
    const s2 = await db.query("INSERT INTO stocks (symbol, company_name, exchange) VALUES ('INFY', 'Infosys Ltd', 'NSE') RETURNING id;");
    const infyId = Number(s2.rows[0].id);

    const snapTcs = generateSnapshot({ id: testStockId, symbol: 'TCS' }, '2026-09-05T10:00:00Z', 'STABLE');
    const snapInfy = generateSnapshot({ id: infyId, symbol: 'INFY' }, '2026-09-05T10:00:00Z', 'STABLE');

    const savedTcs = await saveMarketSnapshot(db, snapTcs);
    const savedInfy = await saveMarketSnapshot(db, snapInfy);

    expect(savedTcs.stockId).toBe(testStockId);
    expect(savedInfy.stockId).toBe(infyId);

    const checkTcs = await db.query('SELECT * FROM market_snapshots WHERE stock_id = $1;', [testStockId]);
    expect(checkTcs.rows.length).toBe(1);

    const checkInfy = await db.query('SELECT * FROM market_snapshots WHERE stock_id = $1;', [infyId]);
    expect(checkInfy.rows.length).toBe(1);
  });

  // Test 3: Invalid negative price is rejected
  it('Test 3 — Invalid negative price is rejected', async () => {
    await expect(
      db.query(
        `INSERT INTO market_snapshots (stock_id, price, open_price, high_price, low_price, previous_close, volume, market_time)
         VALUES ($1, -100.00, 3400.00, 3450.00, 3390.00, 3400.00, 100000, NOW());`,
        [testStockId]
      )
    ).rejects.toThrow();
  });

  // Test 4: Invalid negative volume is rejected
  it('Test 4 — Invalid negative volume is rejected', async () => {
    await expect(
      db.query(
        `INSERT INTO market_snapshots (stock_id, price, open_price, high_price, low_price, previous_close, volume, market_time)
         VALUES ($1, 3410.00, 3400.00, 3450.00, 3390.00, 3400.00, -500, NOW());`,
        [testStockId]
      )
    ).rejects.toThrow();
  });

  // Test 5: Multiple snapshots can exist for one stock
  it('Test 5 — Multiple snapshots can exist for one stock', async () => {
    await saveMarketSnapshot(db, generateSnapshot({ id: testStockId, symbol: 'TCS' }, '2026-09-05T10:00:00Z', 'STABLE'));
    await saveMarketSnapshot(db, generateSnapshot({ id: testStockId, symbol: 'TCS' }, '2026-09-05T10:01:00Z', 'STABLE'));
    await saveMarketSnapshot(db, generateSnapshot({ id: testStockId, symbol: 'TCS' }, '2026-09-05T10:02:00Z', 'PRICE_MOVE'));

    const res = await db.query('SELECT * FROM market_snapshots WHERE stock_id = $1;', [testStockId]);
    expect(res.rows.length).toBe(3);
  });

  // Test 6: Latest snapshot is selected using market_time, not insertion order
  it('Test 6 — Latest snapshot is selected using market_time, not insertion order', async () => {
    // Insert newer market_time first (10:05)
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3600.0,
      openPrice: 3400.0,
      highPrice: 3650.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 250000,
      marketTime: new Date('2026-09-05T10:05:00Z'),
    });

    // Insert older market_time second (10:02) but with higher DB ID
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3420.0,
      openPrice: 3400.0,
      highPrice: 3450.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 120000,
      marketTime: new Date('2026-09-05T10:02:00Z'),
    });

    const latest = await getLatestMarketSnapshot(db, testStockId);
    expect(latest).not.toBeNull();
    expect(latest?.market?.price).toBe(3600.0);
    expect(new Date(latest!.market!.marketTime).toISOString()).toBe('2026-09-05T10:05:00.000Z');
  });

  // Test 7: Deleting a stock cascades to its market snapshots
  it('Test 7 — Deleting a stock cascades to its market snapshots', async () => {
    await saveMarketSnapshot(db, generateSnapshot({ id: testStockId, symbol: 'TCS' }, '2026-09-05T10:00:00Z', 'STABLE'));
    await saveMarketSnapshot(db, generateSnapshot({ id: testStockId, symbol: 'TCS' }, '2026-09-05T10:01:00Z', 'STABLE'));

    const before = await db.query('SELECT * FROM market_snapshots WHERE stock_id = $1;', [testStockId]);
    expect(before.rows.length).toBe(2);

    await db.query('DELETE FROM stocks WHERE id = $1;', [testStockId]);

    const after = await db.query('SELECT * FROM market_snapshots WHERE stock_id = $1;', [testStockId]);
    expect(after.rows.length).toBe(0);
  });

  // ==========================================
  // 2. SIMULATOR TESTS
  // ==========================================

  // Test 8: Stable scenario generates valid data
  it('Test 8 — Stable scenario generates valid data', () => {
    const snap = generateSnapshot({ id: 1, symbol: 'TCS', basePrice: 3400 }, '2026-09-05T10:00:00Z', 'STABLE');

    expect(snap.price).toBeGreaterThan(0);
    expect(snap.openPrice).toBeGreaterThan(0);
    expect(snap.highPrice).toBeGreaterThanOrEqual(snap.lowPrice);
    expect(snap.previousClose).toBe(3400);
    expect(snap.volume).toBeGreaterThan(0);
    // Stable price remains within 1% of previousClose
    const priceChangePct = Math.abs((snap.price - snap.previousClose) / snap.previousClose);
    expect(priceChangePct).toBeLessThan(0.01);
  });

  // Test 9: Price movement scenario generates meaningful price movement
  it('Test 9 — Price movement scenario generates meaningful price movement', () => {
    const snap = generateSnapshot({ id: 1, symbol: 'TCS', basePrice: 3400 }, '2026-09-05T10:00:00Z', 'PRICE_MOVE');

    expect(snap.price).toBeGreaterThan(snap.previousClose);
    const priceChangePct = (snap.price - snap.previousClose) / snap.previousClose;
    // Price movement should be at least +3%
    expect(priceChangePct).toBeGreaterThanOrEqual(0.03);
  });

  // Test 10: Volume spike scenario generates substantially higher volume
  it('Test 10 — Volume spike scenario generates substantially higher volume', () => {
    const stableSnap = generateSnapshot({ id: 1, symbol: 'TCS', basePrice: 3400 }, '2026-09-05T10:00:00Z', 'STABLE');
    const spikeSnap = generateSnapshot({ id: 1, symbol: 'TCS', basePrice: 3400 }, '2026-09-05T10:00:00Z', 'VOLUME_SPIKE');

    expect(spikeSnap.volume).toBeGreaterThan(stableSnap.volume * 5);
    // Price change in volume spike remains modest
    const priceChangePct = Math.abs((spikeSnap.price - spikeSnap.previousClose) / spikeSnap.previousClose);
    expect(priceChangePct).toBeLessThan(0.015);
  });

  // Test 11: Simulator is deterministic
  it('Test 11 — Simulator is deterministic', () => {
    const snap1 = generateSnapshot({ id: 1, symbol: 'TCS' }, '2026-09-05T10:30:00Z', 'PRICE_MOVE');
    const snap2 = generateSnapshot({ id: 1, symbol: 'TCS' }, '2026-09-05T10:30:00Z', 'PRICE_MOVE');

    expect(snap1).toEqual(snap2);
    expect(snap1.price).toBe(snap2.price);
    expect(snap1.volume).toBe(snap2.volume);
    expect(snap1.highPrice).toBe(snap2.highPrice);
  });

  // ==========================================
  // 3. API TESTS
  // ==========================================

  // Test 12: Existing stock with market data returns 200
  it('Test 12 — Existing stock with market data returns 200', async () => {
    const snapshot = generateSnapshot({ id: testStockId, symbol: 'TCS' }, '2026-09-05T10:00:00Z', 'STABLE');
    await saveMarketSnapshot(db, snapshot);

    const res = await request(app).get(`/api/stocks/${testStockId}/market`);
    expect(res.status).toBe(200);
  });

  // Test 13: Response contains stock identity
  it('Test 13 — Response contains stock identity', async () => {
    const snapshot = generateSnapshot({ id: testStockId, symbol: 'TCS' }, '2026-09-05T10:00:00Z', 'STABLE');
    await saveMarketSnapshot(db, snapshot);

    const res = await request(app).get(`/api/stocks/${testStockId}/market`);
    expect(res.status).toBe(200);
    expect(res.body.stockId).toBe(testStockId);
    expect(res.body.symbol).toBe('TCS');
    expect(res.body.exchange).toBe('NSE');
  });

  // Test 14: Response contains latest market snapshot
  it('Test 14 — Response contains latest market snapshot', async () => {
    const snapshot = generateSnapshot({ id: testStockId, symbol: 'TCS' }, '2026-09-05T10:00:00Z', 'PRICE_MOVE');
    await saveMarketSnapshot(db, snapshot);

    const res = await request(app).get(`/api/stocks/${testStockId}/market`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('market');
    expect(res.body.market.price).toBe(snapshot.price);
    expect(res.body.market.openPrice).toBe(snapshot.openPrice);
    expect(res.body.market.highPrice).toBe(snapshot.highPrice);
    expect(res.body.market.lowPrice).toBe(snapshot.lowPrice);
    expect(res.body.market.previousClose).toBe(snapshot.previousClose);
    expect(res.body.market.volume).toBe(snapshot.volume);
    expect(res.body.market).toHaveProperty('marketTime');
    expect(res.body.market).toHaveProperty('createdAt');
  });

  // Test 15: Nonexistent stock returns 404
  it('Test 15 — Nonexistent stock returns 404', async () => {
    const res = await request(app).get('/api/stocks/99999/market');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Stock not found' });
  });

  // Test 16: Existing stock with no market data returns 404
  it('Test 16 — Existing stock with no market data returns 404', async () => {
    const res = await request(app).get(`/api/stocks/${testStockId}/market`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Market data not found' });
  });

  // Test 17: API returns the snapshot with the latest market_time
  it('Test 17 — API returns the snapshot with the latest market_time', async () => {
    // Older snapshot (10:00)
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3400.0,
      openPrice: 3390.0,
      highPrice: 3410.0,
      lowPrice: 3385.0,
      previousClose: 3390.0,
      volume: 100000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });

    // Newer snapshot (10:15)
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3550.0,
      openPrice: 3390.0,
      highPrice: 3560.0,
      lowPrice: 3385.0,
      previousClose: 3390.0,
      volume: 850000,
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    const res = await request(app).get(`/api/stocks/${testStockId}/market`);
    expect(res.status).toBe(200);
    expect(res.body.market.price).toBe(3550.0);
    expect(new Date(res.body.market.marketTime).toISOString()).toBe('2026-09-05T10:15:00.000Z');
  });

  // Test 18: API uses the standard error format
  it('Test 18 — API uses the standard { "error": "..." } error format', async () => {
    const res404 = await request(app).get('/api/stocks/77777/market');
    expect(res404.status).toBe(404);
    expect(res404.body).toHaveProperty('error');
    expect(typeof res404.body.error).toBe('string');

    const res400 = await request(app).get('/api/stocks/invalid-id/market');
    expect(res400.status).toBe(400);
    expect(res400.body).toEqual({ error: 'Invalid stock ID' });
  });
});
