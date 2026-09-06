import { describe, it, expect } from 'vitest';
import { detectMarketChange, type MarketSnapshotInput } from '../src/market/change-detector.js';

describe('Change Detection Engine Domain Tests', () => {
  const baseTimePrev = new Date('2026-09-05T10:00:00Z');
  const baseTimeCurr = new Date('2026-09-05T10:15:00Z');

  // ==========================================
  // BASIC PRICE TESTS
  // ==========================================

  it('Test 1 — Small price change produces NO_SIGNIFICANT_CHANGE (INFO)', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 3400.0,
      volume: 100000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 3410.0, // +0.29%
      volume: 110000,
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('NO_SIGNIFICANT_CHANGE');
    expect(event.severity).toBe('INFO');
    expect(event.priceChangePercent).toBe(0.29);
    expect(event.volumeChangePercent).toBe(10);
  });

  it('Test 2 — Exactly +3.00% price movement produces PRICE_MOVEMENT (SIGNIFICANT)', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 100.0,
      volume: 100000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 103.0, // Exactly +3.00%
      volume: 100000,
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('PRICE_MOVEMENT');
    expect(event.severity).toBe('SIGNIFICANT');
    expect(event.priceChangePercent).toBe(3);
  });

  it('Test 3 — Exactly -3.00% price movement produces PRICE_MOVEMENT (SIGNIFICANT)', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 100.0,
      volume: 100000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 97.0, // Exactly -3.00%
      volume: 100000,
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('PRICE_MOVEMENT');
    expect(event.severity).toBe('SIGNIFICANT');
    expect(event.priceChangePercent).toBe(-3);
  });

  it('Test 4 — Large positive price movement produces PRICE_MOVEMENT (SIGNIFICANT)', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 3400.0,
      volume: 100000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 3600.0, // +5.88%
      volume: 120000,
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('PRICE_MOVEMENT');
    expect(event.severity).toBe('SIGNIFICANT');
    expect(event.priceChangePercent).toBe(5.88);
  });

  it('Test 5 — Large negative price movement produces PRICE_MOVEMENT (SIGNIFICANT)', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 3400.0,
      volume: 100000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 3200.0, // -5.88%
      volume: 120000,
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('PRICE_MOVEMENT');
    expect(event.severity).toBe('SIGNIFICANT');
    expect(event.priceChangePercent).toBe(-5.88);
  });

  it('Test 6 — 2.99% price movement does not cross 3% threshold (NO_SIGNIFICANT_CHANGE)', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 10000.0,
      volume: 100000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 10299.0, // +2.99%
      volume: 100000,
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('NO_SIGNIFICANT_CHANGE');
    expect(event.severity).toBe('INFO');
    expect(event.priceChangePercent).toBe(2.99);
  });

  // ==========================================
  // VOLUME TESTS
  // ==========================================

  it('Test 7 — Volume increase below 2x is not a volume spike', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 3400.0,
      volume: 1000000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 3410.0, // +0.29%
      volume: 1900000, // 1.9x
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('NO_SIGNIFICANT_CHANGE');
    expect(event.severity).toBe('INFO');
    expect(event.volumeChangePercent).toBe(90);
  });

  it('Test 8 — Exactly 2x volume increase produces VOLUME_SPIKE (WATCH)', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 3400.0,
      volume: 1000000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 3410.0, // +0.29%
      volume: 2000000, // Exactly 2.0x
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('VOLUME_SPIKE');
    expect(event.severity).toBe('WATCH');
    expect(event.volumeChangePercent).toBe(100);
  });

  it('Test 9 — More than 2x volume produces VOLUME_SPIKE (WATCH)', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 3400.0,
      volume: 1000000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 3410.0,
      volume: 3500000, // 3.5x
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('VOLUME_SPIKE');
    expect(event.severity).toBe('WATCH');
    expect(event.volumeChangePercent).toBe(250);
  });

  it('Test 10 — Previous volume = 0 sets volumeChangePercent = null and no volume spike', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 3400.0,
      volume: 0,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 3410.0,
      volume: 500000,
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('NO_SIGNIFICANT_CHANGE');
    expect(event.severity).toBe('INFO');
    expect(event.volumeChangePercent).toBeNull();
  });

  // ==========================================
  // COMBINED TESTS
  // ==========================================

  it('Test 11 — Significant price + normal volume produces PRICE_MOVEMENT', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 3400.0,
      volume: 100000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 3550.0, // +4.41%
      volume: 120000, // 1.2x
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('PRICE_MOVEMENT');
    expect(event.severity).toBe('SIGNIFICANT');
  });

  it('Test 12 — Small price + significant volume produces VOLUME_SPIKE', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 3400.0,
      volume: 100000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 3420.0, // +0.59%
      volume: 250000, // 2.5x
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('VOLUME_SPIKE');
    expect(event.severity).toBe('WATCH');
  });

  it('Test 13 — Significant price + significant volume produces PRICE_AND_VOLUME', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 3400.0,
      volume: 100000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 3550.0, // +4.41%
      volume: 250000, // 2.5x
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.type).toBe('PRICE_AND_VOLUME');
    expect(event.severity).toBe('SIGNIFICANT');
  });

  it('Test 14 — Combined event severity is SIGNIFICANT', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 100.0,
      volume: 50000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 105.0, // +5%
      volume: 150000, // 3x
      marketTime: baseTimeCurr,
    };

    const event = detectMarketChange(prev, curr);
    expect(event.severity).toBe('SIGNIFICANT');
  });

  // ==========================================
  // TIMESTAMP TESTS
  // ==========================================

  it('Test 15 — Current timestamp later than previous is valid', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 100.0,
      volume: 100,
      marketTime: '2026-09-05T10:00:00Z',
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 100.0,
      volume: 100,
      marketTime: '2026-09-05T10:01:00Z',
    };

    expect(() => detectMarketChange(prev, curr)).not.toThrow();
  });

  it('Test 16 — Same timestamp is valid', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 100.0,
      volume: 100,
      marketTime: '2026-09-05T10:00:00Z',
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 101.0,
      volume: 100,
      marketTime: '2026-09-05T10:00:00Z',
    };

    const event = detectMarketChange(prev, curr);
    expect(event.previousMarketTime).toBe(event.currentMarketTime);
  });

  it('Test 17 — Current timestamp earlier than previous throws controlled error', () => {
    const prev: MarketSnapshotInput = {
      stockId: 1,
      price: 100.0,
      volume: 100,
      marketTime: '2026-09-05T10:05:00Z',
    };
    const curr: MarketSnapshotInput = {
      stockId: 1,
      price: 100.0,
      volume: 100,
      marketTime: '2026-09-05T10:00:00Z',
    };

    expect(() => detectMarketChange(prev, curr)).toThrow(/Invalid snapshot order/);
  });

  // ==========================================
  // DETERMINISM
  // ==========================================

  it('Test 18 — Same two snapshots produce identical event output', () => {
    const prev: MarketSnapshotInput = {
      id: 10,
      stockId: 1,
      price: 3400.0,
      volume: 100000,
      marketTime: baseTimePrev,
    };
    const curr: MarketSnapshotInput = {
      id: 11,
      stockId: 1,
      price: 3550.0,
      volume: 250000,
      marketTime: baseTimeCurr,
    };

    const event1 = detectMarketChange(prev, curr);
    const event2 = detectMarketChange(prev, curr);

    expect(event1).toEqual(event2);
  });
});
