import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REMINDER_HOUR, DEFAULT_TIMEZONE,
  currentHourInTimezone, resolveReminderHour, resolveTimezone, shouldSendRemindersNow,
  shouldFireDayHourNow, apptInstantUnix, apptExpUnix,
} from './tenantTime.js';

describe('currentHourInTimezone', () => {
  // 2026-06-01T13:30:00Z = 09:30 Eastern (EDT, UTC-4)
  const UTC_13_30 = new Date('2026-06-01T13:30:00Z');

  it('returns 9 for 13:30 UTC in America/New_York (EDT)', () => {
    expect(currentHourInTimezone(UTC_13_30, 'America/New_York')).toBe(9);
  });
  it('returns 6 for the same instant in America/Los_Angeles (PDT)', () => {
    expect(currentHourInTimezone(UTC_13_30, 'America/Los_Angeles')).toBe(6);
  });
  it('returns 7 for America/Denver (MDT) at 13:30 UTC', () => {
    expect(currentHourInTimezone(UTC_13_30, 'America/Denver')).toBe(7);
  });
  it('returns 6 for America/Phoenix (no DST) at 13:30 UTC in summer', () => {
    expect(currentHourInTimezone(UTC_13_30, 'America/Phoenix')).toBe(6);
  });
  it('returns 13 for UTC itself', () => {
    expect(currentHourInTimezone(UTC_13_30, 'UTC')).toBe(13);
  });
  it('treats missing tz as America/New_York', () => {
    expect(currentHourInTimezone(UTC_13_30, undefined)).toBe(9);
    expect(currentHourInTimezone(UTC_13_30, '')).toBe(9);
  });
  it('wraps midnight reported as 24 down to 0', () => {
    // 04:00 UTC = midnight Eastern (00:00); some runtimes report "24"
    const midnightEastern = new Date('2026-06-01T04:00:00Z');
    expect(currentHourInTimezone(midnightEastern, 'America/New_York')).toBe(0);
  });
});

describe('resolveReminderHour', () => {
  it('returns the configured hour when valid', () => {
    expect(resolveReminderHour({ reminderHour: 17 })).toBe(17);
  });
  it('returns 9 (default) when missing or empty', () => {
    expect(resolveReminderHour({})).toBe(DEFAULT_REMINDER_HOUR);
    expect(resolveReminderHour({ reminderHour: '' })).toBe(DEFAULT_REMINDER_HOUR);
    expect(resolveReminderHour(null)).toBe(DEFAULT_REMINDER_HOUR);
  });
  it('clamps out-of-range and NaN to the default', () => {
    expect(resolveReminderHour({ reminderHour: -1 })).toBe(9);
    expect(resolveReminderHour({ reminderHour: 24 })).toBe(9);
    expect(resolveReminderHour({ reminderHour: 99 })).toBe(9);
    expect(resolveReminderHour({ reminderHour: 'foo' })).toBe(9);
  });
  it('accepts numeric strings', () => {
    expect(resolveReminderHour({ reminderHour: '17' })).toBe(17);
  });
  it('floors fractional hours', () => {
    expect(resolveReminderHour({ reminderHour: 14.7 })).toBe(14);
  });
});

describe('resolveTimezone', () => {
  it('returns the configured zone', () => {
    expect(resolveTimezone({ timezone: 'America/Chicago' })).toBe('America/Chicago');
  });
  it('falls back to America/New_York when missing or whitespace', () => {
    expect(resolveTimezone({})).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone({ timezone: '' })).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone({ timezone: '   ' })).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone(null)).toBe(DEFAULT_TIMEZONE);
  });
});

describe('shouldSendRemindersNow', () => {
  // 13:30 UTC = 9:30 Eastern, 6:30 Pacific, 7:30 Mountain (summer)
  const NOW = new Date('2026-06-01T13:30:00Z');

  it('fires for default tenant (9 AM Eastern) at 13:30 UTC', () => {
    expect(shouldSendRemindersNow(NOW, {})).toBe(true);
  });
  it('skips Pacific tenant whose hour is 6 AM at this instant', () => {
    expect(shouldSendRemindersNow(NOW, { timezone: 'America/Los_Angeles', reminderHour: 9 })).toBe(false);
  });
  it('fires for Pacific tenant who picked 6 AM', () => {
    expect(shouldSendRemindersNow(NOW, { timezone: 'America/Los_Angeles', reminderHour: 6 })).toBe(true);
  });
  it('fires for a 7 PM Eastern tenant at the right instant', () => {
    // 23:00 UTC = 19:00 Eastern (EDT)
    const evening = new Date('2026-06-01T23:00:00Z');
    expect(shouldSendRemindersNow(evening, { timezone: 'America/New_York', reminderHour: 19 })).toBe(true);
  });
});

describe('shouldFireDayHourNow', () => {
  // 2026-06-01 is a Monday. 15:00 UTC = 11:00 Eastern (EDT).
  const MON_15_UTC = new Date('2026-06-01T15:00:00Z');

  it('fires on the matching weekday + hour in the tenant TZ', () => {
    expect(shouldFireDayHourNow(MON_15_UTC, 'America/New_York', 1, 11)).toBe(true);
  });
  it('skips when the weekday matches but the hour does not', () => {
    expect(shouldFireDayHourNow(MON_15_UTC, 'America/New_York', 1, 10)).toBe(false);
  });
  it('skips when the hour matches but the weekday does not', () => {
    expect(shouldFireDayHourNow(MON_15_UTC, 'America/New_York', 2, 11)).toBe(false);
  });
  it('uses the tenant TZ — same instant is 8 AM Monday Pacific', () => {
    expect(shouldFireDayHourNow(MON_15_UTC, 'America/Los_Angeles', 1, 8)).toBe(true);
    expect(shouldFireDayHourNow(MON_15_UTC, 'America/Los_Angeles', 1, 11)).toBe(false);
  });
});

describe('apptInstantUnix', () => {
  it('returns the correct instant for a 9 AM Eastern appt (EDT)', () => {
    // 2026-06-01 09:00 EDT = 13:00 UTC
    expect(apptInstantUnix({ date: '2026-06-01', startTime: '09:00' }, 'America/New_York'))
      .toBe(Math.floor(Date.UTC(2026, 5, 1, 13, 0) / 1000));
  });
  it('returns the correct instant for a 9 AM Pacific appt (PDT)', () => {
    // 09:00 PDT = 16:00 UTC
    expect(apptInstantUnix({ date: '2026-06-01', startTime: '09:00' }, 'America/Los_Angeles'))
      .toBe(Math.floor(Date.UTC(2026, 5, 1, 16, 0) / 1000));
  });
  it('handles EST (winter, no DST)', () => {
    // 2026-01-15 09:00 EST = 14:00 UTC
    expect(apptInstantUnix({ date: '2026-01-15', startTime: '09:00' }, 'America/New_York'))
      .toBe(Math.floor(Date.UTC(2026, 0, 15, 14, 0) / 1000));
  });
  it('returns null for missing date', () => {
    expect(apptInstantUnix({}, 'America/New_York')).toBe(null);
    expect(apptInstantUnix(null, 'America/New_York')).toBe(null);
  });
  it('treats missing startTime as midnight', () => {
    // 2026-06-01 midnight Eastern = 04:00 UTC
    expect(apptInstantUnix({ date: '2026-06-01' }, 'America/New_York'))
      .toBe(Math.floor(Date.UTC(2026, 5, 1, 4, 0) / 1000));
  });
  it('defaults to America/New_York when tz omitted', () => {
    expect(apptInstantUnix({ date: '2026-06-01', startTime: '09:00' }))
      .toBe(Math.floor(Date.UTC(2026, 5, 1, 13, 0) / 1000));
  });
});

describe('apptExpUnix', () => {
  it('returns 24h past the real start instant in the tenant tz', () => {
    const start = apptInstantUnix({ date: '2026-06-01', startTime: '09:00' }, 'America/New_York');
    expect(apptExpUnix({ date: '2026-06-01', startTime: '09:00' }, 'America/New_York'))
      .toBe(start + 24 * 3600);
  });
  it('returns 0 (immediately expired) for a malformed appt', () => {
    expect(apptExpUnix({}, 'America/New_York')).toBe(0);
    expect(apptExpUnix(null, 'America/New_York')).toBe(0);
  });
});
