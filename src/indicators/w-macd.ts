import type { DailyBar, WMacdPattern } from '../domain/types.js';
import { calculateMacdSeries } from './technical-features.js';

const CALENDAR_WINDOW_DAYS = 90;
const MIN_WINDOW_BARS = 35;
const MIN_LOW_GAP = 8;
const STRICT_MAX_LOW_GAP = 30;
const SIMILAR_MAX_LOW_GAP = 45;
const MIN_DRAWDOWN = 0.03;
const MIN_REBOUND = 0.02;
const MAX_SECOND_LOW_DROP = 0.02;
const MAX_SIMILAR_LOW_DROP = 0.05;
const MIN_NEGATIVE_BLOCK_BARS = 3;
const MAX_SHALLOW_ZERO_BARS = 20;
const MAX_SHALLOW_ZERO_DEPTH = -0.75;
const MAX_SECOND_LOW_AGE_BARS = 15;
const MACD_WARMUP_BARS = 26;

interface MacdBlock {
  start: number;
  end: number;
  area: number;
}

interface LowCandidate {
  index: number;
  price: number;
}

export function detectWMacdPattern(bars: DailyBar[]): WMacdPattern | undefined {
  const ordered = [...bars].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  if (ordered.length < 26) return undefined;

  if (ordered.some((bar, index) =>
    bar.adjustType !== 'qfq' ||
    ![bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0) ||
    !Number.isFinite(Date.parse(`${bar.tradeDate}T00:00:00Z`)) ||
    (index > 0 && bar.tradeDate === ordered[index - 1]!.tradeDate)
  )) throw new Error('W-MACD 需要日期唯一、价格有效的前复权日线');
  const latestDate = Date.parse(`${ordered.at(-1)!.tradeDate}T00:00:00Z`);
  const cutoff = new Date(latestDate - (CALENDAR_WINDOW_DAYS - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const windowStart = ordered.findIndex((bar) => bar.tradeDate >= cutoff);
  if (windowStart < 0 || ordered.length - windowStart < MIN_WINDOW_BARS) return undefined;

  const macd = calculateMacdSeries(ordered.map((bar) => bar.close));
  const lows = findLocalLows(ordered, Math.max(windowStart + 2, MACD_WARMUP_BARS), ordered.length - 3);
  // Start from the full series so a block crossing the window boundary is never truncated.
  const blocks = findNegativeBlocks(macd, 0)
    .filter((block) => block.end - block.start + 1 >= MIN_NEGATIVE_BLOCK_BARS);
  if (lows.length < 2 || blocks.length < 2) return undefined;

  // The latest pair keeps a historical W from being mistaken for the current setup.
  const secondBlock = blocks.at(-1)!;
  const firstBlock = blocks.at(-2)!;
  if (firstBlock.start < Math.max(windowStart, MACD_WARMUP_BARS)) return undefined;
  const first = lowestNearBlock(lows, firstBlock);
  const second = lowestNearBlock(lows, secondBlock);
  if (!first || !second) return undefined;
  const gap = second.index - first.index;
  if (gap < MIN_LOW_GAP || gap > SIMILAR_MAX_LOW_GAP) return undefined;
  return buildPattern(ordered, macd, firstBlock, secondBlock, first, second, windowStart, gap);
}

function buildPattern(
  bars: DailyBar[],
  macd: ReturnType<typeof calculateMacdSeries>,
  firstBlock: MacdBlock,
  secondBlock: MacdBlock,
  first: LowCandidate,
  second: LowCandidate,
  windowStart: number,
  gap: number,
): WMacdPattern | undefined {
  if (bars.length - 1 - second.index > MAX_SECOND_LOW_AGE_BARS) return undefined;
  if (bars.at(-1)!.close < second.price * 1.01) return undefined;
  if (bars.slice(second.index + 1).some((bar) => bar.low < second.price)) return undefined;
  const middleIndex = indexOfHighestHigh(bars, first.index + 1, second.index - 1);
  if (middleIndex < first.index + 2 || middleIndex > second.index - 2) return undefined;
  const middleHigh = bars[middleIndex]!.high;
  const reboundBase = Math.max(first.price, second.price);
  if ((middleHigh - reboundBase) / reboundBase < MIN_REBOUND) return undefined;

  const priorHighIndex = indexOfHighestHigh(bars, Math.max(windowStart, first.index - 30), first.index - 2);
  if (priorHighIndex < 0) return undefined;
  const priorHigh = bars[priorHighIndex]!.high;
  if ((priorHigh - first.price) / priorHigh < MIN_DRAWDOWN) return undefined;

  if (secondBlock.start <= firstBlock.end) return undefined;
  if (secondBlock.start < middleIndex - 2) return undefined;

  const lowChangePercent = ((second.price / first.price) - 1) * 100;
  const negativeAreaRatio = secondBlock.area / Math.max(firstBlock.area, Number.EPSILON);
  if (negativeAreaRatio >= 1) return undefined;

  const lineStart = firstBlock.start;
  const lineEnd = secondBlock.end;
  const macdLines = macd.slice(lineStart, lineEnd + 1);
  const macdBelowZeroBars = macdLines.filter((point) => point.dif < 0 || point.dea < 0).length;
  const macdMinLine = macdLines.reduce(
    (minimum, point) => Math.min(minimum, point.dif, point.dea),
    Number.POSITIVE_INFINITY,
  );
  const averageRange = averageTrueRange(bars, lineStart, lineEnd);
  const macdMinLineAtr = macdMinLine / Math.max(averageRange, Number.EPSILON);
  const current = macd.at(-1)!;
  const previous = macd.at(-2)!;
  const currentMacdRising = current.dif > previous.dif && current.dea > previous.dea;
  const aboveNeckline = bars.at(-1)!.close > middleHigh;
  const strict =
    gap <= STRICT_MAX_LOW_GAP &&
    lowChangePercent >= -MAX_SECOND_LOW_DROP * 100 &&
    macdBelowZeroBars === 0 &&
    secondBlock.end < bars.length - 1 &&
    current.histogram >= 0 &&
    currentMacdRising;
  const similar =
    gap <= SIMILAR_MAX_LOW_GAP &&
    lowChangePercent >= -MAX_SIMILAR_LOW_DROP * 100 &&
    macdMinLineAtr >= MAX_SHALLOW_ZERO_DEPTH &&
    macdBelowZeroBars <= MAX_SHALLOW_ZERO_BARS;
  if (!strict && !similar) return undefined;

  const status = strict ? 'strict' : 'similar';
  const reasons = buildReasons({
    status,
    lowChangePercent,
    negativeAreaRatio,
    macdBelowZeroBars,
    current,
    currentMacdRising,
    aboveNeckline,
  });
  if (gap > STRICT_MAX_LOW_GAP) reasons.push(`两底间隔 ${gap} 根日线，超过严格组 30 根上限`);
  if (lowChangePercent < -MAX_SECOND_LOW_DROP * 100) reasons.push('第二低点跌破第一低点超过 2%');
  if (middleHigh > priorHigh) reasons.push('中间反弹高点超过前高');
  if (secondBlock.end === bars.length - 1) reasons.push('第二段绿柱尚未结束，面积比较为暂时值');
  return {
    status,
    windowStart: bars[windowStart]!.tradeDate,
    windowBars: bars.length - windowStart,
    priorHighDate: bars[priorHighIndex]!.tradeDate,
    priorHigh,
    firstLowDate: bars[first.index]!.tradeDate,
    firstLow: first.price,
    middleHighDate: bars[middleIndex]!.tradeDate,
    middleHigh,
    secondLowDate: bars[second.index]!.tradeDate,
    secondLow: second.price,
    lowChangePercent,
    lowGapBars: gap,
    firstNegativeArea: firstBlock.area,
    secondNegativeArea: secondBlock.area,
    negativeAreaRatio,
    firstNegativeBars: firstBlock.end - firstBlock.start + 1,
    secondNegativeBars: secondBlock.end - secondBlock.start + 1,
    macdBelowZeroBars,
    macdMinLine,
    macdMinLineAtr,
    firstNegativeStart: bars[firstBlock.start]!.tradeDate,
    firstNegativeEnd: bars[firstBlock.end]!.tradeDate,
    secondNegativeStart: bars[secondBlock.start]!.tradeDate,
    secondNegativeEnd: bars[secondBlock.end]!.tradeDate,
    secondNegativeComplete: secondBlock.end < bars.length - 1,
    asOfDate: bars.at(-1)!.tradeDate,
    currentHistogram: current.histogram,
    currentMacdRising,
    aboveNeckline,
    reasons,
  };
}

function findLocalLows(bars: DailyBar[], start: number, end: number): LowCandidate[] {
  const result: LowCandidate[] = [];
  for (let index = start; index <= end; index += 1) {
    const price = bars[index]!.low;
    const neighbors = [bars[index - 2]!.low, bars[index - 1]!.low, bars[index + 1]!.low, bars[index + 2]!.low];
    if (neighbors.every((low) => price <= low) && neighbors.some((low) => price < low)) {
      result.push({ index, price });
    }
  }
  return result;
}

function findNegativeBlocks(macd: ReturnType<typeof calculateMacdSeries>, start: number): MacdBlock[] {
  const result: MacdBlock[] = [];
  let index = start;
  while (index < macd.length) {
    if (macd[index]!.histogram >= 0) {
      index += 1;
      continue;
    }
    const blockStart = index;
    let area = 0;
    while (index < macd.length && macd[index]!.histogram < 0) {
      area += Math.abs(macd[index]!.histogram);
      index += 1;
    }
    const blockEnd = index - 1;
    result.push({ start: blockStart, end: blockEnd, area });
  }
  return result;
}

function lowestNearBlock(lows: LowCandidate[], block: MacdBlock) {
  if (block.end - block.start + 1 < MIN_NEGATIVE_BLOCK_BARS) return undefined;
  return lows
    .filter((low) => low.index >= block.start - 3 && low.index <= block.end + 3)
    .sort((a, b) => a.price - b.price || b.index - a.index)[0];
}

function indexOfHighestHigh(bars: DailyBar[], start: number, end: number) {
  if (start > end) return -1;
  let best = start;
  for (let index = start + 1; index <= end; index += 1) {
    if (bars[index]!.high > bars[best]!.high) best = index;
  }
  return best;
}

function averageTrueRange(bars: DailyBar[], start: number, end: number) {
  const ranges = bars.slice(start, end + 1).map((bar, offset) => {
    const previousClose = bars[Math.max(0, start + offset - 1)]!.close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function buildReasons(input: {
  status: WMacdPattern['status'];
  lowChangePercent: number;
  negativeAreaRatio: number;
  macdBelowZeroBars: number;
  current: { histogram: number };
  currentMacdRising: boolean;
  aboveNeckline: boolean;
}) {
  const reasons = [
    input.status === 'strict' ? '严格符合 W 底 + MACD 缩柱' : '走势相似：W 底 + MACD 缩柱',
    `第二低点较第一低点${formatSignedPercent(input.lowChangePercent)}`,
    `第二段 MACD 负柱面积为第一段的 ${(input.negativeAreaRatio * 100).toFixed(1)}%`,
  ];
  if (input.macdBelowZeroBars === 0) reasons.push('两段绿柱期间 DIF/DEA 未下穿零轴');
  else reasons.push(`DIF/DEA 有 ${input.macdBelowZeroBars} 根 K 线位于零轴下方`);
  if (input.current.histogram >= 0 && input.currentMacdRising) reasons.push('当前 MACD 已翻红且双线回升');
  else if (input.currentMacdRising) reasons.push('当前 DIF/DEA 同步回升，等待柱体翻红');
  else reasons.push('当前 MACD 尚未完成同步回升确认');
  reasons.push(input.aboveNeckline ? '收盘价已突破两底之间颈线' : '收盘价尚未突破两底之间颈线');
  return reasons;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}
