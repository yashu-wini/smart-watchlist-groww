import { getPostgresPool, closePostgres } from './postgres.js';

async function inspectDatabase() {
  const pool = getPostgresPool();
  try {
    console.log('\n================================================================');
    console.log('📊 LIVE DATABASE INSPECTION (market_watchlist)');
    console.log('================================================================\n');

    // 0. Users
    const users = await pool.query('SELECT id, email, created_at AS "createdAt" FROM users ORDER BY id ASC;');
    console.log('--- [0. USERS] (Total: ' + users.rows.length + ') ---');
    console.table(users.rows);

    // 1. Stocks
    const stocks = await pool.query('SELECT id, symbol, company_name AS "companyName", exchange FROM stocks ORDER BY id ASC;');
    console.log('\n--- [1. STOCKS CATALOG] (Total: ' + stocks.rows.length + ') ---');
    console.table(stocks.rows);

    // 2. Watchlists
    const watchlists = await pool.query('SELECT id, user_id AS "userId", name, created_at AS "createdAt" FROM watchlists ORDER BY id ASC;');
    console.log('\n--- [2. WATCHLISTS] (Total: ' + watchlists.rows.length + ') ---');
    console.table(watchlists.rows);

    // 3. Watchlist Stocks
    const wlStocks = await pool.query(`
      SELECT 
        ws.watchlist_id AS "watchlistId",
        w.name AS "watchlistName",
        s.id AS "stockId",
        s.symbol,
        ws.added_at AS "addedAt"
      FROM watchlist_stocks ws
      JOIN watchlists w ON w.id = ws.watchlist_id
      JOIN stocks s ON s.id = ws.stock_id
      ORDER BY ws.watchlist_id ASC, s.id ASC;
    `);
    console.log('\n--- [3. WATCHLIST MEMBERSHIPS] (Total: ' + wlStocks.rows.length + ') ---');
    console.table(wlStocks.rows);

    // 4. Checkpoint State
    const checkState = await pool.query('SELECT * FROM watchlist_check_state;');
    console.log('\n--- [4. "SINCE YOU LAST CHECKED" WATERMARKS] ---');
    console.table(checkState.rows);

    // 5. Latest Market Snapshots
    const snapshots = await pool.query(`
      SELECT 
        ms.id,
        s.symbol,
        ms.price,
        ms.previous_close AS "prevClose",
        ms.volume,
        ms.market_time AS "marketTime"
      FROM market_snapshots ms
      JOIN stocks s ON s.id = ms.stock_id
      ORDER BY ms.market_time DESC
      LIMIT 10;
    `);
    console.log('\n--- [5. RECENT MARKET SNAPSHOTS] (Top 10) ---');
    console.table(snapshots.rows);

    console.log('\n================================================================\n');
  } catch (error) {
    console.error('Failed to inspect database:', error instanceof Error ? error.message : error);
  } finally {
    await closePostgres(pool);
  }
}

inspectDatabase();
