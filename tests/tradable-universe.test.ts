import { describe, expect, it } from 'vitest';
import type { MarketSnapshot } from '../src/domain/types.js';
import { exclusionReason, filterTradableUniverse } from '../src/market-data/tradable-universe.js';

function snapshot(code: string, name: string, exchange: MarketSnapshot['exchange']): MarketSnapshot {
  return { code, name, exchange, source: 'test', fetchedAt: '2026-10-10T00:00:00.000Z' };
}

describe('filterTradableUniverse', () => {
  it('保留沪深主板和创业板股票', () => {
    const rows = [
      snapshot('600000', '浦发银行', 'SH'),
      snapshot('000001', '平安银行', 'SZ'),
      snapshot('300750', '宁德时代', 'SZ'),
    ];

    expect(filterTradableUniverse(rows).included.map((row) => row.code)).toEqual(['600000', '000001', '300750']);
  });

  it('排除北交所、科创板和风险警示股票', () => {
    const rows = [
      snapshot('830799', '艾融软件', 'BJ'),
      snapshot('688981', '中芯国际', 'SH'),
      snapshot('689009', '九号公司', 'SH'),
      snapshot('600001', 'ST测试', 'SH'),
      snapshot('000002', '*ST测试', 'SZ'),
      snapshot('000003', '测试退', 'SZ'),
    ];

    const result = filterTradableUniverse(rows);

    expect(result.included).toEqual([]);
    expect(result.excluded).toEqual({ beijing: 1, 'star-market': 2, 'risk-warning': 3 });
  });

  it('为单只股票返回明确的排除原因', () => {
    expect(exclusionReason(snapshot('688001', '华兴源创', 'SH'))).toBe('star-market');
    expect(exclusionReason(snapshot('920001', '北交测试', 'BJ'))).toBe('beijing');
    expect(exclusionReason(snapshot('002001', '普通股票', 'SZ'))).toBeUndefined();
  });
});
