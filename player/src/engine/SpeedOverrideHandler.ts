/**
 * SpeedOverrideHandler — Manages Witness Mode speed override for the player.
 *
 * When a `speed_override` command is received via heartbeat, this handler:
 * - Validates the factor (must be 1, 2, or 4; defaults to 1 if invalid)
 * - Checks if `expires_at` has already passed (ignores if so)
 * - Stores the override state (factor + expiry)
 * - Provides `getEffectiveDuration()` to compute reduced spot durations
 * - Auto-expires when `expires_at` is reached, restoring original durations
 * - Flags impressions with `mode: 'witness'` while override is active
 *
 * Validates: Requirements 20.4, 20.5, 20.8
 */

import type { DeviceCommand } from '../sync/HeartbeatService';

/** Valid speed override factors */
const VALID_FACTORS = [1, 2, 4] as const;
export type SpeedFactor = (typeof VALID_FACTORS)[number];

export interface SpeedOverrideState {
  factor: SpeedFactor;
  expiresAt: Date;
}

export interface SpeedOverrideHandlerOptions {
  /** Injectable clock for testing (returns current time in ms) */
  now?: () => number;
}

export class SpeedOverrideHandler {
  private state: SpeedOverrideState | null = null;
  private now: () => number;

  constructor(options?: SpeedOverrideHandlerOptions) {
    this.now = options?.now ?? (() => Date.now());
  }

  /**
   * Process a speed_override command from the heartbeat response.
   *
   * - Validates factor (must be 1, 2, or 4; defaults to 1 if invalid)
   * - If expires_at has already passed → ignores the command
   * - If factor is 1 → clears any active override (restores normal)
   * - Otherwise → activates the speed override
   */
  handleCommand(command: DeviceCommand): void {
    if (command.type !== 'speed_override') return;

    const payload = command.payload as { factor?: unknown; expires_at?: unknown };

    // Parse and validate factor
    const rawFactor = Number(payload.factor);
    const factor: SpeedFactor = this.isValidFactor(rawFactor) ? rawFactor : 1;

    // If factor is 1, clear override (restore normal speed)
    if (factor === 1) {
      this.state = null;
      return;
    }

    // Parse expires_at
    const expiresAtStr = payload.expires_at;
    if (!expiresAtStr || typeof expiresAtStr !== 'string') {
      // No expiry provided → ignore command (invalid)
      this.state = null;
      return;
    }

    const expiresAt = new Date(expiresAtStr);
    if (isNaN(expiresAt.getTime())) {
      // Invalid date → ignore
      this.state = null;
      return;
    }

    // If expires_at has already passed → ignore command
    if (expiresAt.getTime() <= this.now()) {
      return;
    }

    // Activate the speed override
    this.state = { factor, expiresAt };
  }

  /**
   * Returns whether the speed override is currently active.
   * Automatically expires when the current time passes expires_at.
   */
  isActive(): boolean {
    if (!this.state) return false;

    // Check if override has expired
    if (this.now() >= this.state.expiresAt.getTime()) {
      this.state = null;
      return false;
    }

    return true;
  }

  /**
   * Returns the current speed factor (1 if no override is active).
   */
  getFactor(): SpeedFactor {
    if (!this.isActive()) return 1;
    return this.state!.factor;
  }

  /**
   * Computes the effective duration for a spot, applying the speed override.
   * Uses Math.ceil(duration_seconds / factor) per the spec.
   *
   * @param originalDuration - The original spot duration in seconds
   * @returns The effective duration (reduced if override is active)
   */
  getEffectiveDuration(originalDuration: number): number {
    const factor = this.getFactor();
    if (factor === 1) return originalDuration;
    return Math.ceil(originalDuration / factor);
  }

  /**
   * Returns whether impressions should be flagged as 'witness' mode.
   * True when the speed override is active with factor > 1.
   */
  isWitnessMode(): boolean {
    return this.isActive();
  }

  /**
   * Returns the current override state, or null if not active.
   */
  getState(): SpeedOverrideState | null {
    if (!this.isActive()) return null;
    return this.state;
  }

  /**
   * Clears any active override (used when factor=1 command is received).
   */
  clear(): void {
    this.state = null;
  }

  private isValidFactor(value: number): value is SpeedFactor {
    return VALID_FACTORS.includes(value as SpeedFactor);
  }
}
