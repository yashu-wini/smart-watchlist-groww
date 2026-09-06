import { getPostgresPool, closePostgres } from '../infrastructure/postgres.js';
import type pg from 'pg';

export type ChaosEventType =
  | 'STABLE'
  | 'PRICE_UP'
  | 'PRICE_DOWN'
  | 'VOLUME_SPIKE'
  | 'PRICE_AND_VOLUME';

export interface CanonicalStockInfo {
  symbol: string;
  companyName: string;
  exchange: string;
  defaultPrice: number;
  defaultVolume: number;
}

export const CANONICAL_STOCKS: Record<string, CanonicalStockInfo> = {
  TCS: { symbol: 'TCS', companyName: 'Tata Consultancy Services', exchange: 'NSE', defaultPrice: 3850.0, defaultVolume: 250000 },
  RELIANCE: { symbol: 'RELIANCE', companyName: 'Reliance Industries', exchange: 'NSE', defaultPrice: 2950.0, defaultVolume: 450000 },
  INFY: { symbol: 'INFY', companyName: 'Infosys', exchange: 'NSE', defaultPrice: 1620.0, defaultVolume: 350000 },
  HDFCBANK: { symbol: 'HDFCBANK', companyName: 'HDFC Bank', exchange: 'NSE', defaultPrice: 1600.0, defaultVolume: 500000 },
  ICICIBANK: { symbol: 'ICICIBANK', companyName: 'ICICI Bank', exchange: 'NSE', defaultPrice: 1150.0, defaultVolume: 400000 },
  SBIN: { symbol: 'SBIN', companyName: 'State Bank of India', exchange: 'NSE', defaultPrice: 820.0, defaultVolume: 600000 },
  TATAMOTORS: { symbol: 'TATAMOTORS', companyName: 'Tata Motors', exchange: 'NSE', defaultPrice: 980.0, defaultVolume: 700000 },
  WIPRO: { symbol: 'WIPRO', companyName: 'Wipro', exchange: 'NSE', defaultPrice: 520.0, defaultVolume: 300000 },
};

export interface BaseSnapshotInput {
  price: number;
  openPrice?: number;
  previousClose: number;
  volume: number;
  marketTime: Date;
}

export interface GeneratedChaosObservation {
  price: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  previousClose: number;
  volume: number;
  marketTime: Date;
  priceChangePercent: number;
  volumeMultiplier: number;
  eventType: ChaosEventType;
}

/**
 * Pure calculation function for generating a valid market snapshot observation.
 * Ensures all DB constraints and realistic OHLC relationships are preserved.
 */
export function computeChaosObservation(
  base: BaseSnapshotInput,
  eventType: ChaosEventType,
  overrides?: {
    customChangePercent?: number;
    customVolumeMultiplier?: number;
    customTime?: Date;
  }
): GeneratedChaosObservation {
  let priceChangePercent = 0;
  let volumeMultiplier = 1.0;

  switch (eventType) {
    case 'STABLE': {
      // Small price movement: ±0.1% to ±0.5%
      const rawPct = overrides?.customChangePercent ?? (Math.random() * 0.4 + 0.1) * (Math.random() > 0.5 ? 1 : -1);
      priceChangePercent = Math.round(rawPct * 100) / 100;
      // Normal volume variation (0.95x to 1.15x)
      volumeMultiplier = overrides?.customVolumeMultiplier ?? Math.round((Math.random() * 0.2 + 0.95) * 100) / 100;
      break;
    }

    case 'PRICE_UP': {
      // Price movement: +3.5% to +6.0%
      const rawPct = overrides?.customChangePercent ?? (Math.random() * 2.5 + 3.5);
      priceChangePercent = Math.round(rawPct * 100) / 100;
      // Normal/high volume (1.0x to 1.4x)
      volumeMultiplier = overrides?.customVolumeMultiplier ?? Math.round((Math.random() * 0.4 + 1.0) * 100) / 100;
      break;
    }

    case 'PRICE_DOWN': {
      // Price movement: -3.5% to -6.0%
      const rawPct = overrides?.customChangePercent ?? -(Math.random() * 2.5 + 3.5);
      priceChangePercent = Math.round(rawPct * 100) / 100;
      // Normal/high volume (1.0x to 1.4x)
      volumeMultiplier = overrides?.customVolumeMultiplier ?? Math.round((Math.random() * 0.4 + 1.0) * 100) / 100;
      break;
    }

    case 'VOLUME_SPIKE': {
      // Small price movement: less than 1.0% (±0.1% to ±0.5%)
      const rawPct = overrides?.customChangePercent ?? (Math.random() * 0.4 + 0.1) * (Math.random() > 0.5 ? 1 : -1);
      priceChangePercent = Math.round(rawPct * 100) / 100;
      // Volume: at least 2x previous volume (2.1x to 3.5x)
      const rawVolMult = overrides?.customVolumeMultiplier ?? (Math.random() * 1.4 + 2.1);
      volumeMultiplier = Math.round(rawVolMult * 100) / 100;
      break;
    }

    case 'PRICE_AND_VOLUME': {
      // Price movement: ±3.5% to ±6.0%
      const direction = Math.random() > 0.5 ? 1 : -1;
      const rawPct = overrides?.customChangePercent ?? (Math.random() * 2.5 + 3.5) * direction;
      priceChangePercent = Math.round(rawPct * 100) / 100;
      // Volume: at least 2x previous volume (2.1x to 3.5x)
      const rawVolMult = overrides?.customVolumeMultiplier ?? (Math.random() * 1.4 + 2.1);
      volumeMultiplier = Math.round(rawVolMult * 100) / 100;
      break;
    }

    default:
      throw new Error(`Unknown event type: ${String(eventType)}`);
  }

  // Calculate new price
  const rawNewPrice = base.price * (1 + priceChangePercent / 100);
  const newPrice = Math.max(0.01, Math.round(rawNewPrice * 100) / 100);

  // Calculate new volume
  const rawNewVolume = Math.round(base.volume * volumeMultiplier);
  const newVolume = Math.max(0, rawNewVolume);

  // Sensible OHLC relationships
  const openPrice = Math.round(base.price * 100) / 100;
  const maxPrice = Math.max(openPrice, newPrice);
  const minPrice = Math.min(openPrice, newPrice);

  // High >= max(open, close)
  const highPrice = Math.round((maxPrice * 1.002 + 0.05) * 100) / 100;
  // Low <= min(open, close)
  const lowPrice = Math.max(0.01, Math.round((minPrice * 0.998 - 0.05) * 100) / 100);

  // Market time must be strictly later than base observation time
  const baseTimeMs = base.marketTime.getTime();
  const nowMs = Date.now();
  const targetTimeMs = Math.max(nowMs, baseTimeMs + 60000);
  const marketTime = overrides?.customTime ?? new Date(targetTimeMs);

  return {
    price: newPrice,
    openPrice,
    highPrice,
    lowPrice,
    previousClose: Math.round(base.previousClose * 100) / 100,
    volume: newVolume,
    marketTime,
    priceChangePercent,
    volumeMultiplier,
    eventType,
  };
}

/**
 * Parses CLI string into ChaosEventType
 */
export function parseEventTypeArg(raw?: string): ChaosEventType | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase().replace(/_/g, '-');
  switch (normalized) {
    case 'stable':
      return 'STABLE';
    case 'price-up':
    case 'priceup':
    case 'up':
      return 'PRICE_UP';
    case 'price-down':
    case 'pricedown':
    case 'down':
      return 'PRICE_DOWN';
    case 'volume-spike':
    case 'volumespike':
    case 'volume':
      return 'VOLUME_SPIKE';
    case 'price-and-volume':
    case 'price-volume':
    case 'pricevolume':
      return 'PRICE_AND_VOLUME';
    default:
      return null;
  }
}

/**
 * Formats event name for terminal display
 */
function getEventDisplayName(eventType: ChaosEventType): string {
  switch (eventType) {
    case 'STABLE':
      return 'STABLE (Normal Market Fluctuation)';
    case 'PRICE_UP':
      return 'PRICE SURGE (Bullish Breakout)';
    case 'PRICE_DOWN':
      return 'PRICE DROP (Sharp Selloff)';
    case 'VOLUME_SPIKE':
      return 'VOLUME SPIKE (Unusual Institutional Activity)';
    case 'PRICE_AND_VOLUME':
      return 'PRICE + VOLUME SURGE (High-Conviction Momentum)';
  }
}

/**
 * Main Standalone Generator Execution Routine
 */
export async function runMarketChaos(options?: {
  symbol?: string;
  eventType?: ChaosEventType;
  pool?: pg.Pool;
}): Promise<void> {
  const pool = options?.pool ?? getPostgresPool();

  try {
    // 1. Determine Target Stock
    const canonicalKeys = Object.keys(CANONICAL_STOCKS);
    const symbol: string =
      options?.symbol?.toUpperCase().trim() ||
      canonicalKeys[Math.floor(Math.random() * canonicalKeys.length)] ||
      'HDFCBANK';

    const canonicalInfo = CANONICAL_STOCKS[symbol] || {
      symbol,
      companyName: `${symbol} Instrument`,
      exchange: 'NSE',
      defaultPrice: 1000.0,
      defaultVolume: 250000,
    };

    // 2. Fetch or create stock record in DB
    let stockRes = await pool.query(
      'SELECT id, symbol, company_name AS "companyName", exchange FROM stocks WHERE symbol = $1;',
      [symbol]
    );

    let stockRow: { id: number; symbol: string; companyName: string; exchange: string };

    if (stockRes.rows.length === 0) {
      const insertStockRes = await pool.query(
        `INSERT INTO stocks (symbol, company_name, exchange)
         VALUES ($1, $2, $3)
         ON CONFLICT (symbol, exchange) DO UPDATE SET symbol = EXCLUDED.symbol
         RETURNING id, symbol, company_name AS "companyName", exchange;`,
        [canonicalInfo.symbol, canonicalInfo.companyName, canonicalInfo.exchange]
      );
      stockRow = {
        id: Number(insertStockRes.rows[0].id),
        symbol: insertStockRes.rows[0].symbol,
        companyName: insertStockRes.rows[0].companyName,
        exchange: insertStockRes.rows[0].exchange,
      };
    } else {
      stockRow = {
        id: Number(stockRes.rows[0].id),
        symbol: stockRes.rows[0].symbol,
        companyName: stockRes.rows[0].companyName,
        exchange: stockRes.rows[0].exchange,
      };
    }

    // 3. Fetch latest market snapshot for stock
    const snapRes = await pool.query(
      `SELECT price, open_price AS "openPrice", high_price AS "highPrice",
              low_price AS "lowPrice", previous_close AS "previousClose",
              volume, market_time AS "marketTime"
       FROM market_snapshots
       WHERE stock_id = $1
       ORDER BY market_time DESC
       LIMIT 1;`,
      [stockRow.id]
    );

    let baseSnapshot: BaseSnapshotInput;

    if (snapRes.rows.length === 0) {
      baseSnapshot = {
        price: canonicalInfo.defaultPrice,
        openPrice: canonicalInfo.defaultPrice,
        previousClose: canonicalInfo.defaultPrice,
        volume: canonicalInfo.defaultVolume,
        marketTime: new Date(Date.now() - 3600000), // 1 hour ago
      };
    } else {
      const prevRow = snapRes.rows[0];
      baseSnapshot = {
        price: parseFloat(prevRow.price),
        openPrice: parseFloat(prevRow.openPrice),
        previousClose: parseFloat(prevRow.previousClose),
        volume: Number(prevRow.volume),
        marketTime: new Date(prevRow.marketTime),
      };
    }

    // 4. Determine Event Type
    const allEventTypes: ChaosEventType[] = [
      'STABLE',
      'PRICE_UP',
      'PRICE_DOWN',
      'VOLUME_SPIKE',
      'PRICE_AND_VOLUME',
    ];

    const eventType: ChaosEventType =
      options?.eventType ??
      allEventTypes[Math.floor(Math.random() * allEventTypes.length)] ??
      'STABLE';

    // 5. Generate Observation
    const generated = computeChaosObservation(baseSnapshot, eventType);

    // 6. Persist to market_snapshots
    const insertRes = await pool.query(
      `INSERT INTO market_snapshots (
         stock_id, price, open_price, high_price, low_price, previous_close, volume, market_time
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, market_time;`,
      [
        stockRow.id,
        generated.price,
        generated.openPrice,
        generated.highPrice,
        generated.lowPrice,
        generated.previousClose,
        generated.volume,
        generated.marketTime,
      ]
    );

    const snapshotId = insertRes.rows[0].id;

    // 7. Output Formatted Human-Readable Terminal Summary
    const pricePrefix = generated.priceChangePercent > 0 ? '+' : '';
    const volPrefix = generated.volumeMultiplier >= 1.0 ? '+' : '';
    const volChangePct = Math.round((generated.volumeMultiplier - 1.0) * 10000) / 100;

    console.log('\n==================================================');
    console.log('MARKET EVENT GENERATOR');
    console.log('==================================================');
    console.log(`Stock:\n${stockRow.symbol} — ${stockRow.companyName} (${stockRow.exchange})`);
    console.log(`\nEvent:\n${getEventDisplayName(generated.eventType)}`);
    console.log(`\nPrevious Observation:`);
    console.log(`Price: ₹${baseSnapshot.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    console.log(`Volume: ${baseSnapshot.volume.toLocaleString('en-IN')}`);
    console.log(`Time: ${baseSnapshot.marketTime.toISOString()}`);
    console.log(`\nNew Observation (Snapshot #${snapshotId}):`);
    console.log(`Price: ₹${generated.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
    console.log(`Volume: ${generated.volume.toLocaleString('en-IN')}`);
    console.log(`Time: ${generated.marketTime.toISOString()}`);
    console.log(`\nPrice Movement:\n${pricePrefix}${generated.priceChangePercent.toFixed(2)}%`);
    console.log(`Volume Movement:\n${volPrefix}${volChangePct.toFixed(2)}% (${generated.volumeMultiplier.toFixed(2)}x)`);
    console.log('\nSnapshot written successfully.');
    console.log('The existing Market Watch pipeline will classify this observation when the user checks for changes.');
    console.log('==================================================\n');
  } finally {
    if (!options?.pool) {
      await closePostgres(pool);
    }
  }
}

// CLI Execution Entrypoint
if (process.argv[1]?.includes('market-chaos')) {
  // Parse command line arguments:
  // e.g., npm run market:random -- HDFCBANK price-up
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  
  let targetSymbol: string | undefined;
  let targetEvent: ChaosEventType | undefined;

  if (args.length > 0) {
    // First arg could be symbol or event
    const parsedFirst = parseEventTypeArg(args[0]);
    if (parsedFirst) {
      targetEvent = parsedFirst;
    } else {
      targetSymbol = args[0];
    }
  }

  if (args.length > 1) {
    const parsedSecond = parseEventTypeArg(args[1]);
    if (parsedSecond) {
      targetEvent = parsedSecond;
    } else if (!targetSymbol) {
      targetSymbol = args[1];
    }
  }

  runMarketChaos({
    symbol: targetSymbol,
    eventType: targetEvent,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Market Chaos] Error generating market event:', err);
      process.exit(1);
    });
}
