import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createApp } from './app.js';
import { getStrategy, listStrategies } from './strategies/strategy-registry.js';

const app = await createApp();
const port = Number(process.env.PORT ?? 4310);
const webRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist', 'web');
let activeTask: 'sync' | 'run' | null = null;

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: message });
  }
});

server.listen(port, () => {
  console.log(`Stock Strategy Engine 已启动：http://localhost:${port}`);
  console.log(`数据库：${config.databasePath}`);
});

process.on('SIGINT', async () => {
  server.close();
  await app.store.close();
  process.exit(0);
});

async function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    await api(request, response, url);
    return;
  }
  await serveStatic(url.pathname, response);
}

async function api(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, databasePath: config.databasePath });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/strategies') {
    sendJson(response, 200, listStrategies());
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/market/status') {
    const snapshots = await app.marketData.listSnapshots();
    const dailyBars = await app.marketData.getDailyBarStatus();
    const latest = snapshots.map((row) => row.fetchedAt).sort().at(-1);
    sendJson(response, 200, {
      count: snapshots.length,
      fetchedAt: latest ?? null,
      source: snapshots[0]?.source ?? null,
      dailyBars,
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/sync/snapshot') {
    await runExclusive('sync', response, async () => {
      const result = await app.marketData.syncAllSnapshots();
      return {
        count: result.data.length,
        fetchedAt: result.fetchedAt,
        source: result.source,
        warnings: result.warnings,
      };
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/sync/data') {
    await runExclusive('sync', response, () => app.marketData.syncStoredMarketData(config.strategyBarLimit, config.dailyBarConcurrency));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/runs') {
    const body = await readJson(request);
    const strategyId = typeof body.strategyId === 'string' ? body.strategyId : 'volume-trend';
    const strategy = getStrategy(strategyId);
    await runExclusive('run', response, async () => {
      if (body.refreshSnapshot === true) await app.marketData.syncAllSnapshots();
      return app.strategyRunner.run(strategy);
    }, 201);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/runs') {
    const rawLimit = Number(url.searchParams.get('limit') ?? 30);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 30;
    sendJson(response, 200, await app.store.listStrategyRuns(limit));
    return;
  }
  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (request.method === 'GET' && runMatch) {
    const result = await app.store.getStrategyRun(decodeURIComponent(runMatch[1]!));
    if (!result) {
      sendJson(response, 404, { error: '策略运行记录不存在' });
      return;
    }
    sendJson(response, 200, result);
    return;
  }
  const barsMatch = url.pathname.match(/^\/api\/stocks\/([^/]+)\/bars$/);
  if (request.method === 'GET' && barsMatch) {
    const rawLimit = Number(url.searchParams.get('limit') ?? 90);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 240) : 90;
    sendJson(response, 200, await app.marketData.getDailyBars(decodeURIComponent(barsMatch[1]!), limit));
    return;
  }
  sendJson(response, 404, { error: '接口不存在' });
}

async function serveStatic(pathname: string, response: ServerResponse) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = normalize(join(webRoot, requested));
  if (!file.startsWith(normalize(webRoot))) {
    sendJson(response, 403, { error: '禁止访问' });
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('不是文件');
    response.writeHead(200, { 'Content-Type': contentType(extname(file)) });
    createReadStream(file).pipe(response);
  } catch {
    sendJson(response, 404, { error: '页面不存在' });
  }
}

async function runExclusive<T>(task: 'sync' | 'run', response: ServerResponse, work: () => Promise<T>, status = 200) {
  if (activeTask) {
    sendJson(response, 409, { error: '已有任务正在运行，请稍后重试' });
    return;
  }
  activeTask = task;
  try {
    sendJson(response, status, await work());
  } finally {
    activeTask = null;
  }
}

function contentType(extension: string) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of request) text += chunk;
  if (!text.trim()) return {};
  const value: unknown = JSON.parse(text);
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
