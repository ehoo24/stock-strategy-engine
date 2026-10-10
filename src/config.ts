import { resolve } from 'node:path';

function integerEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const config = {
  databasePath: resolve(process.env.STOCK_DB_PATH ?? './data/market.duckdb'),
  requestTimeoutMs: integerEnv('STOCK_REQUEST_TIMEOUT_MS', 12_000),
  dailyBarConcurrency: integerEnv('STOCK_DAILY_BAR_CONCURRENCY', 8),
  strategyBarLimit: integerEnv('STOCK_STRATEGY_BAR_LIMIT', 140),
  strategyCoarseLimit: integerEnv('STOCK_STRATEGY_COARSE_LIMIT', 80),
};
