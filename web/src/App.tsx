import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, BarChart3, Box, Clock3, Database, Feather, Moon, Play, RefreshCw, Search, Sparkles, Star, Sun, X } from 'lucide-react';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar } from 'recharts';
import { api, type Candidate, type DailyBar, type MarketStatus, type RunSummary, type StrategyInfo, type StrategyRun } from './api';

type View = 'results' | 'history';
type SortKey = 'score' | 'change' | 'turnover';
type Theme = 'dark' | 'light';

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无数据';
const formatMoney = (value?: number) => value === undefined ? '--' : value >= 100_000_000 ? `${number.format(value / 100_000_000)} 亿` : `${number.format(value / 10_000)} 万`;
const percent = (value?: number) => value === undefined ? '--' : `${value > 0 ? '+' : ''}${number.format(value)}%`;

async function loadInitial() {
  const [status, strategies, runs] = await Promise.all([
    api<MarketStatus>('/market/status'),
    api<StrategyInfo[]>('/strategies'),
    api<RunSummary[]>('/runs'),
  ]);
  return { status, strategies, runs };
}

export default function App() {
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [strategyId, setStrategyId] = useState('volume-trend');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<StrategyRun | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [bars, setBars] = useState<DailyBar[]>([]);
  const [view, setView] = useState<View>('results');
  const [sort, setSort] = useState<SortKey>('score');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<'sync' | 'run' | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('stock-strategy-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('stock-strategy-theme', theme);
  }, [theme]);

  const openRun = useCallback(async (runId: string) => {
    try {
      const detail = await api<StrategyRun>(`/runs/${encodeURIComponent(runId)}`);
      setRun(detail);
      setSelected(null);
      setBars([]);
      setView('results');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    let active = true;
    loadInitial().then(({ status, strategies, runs }) => {
      if (!active) return;
      setStatus(status);
      setStrategies(strategies);
      setRuns(runs);
      if (strategies[0]) setStrategyId(strategies[0].id);
      if (runs[0]) void openRun(runs[0].runId);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [openRun]);

  const selectCandidate = async (candidate: Candidate) => {
    setSelected(candidate);
    setBars([]);
    setDetailLoading(true);
    try {
      setBars(await api<DailyBar[]>(`/stocks/${encodeURIComponent(candidate.code)}/bars?limit=90`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDetailLoading(false);
    }
  };

  const syncSnapshot = async () => {
    setBusy('sync'); setError(''); setNotice('');
    try {
      const result = await api<{ count: number; warnings: string[] }>('/sync/snapshot', { method: 'POST' });
      setStatus(await api<MarketStatus>('/market/status'));
      setNotice(`行情已更新：${result.count} 只股票${result.warnings.length ? `，${result.warnings.length} 条警告` : ''}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(null); }
  };

  const startRun = async () => {
    setBusy('run'); setError(''); setNotice('');
    try {
      const result = await api<StrategyRun>('/runs', { method: 'POST', body: JSON.stringify({ strategyId }) });
      setRun(result); setSelected(null); setBars([]); setView('results');
      setRuns(await api<RunSummary[]>('/runs'));
      setNotice('策略运行完成，结果已保存');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(null); }
  };

  const filtered = useMemo(() => {
    const matches = (run?.candidates ?? []).filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(query.toLowerCase()));
    return matches.sort((a, b) => {
      const value = (item: Candidate) => sort === 'score' ? item.score : sort === 'change' ? item.snapshot.changePercent ?? -Infinity : item.snapshot.turnoverRate ?? -Infinity;
      return value(b) - value(a);
    });
  }, [run, query, sort]);

  const chartData = useMemo(() => bars.map((bar, index) => {
    const movingAverage = (period: number) => index + 1 < period ? undefined : bars.slice(index + 1 - period, index + 1).reduce((sum, row) => sum + row.close, 0) / period;
    return { date: bar.tradeDate.slice(5), close: bar.close, volume: bar.volume, ma5: movingAverage(5), ma10: movingAverage(10), ma20: movingAverage(20) };
  }), [bars]);

  const navigateTo = (nextView: View) => {
    setView(nextView);
    requestAnimationFrame(() => document.querySelector('.results-surface')?.scrollIntoView({ behavior: 'smooth' }));
  };

  const marqueeItems = [
    { icon: Sun, name: '行情快照' },
    { icon: Box, name: '确定性筛选' },
    { icon: Star, name: '趋势评分' },
    { icon: Feather, name: '技术指标' },
    { icon: Sparkles, name: '本地存储' },
  ];

  return <div className="app-shell" data-theme={theme}>
    <video className="hero-video" autoPlay muted loop playsInline aria-hidden="true">
      <source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260325_094440_a3592600-bd1e-49e5-9bce-a73662061d83.mp4" type="video/mp4" />
    </video>
    <div className="video-shade" />
    <header className="topbar">
      <div className="brand"><svg className="brand-mark" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-label="Stock Strategy Engine"><path d="M8 10L14 30L20 16L26 30L32 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
      <nav className="top-nav" aria-label="主导航"><button onClick={() => navigateTo('results')}>策略</button><button onClick={() => navigateTo('results')}>结果</button><button onClick={() => navigateTo('history')}>历史</button><button onClick={syncSnapshot}>数据</button></nav>
      <button className="theme-toggle" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'} title={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      <div className="topbar-right"><span className="market-pill"><span className={status?.count ? 'status-dot active' : 'status-dot'} />{status?.count ? `${number.format(status.count)} 只股票` : '暂无行情'}</span><span className="top-time">{formatDate(status?.fetchedAt)}</span></div>
    </header>

    <section className="hero">
      <div className="hero-content">
        <p className="hero-kicker">A SHARE MARKET INTELLIGENCE</p>
        <h1>洞察市场，<br />掌握<span className="glow-word">资产。<span aria-hidden="true">资产。</span><span aria-hidden="true">资产。</span></span></h1>
        <p className="hero-copy">用确定性策略筛选全市场行情，让每一次判断都能回溯到数据与信号。</p>
        <div className="hero-actions">
          <button className="glow-button" onClick={startRun} disabled={!!busy || !status?.count}><span className="button-glow" /> <Play size={18} fill="currentColor" />{busy === 'run' ? '策略运行中...' : '启动策略轨道'}</button>
          <button className="ghost-button" onClick={syncSnapshot} disabled={!!busy}><RefreshCw size={17} className={busy === 'sync' ? 'spin' : ''} />{busy === 'sync' ? '同步行情中' : '刷新行情'}</button>
        </div>
      </div>
      <div className="hero-marquee"><p>策略能力</p><div className="marquee-window"><div className="marquee-track">{[...marqueeItems, ...marqueeItems].map(({ icon: Icon, name }, index) => <span className="marquee-item" key={`${name}-${index}`}><Icon />{name}</span>)}</div></div></div>
    </section>

    <div className="workspace results-surface">
      <aside className="sidebar">
        <div className="sidebar-section-label">工作区</div>
        <button className={`nav-item ${view === 'results' ? 'selected' : ''}`} onClick={() => setView('results')}><BarChart3 size={18} />策略结果</button>
        <button className={`nav-item ${view === 'history' ? 'selected' : ''}`} onClick={() => setView('history')}><Clock3 size={18} />运行历史 <span className="nav-count">{runs.length}</span></button>
        <div className="sidebar-divider" />
        <div className="sidebar-section-label">数据源</div>
        <div className="source-block"><Database size={18} /><div><strong>全市场快照</strong><span>{status?.source ?? '尚未同步'}</span></div></div>
        <div className="sidebar-footer">本地研究工具<br />数据仅供参考</div>
      </aside>

      <main className="main-content">
        <div className="page-heading"><div><p className="eyebrow">MARKET INTELLIGENCE</p><h1>{view === 'results' ? '策略结果' : '运行历史'}</h1><p className="subtitle">{view === 'results' ? '查看选股结果与关键技术信号' : '回看每一次策略运行的结果'}</p></div><div className="heading-actions"><span className="snapshot-label">快照 · {formatDate(status?.fetchedAt)}</span></div></div>

        {error && <div className="alert error"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}><X size={16} /></button></div>}
        {notice && <div className="alert notice"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={16} /></button></div>}

        {view === 'results' ? <>
          <section className="run-controls"><div className="control-copy"><span className="section-kicker">策略运行</span><strong>选择策略并生成候选名单</strong><span>使用本地行情快照，结果将自动保存到运行历史。</span></div><div className="control-actions"><label className="select-wrap"><Activity size={16} /><select aria-label="选择策略" value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label><button className="button primary" onClick={startRun} disabled={!!busy || !status?.count}><Play size={16} fill="currentColor" />{busy === 'run' ? '运行中...' : '运行策略'}</button></div></section>

          {run && <><section className="metrics"><Metric label="扫描股票" value={number.format(run.scannedCount)} suffix="只" /><Metric label="粗筛通过" value={number.format(run.coarseMatchedCount)} suffix="只" /><Metric label="最终入选" value={number.format(run.candidates.length)} suffix="只" accent /><Metric label="数据快照" value={run.snapshotFetchedAt ? new Date(run.snapshotFetchedAt).toLocaleDateString('zh-CN') : '--'} suffix="" /></section>
            <div className="section-title-row"><div><h2>候选股票</h2><p>策略：{strategies.find((item) => item.id === run.strategyId)?.name ?? run.strategyId} · 运行于 {formatDate(run.finishedAt)}</p></div><span className="result-count">{filtered.length} 条结果</span></div>
            <div className="table-toolbar"><label className="search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索代码或名称" aria-label="搜索股票" /></label><label className="sort-select">排序<select aria-label="排序方式" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}><option value="score">综合评分</option><option value="change">涨幅</option><option value="turnover">换手率</option></select></label></div>
            <div className="table-scroll"><table><thead><tr><th>排名</th><th>股票</th><th>最新价</th><th>涨跌幅</th><th>换手率</th><th>成交额</th><th>量比</th><th>综合评分</th><th>信号</th></tr></thead><tbody>{filtered.map((candidate, index) => <tr key={candidate.code} onClick={() => void selectCandidate(candidate)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') void selectCandidate(candidate); }}><td className="rank">{String(index + 1).padStart(2, '0')}</td><td><strong>{candidate.name}</strong><span className="stock-code">{candidate.code}</span></td><td>{candidate.snapshot.price?.toFixed(2) ?? '--'}</td><td className={(candidate.snapshot.changePercent ?? 0) >= 0 ? 'positive' : 'negative'}>{percent(candidate.snapshot.changePercent)}</td><td>{percent(candidate.snapshot.turnoverRate)}</td><td>{formatMoney(candidate.snapshot.amountYuan)}</td><td>{candidate.features.volumeRatio5?.toFixed(2) ?? '--'}</td><td><span className="score"><span style={{ width: `${candidate.score}%` }} />{candidate.score.toFixed(1)}</span></td><td className="signal-cell">{candidate.reasons[0] ?? '--'}</td></tr>)}</tbody></table>{!filtered.length && <div className="table-empty">{query ? '没有匹配的股票' : '本次运行没有符合条件的股票'}</div>}</div>
            {!!run.warnings.length && <details className="warnings"><summary>{run.warnings.length} 条数据警告</summary><ul>{run.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          </>}
          {!run && !loading && <div className="empty-state"><BarChart3 size={32} /><h2>尚无策略结果</h2><p>{status?.count ? '选择策略并运行，开始查看候选股票。' : '先刷新行情，再运行策略。'}</p></div>}
        </> : <section className="history-section"><div className="section-title-row"><div><h2>全部运行记录</h2><p>保存于本地 DuckDB 数据库</p></div><span className="result-count">{runs.length} 次运行</span></div><div className="history-list">{runs.map((item) => <button key={item.runId} className="history-row" onClick={() => void openRun(item.runId)}><span className="history-icon"><Activity size={18} /></span><span className="history-main"><strong>{strategies.find((strategy) => strategy.id === item.strategyId)?.name ?? item.strategyId}</strong><small>{formatDate(item.finishedAt)} · 快照 {formatDate(item.snapshotFetchedAt)}</small></span><span className="history-meta">{item.candidateCount} 只入选<small>{item.scannedCount} 只扫描</small></span><ArrowUp size={16} className="history-arrow" /></button>)}{!runs.length && <div className="empty-state"><Clock3 size={30} /><h2>暂无运行记录</h2><p>运行策略后，历史结果会显示在这里。</p></div>}</div></section>}
      </main>
    </div>

    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="detail-drawer" onClick={(event) => event.stopPropagation()} aria-label="股票详情"><div className="drawer-head"><div><span className="section-kicker">股票详情</span><h2>{selected.name} <span>{selected.code}</span></h2></div><button className="icon-button" aria-label="关闭详情" onClick={() => setSelected(null)}><X size={20} /></button></div><div className="drawer-body"><div className="detail-price"><strong>{selected.snapshot.price?.toFixed(2) ?? '--'}</strong><span className={(selected.snapshot.changePercent ?? 0) >= 0 ? 'positive' : 'negative'}>{(selected.snapshot.changePercent ?? 0) >= 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}{percent(selected.snapshot.changePercent)}</span></div><div className="detail-stats"><div><span>综合评分</span><strong>{selected.score.toFixed(1)}</strong></div><div><span>换手率</span><strong>{percent(selected.snapshot.turnoverRate)}</strong></div><div><span>成交额</span><strong>{formatMoney(selected.snapshot.amountYuan)}</strong></div><div><span>流通市值</span><strong>{formatMoney(selected.snapshot.circulatingMarketCapYuan)}</strong></div></div><div className="detail-section"><div className="detail-heading"><h3>价格趋势</h3><span>前复权 · 日线</span></div>{detailLoading ? <div className="chart-empty">加载日线中...</div> : chartData.length ? <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 10, right: 6, left: -20, bottom: 0 }}><CartesianGrid stroke="#e7ecea" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={26} tick={{ fontSize: 11, fill: '#81908d' }} /><YAxis domain={['auto', 'auto']} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#81908d' }} /><Tooltip contentStyle={{ borderRadius: 6, border: '1px solid #dbe4e0', fontSize: 12 }} /><Line type="monotone" dataKey="close" name="收盘价" stroke="#168b6b" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="ma5" name="MA5" stroke="#e3a444" strokeWidth={1.4} dot={false} /><Line type="monotone" dataKey="ma20" name="MA20" stroke="#596d97" strokeWidth={1.4} dot={false} /></ComposedChart></ResponsiveContainer></div> : <div className="chart-empty">暂无日线数据</div>}<div className="chart-legend"><span><i className="line-close" />收盘价</span><span><i className="line-ma5" />MA5</span><span><i className="line-ma20" />MA20</span></div></div><div className="detail-section"><h3>技术指标</h3><div className="indicator-grid"><div>MA5 <strong>{selected.features.ma5?.toFixed(2) ?? '--'}</strong></div><div>MA10 <strong>{selected.features.ma10?.toFixed(2) ?? '--'}</strong></div><div>MA20 <strong>{selected.features.ma20?.toFixed(2) ?? '--'}</strong></div><div>5 日量比 <strong>{selected.features.volumeRatio5?.toFixed(2) ?? '--'}</strong></div><div>MACD DIF <strong>{selected.features.dif?.toFixed(3) ?? '--'}</strong></div><div>MACD DEA <strong>{selected.features.dea?.toFixed(3) ?? '--'}</strong></div></div></div><div className="detail-section"><h3>入选理由</h3><ul className="reasons">{selected.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div></div></aside></div>}
  </div>;
}

function Metric({ label, value, suffix, accent = false }: { label: string; value: string; suffix: string; accent?: boolean }) {
  return <div className={`metric ${accent ? 'metric-accent' : ''}`}><span>{label}</span><strong>{value}<small>{suffix}</small></strong></div>;
}
