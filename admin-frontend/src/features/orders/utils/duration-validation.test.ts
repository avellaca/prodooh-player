import { describe, it, expect } from 'vitest';
import {
  resolveSlotDuration,
  exceedsSlotDuration,
  checkVideoDurationWithScreens,
  DEFAULT_SLOT_DURATION_SECONDS,
} from './duration-validation';

describe('duration-validation', () => {
  describe('DEFAULT_SLOT_DURATION_SECONDS', () => {
    it('should be 10', () => {
      expect(DEFAULT_SLOT_DURATION_SECONDS).toBe(10);
    });
  });

  describe('resolveSlotDuration', () => {
    it('returns group duration when screen has a group with duration', () => {
      const screen = {
        screen_group: { duration_seconds: 15 } as any,
        tenant: { default_duration_seconds: 20 } as any,
      };
      expect(resolveSlotDuration(screen)).toBe(15);
    });

    it('returns tenant default when group has no duration', () => {
      const screen = {
        screen_group: { duration_seconds: null } as any,
        tenant: { default_duration_seconds: 20 } as any,
      };
      expect(resolveSlotDuration(screen)).toBe(20);
    });

    it('returns tenant default when screen has no group', () => {
      const screen = {
        screen_group: undefined,
        tenant: { default_duration_seconds: 8 } as any,
      };
      expect(resolveSlotDuration(screen)).toBe(8);
    });

    it('returns 10s default when no group and no tenant duration', () => {
      const screen = {
        screen_group: undefined,
        tenant: { default_duration_seconds: null } as any,
      };
      expect(resolveSlotDuration(screen)).toBe(10);
    });

    it('returns 10s default when screen has no group and no tenant', () => {
      const screen = {
        screen_group: undefined,
        tenant: undefined,
      };
      expect(resolveSlotDuration(screen)).toBe(10);
    });
  });

  describe('exceedsSlotDuration', () => {
    it('returns true when video duration exceeds slot duration', () => {
      const content = { duration_seconds: 15, mime_type: 'video/mp4' };
      expect(exceedsSlotDuration(content, 10)).toBe(true);
    });

    it('returns false when video duration equals slot duration', () => {
      const content = { duration_seconds: 10, mime_type: 'video/mp4' };
      expect(exceedsSlotDuration(content, 10)).toBe(false);
    });

    it('returns false when video duration is less than slot duration', () => {
      const content = { duration_seconds: 5, mime_type: 'video/mp4' };
      expect(exceedsSlotDuration(content, 10)).toBe(false);
    });

    it('returns false for image content', () => {
      const content = { duration_seconds: 15, mime_type: 'image/png' };
      expect(exceedsSlotDuration(content, 10)).toBe(false);
    });

    it('returns false when duration_seconds is null', () => {
      const content = { duration_seconds: null, mime_type: 'video/mp4' };
      expect(exceedsSlotDuration(content, 10)).toBe(false);
    });

    it('uses default 10s slot when no slotDurationSeconds provided', () => {
      const content = { duration_seconds: 11, mime_type: 'video/mp4' };
      expect(exceedsSlotDuration(content)).toBe(true);
    });

    it('returns false when duration is under default 10s', () => {
      const content = { duration_seconds: 9, mime_type: 'video/mp4' };
      expect(exceedsSlotDuration(content)).toBe(false);
    });
  });

  describe('checkVideoDurationWithScreens', () => {
    it('returns null for non-video content', () => {
      const content = { duration_seconds: 20, mime_type: 'image/jpeg' };
      const screens = [
        { name: 'Screen A', screen_group: undefined, tenant: undefined },
      ];
      expect(checkVideoDurationWithScreens(content, screens)).toBeNull();
    });

    it('returns null when video does not exceed any screen slot', () => {
      const content = { duration_seconds: 8, mime_type: 'video/mp4' };
      const screens = [
        {
          name: 'Screen A',
          screen_group: { duration_seconds: 15 } as any,
          tenant: undefined,
        },
      ];
      expect(checkVideoDurationWithScreens(content, screens)).toBeNull();
    });

    it('returns warning when video exceeds at least one screen slot', () => {
      const content = { duration_seconds: 12, mime_type: 'video/mp4' };
      const screens = [
        {
          name: 'Screen A',
          screen_group: { duration_seconds: 15 } as any,
          tenant: undefined,
        },
        {
          name: 'Screen B',
          screen_group: { duration_seconds: null } as any,
          tenant: { default_duration_seconds: null } as any,
        },
      ];

      const result = checkVideoDurationWithScreens(content, screens);
      expect(result).not.toBeNull();
      expect(result!.videoDuration).toBe(12);
      expect(result!.screens).toHaveLength(1);
      expect(result!.screens[0].name).toBe('Screen B');
      expect(result!.screens[0].slotDuration).toBe(10);
    });

    it('returns all exceeding screens in the warning', () => {
      const content = { duration_seconds: 20, mime_type: 'video/webm' };
      const screens = [
        {
          name: 'Screen A',
          screen_group: { duration_seconds: 10 } as any,
          tenant: undefined,
        },
        {
          name: 'Screen B',
          screen_group: { duration_seconds: 15 } as any,
          tenant: undefined,
        },
      ];

      const result = checkVideoDurationWithScreens(content, screens);
      expect(result).not.toBeNull();
      expect(result!.screens).toHaveLength(2);
    });

    it('returns null when content has no duration', () => {
      const content = { duration_seconds: null, mime_type: 'video/mp4' };
      const screens = [
        { name: 'Screen A', screen_group: undefined, tenant: undefined },
      ];
      expect(checkVideoDurationWithScreens(content, screens)).toBeNull();
    });
  });
});
