import type { StockStrategy } from '../domain/types.js';
import { volumeTrendStrategy } from './volume-trend.js';

const strategies = new Map<string, StockStrategy>([[volumeTrendStrategy.id, volumeTrendStrategy]]);

export function getStrategy(id: string) {
  const strategy = strategies.get(id);
  if (!strategy) throw new Error(`未知策略 ${id}，可选：${[...strategies.keys()].join(', ')}`);
  return strategy;
}

export function listStrategies() {
  return [...strategies.values()].map(({ id, name }) => ({ id, name }));
}
