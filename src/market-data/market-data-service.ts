import type { DailyBar, MarketDataProvider, MarketSnapshot } from '../domain/types.js';
import type { MarketStore } from '../storage/market-store.js';
import { filterTradableUniverse } from './tradable-universe.js';

export class MarketDataService {
  constructor(
    private readonly store: MarketStore,
    private readonly provider: MarketDataProvider,
  ) {}

  async syncAllSnapshots() {
    const result = await this.provider.getAllSnapshots();
    await this.store.upsertSnapshots(result.data);
    return result;
  }

  listSnapshots(): Promise<MarketSnapshot[]> {
    return this.store.listSnapshots();
  }

  getStoredDailyBars(code: string, limit: number): Promise<DailyBar[]> {
    return this.store.listDailyBars(code, limit, 'qfq');
  }

  async getDailyBarStatus() {
    const symbols = await this.store.getDailyBarStatus();
    const dates = symbols.map((row) => row.latestDate).sort();
    return { count: symbols.length, oldestLatestDate: dates[0] ?? null, latestDate: dates.at(-1) ?? null };
  }

  async syncStoredMarketData(limit: number, concurrency: number, onProgress?: (done: number) => void) {
    const warnings: string[] = [];
    let snapshot: { count: number; fetchedAt: string; source: string } | null = null;
    try {
      const result = await this.syncAllSnapshots();
      snapshot = { count: result.data.length, fetchedAt: result.fetchedAt, source: result.source };
      warnings.push(...result.warnings);
    } catch (error) {
      warnings.push(`快照更新失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const stored = await this.store.getDailyBarStatus();
    const tradable = new Set(filterTradableUniverse(await this.listSnapshots()).included.map((row) => row.code));
    const codes = stored.filter((row) => tradable.has(row.code)).map((row) => row.code);
    const dailyBars = await this.syncDailyBars(codes, limit, concurrency, onProgress);
    return { snapshot, dailyBars, dailyBarStatus: await this.getDailyBarStatus(), warnings };
  }

  async refreshDailyBars(code: string, limit: number) {
    const remote = await this.provider.getDailyBars(code, { limit, adjustType: 'qfq' });
    if (!remote.data.length) throw new Error(`${remote.source} 未返回有效日线：${remote.warnings.join('；') || '空响应'}`);
    await this.store.upsertDailyBars(remote.data);
    return remote;
  }

  async getDailyBars(code: string, limit: number): Promise<DailyBar[]> {
    const local = await this.store.listDailyBars(code, limit, 'qfq');
    if (local.length >= limit && isRecentEnough(local.at(-1)?.tradeDate)) return local;

    const remote = await this.provider.getDailyBars(code, { limit, adjustType: 'qfq' });
    if (remote.data.length) await this.store.upsertDailyBars(remote.data);
    const merged = await this.store.listDailyBars(code, limit, 'qfq');
    return merged.length ? merged : remote.data;
  }

  async syncDailyBars(codes: string[], limit: number, concurrency: number, onProgress?: (done: number) => void) {
    codes = [...new Set(codes)];
    let cursor = 0;
    let completed = 0;
    const warnings: string[] = [];
    const refreshed: Array<{ code: string; latestDate: string; count: number }> = [];
    const failures: Array<{ code: string; error: string }> = [];
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, codes.length)) }, async () => {
      while (cursor < codes.length) {
        const index = cursor++;
        const code = codes[index];
        if (!code) continue;
        try {
          const result = await this.refreshDailyBars(code, limit);
          warnings.push(...result.warnings.map((warning) => `${code}：${warning}`));
          if (!result.isComplete) warnings.push(`${code}：${result.source} 报告数据不完整`);
          if (result.data.length < limit) warnings.push(`${code}：请求 ${limit} 根，实际返回 ${result.data.length} 根日线`);
          const latestDate = result.data.map((bar) => bar.tradeDate).sort().at(-1)!;
          refreshed.push({ code, latestDate, count: result.data.length });
        } catch (error) {
          failures.push({ code, error: error instanceof Error ? error.message : String(error) });
        } finally {
          completed += 1;
          onProgress?.(completed);
        }
      }
    });
    await Promise.all(workers);
    return { total: codes.length, succeeded: refreshed.length, failures, warnings, refreshed: refreshed.sort((a, b) => a.code.localeCompare(b.code)) };
  }
}

function isRecentEnough(date?: string) {
  if (!date) return false;
  const ageDays = (Date.now() - Date.parse(`${date}T00:00:00+08:00`)) / 86_400_000;
  return ageDays <= 7;
}
