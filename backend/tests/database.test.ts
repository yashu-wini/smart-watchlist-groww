import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { newDb } from 'pg-mem';
import { config } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

// Interface for database query executor (compatible with pg.Pool and pg-mem)
interface DbExecutor {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;
  end?: () => Promise<void>;
}

describe('PostgreSQL Watchlist Data Model Tests', () => {
  let db: DbExecutor;
  let isLivePostgres = false;
  let realPool: pg.Pool | null = null;

  beforeAll(async () => {
    const schemaPath = path.join(__dirname, '../src/infrastructure/schema.sql');
    const schemaSql = await fs.readFile(schemaPath, 'utf-8');

    // Attempt to connect to live PostgreSQL test database
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
      isLivePostgres = true;
      console.log(`[Tests] Connected to live PostgreSQL test database: "${config.postgres.testDatabase}"`);
    } catch {
      // Fall back to in-memory PostgreSQL instance for offline testing
      console.log('[Tests] Live PostgreSQL server not detected. Using pg-mem in-memory PostgreSQL engine.');
      const memDb = newDb();
      memDb.public.none(schemaSql);
      const pgAdapter = memDb.adapters.createPg();
      db = new pgAdapter.Pool();
      isLivePostgres = false;
    }
  });

  afterAll(async () => {
    if (realPool) {
      await realPool.end();
    }
  });

  beforeEach(async () => {
    // Clean up all tables in reverse dependency order before each test
    await db.query('DELETE FROM watchlist_stocks;');
    await db.query('DELETE FROM watchlists;');
    await db.query('DELETE FROM stocks;');
    await db.query('DELETE FROM users;');
  });

  // Test 1: PostgreSQL connection works
  it('Test 1 — PostgreSQL connection works', async () => {
    const res = await db.query('SELECT 1 AS connected;');
    expect(res.rows[0].connected).toBe(1);
  });

  // Test 2: A user can be inserted
  it('Test 2 — A user can be inserted', async () => {
    const res = await db.query(
      "INSERT INTO users (email, password_hash, created_at) VALUES ('testuser@example.com', 'hash123', NOW()) RETURNING id, email, created_at;"
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].id).toBeDefined();
    expect(res.rows[0].email).toBe('testuser@example.com');
    expect(res.rows[0].created_at).toBeDefined();
  });

  // Test 3: A watchlist can reference an existing user
  it('Test 3 — A watchlist can reference an existing user', async () => {
    const userRes = await db.query(
      "INSERT INTO users (email, password_hash, created_at) VALUES ('watchlistuser@example.com', 'hash123', NOW()) RETURNING id;"
    );
    const userId = userRes.rows[0].id;

    const watchlistRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES ($1, $2) RETURNING id, user_id, name, created_at, updated_at;',
      [userId, 'Tech Growth Watchlist']
    );

    expect(watchlistRes.rows.length).toBe(1);
    expect(watchlistRes.rows[0].name).toBe('Tech Growth Watchlist');
    expect(String(watchlistRes.rows[0].user_id)).toBe(String(userId));
  });

  // Test 4: A stock can be inserted
  it('Test 4 — A stock can be inserted', async () => {
    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id, symbol, company_name, exchange, created_at;',
      ['TCS', 'Tata Consultancy Services', 'NSE']
    );

    expect(stockRes.rows.length).toBe(1);
    expect(stockRes.rows[0].symbol).toBe('TCS');
    expect(stockRes.rows[0].company_name).toBe('Tata Consultancy Services');
    expect(stockRes.rows[0].exchange).toBe('NSE');
  });

  // Test 5: Duplicate (symbol, exchange) is rejected
  it('Test 5 — Duplicate (symbol, exchange) is rejected', async () => {
    await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3);',
      ['INFY', 'Infosys Ltd', 'NSE']
    );

    await expect(
      db.query(
        'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3);',
        ['INFY', 'Infosys Technologies', 'NSE']
      )
    ).rejects.toThrow();
  });

  // Test 6: A stock can be added to a watchlist
  it('Test 6 — A stock can be added to a watchlist', async () => {
    const userRes = await db.query(
      'INSERT INTO users (created_at) VALUES (NOW()) RETURNING id;'
    );
    const userId = userRes.rows[0].id;

    const watchlistRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES ($1, $2) RETURNING id;',
      [userId, 'Bluechip']
    );
    const watchlistId = watchlistRes.rows[0].id;

    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['RELIANCE', 'Reliance Industries', 'NSE']
    );
    const stockId = stockRes.rows[0].id;

    const linkRes = await db.query(
      'INSERT INTO watchlist_stocks (watchlist_id, stock_id) VALUES ($1, $2) RETURNING watchlist_id, stock_id, added_at;',
      [watchlistId, stockId]
    );

    expect(linkRes.rows.length).toBe(1);
    expect(String(linkRes.rows[0].watchlist_id)).toBe(String(watchlistId));
    expect(String(linkRes.rows[0].stock_id)).toBe(String(stockId));
  });

  // Test 7: The same stock cannot be added twice to the same watchlist
  it('Test 7 — The same stock cannot be added twice to the same watchlist', async () => {
    const userRes = await db.query(
      'INSERT INTO users (created_at) VALUES (NOW()) RETURNING id;'
    );
    const userId = userRes.rows[0].id;

    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES ($1, $2) RETURNING id;',
      [userId, 'Banking']
    );
    const watchlistId = wlRes.rows[0].id;

    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['HDFCBANK', 'HDFC Bank Ltd', 'NSE']
    );
    const stockId = stockRes.rows[0].id;

    await db.query(
      'INSERT INTO watchlist_stocks (watchlist_id, stock_id) VALUES ($1, $2);',
      [watchlistId, stockId]
    );

    await expect(
      db.query(
        'INSERT INTO watchlist_stocks (watchlist_id, stock_id) VALUES ($1, $2);',
        [watchlistId, stockId]
      )
    ).rejects.toThrow();
  });

  // Test 8: A watchlist cannot reference a nonexistent user
  it('Test 8 — A watchlist cannot reference a nonexistent user', async () => {
    await expect(
      db.query(
        'INSERT INTO watchlists (user_id, name) VALUES ($1, $2);',
        [999999, 'Orphan Watchlist']
      )
    ).rejects.toThrow();
  });

  // Test 9: Deleting a watchlist removes its watchlist_stocks rows
  it('Test 9 — Deleting a watchlist removes its watchlist_stocks rows', async () => {
    const userRes = await db.query(
      'INSERT INTO users (created_at) VALUES (NOW()) RETURNING id;'
    );
    const userId = userRes.rows[0].id;

    const wlRes = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES ($1, $2) RETURNING id;',
      [userId, 'Auto Sector']
    );
    const watchlistId = wlRes.rows[0].id;

    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['TATAMOTORS', 'Tata Motors Ltd', 'NSE']
    );
    const stockId = stockRes.rows[0].id;

    await db.query(
      'INSERT INTO watchlist_stocks (watchlist_id, stock_id) VALUES ($1, $2);',
      [watchlistId, stockId]
    );

    // Verify relationship exists
    const beforeDelete = await db.query(
      'SELECT * FROM watchlist_stocks WHERE watchlist_id = $1;',
      [watchlistId]
    );
    expect(beforeDelete.rows.length).toBe(1);

    // Delete watchlist
    await db.query('DELETE FROM watchlists WHERE id = $1;', [watchlistId]);

    // Verify cascade deleted the relationship
    const afterDelete = await db.query(
      'SELECT * FROM watchlist_stocks WHERE watchlist_id = $1;',
      [watchlistId]
    );
    expect(afterDelete.rows.length).toBe(0);

    // Stock itself should still exist
    const stockCheck = await db.query('SELECT * FROM stocks WHERE id = $1;', [stockId]);
    expect(stockCheck.rows.length).toBe(1);
  });

  // Test 10: The same stock can belong to two different watchlists
  it('Test 10 — The same stock can belong to two different watchlists', async () => {
    const userRes = await db.query(
      'INSERT INTO users (created_at) VALUES (NOW()) RETURNING id;'
    );
    const userId = userRes.rows[0].id;

    const wl1Res = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES ($1, $2) RETURNING id;',
      [userId, 'Portfolio Alpha']
    );
    const wl1Id = wl1Res.rows[0].id;

    const wl2Res = await db.query(
      'INSERT INTO watchlists (user_id, name) VALUES ($1, $2) RETURNING id;',
      [userId, 'Portfolio Beta']
    );
    const wl2Id = wl2Res.rows[0].id;

    const stockRes = await db.query(
      'INSERT INTO stocks (symbol, company_name, exchange) VALUES ($1, $2, $3) RETURNING id;',
      ['WIPRO', 'Wipro Ltd', 'NSE']
    );
    const stockId = stockRes.rows[0].id;

    // Add stock to both watchlists
    await db.query('INSERT INTO watchlist_stocks (watchlist_id, stock_id) VALUES ($1, $2);', [wl1Id, stockId]);
    await db.query('INSERT INTO watchlist_stocks (watchlist_id, stock_id) VALUES ($1, $2);', [wl2Id, stockId]);

    const linksRes = await db.query('SELECT * FROM watchlist_stocks WHERE stock_id = $1;', [stockId]);
    expect(linksRes.rows.length).toBe(2);
  });
});
