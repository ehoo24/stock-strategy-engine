import type { DailyBar, MarketDataProvider, MarketSnapshot } from '../domain/types.js';
import type { MarketStore } from '../storage/market-store.js';

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

  async getDailyBars(code: string, limit: number): Promise<DailyBar[]> {
    const local = await this.store.listDailyBars(code, limit, 'qfq');
    if (local.length >= limit && isRecentEnough(local.at(-1)?.tradeDate)) return local;

    const remote = await this.provider.getDailyBars(code, { limit, adjustType: 'qfq' });
    if (remote.data.length) await this.store.upsertDailyBars(remote.data);
    const merged = await this.store.listDailyBars(code, limit, 'qfq');
    return merged.length ? merged : remote.data;
  }

  async syncDailyBars(codes: string[], limit: number, concurrency: number, onProgress?: (done: number) => void) {
    let cursor = 0;
    const failures: Array<{ code: string; error: string }> = [];
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, codes.length)) }, async () => {
      while (cursor < codes.length) {
        const index = cursor++;
        const code = codes[index];
        if (!code) continue;
        try {
          await this.getDailyBars(code, limit);
        } catch (error) {
          failures.push({ code, error: error instanceof Error ? error.message : String(error) });
        } finally {
          onProgress?.(index + 1);
        }
      }
    });
    await Promise.all(workers);
    return { total: codes.length, succeeded: codes.length - failures.length, failures };
  }
}

function isRecentEnough(date?: string) {
  if (!date) return false;
  const ageDays = (Date.now() - Date.parse(`${date}T00:00:00+08:00`)) / 86_400_000;
  return ageDays <= 7;
}
