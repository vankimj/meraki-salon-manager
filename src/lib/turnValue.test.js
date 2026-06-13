import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TURN_VALUE, resolveTurnMode, resolveTurnValue, sumTurnValue,
  buildTurnValueMap, turnValueForLineName,
} from './turnValue';

describe('resolveTurnMode', () => {
  it('defaults to count, only "value" flips it', () => {
    expect(resolveTurnMode({})).toBe('count');
    expect(resolveTurnMode(null)).toBe('count');
    expect(resolveTurnMode({ walkinTurnMode: 'count' })).toBe('count');
    expect(resolveTurnMode({ walkinTurnMode: 'value' })).toBe('value');
    expect(resolveTurnMode({ walkinTurnMode: 'nonsense' })).toBe('count');
  });
});

describe('resolveTurnValue', () => {
  it('uses turnValue when finite & >= 0, else default', () => {
    expect(resolveTurnValue({ turnValue: 2 })).toBe(2);
    expect(resolveTurnValue({ turnValue: 0 })).toBe(0);
    expect(resolveTurnValue({ turnValue: 0.5 })).toBe(0.5);
    expect(resolveTurnValue({})).toBe(DEFAULT_TURN_VALUE);
    expect(resolveTurnValue({ turnValue: -1 })).toBe(DEFAULT_TURN_VALUE);
    expect(resolveTurnValue({ turnValue: 'x' })).toBe(DEFAULT_TURN_VALUE);
    expect(resolveTurnValue(null)).toBe(DEFAULT_TURN_VALUE);
  });
});

describe('sumTurnValue', () => {
  it('sums, treating unset as default', () => {
    expect(sumTurnValue([{ turnValue: 2 }, { turnValue: 0.5 }])).toBe(2.5);
    expect(sumTurnValue([{ turnValue: 2 }, {}])).toBe(3);   // {} → 1
    expect(sumTurnValue([])).toBe(0);
    expect(sumTurnValue(null)).toBe(0);
  });
});

describe('buildTurnValueMap + turnValueForLineName', () => {
  const services = [
    { name: 'Full set', turnValue: 2 },
    { name: 'Polish change', turnValue: 0.5 },
    { name: 'Gel Manicure', turnValue: 1.5, options: [{ name: 'Long' }, { name: 'Short' }] },
    { name: 'Mystery' }, // no turnValue → default
  ];
  const map = buildTurnValueMap(services);

  it('maps base names case-insensitively', () => {
    expect(turnValueForLineName('Full set', map)).toBe(2);
    expect(turnValueForLineName('full SET', map)).toBe(2);
    expect(turnValueForLineName('Polish change', map)).toBe(0.5);
  });
  it('maps option-inclusive names and falls back to the base', () => {
    expect(turnValueForLineName('Gel Manicure — Long', map)).toBe(1.5);
    expect(turnValueForLineName('Gel Manicure — Unknownopt', map)).toBe(1.5); // base fallback
  });
  it('unset service resolves to the default', () => {
    expect(turnValueForLineName('Mystery', map)).toBe(DEFAULT_TURN_VALUE);
  });
  it('a totally unknown line falls back to the default (degrades to +1)', () => {
    expect(turnValueForLineName('Something we deleted', map)).toBe(DEFAULT_TURN_VALUE);
    expect(turnValueForLineName('', map)).toBe(DEFAULT_TURN_VALUE);
  });
});
