import { describe, expect, it, vi } from 'vitest';
import type { DailyBar, MarketSnapshot } from '../src/domain/types.js';
import { calculateMacdSeries } from '../src/indicators/technical-features.js';
import { detectWMacdPattern } from '../src/indicators/w-macd.js';
import { wMacdStrategy } from '../src/strategies/w-macd.js';
import { getStrategy } from '../src/strategies/strategy-registry.js';

// A sustained advance followed by two distinct pullbacks and a neckline breakout.
function makeBars(firstLow = 26, secondLow = 27, scale = 1): DailyBar[] {
  const prices: number[] = [];
  function leg(length: number, from: number, to: number) {
    for (let index = 0; index < length; index += 1) {
      prices.push((from + (to - from) * index / (length - 1)) * scale);
    }
  }
  leg(70, 10, 30);
  leg(10, 29.8, firstLow);
  leg(9, firstLow + 0.1, 29);
  leg(8, 28.8, secondLow);
  leg(8, secondLow + 0.1, 30);
  let date = Date.UTC(2026, 0, 1);
  return prices.map((price) => {
    while ([0, 6].includes(new Date(date).getUTCDay())) date += 86_400_000;
    const tradeDate = new Date(date).toISOString().slice(0, 10);
    date += 86_400_000;
    return {
      code: '600000', tradeDate, open: price, high: price + 0.15 * scale,
      low: price - 0.15 * scale, close: price, volume: 1000,
      adjustType: 'qfq', source: 'test', fetchedAt: '2026-06-01T00:00:00Z',
    };
  });
}

describe('W-MACD shape detection', () => {
  it('finds a raised second low with two shrinking complete MACD blocks above zero', () => {
    const bars = makeBars();
    const pattern = detectWMacdPattern(bars)!;
    expect(pattern.status).toBe('strict');
    expect(pattern.firstLow).toBeCloseTo(25.85);
    expect(pattern.secondLow).toBeCloseTo(26.85);
    expect(pattern.lowGapBars).toBe(17);
    expect(pattern.negativeAreaRatio).toBeLessThan(1);
    expect(pattern.macdBelowZeroBars).toBe(0);
    expect(pattern.aboveNeckline).toBe(true);
    expect(pattern.secondNegativeComplete).toBe(true);
    expect(pattern.windowBars).toBeLessThanOrEqual(65);
    expect(pattern.priorHighDate >= pattern.windowStart).toBe(true);

    const series = calculateMacdSeries(bars.map((bar) => bar.close));
    const area = bars.reduce((sum, bar, index) => sum + (
      bar.tradeDate >= pattern.secondNegativeStart && bar.tradeDate <= pattern.secondNegativeEnd
        ? Math.abs(series[index]!.histogram) : 0
    ), 0);
    expect(pattern.secondNegativeArea).toBeCloseTo(area, 10);
    expect(detectWMacdPattern([...bars].reverse())).toEqual(pattern);
  });

  it('keeps shallow zero crossings in the similar group regardless of nominal share price', () => {
    const pattern = detectWMacdPattern(makeBars(25, 26))!;
    expect(pattern.status).toBe('similar');
    expect(pattern.macdBelowZeroBars).toBeGreaterThan(0);
    expect(pattern.macdMinLineAtr).toBeLessThan(0);
    for (const scale of [0.1, 100]) {
      const scaled = detectWMacdPattern(makeBars(25, 26, scale))!;
      expect(scaled.status).toBe(pattern.status);
      expect(scaled.negativeAreaRatio).toBeCloseTo(pattern.negativeAreaRatio, 8);
      expect(scaled.macdMinLineAtr).toBeCloseTo(pattern.macdMinLineAtr, 8);
    }
  });

  it('labels an unfinished second negative block as provisional', () => {
    const pattern = detectWMacdPattern(makeBars().slice(0, -6))!;
    expect(pattern.status).toBe('similar');
    expect(pattern.secondNegativeComplete).toBe(false);
    expect(pattern.reasons.join('；')).toContain('暂时值');
  });

  it('rejects missing data, an invalid price, and non-adjusted bars', () => {
    expect(detectWMacdPattern([])).toBeUndefined();
    expect(detectWMacdPattern(makeBars().slice(-25))).toBeUndefined();
    const invalid = makeBars();
    invalid[50]!.close = Number.NaN;
    expect(() => detectWMacdPattern(invalid)).toThrow('价格有效');
    expect(() => detectWMacdPattern(makeBars().map((bar) => ({ ...bar, adjustType: 'none' })))).toThrow('前复权');
  });

  it('does not resurrect a W after a later breakdown', () => {
    const bars = makeBars();
    const lastDate = Date.parse(`${bars.at(-1)!.tradeDate}T00:00:00Z`);
    for (let index = 1; index <= 20; index += 1) {
      const close = 30 - index;
      bars.push({ ...bars[0]!, tradeDate: new Date(lastDate + index * 86_400_000).toISOString().slice(0, 10),
        open: close, close, high: close + 0.15, low: close - 0.15 });
    }
    expect(detectWMacdPattern(bars)).toBeUndefined();
  });

  it('rejects a visually level double bottom when the second MACD area grows', () => {
    const bars = makeBars();
    const prices = [
      ...Array.from({ length: 70 }, (_, index) => 10 + 20 * index / 69),
      ...Array.from({ length: 6 }, (_, index) => 29.8 - 2.8 * index / 5),
      ...Array.from({ length: 9 }, (_, index) => 27.1 + 3.9 * index / 8),
      ...Array.from({ length: 16 }, (_, index) => 30.8 - 3.8 * index / 15),
      ...Array.from({ length: 8 }, (_, index) => 27.1 + 4.9 * index / 7),
    ];
    const levelBottom = prices.map((price, index) => ({ ...bars[0]!,
      tradeDate: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      open: price, high: price + 0.15, low: price - 0.15, close: price,
    }));
    const series = calculateMacdSeries(prices);
    const firstArea = series.slice(70, 84).reduce((sum, point) => sum - point.histogram, 0);
    const secondArea = series.slice(88, 105).reduce((sum, point) => sum - point.histogram, 0);
    expect(secondArea).toBeGreaterThan(firstArea);
    expect(detectWMacdPattern(levelBottom)).toBeUndefined();
  });

  it('does not detect a monotonic trend or a W outside the 90 calendar day window', () => {
    const monotonic = makeBars().map((bar, index) => ({ ...bar, open: 10 + index, close: 10 + index,
      high: 10.15 + index, low: 9.85 + index }));
    expect(detectWMacdPattern(monotonic)).toBeUndefined();
    const old = makeBars();
    const last = old.at(-1)!;
    old.push({ ...last, tradeDate: '2026-12-31' });
    expect(detectWMacdPattern(old)).toBeUndefined();
  });
});

describe('w-macd strategy', () => {
  it('uses all stored symbols, groups strict first, and reports gaps without requesting remote data', async () => {
    const snapshots: MarketSnapshot[] = ['600000', '600001', '600002', '600003'].map((code) => ({
      code, name: code, exchange: 'SH', source: 'test', fetchedAt: '2026-06-01T00:00:00Z',
    }));
    const remote = vi.fn(() => { throw new Error('remote must not be called'); });
    const warn = vi.fn();
    const result = await wMacdStrategy.run({ snapshots, getDailyBars: remote, warn,
      getStoredDailyBars: async (code) => code === '600000' ? makeBars(25, 26)
        : code === '600001' ? makeBars() : code === '600002' ? [] : makeBars().slice(-15),
    });
    expect(getStrategy('w-macd')).toBe(wMacdStrategy);
    expect(remote).not.toHaveBeenCalled();
    expect(result.scannedCount).toBe(4);
    expect(result.coarseMatchedCount).toBe(2);
    expect(result.candidates.map((row) => row.features.wMacdPattern?.status)).toEqual(['strict', 'similar']);
    expect(warn.mock.calls.flat().join('；')).toContain('缺少日线 1 只，不足 60 根 1 只');
  });
});
