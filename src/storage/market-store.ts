import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api';
import type { DailyBar, MarketSnapshot, StrategyResult } from '../domain/types.js';

const schema = `
  CREATE TABLE IF NOT EXISTS market_snapshots (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    exchange TEXT NOT NULL,
    price DOUBLE,
    change_percent DOUBLE,
    turnover_rate DOUBLE,
    volume DOUBLE,
    amount_yuan DOUBLE,
    total_market_cap_yuan DOUBLE,
    circulating_market_cap_yuan DOUBLE,
    source TEXT NOT NULL,
    fetched_at TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_bars (
    code TEXT NOT NULL,
    trade_date DATE NOT NULL,
    open DOUBLE NOT NULL,
    high DOUBLE NOT NULL,
    low DOUBLE NOT NULL,
    close DOUBLE NOT NULL,
    volume DOUBLE NOT NULL,
    amount_yuan DOUBLE,
    turnover_rate DOUBLE,
    change_percent DOUBLE,
    adjust_type TEXT NOT NULL,
    source TEXT NOT NULL,
    fetched_at TIMESTAMP NOT NULL,
    PRIMARY KEY (code, trade_date, adjust_type)
  );
  CREATE INDEX IF NOT EXISTS idx_daily_bars_code_date ON daily_bars(code, trade_date);

  CREATE TABLE IF NOT EXISTS strategy_runs (
    run_id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP NOT NULL,
    snapshot_fetched_at TIMESTAMP,
    scanned_count INTEGER NOT NULL,
    coarse_matched_count INTEGER NOT NULL,
    candidate_count INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL
  );
`;

interface SnapshotRow {
  code: string;
  name: string;
  exchange: MarketSnapshot['exchange'];
  price: number | null;
  change_percent: number | null;
  turnover_rate: number | null;
  volume: number | null;
  amount_yuan: number | null;
  total_market_cap_yuan: number | null;
  circulating_market_cap_yuan: number | null;
  source: string;
  fetched_at: Date | string;
}

interface DailyBarRow {
  code: string;
  trade_date: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount_yuan: number | null;
  turnover_rate: number | null;
  change_percent: number | null;
  adjust_type: DailyBar['adjustType'];
  source: string;
  fetched_at: Date | string;
}

export class MarketStore {
  private instance?: DuckDBInstance;

  constructor(private readonly databasePath: string) {}

  async initialize() {
    await mkdir(dirname(this.databasePath), { recursive: true });
    this.instance ??= await DuckDBInstance.create(this.databasePath);
    await this.withConnection(async (connection) => {
      await connection.run('SET threads TO 1');
      await connection.run(schema);
    });
  }

  async close() {
    this.instance?.closeSync();
    this.instance = undefined;
  }

  async upsertSnapshots(rows: MarketSnapshot[]) {
    if (!rows.length) return;
    await this.transaction(async (connection) => {
      const statement = await connection.prepare(`
        INSERT OR REPLACE INTO market_snapshots VALUES (
          $code, $name, $exchange, $price, $changePercent, $turnoverRate, $volume,
          $amountYuan, $totalMarketCapYuan, $circulatingMarketCapYuan, $source, $fetchedAt
        )
      `);
      for (const row of rows) {
        statement.bind({
          code: row.code,
          name: row.name,
          exchange: row.exchange,
          price: row.price ?? null,
          changePercent: row.changePercent ?? null,
          turnoverRate: row.turnoverRate ?? null,
          volume: row.volume ?? null,
          amountYuan: row.amountYuan ?? null,
          totalMarketCapYuan: row.totalMarketCapYuan ?? null,
          circulatingMarketCapYuan: row.circulatingMarketCapYuan ?? null,
          source: row.source,
          fetchedAt: row.fetchedAt,
        });
        await statement.run();
      }
    });
  }

  async listSnapshots(): Promise<MarketSnapshot[]> {
    return this.withConnection(async (connection) => {
      const rows = await all<SnapshotRow>(connection, 'SELECT * FROM market_snapshots ORDER BY code');
      return rows.map((row) => ({
        code: row.code,
        name: row.name,
        exchange: row.exchange,
        price: nullable(row.price),
        changePercent: nullable(row.change_percent),
        turnoverRate: nullable(row.turnover_rate),
        volume: nullable(row.volume),
        amountYuan: nullable(row.amount_yuan),
        totalMarketCapYuan: nullable(row.total_market_cap_yuan),
        circulatingMarketCapYuan: nullable(row.circulating_market_cap_yuan),
        source: row.source,
        fetchedAt: iso(row.fetched_at),
      }));
    });
  }

  async upsertDailyBars(rows: DailyBar[]) {
    if (!rows.length) return;
    await this.transaction(async (connection) => {
      const statement = await connection.prepare(`
        INSERT OR REPLACE INTO daily_bars VALUES (
          $code, CAST($tradeDate AS DATE), $open, $high, $low, $close, $volume,
          $amountYuan, $turnoverRate, $changePercent, $adjustType, $source, $fetchedAt
        )
      `);
      for (const row of rows) {
        statement.bind({
          code: row.code,
          tradeDate: row.tradeDate,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          amountYuan: row.amountYuan ?? null,
          turnoverRate: row.turnoverRate ?? null,
          changePercent: row.changePercent ?? null,
          adjustType: row.adjustType,
          source: row.source,
          fetchedAt: row.fetchedAt,
        });
        await statement.run();
      }
    });
  }

  async listDailyBars(code: string, limit: number, adjustType: DailyBar['adjustType'] = 'qfq'): Promise<DailyBar[]> {
    return this.withConnection(async (connection) => {
      const rows = await all<DailyBarRow>(
        connection,
        `SELECT * FROM (
          SELECT * FROM daily_bars WHERE code = $code AND adjust_type = $adjustType
          ORDER BY trade_date DESC LIMIT $limit
        ) rows ORDER BY trade_date ASC`,
        { code, adjustType, limit },
      );
      return rows.map((row) => ({
        code: row.code,
        tradeDate: dateOnly(row.trade_date),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        amountYuan: nullable(row.amount_yuan),
        turnoverRate: nullable(row.turnover_rate),
        changePercent: nullable(row.change_percent),
        adjustType: row.adjust_type,
        source: row.source,
        fetchedAt: iso(row.fetched_at),
      }));
    });
  }

  async saveStrategyResult(result: StrategyResult) {
    await this.withConnection((connection) =>
      connection.run(
        `INSERT OR REPLACE INTO strategy_runs VALUES (
          $runId, $strategyId, $startedAt, $finishedAt, $snapshotFetchedAt,
          $scannedCount, $coarseMatchedCount, $candidateCount, $resultJson, $warningsJson
        )`,
        {
          runId: result.runId,
          strategyId: result.strategyId,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          snapshotFetchedAt: result.snapshotFetchedAt ?? null,
          scannedCount: result.scannedCount,
          coarseMatchedCount: result.coarseMatchedCount,
          candidateCount: result.candidates.length,
          resultJson: JSON.stringify(result.candidates),
          warningsJson: JSON.stringify(result.warnings),
        },
      ).then(() => undefined),
    );
  }

  private async transaction(work: (connection: DuckDBConnection) => Promise<void>) {
    await this.withConnection(async (connection) => {
      await connection.run('BEGIN TRANSACTION');
      try {
        await work(connection);
        await connection.run('COMMIT');
      } catch (error) {
        await connection.run('ROLLBACK');
        throw error;
      }
    });
  }

  private async withConnection<T>(work: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
    if (!this.instance) throw new Error('MarketStore 尚未初始化');
    const connection = await this.instance.connect();
    try {
      return await work(connection);
    } finally {
      connection.closeSync();
    }
  }
}

async function all<T>(connection: DuckDBConnection, sql: string, values?: Record<string, DuckDBValue>) {
  const reader = await connection.runAndReadAll(sql, values);
  return reader.getRowObjectsJS() as T[];
}

function nullable(value: number | null) {
  return value === null ? undefined : Number(value);
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function dateOnly(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
