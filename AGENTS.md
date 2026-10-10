# 项目协作指南

## 当前状态

本项目是独立的 TypeScript/Node.js A 股数据与确定性选股引擎。目前提供命令行入口、DuckDB 存储和内置的 `volume-trend`（放量趋势）策略。尚无 Web 界面和 HTTP API；实现可视化前，先与用户确认设计方案。

## 目录结构

- `src/cli.ts`：命令行命令与终端输出。
- `src/app.ts`：应用组件的组装。
- `src/config.ts`：环境变量配置。
- `src/providers/`：外部行情数据适配器。
- `src/market-data/`：行情快照与日线同步。
- `src/storage/market-store.ts`：DuckDB 表结构与读写。
- `src/indicators/`：技术指标计算。
- `src/strategies/`：策略注册、运行、筛选和评分。
- `src/domain/types.ts`：共享领域类型。
- `tests/`：Vitest 测试。

## 常用命令

- `npm install`：安装依赖。
- `npm run typecheck`：检查 TypeScript 类型。
- `npm test`：运行测试。
- `npm run sync:snapshot`：获取并保存当前全市场行情快照。
- `npm run sync:bars -- 100`：为限定数量的股票同步日线。
- `npm run strategy`：使用已保存的快照运行策略；日线缺失或过期时可能远程补齐。
- `npm run pipeline`：先刷新行情快照，再运行策略。

## 数据与行为约定

- 默认数据库路径为 `data/market.duckdb`，可用 `STOCK_DB_PATH` 覆盖。不要提交本地数据库或 `node_modules`。
- 成交额与市值统一使用人民币元；日线默认使用前复权 `qfq`。
- `market_snapshots` 保存每只股票最新写入的快照，`daily_bars` 保存日线，`strategy_runs` 保存策略运行结果。
- 单独运行策略不会刷新行情快照。展示结果时应同时显示快照时间和警告。
- 保留数据来源，报告缺失或不完整的数据，不要虚构兜底行情。
- 保持数据源、存储、指标和策略逻辑分离；新增策略时使用现有注册表和领域类型。

## 开发约定

- 修改行为前先阅读相关模块和测试，遵循现有 TypeScript 与 ESM 风格。
- 策略计算或存储契约发生有意义的变化时，补充测试，并运行 `npm run typecheck` 和 `npm test`。
- 外部行情请求应限制并发，并保留数据源的具体错误信息。
- 引入界面、API、策略参数或数据库迁移前，先与用户确认对应行为和范围。
- Git 提交说明使用中文；一次提交只包含该次任务相关的改动。

<!-- fastctx:begin -->
## 本地文件检查

优先使用 `mcp__fastctx__read`、`mcp__fastctx__grep` 和 `mcp__fastctx__glob` 检查本地文件，并传入绝对路径。遇到 Partial 结果时，按提示的准确参数继续读取。

跨文件的机械替换使用 `mcp__fastctx__replace`；生成内容、语义修改和小范围编辑使用 `apply_patch`。
<!-- fastctx:end -->
