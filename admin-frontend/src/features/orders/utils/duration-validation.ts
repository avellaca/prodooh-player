import type { Content, Screen, ScreenGroup, Tenant } from '@/types/models';

/**
 * Default slot duration (seconds) when no override is configured
 * at screen, group, or tenant level.
 */
export const DEFAULT_SLOT_DURATION_SECONDS = 10;

/**
 * Resolves the effective slot duration for a screen following the hierarchy:
 * screen (not applicable - no field) → group.duration_seconds → tenant.default_duration_seconds → 10s
 */
export function resolveSlotDuration(
  screen: Pick<Screen, 'screen_group' | 'tenant'>
): number {
  return (
    screen.screen_group?.duration_seconds ??
    screen.tenant?.default_duration_seconds ??
    DEFAULT_SLOT_DURATION_SECONDS
  );
}

/**
 * Info about a screen where video duration exceeds slot duration.
 */
export interface ExceedingScreen {
  name: string;
  slotDuration: number;
}

/**
 * Duration warning information returned when a video exceeds slot duration.
 */
export interface DurationWarning {
  videoDuration: number;
  screens: ExceedingScreen[];
}

/**
 * Checks if a video content's duration exceeds the slot duration for given screens.
 * Returns null if no warning needed, or a DurationWarning if video exceeds at least one screen's slot.
 *
 * For use when full Screen objects with group/tenant data are available.
 */
export function checkVideoDurationWithScreens(
  content: Pick<Content, 'duration_seconds' | 'mime_type'>,
  screens: Array<Pick<Screen, 'name' | 'screen_group' | 'tenant'>>
): DurationWarning | null {
  if (!content.duration_seconds || !content.mime_type?.startsWith('video/')) {
    return null;
  }

  const exceedingScreens: ExceedingScreen[] = screens
    .filter((screen) => {
      const slotDuration = resolveSlotDuration(screen);
      return content.duration_seconds! > slotDuration;
    })
    .map((screen) => ({
      name: screen.name,
      slotDuration: resolveSlotDuration(screen),
    }));

  if (exceedingScreens.length === 0) return null;

  return {
    videoDuration: content.duration_seconds,
    screens: exceedingScreens,
  };
}

/**
 * Simplified check: determines if a video content exceeds a given slot duration.
 * Use when you only have a single slot duration value (resolved or default).
 *
 * Returns true if the video duration exceeds the slot duration.
 */
export function exceedsSlotDuration(
  content: Pick<Content, 'duration_seconds' | 'mime_type'>,
  slotDurationSeconds: number = DEFAULT_SLOT_DURATION_SECONDS
): boolean {
  if (!content.duration_seconds || !content.mime_type?.startsWith('video/')) {
    return false;
  }
  return content.duration_seconds > slotDurationSeconds;
}
