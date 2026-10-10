import StockSDK, { type FullQuote, type HistoryKline } from 'stock-sdk';
import type {
  AdjustType,
  DailyBar,
  Exchange,
  MarketDataProvider,
  MarketSnapshot,
  ProviderResult,
} from '../domain/types.js';
import { config } from '../config.js';

const WAN_TO_YUAN = 10_000;
const YI_TO_YUAN = 100_000_000;

export class StockSdkProvider implements MarketDataProvider {
  readonly name = 'stock-sdk';
  private readonly sdk = new StockSDK({
    timeout: config.requestTimeoutMs,
    retry: { maxRetries: 2, baseDelay: 500 },
    providerPolicies: { eastmoney: { rotateUserAgent: true } },
  });

  async getAllSnapshots(): Promise<ProviderResult<MarketSnapshot[]>> {
    const fetchedAt = new Date().toISOString();
    const rows = await this.sdk.batch.cn({ batchSize: 500, concurrency: 6 });
    const data = rows.map((row) => this.toSnapshot(row, fetchedAt)).filter((row) => /^\d{6}$/.test(row.code));
    return {
      data,
      source: 'stock-sdk:batch.cn',
      fetchedAt,
      isComplete: data.length >= 4_000,
      warnings: data.length >= 4_000 ? [] : [`全市场快照仅返回 ${data.length} 只股票`],
    };
  }

  async getDailyBars(
    code: string,
    options: { limit: number; adjustType: AdjustType },
  ): Promise<ProviderResult<DailyBar[]>> {
    const fetchedAt = new Date().toISOString();
    const startDate = dateDaysAgo(Math.max(365, Math.ceil(options.limit * 1.8)));
    const rows = await this.sdk.kline.cn(code, {
      period: 'daily',
      adjust: options.adjustType === 'qfq' ? 'qfq' : '',
      startDate: startDate.replaceAll('-', ''),
      endDate: fetchedAt.slice(0, 10).replaceAll('-', ''),
    });
    const data = rows
      .map((row) => this.toDailyBar(code, row, options.adjustType, fetchedAt))
      .filter(isValidDailyBar)
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
      .slice(-options.limit);
    return {
      data,
      source: 'stock-sdk:eastmoney',
      fetchedAt,
      isComplete: data.length >= Math.min(options.limit, 20),
      warnings: data.length >= Math.min(options.limit, 20) ? [] : [`${code} 仅取得 ${data.length} 根有效日线`],
    };
  }

  private toSnapshot(row: FullQuote, fetchedAt: string): MarketSnapshot {
    const code = normalizeCode(row.code);
    return {
      code,
      name: row.name || code,
      exchange: inferExchange(code),
      price: finite(row.price),
      changePercent: finite(row.changePercent),
      turnoverRate: finite(row.turnoverRate),
      volume: finite(row.volume),
      amountYuan: scalePositive(row.amount, WAN_TO_YUAN),
      totalMarketCapYuan: scalePositive(row.totalMarketCap, YI_TO_YUAN),
      circulatingMarketCapYuan: scalePositive(row.circulatingMarketCap, YI_TO_YUAN),
      source: `stock-sdk:${row.source}`,
      fetchedAt,
    };
  }

  private toDailyBar(code: string, row: HistoryKline, adjustType: AdjustType, fetchedAt: string): DailyBar {
    return {
      code,
      tradeDate: normalizeDate(row.date),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      amountYuan: finite(row.amount),
      turnoverRate: finite(row.turnoverRate),
      changePercent: finite(row.changePercent),
      adjustType,
      source: 'stock-sdk:eastmoney',
      fetchedAt,
    };
  }
}

function finite(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : undefined;
}

function scalePositive(value: number | null | undefined, multiplier: number) {
  const parsed = finite(value);
  return parsed !== undefined && parsed > 0 ? parsed * multiplier : undefined;
}

function normalizeCode(value: string) {
  return String(value ?? '').replace(/^\D+/, '').slice(-6);
}

function inferExchange(code: string): Exchange {
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('92')) return 'BJ';
  return 'SZ';
}

function normalizeDate(value: string) {
  const text = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return text.slice(0, 10);
}

function dateDaysAgo(days: number) {
  const date = new Date(Date.now() - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function isValidDailyBar(row: DailyBar) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(row.tradeDate) &&
    [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite) &&
    row.open > 0 &&
    row.high > 0 &&
    row.low > 0 &&
    row.close > 0 &&
    row.volume >= 0 &&
    row.high >= row.low
  );
}
