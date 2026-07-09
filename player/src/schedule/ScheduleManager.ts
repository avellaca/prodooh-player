/**
 * ScheduleManager — Enforces operating hours for the player.
 *
 * Evaluates isWithinOperatingHours() using timezone-aware schedule rules.
 * Supports per-day schedules (different hours per day of week).
 * Defaults to 24/7 if no schedule is configured.
 * Enters/exits sleep mode at schedule boundaries.
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */

import type { ScheduleChecker } from '../engine/LoopEngine';
import type { ScheduleConfig, ScheduleRule } from '../storage/types';

export interface ScheduleManagerOptions {
  /** Schedule configuration. Null means 24/7 operation. */
  config: ScheduleConfig | null;
  /** Injectable clock for testing. Defaults to () => new Date(). */
  clock?: () => Date;
}

/**
 * ScheduleManager implements the ScheduleChecker interface from LoopEngine.
 * It determines whether the player should be active based on timezone-aware
 * schedule rules with per-day granularity.
 */
export class ScheduleManager implements ScheduleChecker {
  private config: ScheduleConfig | null;
  private clock: () => Date;
  private wasSleeping: boolean = false;

  constructor(options: ScheduleManagerOptions) {
    this.config = options.config;
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Returns true if the current time is within operating hours.
   * If no schedule is configured, always returns true (24/7 mode per Req 16.6).
   */
  isWithinOperatingHours(): boolean {
    // Req 16.6: Default to 24/7 if no schedule configured
    if (!this.config || this.config.rules.length === 0) {
      return true;
    }

    const now = this.clock();
    const { timezone, rules } = this.config;

    // Get current day and time in the configured timezone (Req 16.3)
    const { dayOfWeek, hours, minutes } = this.getLocalTime(now, timezone);

    // Check if any rule applies to the current day and time (Req 16.2, 16.5)
    const withinHours = this.matchesAnyRule(dayOfWeek, hours, minutes, rules);

    // Track sleep/wake transitions (Req 16.4, 16.5)
    const currentlySleeping = !withinHours;
    if (this.wasSleeping && !currentlySleeping) {
      // Transition from sleep to active (Req 16.4)
      this.wasSleeping = false;
    } else if (!this.wasSleeping && currentlySleeping) {
      // Transition from active to sleep (Req 16.5)
      this.wasSleeping = true;
    }

    return withinHours;
  }

  /**
   * Updates the schedule configuration at runtime.
   * Takes effect on the next isWithinOperatingHours() call.
   */
  updateConfig(config: ScheduleConfig | null): void {
    this.config = config;
  }

  /**
   * Returns the current schedule configuration.
   */
  getConfig(): ScheduleConfig | null {
    return this.config;
  }

  /**
   * Returns whether the manager is currently tracking a sleep state.
   */
  isSleeping(): boolean {
    return this.wasSleeping;
  }

  /**
   * Get the local time in a specific timezone.
   * Returns day of week (0=Sunday, 6=Saturday), hours (0-23), and minutes (0-59).
   */
  private getLocalTime(
    date: Date,
    timezone: string
  ): { dayOfWeek: number; hours: number; minutes: number } {
    // Use Intl.DateTimeFormat to get timezone-aware components
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
        dayOfWeek = this.weekdayToNumber(part.value);
      } else if (part.type === 'hour') {
        hours = parseInt(part.value, 10);
        // Handle midnight: Intl formats it as 24 in some locales
        if (hours === 24) hours = 0;
      } else if (part.type === 'minute') {
        minutes = parseInt(part.value, 10);
      }
    }

    return { dayOfWeek, hours, minutes };
  }

  /**
   * Check if the given time matches any of the schedule rules.
   * A rule matches if:
   * 1. The current day is in the rule's days array
   * 2. The current time is between start and end (inclusive start, exclusive end)
   *
   * Supports overnight spans (e.g., start: "22:00", end: "06:00")
   */
  private matchesAnyRule(
    dayOfWeek: number,
    hours: number,
    minutes: number,
    rules: ScheduleRule[]
  ): boolean {
    const currentMinutes = hours * 60 + minutes;

    for (const rule of rules) {
      if (!rule.days.includes(dayOfWeek)) {
        continue;
      }

      const [startH, startM] = this.parseTime(rule.start);
      const [endH, endM] = this.parseTime(rule.end);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (startMinutes <= endMinutes) {
        // Normal range: e.g., 08:00 to 20:00
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
          return true;
        }
      } else {
        // Overnight range: e.g., 22:00 to 06:00
        // Active if current time >= start OR current time < end
        if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Parse a time string "HH:mm" into [hours, minutes].
   */
  private parseTime(time: string): [number, number] {
    const [h, m] = time.split(':').map(Number);
    return [h ?? 0, m ?? 0];
  }

  /**
   * Convert short weekday name to number (0=Sunday, 6=Saturday).
   */
  private weekdayToNumber(weekday: string): number {
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[weekday] ?? 0;
  }
}
