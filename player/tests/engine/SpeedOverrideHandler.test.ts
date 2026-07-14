/**
 * Unit tests for SpeedOverrideHandler.
 *
 * Validates: Requirements 20.4, 20.5, 20.8
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SpeedOverrideHandler } from '../../src/engine/SpeedOverrideHandler';
import type { DeviceCommand } from '../../src/sync/HeartbeatService';

// --- Helpers ---

function createSpeedOverrideCommand(factor: unknown, expiresAt: string): DeviceCommand {
  return {
    id: 'cmd-1',
    type: 'speed_override',
    payload: { factor, expires_at: expiresAt },
  };
}

describe('SpeedOverrideHandler', () => {
  let handler: SpeedOverrideHandler;
  let currentTime: number;

  beforeEach(() => {
    currentTime = new Date('2025-01-15T12:00:00Z').getTime();
    handler = new SpeedOverrideHandler({ now: () => currentTime });
  });

  describe('handleCommand', () => {
    it('activates speed override with valid factor 2', () => {
      const cmd = createSpeedOverrideCommand(2, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      expect(handler.isActive()).toBe(true);
      expect(handler.getFactor()).toBe(2);
    });

    it('activates speed override with valid factor 4', () => {
      const cmd = createSpeedOverrideCommand(4, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      expect(handler.isActive()).toBe(true);
      expect(handler.getFactor()).toBe(4);
    });

    it('ignores command if expires_at has already passed', () => {
      const cmd = createSpeedOverrideCommand(2, '2025-01-15T11:59:00Z');
      handler.handleCommand(cmd);

      expect(handler.isActive()).toBe(false);
      expect(handler.getFactor()).toBe(1);
    });

    it('clears override when factor is 1', () => {
      // First activate
      const activateCmd = createSpeedOverrideCommand(2, '2025-01-15T12:10:00Z');
      handler.handleCommand(activateCmd);
      expect(handler.isActive()).toBe(true);

      // Then deactivate with factor=1
      const deactivateCmd = createSpeedOverrideCommand(1, '2025-01-15T12:10:00Z');
      handler.handleCommand(deactivateCmd);

      expect(handler.isActive()).toBe(false);
      expect(handler.getFactor()).toBe(1);
    });

    it('defaults to factor 1 (no effect) when factor is invalid', () => {
      const cmd = createSpeedOverrideCommand(3, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      // Invalid factor defaults to 1, which clears override
      expect(handler.isActive()).toBe(false);
      expect(handler.getFactor()).toBe(1);
    });

    it('defaults to factor 1 when factor is not a number', () => {
      const cmd = createSpeedOverrideCommand('fast', '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      expect(handler.isActive()).toBe(false);
    });

    it('ignores command with invalid expires_at date', () => {
      const cmd = createSpeedOverrideCommand(2, 'not-a-date');
      handler.handleCommand(cmd);

      expect(handler.isActive()).toBe(false);
    });

    it('ignores command with missing expires_at', () => {
      const cmd: DeviceCommand = {
        id: 'cmd-1',
        type: 'speed_override',
        payload: { factor: 2 },
      };
      handler.handleCommand(cmd);

      expect(handler.isActive()).toBe(false);
    });

    it('ignores commands of other types', () => {
      const cmd: DeviceCommand = {
        id: 'cmd-1',
        type: 'screenshot',
        payload: {},
      };
      handler.handleCommand(cmd);

      expect(handler.isActive()).toBe(false);
    });
  });

  describe('auto-expiration', () => {
    it('expires automatically when expires_at is reached', () => {
      const cmd = createSpeedOverrideCommand(2, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);
      expect(handler.isActive()).toBe(true);

      // Advance time past expiry
      currentTime = new Date('2025-01-15T12:10:01Z').getTime();
      expect(handler.isActive()).toBe(false);
      expect(handler.getFactor()).toBe(1);
    });

    it('remains active before expires_at', () => {
      const cmd = createSpeedOverrideCommand(4, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      // Time is still before expiry
      currentTime = new Date('2025-01-15T12:09:59Z').getTime();
      expect(handler.isActive()).toBe(true);
      expect(handler.getFactor()).toBe(4);
    });
  });

  describe('getEffectiveDuration', () => {
    it('returns original duration when no override is active', () => {
      expect(handler.getEffectiveDuration(10)).toBe(10);
      expect(handler.getEffectiveDuration(15)).toBe(15);
    });

    it('divides duration by factor 2 using Math.ceil', () => {
      const cmd = createSpeedOverrideCommand(2, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      expect(handler.getEffectiveDuration(10)).toBe(5); // 10/2 = 5
      expect(handler.getEffectiveDuration(11)).toBe(6); // ceil(11/2) = 6
      expect(handler.getEffectiveDuration(1)).toBe(1);  // ceil(1/2) = 1
    });

    it('divides duration by factor 4 using Math.ceil', () => {
      const cmd = createSpeedOverrideCommand(4, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      expect(handler.getEffectiveDuration(10)).toBe(3); // ceil(10/4) = 3
      expect(handler.getEffectiveDuration(8)).toBe(2);  // 8/4 = 2
      expect(handler.getEffectiveDuration(1)).toBe(1);  // ceil(1/4) = 1
      expect(handler.getEffectiveDuration(5)).toBe(2);  // ceil(5/4) = 2
    });

    it('restores original duration after expiry', () => {
      const cmd = createSpeedOverrideCommand(2, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);
      expect(handler.getEffectiveDuration(10)).toBe(5);

      // Advance past expiry
      currentTime = new Date('2025-01-15T12:11:00Z').getTime();
      expect(handler.getEffectiveDuration(10)).toBe(10);
    });
  });

  describe('isWitnessMode', () => {
    it('returns false when no override is active', () => {
      expect(handler.isWitnessMode()).toBe(false);
    });

    it('returns true when speed override is active', () => {
      const cmd = createSpeedOverrideCommand(2, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      expect(handler.isWitnessMode()).toBe(true);
    });

    it('returns false after override expires', () => {
      const cmd = createSpeedOverrideCommand(2, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      currentTime = new Date('2025-01-15T12:11:00Z').getTime();
      expect(handler.isWitnessMode()).toBe(false);
    });
  });

  describe('getState', () => {
    it('returns null when no override is active', () => {
      expect(handler.getState()).toBeNull();
    });

    it('returns state object when override is active', () => {
      const cmd = createSpeedOverrideCommand(2, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      const state = handler.getState();
      expect(state).not.toBeNull();
      expect(state!.factor).toBe(2);
      expect(state!.expiresAt).toEqual(new Date('2025-01-15T12:10:00Z'));
    });

    it('returns null after expiry', () => {
      const cmd = createSpeedOverrideCommand(2, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);

      currentTime = new Date('2025-01-15T12:11:00Z').getTime();
      expect(handler.getState()).toBeNull();
    });
  });

  describe('clear', () => {
    it('clears an active override', () => {
      const cmd = createSpeedOverrideCommand(4, '2025-01-15T12:10:00Z');
      handler.handleCommand(cmd);
      expect(handler.isActive()).toBe(true);

      handler.clear();
      expect(handler.isActive()).toBe(false);
      expect(handler.getFactor()).toBe(1);
    });
  });
});
