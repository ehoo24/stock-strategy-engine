import { describe, expect, it } from 'vitest';
import { calculateTechnicalFeatures } from '../src/indicators/technical-features.js';
import type { DailyBar } from '../src/domain/types.js';

describe('calculateTechnicalFeatures', () => {
  it('calculates bullish alignment and volume ratio from deterministic bars', () => {
    const bars: DailyBar[] = Array.from({ length: 40 }, (_, index) => ({
      code: '600000',
      tradeDate: `2026-01-${String(index + 1).padStart(2, '0')}`,
      open: 10 + index * 0.1,
      high: 10.2 + index * 0.1,
      low: 9.8 + index * 0.1,
      close: 10 + index * 0.1,
      volume: index === 39 ? 2000 : 1000,
      adjustType: 'qfq',
      source: 'test',
      fetchedAt: '2026-01-01T00:00:00.000Z',
    }));

    const result = calculateTechnicalFeatures(bars);

    expect(result.bullishMaAlignment).toBe(true);
    expect(result.aboveMa20).toBe(true);
    expect(result.volumeRatio5).toBe(2);
  });
});
