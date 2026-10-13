export interface MarketStatus {
  count: number;
  fetchedAt: string | null;
  source: string | null;
  dailyBars: { count: number; oldestLatestDate: string | null; latestDate: string | null };
}

export interface DataSyncResult {
  snapshot: { count: number; fetchedAt: string; source: string } | null;
  dailyBars: {
    total: number; succeeded: number;
    failures: Array<{ code: string; error: string }>;
    warnings: string[];
    refreshed: Array<{ code: string; latestDate: string; count: number }>;
  };
  dailyBarStatus: MarketStatus['dailyBars'];
  warnings: string[];
}

export interface StrategyInfo { id: string; name: string }

export interface Candidate {
  code: string;
  name: string;
  score: number;
  reasons: string[];
  snapshot: {
    price?: number;
    changePercent?: number;
    turnoverRate?: number;
    amountYuan?: number;
    circulatingMarketCapYuan?: number;
    fetchedAt: string;
  };
  features: {
    latestClose: number;
    ma5?: number;
    ma10?: number;
    ma20?: number;
    volumeRatio5?: number;
    dif?: number;
    dea?: number;
    macdHistogram?: number;
    breakout20: boolean;
    wMacdRadar?: {
      stage: 'left-watch' | 'micro-right' | 'neckline-breakout'; stageLabel: string;
      asOfDate: string; signalDate: string; qualityScore: number; provisionalLow: number;
      secondBlockBars: number; secondBlockComplete: boolean; areaRatio: number;
      histogramContractionPercent?: number; consecutiveContractionBars: number;
      volumeRatio20: number; pullbackVolumeRatio: number; plannedRewardRisk: number; atr14: number;
      fromLow: Distance; localInvalidation: Distance; structuralInvalidation: Distance; necklineSpace: Distance;
      scoreComponents: { momentum: number; structure: number; volume: number }; warnings: string[];
    };
  };
}
interface Distance { price: number; percent: number; atrMultiple: number }

export interface RunSummary {
  runId: string;
  strategyId: string;
  startedAt: string;
  finishedAt: string;
  snapshotFetchedAt?: string;
  scannedCount: number;
  coarseMatchedCount: number;
  candidateCount: number;
  warningCount: number;
}

export interface StrategyRun extends Omit<RunSummary, 'candidateCount' | 'warningCount'> {
  candidates: Candidate[];
  warnings: string[];
}

export interface DailyBar {
  code: string;
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `请求失败（${response.status}）`);
  return body as T;
}
