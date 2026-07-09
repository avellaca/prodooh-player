/**
 * Duration Resolution — Hierarchy-based duration resolution.
 *
 * Resolves the display duration for a piece of content based on its type,
 * source, and the configuration hierarchy (screen > group > tenant).
 *
 * Resolution rules:
 * - Video: always use the video's natural duration (metadata.videoDuration)
 * - VAST (GAM): use the duration from the VAST XML (metadata.vastDuration)
 * - Prodooh API: use API-provided duration if available (metadata.apiDuration),
 *   otherwise fall through to the hierarchy
 * - Static content (images, URLs): screen override > group override > tenant default
 *
 * Validates: Requirements 15.4, 15.5, 15.6, 15.7
 */

import type { PreparedContent } from '../sources/types';

/** Screen-level duration configuration */
export interface ScreenConfig {
  /** Screen-specific duration override in seconds, or null if not set */
  durationSeconds: number | null;
}

/** Group-level duration configuration */
export interface GroupConfig {
  /** Group-specific duration override in seconds, or null if not set */
  durationSeconds: number | null;
}

/** Tenant-level duration configuration */
export interface TenantConfig {
  /** Tenant default duration in seconds (always present) */
  defaultDurationSeconds: number;
}

/**
 * Resolves the display duration for content using the inheritance hierarchy.
 *
 * @param content - The prepared content to resolve duration for
 * @param screenConfig - Screen-level configuration with optional duration override
 * @param groupConfig - Group-level configuration (null if screen has no group)
 * @param tenantConfig - Tenant-level configuration with the default duration
 * @returns Duration in seconds
 */
export function resolveDuration(
  content: PreparedContent,
  screenConfig: ScreenConfig,
  groupConfig: GroupConfig | null,
  tenantConfig: TenantConfig
): number {
  // Video: always use natural duration (Req 15.5 — "respetar la duración natural del video")
  if (content.type === 'video') {
    return (content.metadata.videoDuration as number) ?? content.duration;
  }

  // VAST: use duration from VAST XML (Req 15.6 — "respetar la duración definida en el XML del anuncio VAST")
  if (content.source === 'gam' && content.metadata.vastDuration != null) {
    return content.metadata.vastDuration as number;
  }

  // Prodooh API: use API-provided duration if available (Req 15.7)
  if (content.source === 'prodooh' && content.metadata.apiDuration != null) {
    return content.metadata.apiDuration as number;
  }

  // Static content: resolve from hierarchy (Req 15.4 — screen > group > tenant)
  if (screenConfig.durationSeconds !== null) {
    return screenConfig.durationSeconds;
  }
  if (groupConfig?.durationSeconds !== null && groupConfig?.durationSeconds !== undefined) {
    return groupConfig.durationSeconds;
  }
  return tenantConfig.defaultDurationSeconds;
}
