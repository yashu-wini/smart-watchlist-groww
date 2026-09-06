export type MarketEventType =
  | 'PRICE_MOVEMENT'
  | 'VOLUME_SPIKE'
  | 'PRICE_AND_VOLUME'
  | 'NO_SIGNIFICANT_CHANGE';

export type MarketEventSeverity =
  | 'INFO'
  | 'WATCH'
  | 'SIGNIFICANT';

export interface MarketSnapshotInput {
  id?: number;
  stockId: number;
  price: number;
  volume: number;
  marketTime: Date | string;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  previousClose?: number;
}

export interface MarketEvent {
  stockId: number;
  previousSnapshotId?: number;
  currentSnapshotId?: number;
  previousMarketTime: string;
  currentMarketTime: string;
  previousPrice: number;
  currentPrice: number;
  priceChangePercent: number;
  previousVolume: number;
  currentVolume: number;
  volumeChangePercent: number | null;
  type: MarketEventType;
  severity: MarketEventSeverity;
}

function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function detectMarketChange(
  previous: MarketSnapshotInput,
  current: MarketSnapshotInput
): MarketEvent {
  if (previous.stockId !== current.stockId) {
    throw new Error(`Cannot compare snapshots of different stocks: ${previous.stockId} vs ${current.stockId}`);
  }

  const prevTime = previous.marketTime instanceof Date ? previous.marketTime : new Date(previous.marketTime);
  const currTime = current.marketTime instanceof Date ? current.marketTime : new Date(current.marketTime);

  if (currTime.getTime() < prevTime.getTime()) {
    throw new Error(
      `Invalid snapshot order: Current snapshot marketTime (${currTime.toISOString()}) is earlier than previous snapshot marketTime (${prevTime.toISOString()})`
    );
  }

  if (previous.price <= 0 || current.price <= 0) {
    throw new Error('Snapshot prices must be strictly positive');
  }

  // 1. Calculate price change percentage with full precision
  const rawPriceChangePercent = ((current.price - previous.price) / previous.price) * 100;

  // 2. Calculate volume change percentage
  let rawVolumeChangePercent: number | null = null;
  let significantVolume = false;

  if (previous.volume > 0) {
    rawVolumeChangePercent = ((current.volume - previous.volume) / previous.volume) * 100;
    // Volume spike threshold: current.volume >= previous.volume * 2
    significantVolume = current.volume >= previous.volume * 2;
  } else {
    // Zero-volume edge case: no division by zero, volumeChangePercent is null, volume spike is false
    rawVolumeChangePercent = null;
    significantVolume = false;
  }

  // 3. Price movement threshold: ABS(priceChangePercent) >= 3.0% (unrounded evaluation)
  const significantPrice = Math.abs(rawPriceChangePercent) >= 3.0;

  // 4. Classify event type and severity
  let type: MarketEventType;
  let severity: MarketEventSeverity;

  if (significantPrice && significantVolume) {
    type = 'PRICE_AND_VOLUME';
    severity = 'SIGNIFICANT';
  } else if (significantPrice) {
    type = 'PRICE_MOVEMENT';
    severity = 'SIGNIFICANT';
  } else if (significantVolume) {
    type = 'VOLUME_SPIKE';
    severity = 'WATCH';
  } else {
    type = 'NO_SIGNIFICANT_CHANGE';
    severity = 'INFO';
  }

  return {
    stockId: current.stockId,
    previousSnapshotId: previous.id,
    currentSnapshotId: current.id,
    previousMarketTime: prevTime.toISOString(),
    currentMarketTime: currTime.toISOString(),
    previousPrice: previous.price,
    currentPrice: current.price,
    priceChangePercent: roundToTwo(rawPriceChangePercent),
    previousVolume: previous.volume,
    currentVolume: current.volume,
    volumeChangePercent: rawVolumeChangePercent !== null ? roundToTwo(rawVolumeChangePercent) : null,
    type,
    severity,
  };
}
