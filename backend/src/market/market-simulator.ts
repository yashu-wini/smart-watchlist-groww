export type MarketScenario = 'STABLE' | 'PRICE_MOVE' | 'VOLUME_SPIKE';

export interface StockIdentity {
  id: number;
  symbol: string;
  companyName?: string;
  exchange?: string;
  basePrice?: number;
}

export interface SimulatedSnapshot {
  stockId: number;
  price: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  previousClose: number;
  volume: number;
  marketTime: Date;
}

function getDeterministicHash(symbol: string, timeMs: number, scenario: string): number {
  let hash = 0;
  const str = `${symbol}:${timeMs}:${scenario}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function getDefaultBasePrice(symbol: string): number {
  const stockBasePrices: Record<string, number> = {
    TCS: 3400.0,
    INFY: 1500.0,
    RELIANCE: 2800.0,
    HDFCBANK: 1600.0,
    TATAMOTORS: 950.0,
    WIPRO: 480.0,
  };

  if (stockBasePrices[symbol.toUpperCase()]) {
    return stockBasePrices[symbol.toUpperCase()]!;
  }

  // Generate fallback base price between 500 and 3000 from symbol string
  let sum = 0;
  for (let i = 0; i < symbol.length; i++) {
    sum += symbol.charCodeAt(i);
  }
  return 500 + (sum % 2500);
}

function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function generateSnapshot(
  stock: StockIdentity,
  timestamp: Date | string | number,
  scenario: MarketScenario = 'STABLE'
): SimulatedSnapshot {
  const marketTime = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const timeMs = marketTime.getTime();
  const base = stock.basePrice ?? getDefaultBasePrice(stock.symbol);
  const hash = getDeterministicHash(stock.symbol, timeMs, scenario);

  let price: number;
  let openPrice: number;
  let highPrice: number;
  let lowPrice: number;
  let previousClose: number;
  let volume: number;

  switch (scenario) {
    case 'PRICE_MOVE': {
      // Significant upward price movement (+3.5% to +5.0%)
      const priceDeltaPct = 0.035 + (hash % 150) / 10000;
      previousClose = base;
      openPrice = roundToTwo(base * 1.008);
      price = roundToTwo(base * (1 + priceDeltaPct));
      highPrice = roundToTwo(Math.max(price, openPrice) * 1.005);
      lowPrice = roundToTwo(Math.min(previousClose, openPrice) * 0.996);
      volume = 300000 + (hash % 150000);
      break;
    }

    case 'VOLUME_SPIKE': {
      // Unusually high volume with modest price variation (< 0.5%)
      const priceDeltaPct = 0.002 + (hash % 30) / 10000;
      previousClose = base;
      openPrice = roundToTwo(base * 1.001);
      price = roundToTwo(base * (1 + priceDeltaPct));
      highPrice = roundToTwo(price * 1.004);
      lowPrice = roundToTwo(base * 0.998);
      // High volume: 1.5M to 3.0M (15x - 30x of stable)
      volume = 1500000 + (hash % 1500000);
      break;
    }

    case 'STABLE':
    default: {
      // Small fluctuation around base (+-0.3%) and standard volume (~100,000)
      const priceDeltaPct = ((hash % 60) - 30) / 10000;
      previousClose = base;
      openPrice = roundToTwo(base * (1 + ((hash % 20) - 10) / 10000));
      price = roundToTwo(base * (1 + priceDeltaPct));
      highPrice = roundToTwo(Math.max(price, openPrice) * 1.003);
      lowPrice = roundToTwo(Math.min(price, openPrice) * 0.997);
      volume = 80000 + (hash % 40000);
      break;
    }
  }

  // Safety checks
  if (highPrice < lowPrice) {
    highPrice = lowPrice;
  }

  return {
    stockId: stock.id,
    price,
    openPrice,
    highPrice,
    lowPrice,
    previousClose,
    volume: Math.round(volume),
    marketTime,
  };
}
