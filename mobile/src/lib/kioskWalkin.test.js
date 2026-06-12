import { describe, it, expect } from 'vitest';
import {
  KIOSK_MODES, isCheckoutActive, resolveKioskView,
  digitsOnly, fmtPhoneInput, fmtPhoneStored, waitLabel, availabilityView,
} from './kioskWalkin';

describe('resolveKioskView', () => {
  it('a live checkout session ALWAYS takes over, regardless of idle mode', () => {
    for (const mode of ['walkin', 'tipflow', 'checkout', undefined]) {
      for (const status of ['pending', 'paying', 'confirmed']) {
        expect(resolveKioskView({ kioskDefaultMode: mode }, { status })).toBe('checkout');
      }
    }
  });
  it('no session → walk-in when default is walkin (and when unset)', () => {
    expect(resolveKioskView({ kioskDefaultMode: 'walkin' }, null)).toBe('walkin');
    expect(resolveKioskView({}, null)).toBe('walkin');          // default
    expect(resolveKioskView(null, undefined)).toBe('walkin');
  });
  it('no session → tipflow for both tipflow and checkout defaults (checkout idles on TipFlow)', () => {
    expect(resolveKioskView({ kioskDefaultMode: 'tipflow' }, null)).toBe('tipflow');
    expect(resolveKioskView({ kioskDefaultMode: 'checkout' }, null)).toBe('tipflow');
  });
  it('a done/cancelled session does not count as active', () => {
    expect(isCheckoutActive({ status: 'done' })).toBe(false);
    expect(resolveKioskView({ kioskDefaultMode: 'walkin' }, { status: 'done' })).toBe('walkin');
  });
});

describe('phone helpers', () => {
  it('digitsOnly strips + caps at 10', () => {
    expect(digitsOnly('+1 (614) 515-1231')).toBe('6145151231');
    expect(digitsOnly('61451512319999')).toBe('6145151231');
  });
  it('fmtPhoneInput formats progressively', () => {
    expect(fmtPhoneInput('614')).toBe('614');
    expect(fmtPhoneInput('614515')).toBe('(614) 515');
    expect(fmtPhoneInput('6145151231')).toBe('(614) 515-1231');
  });
  it('fmtPhoneStored gives the +1 (xxx) form only for a full 10 digits', () => {
    expect(fmtPhoneStored('6145151231')).toBe('+1 (614) 515-1231');
    expect(fmtPhoneStored('614515')).toBe('614515');
  });
  it('waitLabel formats minutes and hours', () => {
    expect(waitLabel(null)).toBe('');
    expect(waitLabel(20)).toBe('20 min');
    expect(waitLabel(60)).toBe('1 hr');
    expect(waitLabel(75)).toBe('1 hr 15 min');
  });
});

describe('availabilityView', () => {
  it('loading + closed', () => {
    expect(availabilityView(null, 'Any').kind).toBe('loading');
    expect(availabilityView({ salonClosed: true }, 'Any').kind).toBe('closed');
  });

  it('No preference → soonest tech, with join args', () => {
    const v = availabilityView({ noPrefEarliest: { techName: 'Yara', waitMinutes: 15 } }, 'Any');
    expect(v.kind).toBe('noPref');
    expect(v.primary).toEqual({ techName: 'Yara', waitMinutes: 15, note: 'next available' });
    expect(v.join).toEqual({ techName: 'Any', requestedTechName: '', waitMin: 15 });
  });

  it('No preference but nobody available → noTech', () => {
    expect(availabilityView({ noPrefEarliest: null, options: [] }, 'Any').kind).toBe('noTech');
  });

  it('requested tech soon (<=60) → soon', () => {
    const v = availabilityView({ options: [{ techName: 'Mara', waitMinutes: 30 }] }, 'Mara');
    expect(v.kind).toBe('soon');
    expect(v.join).toEqual({ techName: 'Mara', requestedTechName: 'Mara', waitMin: 30 });
  });

  it('requested tech long wait (>60), suggests an immediate alternative (<=10)', () => {
    const avail = { options: [
      { techName: 'Mara', waitMinutes: 90 },
      { techName: 'Ana',  waitMinutes: 5 },
    ] };
    const v = availabilityView(avail, 'Mara');
    expect(v.kind).toBe('wait');
    expect(v.primaryWaitMinutes).toBe(90);
    expect(v.suggest).toEqual({ techName: 'Ana', waitMinutes: 5, immediate: true });
    expect(v.joinSuggest).toEqual({ techName: 'Ana', requestedTechName: 'Ana', waitMin: 5 });
    expect(v.joinKeep).toEqual({ techName: 'Mara', requestedTechName: 'Mara', waitMin: 90 });
  });

  it('requested tech long wait, no immediate → suggests the next sooner tech', () => {
    const avail = { options: [
      { techName: 'Mara', waitMinutes: 90 },
      { techName: 'Ana',  waitMinutes: 40 },
    ] };
    const v = availabilityView(avail, 'Mara');
    expect(v.suggest).toEqual({ techName: 'Ana', waitMinutes: 40, immediate: false });
  });

  it('requested tech not available today → techUnavailable + alt + wait-anyway args', () => {
    const avail = { options: [{ techName: 'Ana', waitMinutes: 20 }] };
    const v = availabilityView(avail, 'Mara');
    expect(v.kind).toBe('techUnavailable');
    expect(v.alt).toEqual({ techName: 'Ana', waitMinutes: 20 });
    expect(v.joinAlt).toEqual({ techName: 'Ana', requestedTechName: 'Ana', waitMin: 20 });
    expect(v.joinWait).toEqual({ techName: 'Mara', requestedTechName: 'Mara', waitMin: null });
  });

  it('requested tech not available AND nobody else → techUnavailable with null alt', () => {
    const v = availabilityView({ options: [] }, 'Mara');
    expect(v.kind).toBe('techUnavailable');
    expect(v.alt).toBeNull();
    expect(v.joinAlt).toBeNull();
  });
});
