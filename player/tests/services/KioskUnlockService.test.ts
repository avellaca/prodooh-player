import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalConfigStore } from '../../src/storage/LocalConfigStore';
import {
  KioskUnlockService,
  hashPassword,
  KIOSK_PASSWORD_HASH_KEY,
  DEFAULT_KIOSK_PASSWORD,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
} from '../../src/services/KioskUnlockService';

/**
 * Tests for KioskUnlockService — password validation, hashing, and lockout.
 *
 * Validates: Requirements 14.3, 14.5
 */

describe('KioskUnlockService', () => {
  let configStore: LocalConfigStore;
  let service: KioskUnlockService;

  beforeEach(() => {
    // Use in-memory SQLite database for testing
    configStore = new LocalConfigStore(':memory:');
    service = new KioskUnlockService({ configStore });
  });

  afterEach(() => {
    configStore.close();
  });

  describe('hashPassword()', () => {
    it('should produce a 64-character hex string (SHA-256)', async () => {
      const hash = await hashPassword('test-password');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce consistent hashes for the same input', async () => {
      const hash1 = await hashPassword('my-password');
      const hash2 = await hashPassword('my-password');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', async () => {
      const hash1 = await hashPassword('password-a');
      const hash2 = await hashPassword('password-b');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', async () => {
      const hash = await hashPassword('');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should handle unicode characters', async () => {
      const hash = await hashPassword('contraseña-🔑');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('setPassword()', () => {
    it('should store password hash in device_config', async () => {
      await service.setPassword('secure-password');
      const stored = configStore.get(KIOSK_PASSWORD_HASH_KEY);
      expect(stored).not.toBeNull();
      expect(stored).toHaveLength(64);
    });

    it('should never store plaintext password', async () => {
      const password = 'my-secret-123';
      await service.setPassword(password);
      const stored = configStore.get(KIOSK_PASSWORD_HASH_KEY);
      expect(stored).not.toBe(password);
      expect(stored).not.toContain(password);
    });

    it('should store the SHA-256 hash of the password', async () => {
      const password = 'test-password';
      await service.setPassword(password);
      const stored = configStore.get(KIOSK_PASSWORD_HASH_KEY);
      const expectedHash = await hashPassword(password);
      expect(stored).toBe(expectedHash);
    });

    it('should overwrite existing password hash', async () => {
      await service.setPassword('first-password');
      const firstHash = configStore.get(KIOSK_PASSWORD_HASH_KEY);

      await service.setPassword('second-password');
      const secondHash = configStore.get(KIOSK_PASSWORD_HASH_KEY);

      expect(firstHash).not.toBe(secondHash);
    });
  });

  describe('hasPassword()', () => {
    it('should return false when no password is configured', () => {
      expect(service.hasPassword()).toBe(false);
    });

    it('should return true after setPassword()', async () => {
      await service.setPassword('some-password');
      expect(service.hasPassword()).toBe(true);
    });
  });

  describe('unlock()', () => {
    beforeEach(async () => {
      await service.setPassword('correct-password');
    });

    it('should return success for correct password', async () => {
      const result = await service.unlock('correct-password');
      expect(result.success).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return failure for incorrect password', async () => {
      const result = await service.unlock('wrong-password');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_password');
    });

    it('should report remaining attempts on failure', async () => {
      const result = await service.unlock('wrong-password');
      expect(result.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS - 1);
    });

    it('should decrement remaining attempts on each failure', async () => {
      const result1 = await service.unlock('wrong');
      expect(result1.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS - 1);

      const result2 = await service.unlock('wrong');
      expect(result2.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS - 2);

      const result3 = await service.unlock('wrong');
      expect(result3.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS - 3);
    });

    it('should reset failed attempts after successful unlock', async () => {
      // Fail a few times
      await service.unlock('wrong');
      await service.unlock('wrong');
      expect(service.getFailedAttempts()).toBe(2);

      // Succeed
      await service.unlock('correct-password');
      expect(service.getFailedAttempts()).toBe(0);

      // Next failure should show full remaining attempts
      const result = await service.unlock('wrong');
      expect(result.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS - 1);
    });

    it('should return no_password_configured when no hash is stored', async () => {
      const emptyStore = new LocalConfigStore(':memory:');
      const emptyService = new KioskUnlockService({ configStore: emptyStore });

      const result = await emptyService.unlock('any-password');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('no_password_configured');

      emptyStore.close();
    });
  });

  describe('lockout mechanism', () => {
    beforeEach(async () => {
      await service.setPassword('correct-password');
    });

    it('should lock out after max failed attempts', async () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await service.unlock('wrong');
      }

      const result = await service.unlock('correct-password');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('locked_out');
      expect(result.lockoutEndsAt).toBeDefined();
    });

    it('should include lockout end time', async () => {
      const before = Date.now();
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await service.unlock('wrong');
      }
      const after = Date.now();

      const result = await service.unlock('anything');
      expect(result.lockoutEndsAt).toBeGreaterThanOrEqual(before + LOCKOUT_DURATION_MS);
      expect(result.lockoutEndsAt).toBeLessThanOrEqual(after + LOCKOUT_DURATION_MS + 100);
    });

    it('should unlock after lockout expires', async () => {
      // Trigger lockout
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await service.unlock('wrong');
      }

      // Simulate time passing beyond lockout
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + LOCKOUT_DURATION_MS + 1);

      const result = await service.unlock('correct-password');
      expect(result.success).toBe(true);

      vi.useRealTimers();
    });

    it('should support custom lockout configuration', async () => {
      const customService = new KioskUnlockService({
        configStore,
        maxFailedAttempts: 3,
        lockoutDurationMs: 1000,
      });

      // Should lock out after 3 attempts
      for (let i = 0; i < 3; i++) {
        await customService.unlock('wrong');
      }

      const result = await customService.unlock('correct-password');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('locked_out');
    });

    it('should reset lockout state on resetLockout()', async () => {
      // Trigger lockout
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await service.unlock('wrong');
      }

      service.resetLockout();

      const result = await service.unlock('correct-password');
      expect(result.success).toBe(true);
    });
  });

  describe('provisionDefaultPassword()', () => {
    it('should set default password when none exists', async () => {
      expect(service.hasPassword()).toBe(false);
      await service.provisionDefaultPassword();
      expect(service.hasPassword()).toBe(true);
    });

    it('should allow unlock with default password after provisioning', async () => {
      await service.provisionDefaultPassword();
      const result = await service.unlock(DEFAULT_KIOSK_PASSWORD);
      expect(result.success).toBe(true);
    });

    it('should not overwrite existing password', async () => {
      await service.setPassword('custom-password');
      const hashBefore = configStore.get(KIOSK_PASSWORD_HASH_KEY);

      await service.provisionDefaultPassword();
      const hashAfter = configStore.get(KIOSK_PASSWORD_HASH_KEY);

      expect(hashAfter).toBe(hashBefore);
    });
  });

  describe('changePassword()', () => {
    beforeEach(async () => {
      await service.setPassword('old-password');
    });

    it('should change password when current password is correct', async () => {
      const changed = await service.changePassword('old-password', 'new-password');
      expect(changed).toBe(true);

      const result = await service.unlock('new-password');
      expect(result.success).toBe(true);
    });

    it('should reject change when current password is incorrect', async () => {
      const changed = await service.changePassword('wrong-password', 'new-password');
      expect(changed).toBe(false);

      // Old password should still work
      const result = await service.unlock('old-password');
      expect(result.success).toBe(true);
    });

    it('should not allow login with old password after change', async () => {
      await service.changePassword('old-password', 'new-password');

      const result = await service.unlock('old-password');
      expect(result.success).toBe(false);
    });
  });

  describe('security properties', () => {
    it('should never have plaintext password in storage', async () => {
      const password = 'super-secret-password-123';
      await service.setPassword(password);

      // Check the stored value is not the plaintext
      const stored = configStore.get(KIOSK_PASSWORD_HASH_KEY);
      expect(stored).not.toBe(password);
      expect(stored).toHaveLength(64); // SHA-256 hex
    });

    it('should be case-sensitive for password comparison', async () => {
      await service.setPassword('MyPassword');

      const result1 = await service.unlock('MyPassword');
      expect(result1.success).toBe(true);

      const result2 = await service.unlock('mypassword');
      expect(result2.success).toBe(false);

      const result3 = await service.unlock('MYPASSWORD');
      expect(result3.success).toBe(false);
    });

    it('should handle very long passwords', async () => {
      const longPassword = 'a'.repeat(1000);
      await service.setPassword(longPassword);

      const result = await service.unlock(longPassword);
      expect(result.success).toBe(true);
    });

    it('should handle special characters in passwords', async () => {
      const specialPassword = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`"\'\\';
      await service.setPassword(specialPassword);

      const result = await service.unlock(specialPassword);
      expect(result.success).toBe(true);
    });
  });
});
