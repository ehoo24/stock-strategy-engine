import { config } from './config.js';
import { MarketDataService } from './market-data/market-data-service.js';
import { StockSdkProvider } from './providers/stock-sdk-provider.js';
import { MarketStore } from './storage/market-store.js';
import { StrategyRunner } from './strategies/strategy-runner.js';

export async function createApp() {
  const store = new MarketStore(config.databasePath);
  await store.initialize();
  const provider = new StockSdkProvider();
  const marketData = new MarketDataService(store, provider);
  const strategyRunner = new StrategyRunner(marketData, store);
  return { store, provider, marketData, strategyRunner };
}
