import { config } from '../config.js';
import type { StockStrategy, StrategyCandidate, WMacdPattern } from '../domain/types.js';
import { calculateTechnicalFeatures } from '../indicators/technical-features.js';
import { detectWMacdPattern } from '../indicators/w-macd.js';

export const wMacdStrategy: StockStrategy = {
  id: 'w-macd',
  name: 'W 底 MACD 缩柱策略',

  async run(context) {
    const universe = context.snapshots;
    const candidates: StrategyCandidate[] = [];
    let missing = 0;
    let insufficient = 0;
    let evaluated = 0;
    const dates = new Set<string>();

    for (const snapshot of universe) {
      try {
        const bars = await context.getStoredDailyBars(snapshot.code, config.strategyBarLimit);
        if (!bars.length) { missing += 1; continue; }
        if (bars.length < 60) { insufficient += 1; continue; }
        evaluated += 1;
        dates.add(bars.at(-1)!.tradeDate);
        const pattern = detectWMacdPattern(bars);
        if (!pattern) continue;
        const features = { ...calculateTechnicalFeatures(bars), wMacdPattern: pattern };
        candidates.push({
          code: snapshot.code,
          name: snapshot.name,
          score: calculateScore(pattern),
          reasons: pattern.reasons,
          snapshot,
          features,
        });
      } catch (error) {
        context.warn(`${snapshot.code} ${snapshot.name} W-MACD 筛选失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const orderedDates = [...dates].sort();
    context.warn(`仅使用本地前复权日线：实际分析 ${evaluated} 只，缺少日线 ${missing} 只，不足 60 根 ${insufficient} 只；没有远程补齐。`);
    if (orderedDates.length) {
      context.warn(`日线截至 ${orderedDates[0]}${orderedDates.length > 1 ? ` 至 ${orderedDates.at(-1)}` : ''}，各股形态窗口以各自最后一根日线为准。`);
    }

    return {
      strategyId: this.id,
      scannedCount: context.snapshots.length,
      coarseMatchedCount: evaluated,
      candidates: candidates.sort(compareCandidates),
      warnings: [],
    };
  },
};

function calculateScore(pattern: WMacdPattern) {
  let score = pattern.status === 'strict' ? 65 : 35;
  score += Math.max(0, 15 * (1 - pattern.negativeAreaRatio));
  score += Math.max(0, 8 - Math.abs(pattern.lowChangePercent) * 0.6);
  if (pattern.macdBelowZeroBars === 0) score += 5;
  if (pattern.currentMacdRising) score += 3;
  if (pattern.currentHistogram >= 0) score += 2;
  if (pattern.aboveNeckline) score += 2;
  return Math.round(Math.min(100, score) * 10) / 10;
}

function compareCandidates(left: StrategyCandidate, right: StrategyCandidate) {
  const leftStrict = left.features.wMacdPattern?.status === 'strict' ? 1 : 0;
  const rightStrict = right.features.wMacdPattern?.status === 'strict' ? 1 : 0;
  return rightStrict - leftStrict || right.score - left.score;
}
