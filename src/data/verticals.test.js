import { describe, it, expect } from 'vitest';
import { VERTICALS, resolveVertical, resolveTerms, DEFAULT_TERMS } from './verticals.js';
import { membershipPlansForVertical as serverMembershipPlans, normalizeVertical as serverNormalizeVertical } from '../../functions/lib/verticals.js';

// The membership-plan templates are hand-mirrored between the ESM client
// registry (this file) and the CommonJS server seed module (functions/lib).
// This guard fails loudly if they drift.
describe('vertical registry', () => {
  it('membership-plan templates match between client registry and server mirror', () => {
    for (const key of Object.keys(VERTICALS)) {
      expect(serverMembershipPlans(key)).toEqual(VERTICALS[key].membershipPlans);
    }
  });

  it('server normalizeVertical clamps unknown industries to nails', () => {
    expect(serverNormalizeVertical('personalTraining')).toBe('personalTraining');
    expect(serverNormalizeVertical('nails')).toBe('nails');
    for (const unknown of ['hair', 'both', 'other', undefined, '']) {
      expect(serverNormalizeVertical(unknown)).toBe('nails');
    }
  });

  it('resolveVertical/resolveTerms fall back to nail defaults for unknown keys', () => {
    expect(resolveVertical(undefined).key).toBe('nails');
    expect(resolveVertical('hair').serviceTemplateId).toBe('nail-salon');
    expect(resolveTerms(undefined)).toBe(DEFAULT_TERMS);
    expect(resolveTerms('personalTraining').staff).toBe('trainer');
  });

  it('only the nail vertical seeds the nail starter menu (others bring their own)', () => {
    // Mirrors ServicesAdmin.shouldAutoSeedNailMenu — nails + every unregistered
    // industry keep the nail seed; personal training does not.
    expect(resolveVertical('nails').serviceTemplateId).toBe('nail-salon');
    expect(resolveVertical('hair').serviceTemplateId).toBe('nail-salon'); // unregistered -> fallback
    expect(resolveVertical('personalTraining').serviceTemplateId).toBe('personal-training');
    expect(resolveVertical('makeupArtist').serviceTemplateId).toBe('makeup-artist');
  });

  it('make-up artist resolves its own terminology + is a known server vertical', () => {
    expect(resolveTerms('makeupArtist').staff).toBe('makeup artist');
    expect(resolveTerms('makeupArtist').emoji).toBe('💄');
    expect(serverNormalizeVertical('makeupArtist')).toBe('makeupArtist');
  });
});
