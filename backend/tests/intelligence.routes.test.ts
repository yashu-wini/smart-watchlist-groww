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
import { saveMarketSnapshot } from '../src/market/market-data.js';
import type { Express } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

describe('Watchlist Intelligence API Tests (GET /api/watchlists/:id/intelligence)', () => {
  let db: DbClient & { end?: () => Promise<void> };
  let app: Express;
  let realPool: pg.Pool | null = null;
  let defaultWatchlistId: number;
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
      console.log(`[Intelligence Routes Tests] Connected to live PostgreSQL test DB: "${config.postgres.testDatabase}"`);
    } catch {
      console.log('[Intelligence Routes Tests] Using pg-mem in-memory PostgreSQL engine.');
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
    await db.query('DELETE FROM watchlist_check_state;');
    await db.query('DELETE FROM market_snapshots;');
    await db.query('DELETE FROM watchlist_stocks;');
    await db.query('DELETE FROM watchlists;');
    await db.query('DELETE FROM stocks;');
    await db.query('DELETE FROM users;');

    // Seed User 1 (default user) and User 2 (for ownership tests)
    await db.query(`
      INSERT INTO users (id, email, password_hash, created_at)
      VALUES 
        (1, 'dev@example.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', NOW()),
        (2, 'user2@example.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', NOW())
      ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email;
    `);

    // Create a default stock TCS
    const stockRes = await db.query(
      "INSERT INTO stocks (symbol, company_name, exchange) VALUES ('TCS', 'Tata Consultancy Services', 'NSE') RETURNING id;"
    );
    testStockId = Number(stockRes.rows[0].id);

    // Create a default watchlist for User 1
    const wlRes = await db.query(
      "INSERT INTO watchlists (user_id, name) VALUES (1, 'Main Watchlist') RETURNING id;"
    );
    defaultWatchlistId = Number(wlRes.rows[0].id);

    // Add TCS to watchlist (added_at before baseline observations)
    await db.query(
      "INSERT INTO watchlist_stocks (watchlist_id, stock_id, added_at) VALUES ($1, $2, '2026-09-05T09:00:00Z');",
      [defaultWatchlistId, testStockId]
    );
  });

  // Test 1: Watchlist with no stocks
  it('Test 1 — Watchlist with no stocks returns empty array and all zero summary counts', async () => {
    const emptyWlRes = await db.query(
      "INSERT INTO watchlists (user_id, name) VALUES (1, 'Empty Watchlist') RETURNING id;"
    );
    const emptyWlId = Number(emptyWlRes.rows[0].id);

    const res = await request(app)
      .get(`/api/watchlists/${emptyWlId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.watchlist).toEqual({
      id: emptyWlId,
      name: 'Empty Watchlist',
    });
    expect(res.body.summary).toEqual({
      needsAttention: 0,
      worthWatching: 0,
      noMeaningfulChange: 0,
    });
    expect(res.body.stocks).toEqual([]);
  });

  // Test 2: Stock with market data
  it('Test 2 — Stock with market data returns stock identity, latest snapshot, and correct display changePercent', async () => {
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3550.0,
      openPrice: 3400.0,
      highPrice: 3560.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 120000,
      marketTime: new Date('2026-09-05T10:10:00Z'),
    });

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stocks.length).toBe(1);
    const stock = res.body.stocks[0];
    expect(stock.stockId).toBe(testStockId);
    expect(stock.symbol).toBe('TCS');
    expect(stock.companyName).toBe('Tata Consultancy Services');
    expect(stock.exchange).toBe('NSE');
    expect(stock.market).toEqual({
      price: 3550.0,
      previousClose: 3400.0,
      changePercent: 4.41,
      volume: 120000,
      marketTime: '2026-09-05T10:10:00.000Z',
    });
  });

  // Test 3: Latest snapshot selection based on market_time DESC (not ID)
  it('Test 3 — Chooses latest snapshot using market_time DESC, regardless of insertion order/ID', async () => {
    // Insert newer market_time first
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3600.0,
      openPrice: 3400.0,
      highPrice: 3610.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 150000,
      marketTime: new Date('2026-09-05T12:00:00Z'), // Newer
    });

    // Insert older market_time second (higher ID)
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3450.0,
      openPrice: 3400.0,
      highPrice: 3460.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 110000,
      marketTime: new Date('2026-09-05T11:00:00Z'), // Older
    });

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stocks[0].market.price).toBe(3600.0);
    expect(res.body.stocks[0].market.marketTime).toBe('2026-09-05T12:00:00.000Z');
  });

  // Test 4: Significant price movement
  it('Test 4 — Returns NEEDS_ATTENTION when price movement >= 3% occurs since checkpoint', async () => {
    // Baseline snapshot at 10:00
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

    // Establish checkpoint
    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // New snapshot at 10:15 (+4.41%)
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

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.needsAttention).toBe(1);
    expect(res.body.stocks[0].attention).toEqual({
      level: 'NEEDS_ATTENTION',
      reason: 'Significant price movement',
    });
  });

  // Test 5: Volume spike
  it('Test 5 — Returns WORTH_WATCHING when volume spike occurs since checkpoint', async () => {
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

    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // New snapshot at 10:15 with 2.5x volume
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3415.0,
      openPrice: 3400.0,
      highPrice: 3420.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 250000,
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.worthWatching).toBe(1);
    expect(res.body.stocks[0].attention).toEqual({
      level: 'WORTH_WATCHING',
      reason: 'Unusual increase in trading volume',
    });
  });

  // Test 6: Combined price movement + volume spike
  it('Test 6 — Returns NEEDS_ATTENTION when price movement + volume spike occurs since checkpoint', async () => {
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

    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // New snapshot at 10:15 (+4.41% and 2.5x volume)
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3550.0,
      openPrice: 3400.0,
      highPrice: 3560.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 250000,
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.needsAttention).toBe(1);
    expect(res.body.stocks[0].attention).toEqual({
      level: 'NEEDS_ATTENTION',
      reason: 'Significant price movement combined with a volume spike',
    });
  });

  // Test 7: Insignificant change
  it('Test 7 — Returns NO_MEANINGFUL_CHANGE when change is below thresholds', async () => {
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

    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // Minor change (+0.29%, 1.1x volume)
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3410.0,
      openPrice: 3400.0,
      highPrice: 3415.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 110000,
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.noMeaningfulChange).toBe(1);
    expect(res.body.stocks[0].attention).toEqual({
      level: 'NO_MEANINGFUL_CHANGE',
      reason: 'No significant market change detected',
    });
  });

  // Test 8: Stock without market data
  it('Test 8 — Stock without market data returns market = null and attention Market data unavailable', async () => {
    // Add second stock with no snapshots
    const infyRes = await db.query(
      "INSERT INTO stocks (symbol, company_name, exchange) VALUES ('INFY', 'Infosys Ltd', 'NSE') RETURNING id;"
    );
    const infyId = Number(infyRes.rows[0].id);

    await db.query(
      'INSERT INTO watchlist_stocks (watchlist_id, stock_id, added_at) VALUES ($1, $2, NOW());',
      [defaultWatchlistId, infyId]
    );

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    const infyStock = res.body.stocks.find((s: any) => s.stockId === infyId);
    expect(infyStock).toBeDefined();
    expect(infyStock.market).toBeNull();
    expect(infyStock.attention).toEqual({
      level: 'NO_MEANINGFUL_CHANGE',
      reason: 'Market data unavailable',
    });
  });

  // Test 9: First-time watchlist without checkpoint
  it('Test 9 — First-time watchlist with historical snapshots returns No previous check available', async () => {
    // Insert snapshot
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3550.0,
      openPrice: 3400.0,
      highPrice: 3560.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 120000,
      marketTime: new Date('2026-09-05T10:10:00Z'),
    });

    // Do NOT call /check endpoint
    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stocks[0].market.price).toBe(3550.0);
    expect(res.body.stocks[0].attention).toEqual({
      level: 'NO_MEANINGFUL_CHANGE',
      reason: 'No previous check available',
    });
  });

  // Test 10: Newly added stock baseline handling
  it('Test 10 — Newly added stock does not trigger false positive attention from pre-addition movements', async () => {
    // Checkpoint at 10:00
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

    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // INFY created with historical moves at 10:00 and 10:10
    const infyRes = await db.query(
      "INSERT INTO stocks (symbol, company_name, exchange) VALUES ('INFY', 'Infosys Ltd', 'NSE') RETURNING id;"
    );
    const infyId = Number(infyRes.rows[0].id);

    await saveMarketSnapshot(db, {
      stockId: infyId,
      price: 1500.0,
      openPrice: 1500.0,
      highPrice: 1510.0,
      lowPrice: 1490.0,
      previousClose: 1500.0,
      volume: 50000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });

    await saveMarketSnapshot(db, {
      stockId: infyId,
      price: 1650.0, // +10% move
      openPrice: 1500.0,
      highPrice: 1660.0,
      lowPrice: 1490.0,
      previousClose: 1500.0,
      volume: 150000,
      marketTime: new Date('2026-09-05T10:10:00Z'),
    });

    // Added to watchlist at 10:15 (after checkpoint)
    await db.query(
      "INSERT INTO watchlist_stocks (watchlist_id, stock_id, added_at) VALUES ($1, $2, '2026-09-05T10:15:00Z');",
      [defaultWatchlistId, infyId]
    );

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    const infyStock = res.body.stocks.find((s: any) => s.stockId === infyId);
    expect(infyStock.attention).toEqual({
      level: 'NO_MEANINGFUL_CHANGE',
      reason: 'No significant market change detected',
    });
  });

  // Test 11: Multiple stocks with mixed attention classifications
  it('Test 11 — Correctly aggregates summary counts across multiple stocks with mixed attention levels', async () => {
    // Create stock 2 (RELIANCE) and stock 3 (HDFC)
    const relRes = await db.query(
      "INSERT INTO stocks (symbol, company_name, exchange) VALUES ('RELIANCE', 'Reliance Industries', 'NSE') RETURNING id;"
    );
    const relId = Number(relRes.rows[0].id);

    const hdfcRes = await db.query(
      "INSERT INTO stocks (symbol, company_name, exchange) VALUES ('HDFCBANK', 'HDFC Bank Ltd', 'NSE') RETURNING id;"
    );
    const hdfcId = Number(hdfcRes.rows[0].id);

    await db.query(
      "INSERT INTO watchlist_stocks (watchlist_id, stock_id, added_at) VALUES ($1, $2, '2026-09-05T09:00:00Z');",
      [defaultWatchlistId, relId]
    );
    await db.query(
      "INSERT INTO watchlist_stocks (watchlist_id, stock_id, added_at) VALUES ($1, $2, '2026-09-05T09:00:00Z');",
      [defaultWatchlistId, hdfcId]
    );

    // Initial snapshots (10:00)
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
      stockId: relId,
      price: 2500.0,
      openPrice: 2500.0,
      highPrice: 2510.0,
      lowPrice: 2490.0,
      previousClose: 2500.0,
      volume: 100000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });
    await saveMarketSnapshot(db, {
      stockId: hdfcId,
      price: 1600.0,
      openPrice: 1600.0,
      highPrice: 1610.0,
      lowPrice: 1590.0,
      previousClose: 1600.0,
      volume: 100000,
      marketTime: new Date('2026-09-05T10:00:00Z'),
    });

    // Checkpoint
    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // Stock 1 (TCS): Price Move -> NEEDS_ATTENTION (+4.41%)
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

    // Stock 2 (RELIANCE): Volume Spike -> WORTH_WATCHING (2.5x volume)
    await saveMarketSnapshot(db, {
      stockId: relId,
      price: 2510.0,
      openPrice: 2500.0,
      highPrice: 2520.0,
      lowPrice: 2490.0,
      previousClose: 2500.0,
      volume: 250000,
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    // Stock 3 (HDFC): Unchanged -> NO_MEANINGFUL_CHANGE (+0.31%)
    await saveMarketSnapshot(db, {
      stockId: hdfcId,
      price: 1605.0,
      openPrice: 1600.0,
      highPrice: 1610.0,
      lowPrice: 1590.0,
      previousClose: 1600.0,
      volume: 105000,
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({
      needsAttention: 1,
      worthWatching: 1,
      noMeaningfulChange: 1,
    });
    expect(res.body.stocks.length).toBe(3);
  });

  // Test 12: Summary consistency (needsAttention + worthWatching + noMeaningfulChange === stocks.length)
  it('Test 12 — Verifies summary counts always equal stocks.length', async () => {
    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    const { needsAttention, worthWatching, noMeaningfulChange } = res.body.summary;
    expect(needsAttention + worthWatching + noMeaningfulChange).toBe(res.body.stocks.length);
  });

  // Test 13: Read-only behavior (does not modify watchlist_check_state)
  it('Test 13 — Read-only behavior: GET /intelligence does not modify or create check state', async () => {
    const stateBefore = await db.query('SELECT * FROM watchlist_check_state;');
    expect(stateBefore.rows.length).toBe(0);

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res.status).toBe(200);

    const stateAfter = await db.query('SELECT * FROM watchlist_check_state;');
    expect(stateAfter.rows.length).toBe(0);
  });

  // Test 14: Ownership enforcement
  it('Test 14 — Nonexistent or unowned watchlist returns 404', async () => {
    // Nonexistent
    const res404 = await request(app)
      .get('/api/watchlists/99999/intelligence')
      .set('Authorization', `Bearer ${devToken}`);
    expect(res404.status).toBe(404);
    expect(res404.body).toEqual({ error: 'Watchlist not found' });

    // Invalid ID
    const resInvalid = await request(app)
      .get('/api/watchlists/abc/intelligence')
      .set('Authorization', `Bearer ${devToken}`);
    expect(resInvalid.status).toBe(400);

    // Watchlist belonging to User 2
    const user2Wl = await db.query(
      "INSERT INTO watchlists (user_id, name) VALUES (2, 'User 2 WL') RETURNING id;"
    );
    const user2WlId = Number(user2Wl.rows[0].id);

    const resOtherUser = await request(app)
      .get(`/api/watchlists/${user2WlId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(resOtherUser.status).toBe(404);
    expect(resOtherUser.body).toEqual({ error: 'Watchlist not found' });
  });

  // Test 15: Foreign key cascade behavior on deleted stock / watchlist
  it('Test 15 — Respects cascade behavior when stock or watchlist is deleted', async () => {
    // Delete stock
    await db.query('DELETE FROM stocks WHERE id = $1;', [testStockId]);

    const res = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res.status).toBe(200);
    expect(res.body.stocks).toEqual([]);
    expect(res.body.summary).toEqual({
      needsAttention: 0,
      worthWatching: 0,
      noMeaningfulChange: 0,
    });

    // Delete watchlist
    await db.query('DELETE FROM watchlists WHERE id = $1;', [defaultWatchlistId]);
    const resAfterWlDelete = await request(app)
      .get(`/api/watchlists/${defaultWatchlistId}/intelligence`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(resAfterWlDelete.status).toBe(404);
  });
});
