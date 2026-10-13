import { describe, expect, it } from 'vitest';
import type { DailyBar } from '../src/domain/types.js';
import { detectWMacdRadar, replayWMacdRadar } from '../src/indicators/w-macd-radar.js';

function bars(variant: 'direct' | 'micro' = 'direct'): DailyBar[] {
  const prices: number[] = [];
  const leg = (length: number, from: number, to: number) => {
    for (let index = 0; index < length; index += 1) prices.push(from + (to - from) * index / (length - 1));
  };
  leg(70, 10, 30); leg(10, 29.8, 26); leg(9, 26.1, 29); leg(7, 28.8, 27);
  if (variant === 'direct') leg(8, 27.1, 30);
  else { leg(4, 27.1, 27.6); leg(3, 27.5, 27.3); leg(4, 27.4, 28.2); }
  let date = Date.UTC(2026, 0, 1);
  return prices.map((price, index) => {
    while ([0, 6].includes(new Date(date).getUTCDay())) date += 86_400_000;
    const tradeDate = new Date(date).toISOString().slice(0, 10); date += 86_400_000;
    return { code: '600000', tradeDate, open: price, high: price + 0.15, low: price - 0.15,
      close: price, volume: variant === 'direct' && index > 100 ? 1800 : 1000,
      adjustType: 'qfq', source: 'test', fetchedAt: '2026-06-01T00:00:00Z' };
  });
}

describe('W-MACD stage radar', () => {
  it('emits a provisional left signal before the second bottom is confirmed', () => {
    const input = bars();
    const replay = replayWMacdRadar(input);
    const left = replay.find((row) => row.signal?.stage === 'left-watch')!;
    expect(left.signal?.secondBlockComplete).toBe(false);
    expect(left.signal?.firstContraction).toBe(true);
    expect(left.signal?.reasons.join('；')).toContain('未闭合动态值');
    const index = input.findIndex((bar) => bar.tradeDate === left.asOfDate);
    expect(index).toBeLessThan(input.length - 2);
    expect(detectWMacdRadar(input.slice(0, index + 1))).toEqual(left.signal);
  });

  it('requires a previously confirmed micro pivot before emitting micro-right', () => {
    const replay = replayWMacdRadar(bars('micro'));
    const signal = replay.find((row) => row.signal?.stage === 'micro-right')!.signal!;
    expect(signal.microHigh).toBeDefined();
    expect(signal.microHighConfirmedDate! < signal.signalDate).toBe(true);
    expect(signal.asOfDate).toBe(signal.signalDate);
    expect(signal.fromLow.percent).toBeGreaterThan(0);
    expect(signal.necklineSpace.percent).toBeGreaterThan(0);
  });

  it('replay results are prefix-stable when future bars are appended', () => {
    const input = bars();
    const original = replayWMacdRadar(input);
    const extra = Array.from({ length: 8 }, (_, index) => ({ ...input.at(-1)!,
      tradeDate: new Date(Date.parse(`${input.at(-1)!.tradeDate}T00:00:00Z`) + (index + 1) * 86_400_000).toISOString().slice(0, 10),
      open: 31 + index, high: 31.2 + index, low: 30.8 + index, close: 31 + index,
    }));
    const extended = replayWMacdRadar([...input, ...extra]).slice(0, input.length);
    expect(extended).toEqual(original);
  });

  it('uses planned distances and labels scores as quality, not probability', () => {
    const signal = replayWMacdRadar(bars()).find((row) => row.signal?.stage === 'left-watch')!.signal!;
    expect(signal.qualityScore).toBeGreaterThanOrEqual(0);
    expect(signal.qualityScore).toBeLessThanOrEqual(100);
    expect(signal.localInvalidation.percent).toBeLessThan(0);
    expect(signal.structuralInvalidation.percent).toBeLessThan(0);
    expect(signal.necklineSpace.percent).toBeGreaterThan(0);
    expect(signal.localInvalidation.atrMultiple).toBeLessThan(0);
    expect(signal.scoreComponents.momentum + signal.scoreComponents.structure + signal.scoreComponents.volume)
      .toBeCloseTo(signal.qualityScore, 1);
  });

  it('invalidates the setup instead of lowering Low2 below Low1', () => {
    const input = bars('micro');
    const last = input.at(-1)!;
    input.push({ ...last, tradeDate: '2026-06-30', open: 25, high: 25.2, low: 24.8, close: 25 });
    expect(detectWMacdRadar(input)).toBeUndefined();
  });
});
