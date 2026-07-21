/**
 * Feature: 13-creatives-enhancements, Property 9: Validación de duración video vs slot
 *
 * For any Content of type video assigned to a screen, the system SHALL produce a warning
 * if and only if content.duration_seconds > resolveSlotDuration(screen).
 *
 * **Validates: Requirements 17.1, 17.2**
 *
 * Requirement 17.1: Compare video duration with the screen's resolved slot duration
 * Requirement 17.2: Show non-blocking warning if video exceeds slot duration
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  resolveSlotDuration,
  checkVideoDurationWithScreens,
  exceedsSlotDuration,
  DEFAULT_SLOT_DURATION_SECONDS,
} from '../utils/duration-validation';

// --- Generators ---

/** Generate a positive slot duration (1-120 seconds) */
const slotDurationArb = fc.integer({ min: 1, max: 120 });

/** Generate a ScreenGroup with optional duration_seconds */
const screenGroupArb = fc.record({
  duration_seconds: fc.option(slotDurationArb, { nil: null }),
});

/** Generate a Tenant with optional default_duration_seconds */
const tenantArb = fc.record({
  default_duration_seconds: fc.option(slotDurationArb, { nil: null }),
});

/** Generate a screen-like object with group and tenant for resolveSlotDuration */
const screenArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  screen_group: fc.option(screenGroupArb, { nil: undefined }),
  tenant: fc.option(tenantArb, { nil: undefined }),
});

/** Generate a positive video duration in seconds */
const videoDurationArb = fc.integer({ min: 1, max: 300 });

/** Generate a video mime type */
const videoMimeTypeArb = fc.constantFrom('video/mp4', 'video/webm', 'video/ogg', 'video/quicktime');

/** Generate a non-video mime type */
const nonVideoMimeTypeArb = fc.constantFrom('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf');

/** Generate video content with a known duration */
const videoContentArb = fc
  .record({
    duration_seconds: videoDurationArb,
    mime_type: videoMimeTypeArb,
  });

/** Generate non-video content */
const nonVideoContentArb = fc.record({
  duration_seconds: fc.option(fc.integer({ min: 1, max: 300 }), { nil: null }),
  mime_type: nonVideoMimeTypeArb,
});

describe('Property 9: Validación de duración video vs slot', () => {
  // =========================================================================
  // Core property: warning IFF video duration > slot duration
  // =========================================================================
  describe('checkVideoDurationWithScreens produces warning iff video > slot', () => {
    it('for any video content and any screen, a warning is produced if and only if duration > resolveSlotDuration', () => {
      fc.assert(
        fc.property(
          videoContentArb,
          fc.array(screenArb, { minLength: 1, maxLength: 10 }),
          (content, screens) => {
            const result = checkVideoDurationWithScreens(content, screens);

            // Compute expected exceeding screens
            const expectedExceeding = screens.filter(
              (s) => content.duration_seconds! > resolveSlotDuration(s)
            );

            if (expectedExceeding.length === 0) {
              // No screens exceeded — no warning
              expect(result).toBeNull();
            } else {
              // At least one screen exceeded — warning with exactly those screens
              expect(result).not.toBeNull();
              expect(result!.videoDuration).toBe(content.duration_seconds);
              expect(result!.screens).toHaveLength(expectedExceeding.length);

              // Each exceeding screen should be listed with correct slot duration
              for (let i = 0; i < expectedExceeding.length; i++) {
                expect(result!.screens[i].name).toBe(expectedExceeding[i].name);
                expect(result!.screens[i].slotDuration).toBe(
                  resolveSlotDuration(expectedExceeding[i])
                );
              }
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // =========================================================================
  // Property: non-video content NEVER produces a warning
  // =========================================================================
  describe('Non-video content never triggers a warning', () => {
    it('for any non-video content, checkVideoDurationWithScreens returns null regardless of screens', () => {
      fc.assert(
        fc.property(
          nonVideoContentArb,
          fc.array(screenArb, { minLength: 1, maxLength: 5 }),
          (content, screens) => {
            const result = checkVideoDurationWithScreens(content, screens);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property: video with null duration NEVER produces a warning
  // =========================================================================
  describe('Video with null duration never triggers a warning', () => {
    it('for any video content without duration_seconds, no warning is produced', () => {
      fc.assert(
        fc.property(
          fc.record({ duration_seconds: fc.constant(null as number | null), mime_type: videoMimeTypeArb }),
          fc.array(screenArb, { minLength: 1, maxLength: 5 }),
          (content, screens) => {
            const result = checkVideoDurationWithScreens(content, screens);
            expect(result).toBeNull();
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // =========================================================================
  // Property: exceedsSlotDuration is consistent with resolveSlotDuration
  // =========================================================================
  describe('exceedsSlotDuration biconditional with duration > slotDuration', () => {
    it('exceedsSlotDuration returns true iff video duration > given slot duration', () => {
      fc.assert(
        fc.property(
          videoContentArb,
          slotDurationArb,
          (content, slotDuration) => {
            const result = exceedsSlotDuration(content, slotDuration);
            const expected = content.duration_seconds! > slotDuration;
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('exceedsSlotDuration returns false for non-video content regardless of duration', () => {
      fc.assert(
        fc.property(
          nonVideoContentArb,
          slotDurationArb,
          (content, slotDuration) => {
            expect(exceedsSlotDuration(content, slotDuration)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property: resolveSlotDuration hierarchy correctness
  // =========================================================================
  describe('resolveSlotDuration follows hierarchy group → tenant → default', () => {
    it('group duration takes priority over tenant and default', () => {
      fc.assert(
        fc.property(
          slotDurationArb,
          slotDurationArb,
          (groupDuration, tenantDuration) => {
            const screen = {
              screen_group: { duration_seconds: groupDuration },
              tenant: { default_duration_seconds: tenantDuration },
            };
            expect(resolveSlotDuration(screen)).toBe(groupDuration);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('tenant duration takes priority over default when group is absent or null', () => {
      fc.assert(
        fc.property(tenantArb, (tenant) => {
          if (tenant.default_duration_seconds === null) return; // skip when both null

          const screenNoGroup = {
            screen_group: undefined as any,
            tenant,
          };
          expect(resolveSlotDuration(screenNoGroup)).toBe(tenant.default_duration_seconds);

          const screenNullGroup = {
            screen_group: { duration_seconds: null },
            tenant,
          };
          expect(resolveSlotDuration(screenNullGroup)).toBe(tenant.default_duration_seconds);
        }),
        { numRuns: 100 }
      );
    });

    it('default 10s is used when group and tenant durations are absent', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            { screen_group: undefined, tenant: undefined },
            { screen_group: undefined, tenant: { default_duration_seconds: null } },
            { screen_group: { duration_seconds: null }, tenant: undefined },
            { screen_group: { duration_seconds: null }, tenant: { default_duration_seconds: null } }
          ),
          (screen) => {
            expect(resolveSlotDuration(screen)).toBe(DEFAULT_SLOT_DURATION_SECONDS);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
