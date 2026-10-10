export type Exchange = 'SH' | 'SZ' | 'BJ';
export type AdjustType = 'qfq' | 'none';

export interface MarketSnapshot {
  code: string;
  name: string;
  exchange: Exchange;
  price?: number;
  changePercent?: number;
  turnoverRate?: number;
  volume?: number;
  amountYuan?: number;
  totalMarketCapYuan?: number;
  circulatingMarketCapYuan?: number;
  source: string;
  fetchedAt: string;
}

export interface DailyBar {
  code: string;
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amountYuan?: number;
  turnoverRate?: number;
  changePercent?: number;
  adjustType: AdjustType;
  source: string;
  fetchedAt: string;
}

export interface ProviderResult<T> {
  data: T;
  source: string;
  fetchedAt: string;
  isComplete: boolean;
  warnings: string[];
}

export interface MarketDataProvider {
  readonly name: string;
  getAllSnapshots(): Promise<ProviderResult<MarketSnapshot[]>>;
  getDailyBars(code: string, options: { limit: number; adjustType: AdjustType }): Promise<ProviderResult<DailyBar[]>>;
}

export interface TechnicalFeatures {
  latestClose: number;
  ma5?: number;
  ma10?: number;
  ma20?: number;
  volumeRatio5?: number;
  dif?: number;
  dea?: number;
  macdHistogram?: number;
  macdGoldenCross: boolean;
  aboveMa20: boolean;
  bullishMaAlignment: boolean;
  breakout20: boolean;
}

export interface StrategyCandidate {
  code: string;
  name: string;
  score: number;
  reasons: string[];
  snapshot: MarketSnapshot;
  features: TechnicalFeatures;
}

export interface StrategyResult {
  runId: string;
  strategyId: string;
  startedAt: string;
  finishedAt: string;
  snapshotFetchedAt?: string;
  scannedCount: number;
  coarseMatchedCount: number;
  candidates: StrategyCandidate[];
  warnings: string[];
}

export interface StrategyContext {
  snapshots: MarketSnapshot[];
  getDailyBars(code: string, limit: number): Promise<DailyBar[]>;
  warn(message: string): void;
}

export interface StockStrategy {
  readonly id: string;
  readonly name: string;
  run(context: StrategyContext): Promise<Omit<StrategyResult, 'runId' | 'startedAt' | 'finishedAt' | 'snapshotFetchedAt'>>;
}
