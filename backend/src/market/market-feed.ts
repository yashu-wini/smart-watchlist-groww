import type { DbClient } from '../routes/watchlist.routes.js';
import { generateSnapshot, type MarketScenario, type StockIdentity } from './market-simulator.js';
import { saveMarketSnapshot, type MarketSnapshotRow } from './market-data.js';

export async function simulateStockSnapshot(
  db: DbClient,
  stockId: number,
  scenario: MarketScenario = 'STABLE',
  explicitTime?: Date | string
): Promise<MarketSnapshotRow> {
  // 1. Fetch stock from DB
  const stockRes = await db.query(
    `SELECT id, symbol, company_name AS "companyName", exchange FROM stocks WHERE id = $1;`,
    [stockId]
  );

  if (stockRes.rows.length === 0) {
    throw new Error(`Stock with ID ${stockId} not found`);
  }

  const stockRow = stockRes.rows[0];
  const stock: StockIdentity = {
    id: Number(stockRow.id),
    symbol: stockRow.symbol,
    companyName: stockRow.companyName,
    exchange: stockRow.exchange,
  };

  // 2. Determine marketTime (ensure advancing chronological timestamp)
  let marketTime: Date;
  if (explicitTime) {
    marketTime = explicitTime instanceof Date ? explicitTime : new Date(explicitTime);
  } else {
    const latestSnapRes = await db.query(
      `SELECT market_time AS "marketTime" FROM market_snapshots WHERE stock_id = $1 ORDER BY market_time DESC LIMIT 1;`,
      [stockId]
    );
    const now = Date.now();
    if (latestSnapRes.rows.length > 0) {
      const lastTime = new Date(latestSnapRes.rows[0].marketTime).getTime();
      marketTime = new Date(Math.max(now, lastTime + 60000));
    } else {
      marketTime = new Date(now);
    }
  }

  // 3. Generate snapshot using deterministic simulator
  const snapshot = generateSnapshot(stock, marketTime, scenario);

  // 4. Save to PostgreSQL market_snapshots
  return await saveMarketSnapshot(db, snapshot);
}
