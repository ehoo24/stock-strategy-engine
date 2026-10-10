# Stock Strategy Engine

一个从 StockBuddy 数据获取方式中独立出来的 A 股数据与确定性选股系统。它不依赖 Electron、React 或 Agent。

## 第一版能力

- 使用 `stock-sdk` 获取全市场行情和前复权日 K。
- 将金额与市值统一换算为“元”。
- 使用 DuckDB 保存全市场快照、日 K 和策略运行结果。
- 本地日 K 不足时自动远程补齐。
- 计算 MA5/10/20、MACD、5 日量比和 20 日突破。
- 内置“放量趋势”策略，采用粗筛、精筛、评分三阶段流程。

## 安装与运行

```bash
npm install
npm run pipeline
```

也可以分步运行：

```bash
npm run sync:snapshot
npm run strategy
```

全量同步日 K 请求较多，建议先小批量验证：

```bash
npm run sync:bars -- 100
```

数据库默认保存在 `data/market.duckdb`。可通过 `STOCK_DB_PATH` 指定其他位置。

## 本地可视化预览（v1 开发中）

先启动 API 服务，再另开一个终端启动前端：

```bash
npm run serve
npm run dev
```

浏览器访问 `http://127.0.0.1:5173/`。页面可查看已有策略结果和运行历史，也可刷新行情、运行放量趋势策略。刷新行情会请求外部数据；单独运行策略使用本地快照。构建前端可运行 `npm run build:web`，构建后 `npm run serve` 可在 `http://localhost:4310/` 提供页面和 API。

## 放量趋势策略

所有策略运行前会先应用统一的可交易股票池：保留沪深主板和创业板，排除北交所、科创板、ST、`*ST` 和名称含“退”的股票。全市场行情快照仍会完整保存，便于以后调整交易范围。

粗筛：

- 当日涨幅 1% 到 7%。
- 换手率不低于 3%。
- 成交额不低于 1 亿元。
- 流通市值 20 亿到 150 亿元。

精筛：

- 收盘价位于 MA20 上方。
- MA5 > MA10 > MA20。
- 当日成交量不低于前 5 日均量的 1.2 倍。
- MACD DIF 位于 DEA 上方。

策略参数位于 `src/strategies/volume-trend.ts`，修改它不会影响数据获取与存储模块。

## 数据口径

- `amountYuan`、`totalMarketCapYuan`、`circulatingMarketCapYuan` 均为人民币元。
- 日 K 默认使用前复权 `qfq`。
- 策略输出包含快照时间和警告。外部数据不完整时不会生成替代行情。

本工具仅用于公开数据研究，不构成投资建议。
