import type { StrategyResult, StockStrategy } from '../domain/types.js';
import type { MarketDataService } from '../market-data/market-data-service.js';
import type { MarketStore } from '../storage/market-store.js';
import { filterTradableUniverse } from '../market-data/tradable-universe.js';

export class StrategyRunner {
  constructor(
    private readonly marketData: MarketDataService,
    private readonly store: MarketStore,
  ) {}

  async run(strategy: StockStrategy): Promise<StrategyResult> {
    const startedAt = new Date().toISOString();
    const snapshots = await this.marketData.listSnapshots();
    if (!snapshots.length) throw new Error('本地没有市场快照，请先运行 sync-snapshot 或 pipeline');
    const universe = filterTradableUniverse(snapshots);
    if (!universe.included.length) throw new Error('本地行情中没有符合当前交易范围的股票');
    const warnings: string[] = [];
    const partial = await strategy.run({
      snapshots: universe.included,
      getDailyBars: (code, limit) => this.marketData.getDailyBars(code, limit),
      warn: (message) => warnings.push(message),
    });
    const result: StrategyResult = {
      ...partial,
      runId: `${strategy.id}-${Date.now()}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      snapshotFetchedAt: latestSnapshotTime(universe.included.map((row) => row.fetchedAt)),
      warnings: [...partial.warnings, ...warnings],
    };
    await this.store.saveStrategyResult(result);
    return result;
  }
}

function latestSnapshotTime(values: string[]) {
  return values.filter(Boolean).sort().at(-1);
}
