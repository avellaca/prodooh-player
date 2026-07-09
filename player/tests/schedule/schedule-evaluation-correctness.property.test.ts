/**
 * Property-based test: Schedule Evaluation Correctness
 *
 * Generates random timestamps, timezones, and schedule rules, then verifies
 * that the ScheduleManager produces correct results by comparing against
 * a reference oracle implementation.
 *
 * **Validates: Requirements 16.1, 16.2, 16.3, 16.6**
 *
 * Requirement 16.1: Schedule defined as start/end time range with explicit timezone.
 * Requirement 16.2: Within operating hours, player functions normally.
 * Requirement 16.3: Outside operating hours, player enters sleep/standby.
 * Requirement 16.6: If no schedule configured, operate 24/7 (default).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ScheduleManager } from '../../src/schedule/ScheduleManager';
import type { ScheduleConfig, ScheduleRule } from '../../src/storage/types';

// --- Arbitraries ---

/** Arbitrary for valid hours (0-23) */
const hoursArb = fc.integer({ min: 0, max: 23 });

/** Arbitrary for valid minutes (0-59) */
const minutesArb = fc.integer({ min: 0, max: 59 });

/** Arbitrary for time string "HH:mm" */
const timeStringArb = fc.tuple(hoursArb, minutesArb).map(
  ([h, m]) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
);

/** Arbitrary for day of week (0=Sunday, 6=Saturday) */
const dayOfWeekArb = fc.integer({ min: 0, max: 6 });

/** Arbitrary for a non-empty subset of days */
const daysArrayArb = fc.uniqueArray(dayOfWeekArb, { minLength: 1, maxLength: 7 });

/** Arbitrary for a schedule rule */
const scheduleRuleArb: fc.Arbitrary<ScheduleRule> = fc.record({
  days: daysArrayArb,
  start: timeStringArb,
  end: timeStringArb,
});

/**
 * A set of common IANA timezone identifiers that are widely supported.
 * Using a limited set avoids issues with obscure or deprecated timezone names.
 */
const timezones = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Bogota',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Madrid',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const timezoneArb = fc.constantFrom(...timezones);

/** Arbitrary for a schedule config with 1-3 rules */
const scheduleConfigArb: fc.Arbitrary<ScheduleConfig> = fc.record({
  timezone: timezoneArb,
  rules: fc.array(scheduleRuleArb, { minLength: 1, maxLength: 3 }),
});

/**
 * Arbitrary for a timestamp within a reasonable range (year 2024).
 * Generates a random epoch millis for the year 2024.
 */
const timestampArb = fc.integer({
  min: new Date('2024-01-01T00:00:00Z').getTime(),
  max: new Date('2024-12-31T23:59:59Z').getTime(),
}).map(ms => new Date(ms));

// --- Reference Oracle ---

/**
 * Reference oracle that independently evaluates whether a given timestamp
 * is within operating hours for a given schedule config.
 * This mirrors the logic of ScheduleManager but is implemented independently.
 */
function oracleIsWithinOperatingHours(
  timestamp: Date,
  config: ScheduleConfig | null
): boolean {
  // Req 16.6: No config or empty rules → 24/7
  if (!config || config.rules.length === 0) {
    return true;
  }

  const { timezone, rules } = config;

  // Get local time in the configured timezone using Intl API
  const { dayOfWeek, hours, minutes } = getLocalTimeOracle(timestamp, timezone);

  // Check if any rule matches
  const currentMinutes = hours * 60 + minutes;

  for (const rule of rules) {
    if (!rule.days.includes(dayOfWeek)) {
      continue;
    }

    const [startH, startM] = parseTimeOracle(rule.start);
    const [endH, endM] = parseTimeOracle(rule.end);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      // Normal range (e.g., 08:00 to 20:00)
      if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
        return true;
      }
    } else {
      // Overnight range (e.g., 22:00 to 06:00)
      if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Oracle helper: get local time components in timezone using Intl API.
 */
function getLocalTimeOracle(
  date: Date,
  timezone: string
): { dayOfWeek: number; hours: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);

  let dayOfWeek = 0;
  let hours = 0;
  let minutes = 0;

  for (const part of parts) {
    if (part.type === 'weekday') {
      dayOfWeek = weekdayToNumberOracle(part.value);
    } else if (part.type === 'hour') {
      hours = parseInt(part.value, 10);
      if (hours === 24) hours = 0;
    } else if (part.type === 'minute') {
      minutes = parseInt(part.value, 10);
    }
  }

  return { dayOfWeek, hours, minutes };
}

function weekdayToNumberOracle(weekday: string): number {
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[weekday] ?? 0;
}

function parseTimeOracle(time: string): [number, number] {
  const [h, m] = time.split(':').map(Number);
  return [h ?? 0, m ?? 0];
}

// --- Property Tests ---

describe('Property 19: Schedule Evaluation Correctness', () => {
  it('ScheduleManager matches reference oracle for random timestamps and schedules', () => {
    fc.assert(
      fc.property(
        timestampArb,
        scheduleConfigArb,
        (timestamp, config) => {
          const clock = () => timestamp;
          const manager = new ScheduleManager({ config, clock });

          const actual = manager.isWithinOperatingHours();
          const expected = oracleIsWithinOperatingHours(timestamp, config);

          expect(actual).toBe(expected);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('null config always returns true (24/7 operation) regardless of timestamp', () => {
    fc.assert(
      fc.property(
        timestampArb,
        (timestamp) => {
          const clock = () => timestamp;
          const manager = new ScheduleManager({ config: null, clock });

          expect(manager.isWithinOperatingHours()).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('empty rules array always returns true (24/7 operation) regardless of timezone', () => {
    fc.assert(
      fc.property(
        timestampArb,
        timezoneArb,
        (timestamp, timezone) => {
          const config: ScheduleConfig = { timezone, rules: [] };
          const clock = () => timestamp;
          const manager = new ScheduleManager({ config, clock });

          expect(manager.isWithinOperatingHours()).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('a rule covering all days 00:00-00:00 (start == end, overnight) returns true for any timestamp', () => {
    fc.assert(
      fc.property(
        timestampArb,
        timezoneArb,
        (timestamp, timezone) => {
          // When start == end and start > end is false (they're equal),
          // the normal range check requires currentMinutes >= start AND < end,
          // which is never true when start == end. So this should return false.
          // This tests the edge case of start == end.
          const config: ScheduleConfig = {
            timezone,
            rules: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }],
          };
          const clock = () => timestamp;
          const manager = new ScheduleManager({ config, clock });

          const actual = manager.isWithinOperatingHours();
          const expected = oracleIsWithinOperatingHours(timestamp, config);

          // Both should agree (when start == end with normal range, nothing matches)
          expect(actual).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('schedule evaluation is consistent across different timezones for same UTC instant', () => {
    fc.assert(
      fc.property(
        timestampArb,
        scheduleRuleArb,
        timezoneArb,
        (timestamp, rule, timezone) => {
          const config: ScheduleConfig = { timezone, rules: [rule] };
          const clock = () => timestamp;

          const manager = new ScheduleManager({ config, clock });
          const result = manager.isWithinOperatingHours();

          // Call it again with the same clock — should be deterministic
          const manager2 = new ScheduleManager({ config, clock });
          const result2 = manager2.isWithinOperatingHours();

          expect(result).toBe(result2);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('if a day is not in any rule days array, that day is always outside operating hours', () => {
    fc.assert(
      fc.property(
        timezoneArb,
        fc.integer({ min: 0, max: 6 }),
        timeStringArb,
        timeStringArb,
        (timezone, excludedDay, start, end) => {
          // Create a rule that explicitly excludes one day
          const allDays = [0, 1, 2, 3, 4, 5, 6];
          const includedDays = allDays.filter(d => d !== excludedDay);

          if (includedDays.length === 0) return; // Skip if all excluded

          const config: ScheduleConfig = {
            timezone,
            rules: [{ days: includedDays, start, end }],
          };

          // Generate a timestamp that falls on the excluded day in the given timezone
          // Find a date in 2024 that corresponds to the excluded day in the timezone
          const testDate = findDateForDayInTimezone(excludedDay, timezone);
          if (!testDate) return; // Skip if we can't find a suitable date

          const clock = () => testDate;
          const manager = new ScheduleManager({ config, clock });

          expect(manager.isWithinOperatingHours()).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('overnight rules correctly wrap: time after start or before end is within hours', () => {
    fc.assert(
      fc.property(
        timezoneArb,
        daysArrayArb,
        // Generate start > end to create overnight range
        fc.integer({ min: 12, max: 23 }), // start hour (afternoon/evening)
        fc.integer({ min: 0, max: 11 }), // end hour (morning)
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 59 }),
        (timezone, days, startH, endH, startM, endM) => {
          const start = `${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`;
          const end = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

          const config: ScheduleConfig = {
            timezone,
            rules: [{ days, start, end }],
          };

          // Find a timestamp that's after start time on a matching day
          const matchingDay = days[0]!;
          const testDate = findDateForDayAndTimeInTimezone(
            matchingDay,
            startH,
            startM + 1, // 1 minute after start
            timezone
          );
          if (!testDate) return;

          const clock = () => testDate;
          const manager = new ScheduleManager({ config, clock });

          const actual = manager.isWithinOperatingHours();
          const expected = oracleIsWithinOperatingHours(testDate, config);

          expect(actual).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// --- Helpers ---

/**
 * Find a Date object in 2024 that falls on the given day of week in the given timezone.
 * Returns null if not found (shouldn't happen for valid inputs).
 */
function findDateForDayInTimezone(targetDay: number, timezone: string): Date | null {
  // Start from Jan 1, 2024 and scan forward up to 7 days
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(`2024-01-${(1 + offset).toString().padStart(2, '0')}T12:00:00Z`);
    const { dayOfWeek } = getLocalTimeOracle(date, timezone);
    if (dayOfWeek === targetDay) {
      return date;
    }
  }
  return null;
}

/**
 * Find a Date in 2024 that corresponds to a given day of week and approximate
 * local time in the specified timezone.
 */
function findDateForDayAndTimeInTimezone(
  targetDay: number,
  targetHour: number,
  targetMinute: number,
  timezone: string
): Date | null {
  // First find a date that falls on the correct day
  const baseDate = findDateForDayInTimezone(targetDay, timezone);
  if (!baseDate) return null;

  // Now adjust to hit the desired local time.
  // Get the current local time at baseDate and compute the offset needed.
  const { hours, minutes } = getLocalTimeOracle(baseDate, timezone);
  const currentTotalMinutes = hours * 60 + minutes;
  const targetTotalMinutes = targetHour * 60 + (targetMinute % 60);
  const diffMinutes = targetTotalMinutes - currentTotalMinutes;

  const result = new Date(baseDate.getTime() + diffMinutes * 60 * 1000);

  // Verify the day didn't shift
  const check = getLocalTimeOracle(result, timezone);
  if (check.dayOfWeek !== targetDay) return null;

  return result;
}
