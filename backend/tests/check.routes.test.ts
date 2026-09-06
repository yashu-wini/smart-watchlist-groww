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

describe('Watchlist Checkpoint API Tests (POST /api/watchlists/:id/check)', () => {
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
      console.log(`[Check Routes Tests] Connected to live PostgreSQL test DB: "${config.postgres.testDatabase}"`);
    } catch {
      console.log('[Check Routes Tests] Using pg-mem in-memory PostgreSQL engine.');
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

    // Seed User 1 (default user) and User 2 (for ownership test)
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

  // Test 1: First check establishes baseline without historical changes
  it('Test 1 — First check establishes baseline (changes = [], check state created)', async () => {
    // Insert baseline market data
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

    const res = await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.watchlistId).toBe(defaultWatchlistId);
    expect(res.body.previouslyCheckedAt).toBeNull();
    expect(res.body).toHaveProperty('checkedAt');
    expect(res.body.changes).toEqual([]);

    // Verify row exists in watchlist_check_state
    const stateCheck = await db.query(
      'SELECT * FROM watchlist_check_state WHERE watchlist_id = $1;',
      [defaultWatchlistId]
    );
    expect(stateCheck.rows.length).toBe(1);
    expect(new Date(stateCheck.rows[0].last_checked_market_time).toISOString()).toBe('2026-09-05T10:00:00.000Z');
  });

  // Test 2: Second check with significant price movement
  it('Test 2 — Second check with significant price movement returns PRICE_MOVEMENT (SIGNIFICANT)', async () => {
    // Snapshot 1 (Baseline)
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

    // First check
    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // Insert newer snapshot (+4.41% price move)
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3550.0,
      openPrice: 3400.0,
      highPrice: 3560.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 120000, // 1.2x (not volume spike)
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    // Second check
    const res = await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.previouslyCheckedAt).not.toBeNull();
    expect(res.body.changes.length).toBe(1);
    expect(res.body.changes[0].stockId).toBe(testStockId);
    expect(res.body.changes[0].symbol).toBe('TCS');
    expect(res.body.changes[0].event.type).toBe('PRICE_MOVEMENT');
    expect(res.body.changes[0].event.severity).toBe('SIGNIFICANT');
    expect(res.body.changes[0].event.priceChangePercent).toBe(4.41);
    expect(res.body.changes[0].attention).toEqual({
      level: 'NEEDS_ATTENTION',
      reason: 'Significant price movement',
    });
  });

  // Test 3: Second check with insignificant movement
  it('Test 3 — Second check with insignificant movement returns empty changes', async () => {
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

    // First check
    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // Insert newer snapshot with small price move (+0.29%)
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
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual([]);
  });

  // Test 4: Volume spike
  it('Test 4 — Volume spike produces VOLUME_SPIKE (WATCH) with WORTH_WATCHING attention', async () => {
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

    // First check
    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // Insert newer snapshot with volume 2.5x and small price move (+0.44%)
    await saveMarketSnapshot(db, {
      stockId: testStockId,
      price: 3415.0,
      openPrice: 3400.0,
      highPrice: 3420.0,
      lowPrice: 3390.0,
      previousClose: 3400.0,
      volume: 250000, // 2.5x >= 2x
      marketTime: new Date('2026-09-05T10:15:00Z'),
    });

    const res = await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.changes.length).toBe(1);
    expect(res.body.changes[0].event.type).toBe('VOLUME_SPIKE');
    expect(res.body.changes[0].event.severity).toBe('WATCH');
    expect(res.body.changes[0].attention).toEqual({
      level: 'WORTH_WATCHING',
      reason: 'Unusual increase in trading volume',
    });
  });

  // Test 5: Combined price + volume
  it('Test 5 — Combined price + volume produces PRICE_AND_VOLUME (SIGNIFICANT) with NEEDS_ATTENTION attention', async () => {
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

    // First check
    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // Insert newer snapshot (+4.41% price and 2.5x volume)
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
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(200);
    expect(res.body.changes.length).toBe(1);
    expect(res.body.changes[0].event.type).toBe('PRICE_AND_VOLUME');
    expect(res.body.changes[0].event.severity).toBe('SIGNIFICANT');
    expect(res.body.changes[0].attention).toEqual({
      level: 'NEEDS_ATTENTION',
      reason: 'Significant price movement combined with a volume spike',
    });
  });

  // Test 6: No new market data
  it('Test 6 — Checking again without newer market data returns empty changes and preserves watermark', async () => {
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

    const res1 = await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res2.status).toBe(200);
    expect(res2.body.changes).toEqual([]);

    const stateCheck = await db.query(
      'SELECT * FROM watchlist_check_state WHERE watchlist_id = $1;',
      [defaultWatchlistId]
    );
    expect(new Date(stateCheck.rows[0].last_checked_market_time).toISOString()).toBe('2026-09-05T10:00:00.000Z');
  });

  // Test 7: Independent watchlists
  it('Test 7 — Check state is independent per watchlist', async () => {
    // Create second watchlist for User 1
    const wl2Res = await db.query(
      "INSERT INTO watchlists (user_id, name) VALUES (1, 'Second Watchlist') RETURNING id;"
    );
    const wl2Id = Number(wl2Res.rows[0].id);

    // Check Watchlist 1
    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // Verify Watchlist 2 has no check state
    const checkStateWl2 = await db.query(
      'SELECT * FROM watchlist_check_state WHERE watchlist_id = $1;',
      [wl2Id]
    );
    expect(checkStateWl2.rows.length).toBe(0);

    // Check Watchlist 2
    await request(app)
      .post(`/api/watchlists/${wl2Id}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    const finalStateWl1 = await db.query('SELECT * FROM watchlist_check_state WHERE watchlist_id = $1;', [defaultWatchlistId]);
    const finalStateWl2 = await db.query('SELECT * FROM watchlist_check_state WHERE watchlist_id = $1;', [wl2Id]);

    expect(finalStateWl1.rows.length).toBe(1);
    expect(finalStateWl2.rows.length).toBe(1);
  });

  // Test 8: Newly added stock rule
  it('Test 8 — Newly added stock does not produce historical false positive changes', async () => {
    // 1. Initial snapshot for TCS (10:00)
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

    // First check (10:00 watermark)
    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    // 2. Create another stock INFY with historical snapshots (10:00 = 1500, 10:10 = 1600 (+6.6% move))
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
      price: 1600.0,
      openPrice: 1500.0,
      highPrice: 1610.0,
      lowPrice: 1490.0,
      previousClose: 1500.0,
      volume: 80000,
      marketTime: new Date('2026-09-05T10:10:00Z'),
    });

    // 3. User adds INFY to the watchlist AFTER previous check (at 10:15)
    await db.query(
      "INSERT INTO watchlist_stocks (watchlist_id, stock_id, added_at) VALUES ($1, $2, '2026-09-05T10:15:00Z');",
      [defaultWatchlistId, infyId]
    );

    // 4. Perform check. INFY has no snapshot after added_at (10:15), so it should report NO change
    const res = await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual([]);
  });

  // Test 9: Deleted watchlist cascades to delete check state
  it('Test 9 — Deleting a watchlist automatically deletes its check state', async () => {
    await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    const stateBefore = await db.query('SELECT * FROM watchlist_check_state WHERE watchlist_id = $1;', [defaultWatchlistId]);
    expect(stateBefore.rows.length).toBe(1);

    await db.query('DELETE FROM watchlists WHERE id = $1;', [defaultWatchlistId]);

    const stateAfter = await db.query('SELECT * FROM watchlist_check_state WHERE watchlist_id = $1;', [defaultWatchlistId]);
    expect(stateAfter.rows.length).toBe(0);
  });

  // Test 10: Failed processing does not advance checkpoint
  it('Test 10 — Failed database processing does not advance checkpoint', async () => {
    // Initial check
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

    const initialCheckState = await db.query(
      'SELECT * FROM watchlist_check_state WHERE watchlist_id = $1;',
      [defaultWatchlistId]
    );
    const initialCheckedTime = initialCheckState.rows[0].last_checked_at;

    // Create a mock app with failing DB during second check
    const mockFailingDb: DbClient = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('UPDATE watchlist_check_state')) {
          throw new Error('Database disk error');
        }
        return db.query(sql, params);
      },
    };

    const failingApp = createApp({ db: mockFailingDb });
    const res = await request(failingApp)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to process watchlist check' });

    // Verify checkpoint remained unchanged
    const afterCheckState = await db.query(
      'SELECT * FROM watchlist_check_state WHERE watchlist_id = $1;',
      [defaultWatchlistId]
    );
    expect(afterCheckState.rows[0].last_checked_at).toEqual(initialCheckedTime);
  });

  // Test 11: Insufficient data for a stock does not crash the check operation
  it('Test 11 — Insufficient data for a stock does not crash the check operation', async () => {
    // Create second stock without any snapshots
    const s2 = await db.query(
      "INSERT INTO stocks (symbol, company_name, exchange) VALUES ('WIPRO', 'Wipro Ltd', 'NSE') RETURNING id;"
    );
    const wiproId = Number(s2.rows[0].id);

    await db.query(
      'INSERT INTO watchlist_stocks (watchlist_id, stock_id, added_at) VALUES ($1, $2, NOW());',
      [defaultWatchlistId, wiproId]
    );

    // Should succeed gracefully
    const res = await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual([]);
  });

  // Test 12: Ownership
  it('Test 12 — Checking a nonexistent or other user watchlist returns 404', async () => {
    // Nonexistent watchlist
    const res404 = await request(app)
      .post('/api/watchlists/99999/check')
      .set('Authorization', `Bearer ${devToken}`);
    expect(res404.status).toBe(404);
    expect(res404.body).toEqual({ error: 'Watchlist not found' });

    // Watchlist belonging to User 2
    const user2Wl = await db.query(
      "INSERT INTO watchlists (user_id, name) VALUES (2, 'User 2 WL') RETURNING id;"
    );
    const user2WlId = Number(user2Wl.rows[0].id);

    const resOtherUser = await request(app)
      .post(`/api/watchlists/${user2WlId}/check`)
      .set('Authorization', `Bearer ${devToken}`);
    expect(resOtherUser.status).toBe(404);
    expect(resOtherUser.body).toEqual({ error: 'Watchlist not found' });
  });

  // Test 13: Transaction/concurrent check safety
  it('Test 13 — Transaction and row-level locking protect concurrent checks', async () => {
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

    // Execute concurrent requests
    const res1 = await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);
    const res2 = await request(app)
      .post(`/api/watchlists/${defaultWatchlistId}/check`)
      .set('Authorization', `Bearer ${devToken}`);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const checkStates = await db.query('SELECT * FROM watchlist_check_state WHERE watchlist_id = $1;', [defaultWatchlistId]);
    expect(checkStates.rows.length).toBe(1);
  });
});
