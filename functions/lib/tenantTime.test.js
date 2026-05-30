import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REMINDER_HOUR, DEFAULT_TIMEZONE,
  currentHourInTimezone, resolveReminderHour, resolveTimezone, shouldSendRemindersNow,
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
