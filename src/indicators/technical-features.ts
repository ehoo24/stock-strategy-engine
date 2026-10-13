import type { DailyBar, TechnicalFeatures } from '../domain/types.js';

export function calculateTechnicalFeatures(bars: DailyBar[]): TechnicalFeatures {
  if (bars.length < 26) throw new Error(`技术指标至少需要 26 根日线，当前仅 ${bars.length} 根`);
  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const macd = calculateMacdSeries(closes);
  const previous = macd.at(-2);
  const latest = macd.at(-1);
  const latestClose = closes.at(-1)!;
  const previous20 = closes.slice(-21, -1);
  const ma5 = average(closes.slice(-5));
  const ma10 = average(closes.slice(-10));
  const ma20 = average(closes.slice(-20));
  const averageVolume5 = average(volumes.slice(-6, -1));

  return {
    latestClose,
    ma5,
    ma10,
    ma20,
    volumeRatio5: averageVolume5 > 0 ? volumes.at(-1)! / averageVolume5 : undefined,
    dif: latest?.dif,
    dea: latest?.dea,
    macdHistogram: latest?.histogram,
    macdGoldenCross: Boolean(previous && latest && previous.dif <= previous.dea && latest.dif > latest.dea),
    aboveMa20: latestClose > ma20,
    bullishMaAlignment: ma5 > ma10 && ma10 > ma20,
    breakout20: previous20.length === 20 && latestClose > Math.max(...previous20),
  };
}

export interface MacdPoint {
  dif: number;
  dea: number;
  histogram: number;
}

export function calculateMacdSeries(values: number[]): MacdPoint[] {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const dif = values.map((_, index) => ema12[index]! - ema26[index]!);
  const dea = ema(dif, 9);
  return dif.map((value, index) => ({
    dif: value,
    dea: dea[index]!,
    histogram: (value - dea[index]!) * 2,
  }));
}

function ema(values: number[], period: number) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  const result = [values[0]!];
  for (let index = 1; index < values.length; index += 1) {
    result.push(values[index]! * multiplier + result[index - 1]! * (1 - multiplier));
  }
  return result;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
