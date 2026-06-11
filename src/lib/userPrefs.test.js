import { describe, it, expect, beforeEach } from 'vitest';
import { getUserPrefs, setUserPrefs, DEFAULT_PREFS, DENSITIES } from './userPrefs';

// Minimal in-memory localStorage for the node test env (no jsdom).
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
});

describe('userPrefs', () => {
  it('returns defaults when nothing stored', () => {
    expect(getUserPrefs('u1')).toEqual(DEFAULT_PREFS);
  });

  it('persists density and reads it back, isolated per uid', () => {
    setUserPrefs('u1', { density: 'simple' });
    expect(getUserPrefs('u1').density).toBe('simple');
    expect(getUserPrefs('u2').density).toBe('standard'); // other user untouched
  });

  it('falls back to the default for an invalid density', () => {
    setUserPrefs('u1', { density: 'bogus' });
    expect(getUserPrefs('u1').density).toBe('standard');
  });

  it('coerces homeExpanded to a boolean', () => {
    setUserPrefs('u1', { homeExpanded: 1 });
    expect(getUserPrefs('u1').homeExpanded).toBe(true);
  });

  it('exposes the three density levels', () => {
    expect(DENSITIES).toEqual(['simple', 'standard', 'everything']);
  });
});
