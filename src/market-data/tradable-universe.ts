import type { MarketSnapshot } from '../domain/types.js';

export type UniverseExclusionReason = 'beijing' | 'star-market' | 'risk-warning';

export interface UniverseFilterResult {
  included: MarketSnapshot[];
  excluded: Record<UniverseExclusionReason, number>;
}

export function filterTradableUniverse(snapshots: MarketSnapshot[]): UniverseFilterResult {
  const excluded: Record<UniverseExclusionReason, number> = {
    beijing: 0,
    'star-market': 0,
    'risk-warning': 0,
  };
  const included: MarketSnapshot[] = [];

  for (const snapshot of snapshots) {
    const reason = exclusionReason(snapshot);
    if (reason) excluded[reason] += 1;
    else included.push(snapshot);
  }

  return { included, excluded };
}

export function exclusionReason(snapshot: MarketSnapshot): UniverseExclusionReason | undefined {
  if (snapshot.exchange === 'BJ') return 'beijing';
  if (snapshot.exchange === 'SH' && /^(688|689)/.test(snapshot.code)) return 'star-market';
  if (/^\*?ST|退/i.test(snapshot.name)) return 'risk-warning';
  return undefined;
}
