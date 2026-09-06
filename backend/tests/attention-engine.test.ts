import { describe, it, expect } from 'vitest';
import { classifyAttention } from '../src/market/attention-engine.js';
import type { MarketEvent } from '../src/market/change-detector.js';

describe('Attention Engine Pure Function Tests', () => {
  const baseEvent: MarketEvent = {
    stockId: 1,
    previousSnapshotId: 10,
    currentSnapshotId: 11,
    previousMarketTime: '2026-09-05T10:00:00.000Z',
    currentMarketTime: '2026-09-05T10:15:00.000Z',
    previousPrice: 3400,
    currentPrice: 3550,
    priceChangePercent: 4.41,
    previousVolume: 100000,
    currentVolume: 120000,
    volumeChangePercent: 20,
    type: 'PRICE_MOVEMENT',
    severity: 'SIGNIFICANT',
  };

  // Test 1: PRICE_MOVEMENT + SIGNIFICANT
  it('Test 1 — PRICE_MOVEMENT with SIGNIFICANT severity returns NEEDS_ATTENTION', () => {
    const event: MarketEvent = {
      ...baseEvent,
      type: 'PRICE_MOVEMENT',
      severity: 'SIGNIFICANT',
    };

    const result = classifyAttention(event);
    expect(result.level).toBe('NEEDS_ATTENTION');
  });

  // Test 2: VOLUME_SPIKE + WATCH
  it('Test 2 — VOLUME_SPIKE with WATCH severity returns WORTH_WATCHING', () => {
    const event: MarketEvent = {
      ...baseEvent,
      type: 'VOLUME_SPIKE',
      severity: 'WATCH',
      priceChangePercent: 0.5,
      currentVolume: 250000,
      volumeChangePercent: 150,
    };

    const result = classifyAttention(event);
    expect(result.level).toBe('WORTH_WATCHING');
  });

  // Test 3: PRICE_AND_VOLUME + SIGNIFICANT
  it('Test 3 — PRICE_AND_VOLUME with SIGNIFICANT severity returns NEEDS_ATTENTION', () => {
    const event: MarketEvent = {
      ...baseEvent,
      type: 'PRICE_AND_VOLUME',
      severity: 'SIGNIFICANT',
      priceChangePercent: 5.2,
      currentVolume: 300000,
      volumeChangePercent: 200,
    };

    const result = classifyAttention(event);
    expect(result.level).toBe('NEEDS_ATTENTION');
  });

  // Test 4: NO_SIGNIFICANT_CHANGE + INFO
  it('Test 4 — NO_SIGNIFICANT_CHANGE with INFO severity returns NO_MEANINGFUL_CHANGE', () => {
    const event: MarketEvent = {
      ...baseEvent,
      type: 'NO_SIGNIFICANT_CHANGE',
      severity: 'INFO',
      priceChangePercent: 0.2,
      currentVolume: 105000,
      volumeChangePercent: 5,
    };

    const result = classifyAttention(event);
    expect(result.level).toBe('NO_MEANINGFUL_CHANGE');
  });

  // Test 5: Exact reason for significant price movement
  it('Test 5 — Verify exact reason for significant price movement', () => {
    const event: MarketEvent = {
      ...baseEvent,
      type: 'PRICE_MOVEMENT',
      severity: 'SIGNIFICANT',
    };

    const result = classifyAttention(event);
    expect(result.reason).toBe('Significant price movement');
    expect(result).toEqual({
      level: 'NEEDS_ATTENTION',
      reason: 'Significant price movement',
    });
  });

  // Test 6: Exact reason for volume spike
  it('Test 6 — Verify exact reason for volume spike', () => {
    const event: MarketEvent = {
      ...baseEvent,
      type: 'VOLUME_SPIKE',
      severity: 'WATCH',
    };

    const result = classifyAttention(event);
    expect(result.reason).toBe('Unusual increase in trading volume');
    expect(result).toEqual({
      level: 'WORTH_WATCHING',
      reason: 'Unusual increase in trading volume',
    });
  });

  // Test 7: Exact reason for combined price + volume event
  it('Test 7 — Verify exact reason for combined price + volume event', () => {
    const event: MarketEvent = {
      ...baseEvent,
      type: 'PRICE_AND_VOLUME',
      severity: 'SIGNIFICANT',
    };

    const result = classifyAttention(event);
    expect(result.reason).toBe('Significant price movement combined with a volume spike');
    expect(result).toEqual({
      level: 'NEEDS_ATTENTION',
      reason: 'Significant price movement combined with a volume spike',
    });
  });

  // Test 8: Exact reason for no meaningful change
  it('Test 8 — Verify exact reason for no meaningful change', () => {
    const event: MarketEvent = {
      ...baseEvent,
      type: 'NO_SIGNIFICANT_CHANGE',
      severity: 'INFO',
    };

    const result = classifyAttention(event);
    expect(result.reason).toBe('No significant market change detected');
    expect(result).toEqual({
      level: 'NO_MEANINGFUL_CHANGE',
      reason: 'No significant market change detected',
    });
  });

  // Test 9: Determinism
  it('Test 9 — Verify determinism: calling classifyAttention multiple times produces identical results', () => {
    const event: MarketEvent = {
      ...baseEvent,
      type: 'PRICE_AND_VOLUME',
      severity: 'SIGNIFICANT',
    };

    const run1 = classifyAttention(event);
    const run2 = classifyAttention(event);
    const run3 = classifyAttention(event);

    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);
    expect(run1).toEqual({
      level: 'NEEDS_ATTENTION',
      reason: 'Significant price movement combined with a volume spike',
    });
  });

  // Test 10: Input immutability
  it('Test 10 — Verify that classifyAttention does not mutate the input event', () => {
    const event: MarketEvent = Object.freeze({
      stockId: 1,
      previousSnapshotId: 1,
      currentSnapshotId: 2,
      previousMarketTime: '2026-09-05T10:00:00.000Z',
      currentMarketTime: '2026-09-05T10:15:00.000Z',
      previousPrice: 100,
      currentPrice: 105,
      priceChangePercent: 5.0,
      previousVolume: 500,
      currentVolume: 600,
      volumeChangePercent: 20,
      type: 'PRICE_MOVEMENT',
      severity: 'SIGNIFICANT',
    });

    const eventClone = JSON.parse(JSON.stringify(event));
    const result = classifyAttention(event);

    expect(event).toEqual(eventClone);
    expect(result.level).toBe('NEEDS_ATTENTION');
  });

  // Test 11: Invalid / unknown events error handling
  it('Test 11 — Throws error on unknown or invalid event input', () => {
    expect(() => classifyAttention(null as unknown as MarketEvent)).toThrow('Invalid event input');
    expect(() => classifyAttention({ ...baseEvent, type: 'UNKNOWN_TYPE' as unknown as MarketEvent['type'] })).toThrow(
      'Unknown or unsupported MarketEvent type: UNKNOWN_TYPE'
    );
  });
});
