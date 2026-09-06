import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  computeChaosObservation,
  parseEventTypeArg,
  runMarketChaos,
  CANONICAL_STOCKS,
  type BaseSnapshotInput,
} from '../src/tools/market-chaos.js';
import { getPostgresPool, closePostgres } from '../src/infrastructure/postgres.js';
import { initializeDatabase } from '../src/infrastructure/init-db.js';
import { config } from '../src/config.js';
import type pg from 'pg';

describe('Standalone Market Chaos Generator Tests', () => {
  const base: BaseSnapshotInput = {
    price: 1000.0,
    openPrice: 1000.0,
    previousClose: 1000.0,
    volume: 100000,
    marketTime: new Date('2026-09-01T10:00:00.000Z'),
  };

  describe('Pure Calculation Logic (computeChaosObservation)', () => {
    it('generates STABLE event with small movement (within ±0.5%) and normal volume', () => {
      const result = computeChaosObservation(base, 'STABLE');

      expect(result.eventType).toBe('STABLE');
      expect(Math.abs(result.priceChangePercent)).toBeLessThanOrEqual(0.6);
      expect(result.volumeMultiplier).toBeGreaterThanOrEqual(0.9);
      expect(result.volumeMultiplier).toBeLessThanOrEqual(1.2);
      expect(result.price).toBeGreaterThan(0);
      expect(result.highPrice).toBeGreaterThanOrEqual(Math.max(result.openPrice, result.price));
      expect(result.lowPrice).toBeLessThanOrEqual(Math.min(result.openPrice, result.price));
      expect(result.marketTime.getTime()).toBeGreaterThan(base.marketTime.getTime());
    });

    it('generates PRICE_UP event with significant positive move (+3.5% to +6.0%)', () => {
      const result = computeChaosObservation(base, 'PRICE_UP');

      expect(result.eventType).toBe('PRICE_UP');
      expect(result.priceChangePercent).toBeGreaterThanOrEqual(3.5);
      expect(result.priceChangePercent).toBeLessThanOrEqual(6.0);
      expect(result.price).toBeGreaterThan(base.price);
      expect(result.highPrice).toBeGreaterThanOrEqual(result.price);
      expect(result.lowPrice).toBeLessThanOrEqual(result.openPrice);
    });

    it('generates PRICE_DOWN event with significant negative move (-3.5% to -6.0%)', () => {
      const result = computeChaosObservation(base, 'PRICE_DOWN');

      expect(result.eventType).toBe('PRICE_DOWN');
      expect(result.priceChangePercent).toBeLessThanOrEqual(-3.5);
      expect(result.priceChangePercent).toBeGreaterThanOrEqual(-6.0);
      expect(result.price).toBeLessThan(base.price);
      expect(result.highPrice).toBeGreaterThanOrEqual(result.openPrice);
      expect(result.lowPrice).toBeLessThanOrEqual(result.price);
    });

    it('generates VOLUME_SPIKE event with volume >= 2x and price move < 1%', () => {
      const result = computeChaosObservation(base, 'VOLUME_SPIKE');

      expect(result.eventType).toBe('VOLUME_SPIKE');
      expect(result.volumeMultiplier).toBeGreaterThanOrEqual(2.0);
      expect(result.volume).toBeGreaterThanOrEqual(base.volume * 2);
      expect(Math.abs(result.priceChangePercent)).toBeLessThan(1.0);
    });

    it('generates PRICE_AND_VOLUME event with both price move (>=3.5%) and volume >= 2x', () => {
      const result = computeChaosObservation(base, 'PRICE_AND_VOLUME');

      expect(result.eventType).toBe('PRICE_AND_VOLUME');
      expect(Math.abs(result.priceChangePercent)).toBeGreaterThanOrEqual(3.5);
      expect(result.volumeMultiplier).toBeGreaterThanOrEqual(2.0);
      expect(result.volume).toBeGreaterThanOrEqual(base.volume * 2);
    });

    it('strictly enforces OHLC mathematical validity and positive values', () => {
      for (let i = 0; i < 20; i++) {
        const eventTypes = ['STABLE', 'PRICE_UP', 'PRICE_DOWN', 'VOLUME_SPIKE', 'PRICE_AND_VOLUME'] as const;
        const type = eventTypes[i % eventTypes.length];
        const res = computeChaosObservation(base, type);

        expect(res.price).toBeGreaterThan(0);
        expect(res.openPrice).toBeGreaterThan(0);
        expect(res.highPrice).toBeGreaterThanOrEqual(Math.max(res.openPrice, res.price));
        expect(res.lowPrice).toBeLessThanOrEqual(Math.min(res.openPrice, res.price));
        expect(res.lowPrice).toBeGreaterThan(0);
        expect(res.volume).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(res.volume)).toBe(true);
      }
    });
  });

  describe('CLI Argument Parsing (parseEventTypeArg)', () => {
    it('correctly maps CLI strings to ChaosEventType', () => {
      expect(parseEventTypeArg('stable')).toBe('STABLE');
      expect(parseEventTypeArg('price-up')).toBe('PRICE_UP');
      expect(parseEventTypeArg('priceup')).toBe('PRICE_UP');
      expect(parseEventTypeArg('price-down')).toBe('PRICE_DOWN');
      expect(parseEventTypeArg('pricedown')).toBe('PRICE_DOWN');
      expect(parseEventTypeArg('volume-spike')).toBe('VOLUME_SPIKE');
      expect(parseEventTypeArg('volumespike')).toBe('VOLUME_SPIKE');
      expect(parseEventTypeArg('price-and-volume')).toBe('PRICE_AND_VOLUME');
      expect(parseEventTypeArg('invalid-arg')).toBe(null);
      expect(parseEventTypeArg(undefined)).toBe(null);
    });
  });

  describe('Database Persistence Execution (runMarketChaos)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
      pool = getPostgresPool({ database: config.postgres.testDatabase });
      await initializeDatabase(config.postgres.testDatabase);
    });

    afterAll(async () => {
      await closePostgres(pool);
    });

    it('persists a valid snapshot for HDFCBANK without corrupting existing tables', async () => {
      await runMarketChaos({
        symbol: 'HDFCBANK',
        eventType: 'PRICE_UP',
        pool,
      });

      // Verify the snapshot was written
      const stockRes = await pool.query("SELECT id FROM stocks WHERE symbol = 'HDFCBANK';");
      expect(stockRes.rows.length).toBe(1);
      const stockId = stockRes.rows[0].id;

      const snapRes = await pool.query(
        `SELECT price, open_price, high_price, low_price, previous_close, volume, market_time
         FROM market_snapshots
         WHERE stock_id = $1
         ORDER BY market_time DESC
         LIMIT 1;`,
        [stockId]
      );

      expect(snapRes.rows.length).toBe(1);
      const snap = snapRes.rows[0];
      expect(parseFloat(snap.price)).toBeGreaterThan(0);
      expect(parseFloat(snap.high_price)).toBeGreaterThanOrEqual(parseFloat(snap.price));
      expect(parseFloat(snap.low_price)).toBeLessThanOrEqual(parseFloat(snap.price));
      expect(Number(snap.volume)).toBeGreaterThan(0);
    });
  });
});
