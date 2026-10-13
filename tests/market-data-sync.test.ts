import { describe, expect, it, vi } from 'vitest';
import { MarketDataService } from '../src/market-data/market-data-service.js';
import type { MarketStore } from '../src/storage/market-store.js';
import type { DailyBar, MarketDataProvider, MarketSnapshot, ProviderResult } from '../src/domain/types.js';

const snapshot: MarketSnapshot = { code: '600000', name: '测试股票', exchange: 'SH', source: 'test', fetchedAt: '2026-10-13T08:00:00Z' };
const bar: DailyBar = { code: '600000', tradeDate: '2026-10-09', open: 10, high: 11, low: 9, close: 10,
  volume: 1000, adjustType: 'qfq', source: 'test', fetchedAt: '2026-10-09T08:00:00Z' };
function response(data: DailyBar[], warnings: string[] = [], isComplete = true): ProviderResult<DailyBar[]> {
  return { data, warnings, isComplete, source: 'test-provider', fetchedAt: '2026-10-13T08:00:00Z' };
}
function setup() {
  const store = {
    listSnapshots: vi.fn(async () => [snapshot]),
    upsertSnapshots: vi.fn(async () => undefined),
    listDailyBars: vi.fn(async () => Array.from({ length: 140 }, () => ({ ...bar }))),
    upsertDailyBars: vi.fn(async (_bars: DailyBar[]) => undefined),
    getDailyBarStatus: vi.fn(async () => [{ code: '600000', latestDate: '2026-10-09' }]),
  };
  const provider: MarketDataProvider = {
    name: 'test-provider',
    getAllSnapshots: vi.fn(async () => ({ data: [snapshot], source: 'test', fetchedAt: snapshot.fetchedAt, isComplete: true, warnings: [] })),
    getDailyBars: vi.fn(async () => response([{ ...bar, tradeDate: '2026-10-13' }])),
  };
  return { store, provider, service: new MarketDataService(store as unknown as MarketStore, provider) };
}

describe('manual data synchronization', () => {
  it('forces a provider request despite a recent complete cache and reports the actual date', async () => {
    const { service, provider, store } = setup();
    const progress = vi.fn();
    const result = await service.syncDailyBars(['600000', '600000'], 140, 2, progress);
    expect(provider.getDailyBars).toHaveBeenCalledExactlyOnceWith('600000', { limit: 140, adjustType: 'qfq' });
    expect(store.listDailyBars).not.toHaveBeenCalled();
    expect(store.upsertDailyBars).toHaveBeenCalledOnce();
    expect(result.total).toBe(1);
    expect(result.refreshed[0]?.latestDate).toBe('2026-10-13');
    expect(result.warnings.join('；')).toContain('实际返回 1 根');
    expect(progress).toHaveBeenCalledWith(1);
  });

  it('preserves cached data on empty responses and keeps the concrete source error', async () => {
    const { service, provider, store } = setup();
    vi.mocked(provider.getDailyBars).mockResolvedValue(response([], ['数据源无返回'], false));
    const result = await service.syncDailyBars(['600000'], 140, 1);
    expect(result.succeeded).toBe(0);
    expect(result.failures[0]?.error).toContain('test-provider 未返回有效日线：数据源无返回');
    expect(store.upsertDailyBars).not.toHaveBeenCalled();
  });

  it('does not label an old or partial provider response as updated to today', async () => {
    const { service, provider } = setup();
    vi.mocked(provider.getDailyBars).mockResolvedValue(response([bar], ['返回部分历史'], false));
    const result = await service.syncDailyBars(['600000'], 140, 1);
    expect(result.refreshed[0]?.latestDate).toBe('2026-10-09');
    expect(result.warnings.join('；')).toContain('返回部分历史');
    expect(result.warnings.join('；')).toContain('数据不完整');
  });

  it('updates only stored tradable symbols and still syncs bars when snapshots fail', async () => {
    const { service, provider, store } = setup();
    store.getDailyBarStatus.mockResolvedValue([{ code: '600000', latestDate: '2026-10-09' }, { code: '688001', latestDate: '2026-10-09' }]);
    store.listSnapshots.mockResolvedValue([snapshot, { ...snapshot, code: '600001' }, { ...snapshot, code: '688001' }]);
    vi.mocked(provider.getAllSnapshots).mockRejectedValue(new Error('eastmoney: network timeout'));
    const result = await service.syncStoredMarketData(140, 2);
    expect(result.snapshot).toBeNull();
    expect(result.warnings.join('；')).toContain('eastmoney: network timeout');
    expect(result.dailyBars.total).toBe(1);
    expect(provider.getDailyBars).toHaveBeenCalledExactlyOnceWith('600000', { limit: 140, adjustType: 'qfq' });
  });

  it('limits concurrency and counts completions rather than dispatched indexes', async () => {
    const { service, provider } = setup();
    const progress: number[] = [];
    let releaseFirst!: () => void;
    let inFlight = 0;
    let peak = 0;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    vi.mocked(provider.getDailyBars).mockImplementation(async (code) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      if (code === '600000') await first;
      else releaseFirst();
      inFlight -= 1;
      if (code === '600001') throw new Error('provider rate limit');
      return response([{ ...bar, code }]);
    });
    const result = await service.syncDailyBars(['600000', '600001', '600002'], 140, 2, (done) => progress.push(done));
    expect(peak).toBeLessThanOrEqual(2);
    expect(progress).toEqual([1, 2, 3]);
    expect(result.succeeded).toBe(2);
    expect(result.failures).toEqual([{ code: '600001', error: 'provider rate limit' }]);
  });
});
