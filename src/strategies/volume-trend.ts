import { config } from '../config.js';
import { calculateTechnicalFeatures } from '../indicators/technical-features.js';
import type { MarketSnapshot, StockStrategy, StrategyCandidate, TechnicalFeatures } from '../domain/types.js';

export const volumeTrendStrategy: StockStrategy = {
  id: 'volume-trend',
  name: '放量趋势策略',

  async run(context) {
    const coarse = context.snapshots
      .filter(passesCoarseFilter)
      .sort((a, b) => (b.amountYuan ?? 0) - (a.amountYuan ?? 0))
      .slice(0, config.strategyCoarseLimit);
    const candidates: StrategyCandidate[] = [];

    for (const snapshot of coarse) {
      try {
        const bars = await context.getDailyBars(snapshot.code, config.strategyBarLimit);
        const features = calculateTechnicalFeatures(bars);
        if (!passesFineFilter(features)) continue;
        candidates.push({
          code: snapshot.code,
          name: snapshot.name,
          score: calculateScore(snapshot, features),
          reasons: buildReasons(features),
          snapshot,
          features,
        });
      } catch (error) {
        context.warn(`${snapshot.code} ${snapshot.name} 精筛失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      strategyId: this.id,
      scannedCount: context.snapshots.length,
      coarseMatchedCount: coarse.length,
      candidates: candidates.sort((a, b) => b.score - a.score).slice(0, 20),
      warnings: [],
    };
  },
};

function passesCoarseFilter(row: MarketSnapshot) {
  const isSt = /^\*?ST|退/i.test(row.name);
  return (
    !isSt &&
    row.exchange !== 'BJ' &&
    between(row.changePercent, 1, 7) &&
    atLeast(row.turnoverRate, 3) &&
    atLeast(row.amountYuan, 100_000_000) &&
    between(row.circulatingMarketCapYuan, 2_000_000_000, 15_000_000_000)
  );
}

function passesFineFilter(features: TechnicalFeatures) {
  return (
    features.aboveMa20 &&
    features.bullishMaAlignment &&
    (features.volumeRatio5 ?? 0) >= 1.2 &&
    (features.dif ?? Number.NEGATIVE_INFINITY) > (features.dea ?? Number.POSITIVE_INFINITY)
  );
}

function calculateScore(snapshot: MarketSnapshot, features: TechnicalFeatures) {
  let score = 0;
  if (features.aboveMa20) score += 15;
  if (features.bullishMaAlignment) score += 25;
  if (features.macdGoldenCross) score += 15;
  else if ((features.dif ?? 0) > (features.dea ?? 0)) score += 8;
  if (features.breakout20) score += 20;
  score += Math.min(15, Math.max(0, ((features.volumeRatio5 ?? 1) - 1) * 10));
  score += Math.min(10, Math.max(0, (snapshot.turnoverRate ?? 0) - 3));
  return Math.round(Math.min(100, score) * 10) / 10;
}

function buildReasons(features: TechnicalFeatures) {
  const reasons: string[] = [];
  if (features.bullishMaAlignment) reasons.push('MA5 > MA10 > MA20');
  if (features.aboveMa20) reasons.push('收盘价位于 MA20 上方');
  if (features.macdGoldenCross) reasons.push('MACD 当日金叉');
  else if ((features.dif ?? 0) > (features.dea ?? 0)) reasons.push('MACD 位于信号线上方');
  if (features.breakout20) reasons.push('收盘价突破前 20 日高点');
  if ((features.volumeRatio5 ?? 0) >= 1.2) reasons.push(`成交量为前5日均量的 ${features.volumeRatio5!.toFixed(2)} 倍`);
  return reasons;
}

function between(value: number | undefined, min: number, max: number) {
  return value !== undefined && value >= min && value <= max;
}

function atLeast(value: number | undefined, min: number) {
  return value !== undefined && value >= min;
}
