import { describe, it, expect } from 'vitest';
import { ScheduleManager } from '../../src/schedule/ScheduleManager';
import type { ScheduleConfig } from '../../src/storage/types';

/**
 * Unit tests for ScheduleManager — operating hours enforcement.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */

/**
 * Helper to create a Date at a specific time in a given timezone.
 * We construct dates by working backward from the desired local time.
 */
function makeClock(isoString: string): () => Date {
  return () => new Date(isoString);
}

describe('ScheduleManager', () => {
  describe('24/7 default mode (Req 16.6)', () => {
    it('should return true when config is null', () => {
      const manager = new ScheduleManager({ config: null });
      expect(manager.isWithinOperatingHours()).toBe(true);
    });

    it('should return true when rules array is empty', () => {
      const config: ScheduleConfig = {
        timezone: 'America/New_York',
        rules: [],
      };
      const manager = new ScheduleManager({ config });
      expect(manager.isWithinOperatingHours()).toBe(true);
    });
  });

  describe('basic schedule evaluation (Req 16.1, 16.2)', () => {
    it('should return true when within operating hours', () => {
      // Wednesday 2024-01-10 at 14:00 UTC = 09:00 EST (America/New_York)
      const config: ScheduleConfig = {
        timezone: 'America/New_York',
        rules: [{ days: [3], start: '08:00', end: '20:00' }], // Wednesday
      };
      const clock = makeClock('2024-01-10T14:00:00Z'); // Wed 09:00 EST
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(true);
    });

    it('should return false when outside operating hours', () => {
      // Wednesday 2024-01-10 at 02:00 UTC = 21:00 EST (previous day Tue)
      // Actually let's use a clearer example:
      // Wednesday 2024-01-10 at 23:00 EST → 2024-01-11T04:00:00Z
      const config: ScheduleConfig = {
        timezone: 'America/New_York',
        rules: [{ days: [3], start: '08:00', end: '20:00' }], // Wednesday
      };
      // This is Thursday in UTC but still Wednesday 23:00 in EST? No.
      // 2024-01-11T04:00:00Z = 2024-01-10 23:00 EST (Wednesday)
      // Day is Wednesday (3), time is 23:00, outside 08:00-20:00
      const clock = makeClock('2024-01-11T04:00:00Z');
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(false);
    });

    it('should return false when day does not match', () => {
      // 2024-01-10 is Wednesday (day 3)
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [{ days: [1, 2], start: '08:00', end: '20:00' }], // Mon, Tue only
      };
      const clock = makeClock('2024-01-10T12:00:00Z'); // Wednesday 12:00 UTC
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(false);
    });
  });

  describe('per-day schedules (Req 16.2)', () => {
    it('should support different hours per day of week', () => {
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [
          { days: [1, 2, 3, 4, 5], start: '08:00', end: '20:00' }, // Mon-Fri
          { days: [6], start: '10:00', end: '18:00' }, // Saturday
          // Sunday: no rule → inactive
        ],
      };

      // Monday at 12:00 → within hours
      const monClock = makeClock('2024-01-08T12:00:00Z'); // Monday
      const monManager = new ScheduleManager({ config, clock: monClock });
      expect(monManager.isWithinOperatingHours()).toBe(true);

      // Saturday at 14:00 → within hours
      const satClock = makeClock('2024-01-13T14:00:00Z'); // Saturday
      const satManager = new ScheduleManager({ config, clock: satClock });
      expect(satManager.isWithinOperatingHours()).toBe(true);

      // Saturday at 19:00 → outside hours (after 18:00)
      const satLateClock = makeClock('2024-01-13T19:00:00Z'); // Saturday 19:00
      const satLateManager = new ScheduleManager({ config, clock: satLateClock });
      expect(satLateManager.isWithinOperatingHours()).toBe(false);

      // Sunday at 12:00 → no rule, inactive
      const sunClock = makeClock('2024-01-14T12:00:00Z'); // Sunday
      const sunManager = new ScheduleManager({ config, clock: sunClock });
      expect(sunManager.isWithinOperatingHours()).toBe(false);
    });
  });

  describe('timezone-aware evaluation (Req 16.3)', () => {
    it('should evaluate schedule in the configured timezone', () => {
      // 2024-01-10T20:00:00Z = 2024-01-10 15:00 in America/New_York (EST = UTC-5)
      const config: ScheduleConfig = {
        timezone: 'America/New_York',
        rules: [{ days: [3], start: '08:00', end: '20:00' }], // Wednesday
      };
      const clock = makeClock('2024-01-10T20:00:00Z'); // 15:00 EST
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(true);
    });

    it('should handle time zones that shift the day', () => {
      // 2024-01-11T03:00:00Z = 2024-01-10 22:00 EST (still Wednesday)
      // The rule is for Wednesday (day 3), 08:00-20:00
      // 22:00 is outside → should be false
      const config: ScheduleConfig = {
        timezone: 'America/New_York',
        rules: [{ days: [3], start: '08:00', end: '20:00' }], // Wednesday
      };
      const clock = makeClock('2024-01-11T03:00:00Z'); // Wed 22:00 EST
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(false);
    });

    it('should handle positive UTC offset timezones', () => {
      // 2024-01-10T06:00:00Z = 2024-01-10 15:00 in Asia/Tokyo (JST = UTC+9)
      // Wednesday (day 3), 15:00 JST, rule 09:00-18:00 → within hours
      const config: ScheduleConfig = {
        timezone: 'Asia/Tokyo',
        rules: [{ days: [3], start: '09:00', end: '18:00' }],
      };
      const clock = makeClock('2024-01-10T06:00:00Z'); // 15:00 JST
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(true);
    });
  });

  describe('boundary conditions', () => {
    it('should include start time (inclusive)', () => {
      // Exactly at start time → should be within hours
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [{ days: [3], start: '08:00', end: '20:00' }],
      };
      const clock = makeClock('2024-01-10T08:00:00Z'); // Wednesday 08:00 UTC
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(true);
    });

    it('should exclude end time (exclusive)', () => {
      // Exactly at end time → should be outside hours
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [{ days: [3], start: '08:00', end: '20:00' }],
      };
      const clock = makeClock('2024-01-10T20:00:00Z'); // Wednesday 20:00 UTC
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(false);
    });

    it('should handle overnight schedule (start > end)', () => {
      // Rule: 22:00 to 06:00 (overnight)
      // At 23:00 → should be within hours
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [{ days: [3], start: '22:00', end: '06:00' }], // Wednesday night shift
      };
      const clock = makeClock('2024-01-10T23:00:00Z'); // Wednesday 23:00 UTC
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(true);
    });

    it('should handle overnight schedule at early morning', () => {
      // Rule: 22:00 to 06:00 for Wednesday
      // At Wednesday 02:00 → should be within hours (before end)
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [{ days: [3], start: '22:00', end: '06:00' }],
      };
      const clock = makeClock('2024-01-10T02:00:00Z'); // Wednesday 02:00 UTC
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(true);
    });

    it('should handle midnight boundary', () => {
      // Rule: 00:00 to 23:59 (almost all day)
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [{ days: [3], start: '00:00', end: '23:59' }],
      };
      const clock = makeClock('2024-01-10T00:00:00Z'); // Wednesday 00:00 UTC
      const manager = new ScheduleManager({ config, clock });

      expect(manager.isWithinOperatingHours()).toBe(true);
    });
  });

  describe('sleep/wake transitions (Req 16.4, 16.5)', () => {
    it('should track transition from active to sleep', () => {
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [{ days: [3], start: '08:00', end: '20:00' }],
      };
      let currentTime = new Date('2024-01-10T12:00:00Z'); // Within hours
      const manager = new ScheduleManager({
        config,
        clock: () => currentTime,
      });

      // Initially within hours
      expect(manager.isWithinOperatingHours()).toBe(true);
      expect(manager.isSleeping()).toBe(false);

      // Move to outside hours
      currentTime = new Date('2024-01-10T21:00:00Z');
      expect(manager.isWithinOperatingHours()).toBe(false);
      expect(manager.isSleeping()).toBe(true);
    });

    it('should track transition from sleep to active (Req 16.4)', () => {
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [{ days: [3], start: '08:00', end: '20:00' }],
      };
      let currentTime = new Date('2024-01-10T06:00:00Z'); // Outside hours
      const manager = new ScheduleManager({
        config,
        clock: () => currentTime,
      });

      // Initially outside hours
      expect(manager.isWithinOperatingHours()).toBe(false);
      expect(manager.isSleeping()).toBe(true);

      // Move to within hours
      currentTime = new Date('2024-01-10T10:00:00Z');
      expect(manager.isWithinOperatingHours()).toBe(true);
      expect(manager.isSleeping()).toBe(false);
    });
  });

  describe('updateConfig()', () => {
    it('should accept new config and use it immediately', () => {
      const manager = new ScheduleManager({
        config: null,
        clock: makeClock('2024-01-10T12:00:00Z'), // Wednesday
      });

      // Initially 24/7
      expect(manager.isWithinOperatingHours()).toBe(true);

      // Update to a restrictive schedule that excludes current time
      manager.updateConfig({
        timezone: 'UTC',
        rules: [{ days: [3], start: '20:00', end: '22:00' }], // Only 20:00-22:00
      });

      // Now should be outside hours (12:00 not in 20:00-22:00)
      expect(manager.isWithinOperatingHours()).toBe(false);
    });

    it('should support switching back to 24/7 by setting config to null', () => {
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [{ days: [3], start: '20:00', end: '22:00' }],
      };
      const manager = new ScheduleManager({
        config,
        clock: makeClock('2024-01-10T12:00:00Z'),
      });

      expect(manager.isWithinOperatingHours()).toBe(false);

      manager.updateConfig(null);
      expect(manager.isWithinOperatingHours()).toBe(true);
    });
  });

  describe('multiple overlapping rules', () => {
    it('should return true if any rule matches', () => {
      // Two rules: one for morning, one for evening
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [
          { days: [3], start: '08:00', end: '12:00' },
          { days: [3], start: '14:00', end: '18:00' },
        ],
      };

      // 10:00 → first rule matches
      const clock1 = makeClock('2024-01-10T10:00:00Z');
      const manager1 = new ScheduleManager({ config, clock: clock1 });
      expect(manager1.isWithinOperatingHours()).toBe(true);

      // 15:00 → second rule matches
      const clock2 = makeClock('2024-01-10T15:00:00Z');
      const manager2 = new ScheduleManager({ config, clock: clock2 });
      expect(manager2.isWithinOperatingHours()).toBe(true);

      // 13:00 → neither rule matches (lunch break)
      const clock3 = makeClock('2024-01-10T13:00:00Z');
      const manager3 = new ScheduleManager({ config, clock: clock3 });
      expect(manager3.isWithinOperatingHours()).toBe(false);
    });
  });

  describe('getConfig()', () => {
    it('should return the current config', () => {
      const config: ScheduleConfig = {
        timezone: 'UTC',
        rules: [{ days: [1], start: '08:00', end: '20:00' }],
      };
      const manager = new ScheduleManager({ config });
      expect(manager.getConfig()).toBe(config);
    });

    it('should return null when no config set', () => {
      const manager = new ScheduleManager({ config: null });
      expect(manager.getConfig()).toBeNull();
    });
  });
});
