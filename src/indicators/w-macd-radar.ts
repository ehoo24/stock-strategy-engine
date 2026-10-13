import type { DailyBar, PriceDistance, WMacdRadar, WMacdStage } from '../domain/types.js';
import { calculateMacdSeries, type MacdPoint } from './technical-features.js';

const DAY_MS = 86_400_000;
const EPS = 1e-10;
interface Block { start: number; end: number; area: number }
const labels: Record<WMacdStage, string> = {
  'left-watch': '左侧观察', 'micro-right': '微右侧确认', 'neckline-breakout': '颈线突破',
};

/** All structure and trigger decisions use only the supplied prefix, never future bars. */
export function detectWMacdRadar(input: DailyBar[]): WMacdRadar | undefined {
  const bars = [...input].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  if (bars.length < 60) return undefined;
  validate(bars);
  const last = bars.length - 1;
  const latest = bars[last]!;
  const cutoff = new Date(Date.parse(`${latest.tradeDate}T00:00:00Z`) - 89 * DAY_MS).toISOString().slice(0, 10);
  const windowStart = bars.findIndex((bar) => bar.tradeDate >= cutoff);
  if (bars.length - windowStart < 35) return undefined;
  const macd = calculateMacdSeries(bars.map((bar) => bar.close));
  const blocks = negativeBlocks(macd);
  const second = blocks.at(-1);
  if (!second || last - second.end > 5) return undefined;
  // A new block, even if short, supersedes the preceding setup. Only the first block needs 3 bars.
  const first = blocks.slice(0, -1).reverse().find((block) => block.end - block.start >= 2);
  if (!first || first.start < Math.max(26, windowStart)) return undefined;
  const firstLowIndex = lowestIndex(bars, first.start, Math.min(first.end + 2, second.start - 2));
  // First bottom is already historical and its right-hand confirmation precedes second pullback.
  if (firstLowIndex + 2 >= second.start) return undefined;
  const firstLow = bars[firstLowIndex]!.low;
  if (bars.slice(firstLowIndex + 1, firstLowIndex + 3).some((bar) => bar.low < firstLow)) return undefined;
  const neckIndex = highestIndex(bars, firstLowIndex + 1, second.start - 1);
  if (neckIndex < firstLowIndex + 2) return undefined;
  const neckline = bars[neckIndex]!.high;
  const priorIndex = highestIndex(bars, Math.max(windowStart, firstLowIndex - 30), firstLowIndex - 2);
  if (priorIndex < 0 || (bars[priorIndex]!.high / firstLow - 1) < 0.03) return undefined;
  if (neckline / firstLow - 1 < 0.02) return undefined;
  const lowIndex = lowestIndex(bars, second.start, last);
  const provisionalLow = bars[lowIndex]!.low;
  const gap = lowIndex - firstLowIndex;
  if (gap < 8 || gap > 45 || last - lowIndex > 15) return undefined;
  // First-bottom breach invalidates this radar setup; no stop widening by lowering Low2.
  if (provisionalLow < firstLow || neckline / provisionalLow - 1 < 0.02) return undefined;
  if (second.area >= first.area) return undefined;
  const atr14 = atr(bars, last);
  if (atr14 <= EPS) return undefined;
  const linePoints = macd.slice(first.start, last + 1);
  const belowZero = linePoints.filter((point) => point.dif < 0 || point.dea < 0).length;
  const minLine = Math.min(...linePoints.flatMap((point) => [point.dif, point.dea]));
  if (belowZero > 20 || minLine / atr14 < -0.75) return undefined;

  // A one-bar pivot requires its following bar; that confirmation must predate today's signal.
  let microIndex: number | undefined;
  for (let index = second.start + 1; index <= last - 2; index += 1) {
    const value = bars[index]!.high;
    if (value >= bars[index - 1]!.high && value > bars[index + 1]!.high && value < neckline) microIndex = index;
  }
  const microHigh = microIndex === undefined ? undefined : bars[microIndex]!.high;
  const contraction = consecutiveContraction(macd, last);
  const firstContraction = contraction === 1 && macd[last]!.histogram < -EPS;
  const previousHist = macd[last - 1]!.histogram;
  const histogramContractionPercent = previousHist < -EPS && macd[last]!.histogram < 0
    ? (macd[last]!.histogram - previousHist) / Math.abs(previousHist) * 100 : undefined;
  const averageVolume20 = mean(bars.slice(last - 20, last).map((bar) => bar.volume));
  if (averageVolume20 <= EPS) return undefined;
  const volumeRatio20 = latest.volume / averageVolume20;
  const firstVolume = mean(bars.slice(first.start, first.end + 1).map((bar) => bar.volume));
  const secondVolume = mean(bars.slice(second.start, second.end + 1).map((bar) => bar.volume));
  const pullbackVolumeRatio = secondVolume / Math.max(firstVolume, EPS);
  const improving = macd[last]!.dif > macd[last - 1]!.dif &&
    (contraction >= 2 || (macd[last]!.histogram >= 0 && last - second.end <= 2));
  let stage: WMacdStage;
  let trigger: number;
  if (latest.close > neckline) {
    // Require volume expansion on the crossing bar, not every subsequent holding day.
    trigger = last;
    while (trigger > second.start && bars[trigger - 1]!.close > neckline) trigger -= 1;
    const baseline = mean(bars.slice(trigger - 20, trigger).map((bar) => bar.volume));
    if (baseline <= EPS || bars[trigger]!.volume / baseline < 1.2) return undefined;
    stage = 'neckline-breakout';
  } else if (microHigh !== undefined && latest.close > microHigh && improving) {
    trigger = last;
    const confirmed = microIndex! + 1;
    while (trigger > confirmed + 1 && bars[trigger - 1]!.close > microHigh) trigger -= 1;
    stage = 'micro-right';
  } else if (latest.close < neckline && macd[last]!.histogram < -EPS && contraction > 0 && provisionalLow / firstLow - 1 <= 0.08) {
    trigger = last - contraction + 1;
    stage = 'left-watch';
  } else return undefined;
  if (last - trigger > 5) return undefined;
  const localStop = provisionalLow - 0.25 * atr14;
  const structuralStop = firstLow - 0.25 * atr14;
  const distance = (price: number): PriceDistance => ({ price, percent: (price / latest.close - 1) * 100, atrMultiple: (price - latest.close) / atr14 });
  const fromLow: PriceDistance = { price: provisionalLow, percent: (latest.close / provisionalLow - 1) * 100, atrMultiple: (latest.close - provisionalLow) / atr14 };
  const necklineSpace = distance(neckline);
  const plannedRewardRisk = Math.max(0, neckline - latest.close) / Math.max(latest.close - localStop, EPS);
  const warnings: string[] = [];
  if (second.end === last) warnings.push('第二段绿柱为未闭合动态值，累计面积仍可能增加。');
  if (belowZero) warnings.push(`DIF/DEA 有 ${belowZero} 根日线下穿零轴，最低值为 ${minLine / atr14 >= 0 ? '+' : ''}${(minLine / atr14).toFixed(2)}×ATR。`);
  if (fromLow.atrMultiple > 1.5 || fromLow.percent > 5) warnings.push('价格已偏离暂定第二底，注意追高风险。');
  if (stage !== 'neckline-breakout' && necklineSpace.percent < 5) warnings.push('颈线剩余空间不足 5%，不满足基准短波段目标空间。');
  if (stage !== 'neckline-breakout' && plannedRewardRisk < 2) warnings.push('到颈线的计划盈亏比不足 2:1。');
  const momentum = Math.min(40, 20 * (1 - second.area / first.area) + 10 * Math.min(contraction / 2, 1) + (macd[last]!.dif > macd[last - 1]!.dif ? 10 : 0));
  const structure = Math.min(40, (stage === 'left-watch' ? 8 : 18) + Math.max(0, 12 - fromLow.atrMultiple * 4) + Math.min(10, plannedRewardRisk * 3));
  // These are observable volume patterns, not proof of ownership or hidden accumulation.
  const volume = Math.min(20, Math.max(0, 12 * (1 - Math.min(pullbackVolumeRatio, 1))) +
    (stage === 'left-watch' ? (volumeRatio20 < 0.7 ? 8 : 0) : Math.min(8, Math.max(0, (volumeRatio20 - 0.8) * 10))));
  const round = (value: number) => Math.round(value * 10) / 10;
  const scoreComponents = { momentum: round(momentum), structure: round(structure), volume: round(volume) };
  const reasons = [
    labels[stage],
    stage === 'left-watch' ? '下跌动能减弱，底部未确认（左侧博弈）'
      : stage === 'micro-right' ? '突破已确认的局部微反弹高点，微右侧转强（未及颈线）'
        : 'W 形态结构突破（注意防追高）',
    `第二段绿柱 ${second.end - second.start + 1} 根，面积为第一段 ${(second.area / first.area * 100).toFixed(1)}%${second.end === last ? ' [未闭合动态值]' : ' [已闭合]'}`,
    `当前负柱连续收缩 ${contraction} 根${firstContraction ? '，首次缩头' : ''}`,
    `回落平均量比 ${pullbackVolumeRatio.toFixed(2)}，当日/前20日均量 ${volumeRatio20.toFixed(2)}`,
  ];
  return {
    version: '1', stage, stageLabel: labels[stage], asOfDate: latest.tradeDate,
    signalDate: bars[trigger]!.tradeDate, signalAgeBars: last - trigger,
    windowStart: bars[windowStart]!.tradeDate,
    firstLow, firstLowDate: bars[firstLowIndex]!.tradeDate, provisionalLow, provisionalLowDate: bars[lowIndex]!.tradeDate,
    neckline, necklineDate: bars[neckIndex]!.tradeDate, microHigh,
    microHighDate: microIndex === undefined ? undefined : bars[microIndex]!.tradeDate,
    microHighConfirmedDate: microIndex === undefined ? undefined : bars[microIndex + 1]!.tradeDate,
    secondBlockStart: bars[second.start]!.tradeDate, secondBlockEnd: bars[second.end]!.tradeDate,
    secondBlockBars: second.end - second.start + 1, secondBlockComplete: second.end < last,
    firstArea: first.area, secondArea: second.area, areaRatio: second.area / first.area,
    histogramContractionPercent, firstContraction, consecutiveContractionBars: contraction,
    volumeRatio20, pullbackVolumeRatio, atr14, fromLow,
    localInvalidation: distance(localStop), structuralInvalidation: distance(structuralStop), necklineSpace,
    plannedRewardRisk, qualityScore: round(scoreComponents.momentum + scoreComponents.structure + scoreComponents.volume),
    scoreComponents, warnings, reasons,
  };
}

/** Research seam: one independent snapshot per date, including dates without a signal. */
export function replayWMacdRadar(input: DailyBar[]) {
  const ordered = [...input].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  validate(ordered);
  return ordered.map((bar, index) => ({ asOfDate: bar.tradeDate, signal: detectWMacdRadar(ordered.slice(0, index + 1)) ?? null }));
}

function validate(bars: DailyBar[]) {
  if (bars.some((bar, index) => bar.adjustType !== 'qfq' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(bar.tradeDate) || !Number.isFinite(Date.parse(`${bar.tradeDate}T00:00:00Z`)) ||
    (index > 0 && bar.tradeDate === bars[index - 1]!.tradeDate) ||
    ![bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0) ||
    !Number.isFinite(bar.volume) || bar.volume < 0 || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)
  )) throw new Error('阶段雷达需要日期唯一、量价有效的前复权日线');
}
function negativeBlocks(macd: MacdPoint[]) {
  const blocks: Block[] = [];
  for (let index = 0; index < macd.length; index += 1) {
    if (macd[index]!.histogram >= -EPS) continue;
    const start = index;
    let area = 0;
    while (index < macd.length && macd[index]!.histogram < -EPS) { area -= macd[index]!.histogram; index += 1; }
    blocks.push({ start, end: index - 1, area });
  }
  return blocks;
}
function consecutiveContraction(macd: MacdPoint[], last: number) {
  let count = 0;
  for (let index = last; index > 0; index -= 1) {
    if (macd[index]!.histogram >= -EPS || macd[index - 1]!.histogram >= -EPS || macd[index]!.histogram <= macd[index - 1]!.histogram + EPS) break;
    count += 1;
  }
  return count;
}
function lowestIndex(bars: DailyBar[], start: number, end: number) {
  let best = start;
  for (let index = start + 1; index <= end; index += 1) if (bars[index]!.low <= bars[best]!.low) best = index;
  return best;
}
function highestIndex(bars: DailyBar[], start: number, end: number) {
  if (start > end) return -1;
  let best = start;
  for (let index = start + 1; index <= end; index += 1) if (bars[index]!.high > bars[best]!.high) best = index;
  return best;
}
function atr(bars: DailyBar[], end: number) {
  return mean(bars.slice(Math.max(1, end - 13), end + 1).map((bar, offset) => {
    const index = Math.max(1, end - 13) + offset;
    const close = bars[index - 1]!.close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - close), Math.abs(bar.low - close));
  }));
}
function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
