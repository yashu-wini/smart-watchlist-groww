import type { DbClient } from '../routes/watchlist.routes.js';
import type { SimulatedSnapshot } from './market-simulator.js';

export interface MarketSnapshotRow {
  id: number;
  stockId: number;
  price: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  previousClose: number;
  volume: number;
  marketTime: Date | string;
  createdAt: Date | string;
}

export interface LatestMarketDataResult {
  stockId: number;
  symbol: string;
  companyName: string;
  exchange: string;
  market: {
    price: number;
    openPrice: number;
    highPrice: number;
    lowPrice: number;
    previousClose: number;
    volume: number;
    marketTime: Date | string;
    createdAt: Date | string;
  } | null;
}

export async function saveMarketSnapshot(
  db: DbClient,
  snapshot: SimulatedSnapshot | {
    stockId: number;
    price: number;
    openPrice: number;
    highPrice: number;
    lowPrice: number;
    previousClose: number;
    volume: number;
    marketTime: Date | string;
  }
): Promise<MarketSnapshotRow> {
  const result = await db.query(
    `INSERT INTO market_snapshots (
       stock_id, price, open_price, high_price, low_price, previous_close, volume, market_time
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING 
       id,
       stock_id AS "stockId",
       price,
       open_price AS "openPrice",
       high_price AS "highPrice",
       low_price AS "lowPrice",
       previous_close AS "previousClose",
       volume,
       market_time AS "marketTime",
       created_at AS "createdAt";`,
    [
      snapshot.stockId,
      snapshot.price,
      snapshot.openPrice,
      snapshot.highPrice,
      snapshot.lowPrice,
      snapshot.previousClose,
      snapshot.volume,
      snapshot.marketTime,
    ]
  );

  const row = result.rows[0];
  return {
    id: Number(row.id),
    stockId: Number(row.stockId),
    price: parseFloat(row.price),
    openPrice: parseFloat(row.openPrice),
    highPrice: parseFloat(row.highPrice),
    lowPrice: parseFloat(row.lowPrice),
    previousClose: parseFloat(row.previousClose),
    volume: Number(row.volume),
    marketTime: row.marketTime,
    createdAt: row.createdAt,
  };
}

export async function getLatestMarketSnapshot(
  db: DbClient,
  stockId: number
): Promise<LatestMarketDataResult | null> {
  const result = await db.query(
    `SELECT
       s.id AS "stockId",
       s.symbol,
       s.company_name AS "companyName",
       s.exchange,
       m.price,
       m.open_price AS "openPrice",
       m.high_price AS "highPrice",
       m.low_price AS "lowPrice",
       m.previous_close AS "previousClose",
       m.volume,
       m.market_time AS "marketTime",
       m.created_at AS "createdAt"
     FROM stocks s
     LEFT JOIN (
       SELECT *
       FROM market_snapshots
       WHERE stock_id = $1
       ORDER BY market_time DESC
       LIMIT 1
     ) m ON m.stock_id = s.id
     WHERE s.id = $1;`,
    [stockId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const hasMarketData = row.price !== null && row.price !== undefined;

  return {
    stockId: Number(row.stockId),
    symbol: row.symbol,
    companyName: row.companyName,
    exchange: row.exchange,
    market: hasMarketData
      ? {
          price: parseFloat(row.price),
          openPrice: parseFloat(row.openPrice),
          highPrice: parseFloat(row.highPrice),
          lowPrice: parseFloat(row.lowPrice),
          previousClose: parseFloat(row.previousClose),
          volume: Number(row.volume),
          marketTime: row.marketTime,
          createdAt: row.createdAt,
        }
      : null,
  };
}
