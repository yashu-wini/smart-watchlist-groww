import type { MarketEvent } from './change-detector.js';

export type AttentionLevel =
  | 'NEEDS_ATTENTION'
  | 'WORTH_WATCHING'
  | 'NO_MEANINGFUL_CHANGE';

export interface AttentionResult {
  level: AttentionLevel;
  reason: string;
}

/**
 * Pure function to classify the attention level of a MarketEvent.
 *
 * Rules:
 * Rule A: event.type === 'NO_SIGNIFICANT_CHANGE' -> NO_MEANINGFUL_CHANGE
 * Rule B: event.type === 'PRICE_AND_VOLUME' -> NEEDS_ATTENTION
 * Rule C: event.type === 'PRICE_MOVEMENT' && event.severity === 'SIGNIFICANT' -> NEEDS_ATTENTION
 * Rule D: event.type === 'VOLUME_SPIKE' && event.severity === 'WATCH' -> WORTH_WATCHING
 */
export function classifyAttention(event: MarketEvent): AttentionResult {
  if (!event || typeof event !== 'object') {
    throw new Error('Invalid event input: event must be a valid MarketEvent object');
  }

  switch (event.type) {
    case 'PRICE_AND_VOLUME':
      return {
        level: 'NEEDS_ATTENTION',
        reason: 'Significant price movement combined with a volume spike',
      };

    case 'PRICE_MOVEMENT':
      if (event.severity === 'SIGNIFICANT') {
        return {
          level: 'NEEDS_ATTENTION',
          reason: 'Significant price movement',
        };
      }
      return {
        level: 'NO_MEANINGFUL_CHANGE',
        reason: 'No significant market change detected',
      };

    case 'VOLUME_SPIKE':
      if (event.severity === 'WATCH') {
        return {
          level: 'WORTH_WATCHING',
          reason: 'Unusual increase in trading volume',
        };
      }
      return {
        level: 'NO_MEANINGFUL_CHANGE',
        reason: 'No significant market change detected',
      };

    case 'NO_SIGNIFICANT_CHANGE':
      return {
        level: 'NO_MEANINGFUL_CHANGE',
        reason: 'No significant market change detected',
      };

    default: {
      const unknownType = (event as { type?: unknown }).type;
      throw new Error(`Unknown or unsupported MarketEvent type: ${String(unknownType)}`);
    }
  }
}
