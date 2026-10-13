import { config } from '../config.js';
import type { StockStrategy, StrategyCandidate, WMacdStage } from '../domain/types.js';
import { calculateTechnicalFeatures } from '../indicators/technical-features.js';
import { detectWMacdRadar } from '../indicators/w-macd-radar.js';

const order: Record<WMacdStage, number> = { 'micro-right': 3, 'left-watch': 2, 'neckline-breakout': 1 };

export const wMacdRadarStrategy: StockStrategy = {
  id: 'w-macd-radar', name: 'W-MACD 阶段雷达',
  async run(context) {
    const candidates: StrategyCandidate[] = [];
    let missing = 0; let insufficient = 0; let evaluated = 0;
    const dates = new Set<string>();
    for (const snapshot of context.snapshots) {
      try {
        const bars = await context.getStoredDailyBars(snapshot.code, config.strategyBarLimit);
        if (!bars.length) { missing += 1; continue; }
        if (bars.length < 60) { insufficient += 1; continue; }
        evaluated += 1; dates.add(bars.at(-1)!.tradeDate);
        const radar = detectWMacdRadar(bars);
        if (!radar) continue;
        candidates.push({ code: snapshot.code, name: snapshot.name, score: radar.qualityScore,
          reasons: [...radar.reasons, ...radar.warnings], snapshot,
          features: { ...calculateTechnicalFeatures(bars), wMacdRadar: radar },
        });
      } catch (error) {
        context.warn(`${snapshot.code} ${snapshot.name} 阶段雷达失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const orderedDates = [...dates].sort();
    context.warn(`阶段雷达仅使用本地前复权日线：实际分析 ${evaluated} 只，缺少日线 ${missing} 只，不足 60 根 ${insufficient} 只。`);
    if (orderedDates.length) context.warn(`日线截至 ${orderedDates[0]}${orderedDates.length > 1 ? ` 至 ${orderedDates.at(-1)}` : ''}；评分是形态健康度，不是上涨概率。`);
    context.warn('止损距离为事前计划测算；跳空和流动性可能导致实际成交价偏离。');
    return { strategyId: this.id, scannedCount: context.snapshots.length, coarseMatchedCount: evaluated,
      candidates: candidates.sort((a, b) => order[b.features.wMacdRadar!.stage] - order[a.features.wMacdRadar!.stage] || b.score - a.score), warnings: [] };
  },
};
