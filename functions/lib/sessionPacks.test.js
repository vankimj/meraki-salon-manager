import { describe, it, expect } from 'vitest';
import { pickActivePack, decrementState } from './sessionPacks.js';

describe('pickActivePack', () => {
  it('returns null when there are no eligible packs', () => {
    expect(pickActivePack([])).toBe(null);
    expect(pickActivePack([{ status: 'depleted', remaining: 0 }])).toBe(null);
    expect(pickActivePack([{ status: 'active', remaining: 0 }])).toBe(null);
  });
  it('picks the oldest active pack with remaining > 0 (FIFO)', () => {
    const packs = [
      { id: 'b', status: 'active', remaining: 5, grantedAt: '2026-02-01' },
      { id: 'a', status: 'active', remaining: 3, grantedAt: '2026-01-01' },
      { id: 'c', status: 'active', remaining: 0, grantedAt: '2025-12-01' }, // no remaining
    ];
    expect(pickActivePack(packs).id).toBe('a');
  });
});

describe('decrementState', () => {
  it('decrements and stays active', () => {
    expect(decrementState(5)).toEqual({ remaining: 4, status: 'active', low: false });
  });
  it('flags low balance at 2 and 1', () => {
    expect(decrementState(3).low).toBe(true);  // -> 2
    expect(decrementState(2).low).toBe(true);  // -> 1
  });
  it('depletes at zero and never goes negative', () => {
    expect(decrementState(1)).toEqual({ remaining: 0, status: 'depleted', low: false });
    expect(decrementState(0)).toEqual({ remaining: 0, status: 'depleted', low: false });
  });
});
