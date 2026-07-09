/**
 * KioskUnlockService — handles kiosk mode password validation and unlock
 * sequence for authorized maintenance access.
 *
 * Uses SHA-256 hashing (via Web Crypto API) to store and validate passwords.
 * Password is never stored in plaintext — only the hash is persisted in the
 * device_config SQLite table under the key 'kiosk_password_hash'.
 *
 * Validates: Requirements 14.3, 14.5
 */

import type { LocalConfigStore } from '../storage/LocalConfigStore';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Key used in device_config table for the password hash */
export const KIOSK_PASSWORD_HASH_KEY = 'kiosk_password_hash';

/** Default password used during initial provisioning */
export const DEFAULT_KIOSK_PASSWORD = 'prodooh-maintenance';

/** Maximum number of failed attempts before lockout */
export const MAX_FAILED_ATTEMPTS = 5;

/** Lockout duration in milliseconds (5 minutes) */
export const LOCKOUT_DURATION_MS = 5 * 60 * 1000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KioskUnlockResult {
  success: boolean;
  reason?: 'invalid_password' | 'locked_out' | 'no_password_configured';
  remainingAttempts?: number;
  lockoutEndsAt?: number;
}

export interface KioskUnlockServiceOptions {
  configStore: LocalConfigStore;
  maxFailedAttempts?: number;
  lockoutDurationMs?: number;
}

// ─── Hashing Utility ─────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of the given input string.
 * Returns the hash as a lowercase hexadecimal string.
 *
 * Uses the Web Crypto API (available in both browser and Node.js 15+).
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ─── KioskUnlockService ──────────────────────────────────────────────────────

export class KioskUnlockService {
  private configStore: LocalConfigStore;
  private maxFailedAttempts: number;
  private lockoutDurationMs: number;
  private failedAttempts: number = 0;
  private lockoutUntil: number = 0;

  constructor(options: KioskUnlockServiceOptions) {
    this.configStore = options.configStore;
    this.maxFailedAttempts = options.maxFailedAttempts ?? MAX_FAILED_ATTEMPTS;
    this.lockoutDurationMs = options.lockoutDurationMs ?? LOCKOUT_DURATION_MS;
  }

  /**
   * Attempt to unlock kiosk mode with the given password.
   * Returns a result indicating success or failure with details.
   */
  async unlock(password: string): Promise<KioskUnlockResult> {
    // Check lockout state
    if (this.isLockedOut()) {
      return {
        success: false,
        reason: 'locked_out',
        lockoutEndsAt: this.lockoutUntil,
      };
    }

    // Get stored password hash
    const storedHash = this.configStore.get(KIOSK_PASSWORD_HASH_KEY);
    if (!storedHash) {
      return {
        success: false,
        reason: 'no_password_configured',
      };
    }

    // Hash the provided password and compare
    const inputHash = await hashPassword(password);
    const isValid = constantTimeEqual(inputHash, storedHash);

    if (isValid) {
      // Reset failed attempts on successful unlock
      this.failedAttempts = 0;
      this.lockoutUntil = 0;
      return { success: true };
    }

    // Track failed attempt
    this.failedAttempts++;

    // Check if lockout threshold reached
    if (this.failedAttempts >= this.maxFailedAttempts) {
      this.lockoutUntil = Date.now() + this.lockoutDurationMs;
      return {
        success: false,
        reason: 'locked_out',
        lockoutEndsAt: this.lockoutUntil,
      };
    }

    return {
      success: false,
      reason: 'invalid_password',
      remainingAttempts: this.maxFailedAttempts - this.failedAttempts,
    };
  }

  /**
   * Set or update the kiosk unlock password.
   * The password is hashed with SHA-256 before storage — plaintext is never persisted.
   */
  async setPassword(password: string): Promise<void> {
    const hash = await hashPassword(password);
    this.configStore.set(KIOSK_PASSWORD_HASH_KEY, hash);
  }

  /**
   * Check whether a password has been configured on this device.
   */
  hasPassword(): boolean {
    return this.configStore.get(KIOSK_PASSWORD_HASH_KEY) !== null;
  }

  /**
   * Provision the default kiosk password if none is configured.
   * Called during first boot to ensure the device always has a password set.
   */
  async provisionDefaultPassword(): Promise<void> {
    if (!this.hasPassword()) {
      await this.setPassword(DEFAULT_KIOSK_PASSWORD);
    }
  }

  /**
   * Change the kiosk password. Requires the current password for authorization.
   * Returns true if the password was changed, false if validation failed.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    const unlockResult = await this.unlock(currentPassword);
    if (!unlockResult.success) {
      return false;
    }
    await this.setPassword(newPassword);
    return true;
  }

  /**
   * Check if the service is currently in lockout state.
   */
  isLockedOut(): boolean {
    if (this.lockoutUntil === 0) return false;
    if (Date.now() >= this.lockoutUntil) {
      // Lockout expired, reset
      this.lockoutUntil = 0;
      this.failedAttempts = 0;
      return false;
    }
    return true;
  }

  /**
   * Get the number of failed attempts since last successful unlock.
   */
  getFailedAttempts(): number {
    return this.failedAttempts;
  }

  /**
   * Reset the lockout state. Used for testing or emergency reset.
   */
  resetLockout(): void {
    this.failedAttempts = 0;
    this.lockoutUntil = 0;
  }
}
