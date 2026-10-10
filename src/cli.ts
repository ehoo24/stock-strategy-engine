import { config } from './config.js';
import { createApp } from './app.js';
import { getStrategy, listStrategies } from './strategies/strategy-registry.js';
import type { StrategyResult } from './domain/types.js';

const [command = 'help', argument] = process.argv.slice(2);
const app = await createApp();

try {
  switch (command) {
    case 'sync-snapshot':
      await syncSnapshot();
      break;
    case 'sync-bars':
      await syncBars(argument);
      break;
    case 'strategy':
      await runStrategy(argument ?? 'volume-trend');
      break;
    case 'pipeline':
      await syncSnapshot();
      await runStrategy(argument ?? 'volume-trend');
      break;
    case 'list':
      console.table(listStrategies());
      break;
    default:
      printHelp();
  }
} finally {
  await app.store.close();
}

async function syncSnapshot() {
  console.log('正在获取全市场行情快照...');
  const result = await app.marketData.syncAllSnapshots();
  console.log(`已写入 ${result.data.length} 条行情，来源：${result.source}，时间：${result.fetchedAt}`);
  for (const warning of result.warnings) console.warn(`警告：${warning}`);
}

async function syncBars(rawLimit?: string) {
  const snapshots = await app.marketData.listSnapshots();
  if (!snapshots.length) throw new Error('本地没有股票列表，请先运行 sync-snapshot');
  const maxSymbols = parsePositiveInteger(rawLimit) ?? snapshots.length;
  const codes = snapshots.slice(0, maxSymbols).map((row) => row.code);
  let lastPrinted = 0;
  const result = await app.marketData.syncDailyBars(
    codes,
    config.strategyBarLimit,
    config.dailyBarConcurrency,
    (done) => {
      if (done - lastPrinted >= 50 || done === codes.length) {
        lastPrinted = done;
        console.log(`日线同步进度：${done}/${codes.length}`);
      }
    },
  );
  console.log(`日线同步完成：成功 ${result.succeeded}/${result.total}，失败 ${result.failures.length}`);
  for (const failure of result.failures.slice(0, 20)) console.warn(`${failure.code}: ${failure.error}`);
}

async function runStrategy(id: string) {
  const result = await app.strategyRunner.run(getStrategy(id));
  printStrategyResult(result);
}

function printStrategyResult(result: StrategyResult) {
  console.log(`\n策略：${result.strategyId}`);
  console.log(`快照时间：${result.snapshotFetchedAt ?? '--'}`);
  console.log(`全市场 ${result.scannedCount} 只，粗筛 ${result.coarseMatchedCount} 只，最终 ${result.candidates.length} 只`);
  console.table(
    result.candidates.map((item, index) => ({
      rank: index + 1,
      code: item.code,
      name: item.name,
      score: item.score,
      changePercent: item.snapshot.changePercent?.toFixed(2),
      turnoverRate: item.snapshot.turnoverRate?.toFixed(2),
      volumeRatio5: item.features.volumeRatio5?.toFixed(2),
      reasons: item.reasons.join('；'),
    })),
  );
  if (result.warnings.length) console.warn(`警告 ${result.warnings.length} 条，示例：\n${result.warnings.slice(0, 10).join('\n')}`);
  console.log(`结果已保存，runId=${result.runId}`);
}

function parsePositiveInteger(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function printHelp() {
  console.log(`
Stock Strategy Engine

  pnpm sync:snapshot          获取并保存全市场行情快照
  pnpm sync:bars -- 100       为前 100 只股票同步日线
  pnpm strategy              用本地快照运行放量趋势策略，缺日线时自动补齐
  pnpm pipeline              同步快照后立即运行策略
  pnpm exec tsx src/cli.ts list

环境变量：
  STOCK_DB_PATH                    DuckDB 路径
  STOCK_DAILY_BAR_CONCURRENCY      日线并发数，默认 8
  STOCK_STRATEGY_COARSE_LIMIT      精筛股票数，默认 80
  STOCK_STRATEGY_BAR_LIMIT         每只股票日线数，默认 140
`);
}
