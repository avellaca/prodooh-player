/**
 * Property-based test: Duration Resolution Hierarchy
 *
 * Generates random content types, sources, metadata durations, and config
 * hierarchies; verifies the most-specific rule always wins according to
 * the documented priority:
 *
 * 1. Video → always videoDuration (or content.duration fallback)
 * 2. GAM with vastDuration → vastDuration
 * 3. Prodooh with apiDuration → apiDuration
 * 4. Static content → screen > group > tenant hierarchy
 *
 * **Validates: Requirements 15.4, 15.5, 15.6, 15.7**
 *
 * Requirement 15.4: Screen override > Group override > Tenant default.
 * Requirement 15.5: Video uses natural duration, never cut or extended.
 * Requirement 15.6: VAST ads use the duration from VAST XML.
 * Requirement 15.7: Prodooh API duration if provided, else hierarchy.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveDuration,
  type ScreenConfig,
  type GroupConfig,
  type TenantConfig,
} from '../../src/engine/resolveDuration';
import type { PreparedContent, ContentType, SourceType } from '../../src/sources/types';

// --- Arbitraries ---

/** Positive duration in seconds (1..300) */
const durationArb = fc.integer({ min: 1, max: 300 });

/** Nullable duration for config overrides */
const nullableDurationArb = fc.option(durationArb, { nil: null });

/** Content types */
const contentTypeArb = fc.constantFrom<ContentType>('image', 'video', 'url', 'html');

/** Source types */
const sourceTypeArb = fc.constantFrom<SourceType>('prodooh', 'gam', 'url', 'playlist');

/** Screen config arbitrary */
const screenConfigArb = nullableDurationArb.map(
  (d): ScreenConfig => ({ durationSeconds: d })
);

/** Group config arbitrary (can be null = no group) */
const groupConfigArb = fc.option(
  nullableDurationArb.map((d): GroupConfig => ({ durationSeconds: d })),
  { nil: null }
);

/** Tenant config arbitrary (always has a default) */
const tenantConfigArb = durationArb.map(
  (d): TenantConfig => ({ defaultDurationSeconds: d })
);

/** Generate a PreparedContent with random type, source, and metadata */
const preparedContentArb = fc.record({
  type: contentTypeArb,
  source: sourceTypeArb,
  contentDuration: durationArb,
  videoDuration: fc.option(durationArb, { nil: undefined }),
  vastDuration: fc.option(durationArb, { nil: undefined }),
  apiDuration: fc.option(durationArb, { nil: undefined }),
}).map(({ type, source, contentDuration, videoDuration, vastDuration, apiDuration }) => {
  const metadata: Record<string, unknown> = {};
  if (videoDuration !== undefined) metadata.videoDuration = videoDuration;
  if (vastDuration !== undefined) metadata.vastDuration = vastDuration;
  if (apiDuration !== undefined) metadata.apiDuration = apiDuration;

  const content: PreparedContent = {
    id: 'test-content',
    type,
    source,
    mediaUrl: '/media/test',
    duration: contentDuration,
    metadata,
  };
  return content;
});

// --- Helper to compute the expected resolution manually ---

function expectedDuration(
  content: PreparedContent,
  screenConfig: ScreenConfig,
  groupConfig: GroupConfig | null,
  tenantConfig: TenantConfig
): number {
  // Rule 1: Video always uses natural duration
  if (content.type === 'video') {
    return (content.metadata.videoDuration as number) ?? content.duration;
  }

  // Rule 2: GAM with vastDuration
  if (content.source === 'gam' && content.metadata.vastDuration != null) {
    return content.metadata.vastDuration as number;
  }

  // Rule 3: Prodooh with apiDuration
  if (content.source === 'prodooh' && content.metadata.apiDuration != null) {
    return content.metadata.apiDuration as number;
  }

  // Rule 4: Hierarchy (screen > group > tenant)
  if (screenConfig.durationSeconds !== null) {
    return screenConfig.durationSeconds;
  }
  if (groupConfig?.durationSeconds !== null && groupConfig?.durationSeconds !== undefined) {
    return groupConfig.durationSeconds;
  }
  return tenantConfig.defaultDurationSeconds;
}

// --- Property Tests ---

describe('Property 18: Duration Resolution Hierarchy', () => {
  it('video content always resolves to videoDuration regardless of config hierarchy', () => {
    fc.assert(
      fc.property(
        durationArb,               // videoDuration
        durationArb,               // content.duration (fallback)
        sourceTypeArb,             // source can be anything
        screenConfigArb,
        groupConfigArb,
        tenantConfigArb,
        (videoDuration, contentDuration, source, screenConfig, groupConfig, tenantConfig) => {
          const content: PreparedContent = {
            id: 'video-test',
            type: 'video',
            source,
            mediaUrl: '/media/video.mp4',
            duration: contentDuration,
            metadata: { videoDuration },
          };

          const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
          expect(result).toBe(videoDuration);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('video content falls back to content.duration when videoDuration metadata is missing', () => {
    fc.assert(
      fc.property(
        durationArb,               // content.duration
        sourceTypeArb,
        screenConfigArb,
        groupConfigArb,
        tenantConfigArb,
        (contentDuration, source, screenConfig, groupConfig, tenantConfig) => {
          const content: PreparedContent = {
            id: 'video-no-meta',
            type: 'video',
            source,
            mediaUrl: '/media/video.mp4',
            duration: contentDuration,
            metadata: {},  // no videoDuration
          };

          const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
          expect(result).toBe(contentDuration);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('GAM content with vastDuration ignores config hierarchy', () => {
    fc.assert(
      fc.property(
        durationArb,               // vastDuration
        fc.constantFrom<ContentType>('image', 'url', 'html'), // non-video types
        screenConfigArb,
        groupConfigArb,
        tenantConfigArb,
        (vastDuration, type, screenConfig, groupConfig, tenantConfig) => {
          const content: PreparedContent = {
            id: 'gam-test',
            type,
            source: 'gam',
            mediaUrl: '/media/ad',
            duration: 10,
            metadata: { vastDuration },
          };

          const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
          expect(result).toBe(vastDuration);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Prodooh content with apiDuration ignores config hierarchy', () => {
    fc.assert(
      fc.property(
        durationArb,               // apiDuration
        fc.constantFrom<ContentType>('image', 'url', 'html'), // non-video types
        screenConfigArb,
        groupConfigArb,
        tenantConfigArb,
        (apiDuration, type, screenConfig, groupConfig, tenantConfig) => {
          const content: PreparedContent = {
            id: 'prodooh-test',
            type,
            source: 'prodooh',
            mediaUrl: '/media/ad',
            duration: 10,
            metadata: { apiDuration },
          };

          const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
          expect(result).toBe(apiDuration);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('static content with screen override uses screen duration (highest priority in hierarchy)', () => {
    fc.assert(
      fc.property(
        durationArb,               // screen duration
        nullableDurationArb,       // group duration (could be anything)
        tenantConfigArb,
        fc.constantFrom<ContentType>('image', 'url', 'html'),
        fc.constantFrom<SourceType>('url', 'playlist'), // sources that don't have special metadata rules
        (screenDuration, groupDuration, tenantConfig, type, source) => {
          const content: PreparedContent = {
            id: 'static-screen',
            type,
            source,
            mediaUrl: '/media/img.jpg',
            duration: 10,
            metadata: {},
          };
          const screenConfig: ScreenConfig = { durationSeconds: screenDuration };
          const groupConfig: GroupConfig | null = groupDuration !== null
            ? { durationSeconds: groupDuration }
            : null;

          const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
          expect(result).toBe(screenDuration);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('static content without screen override uses group duration (second priority)', () => {
    fc.assert(
      fc.property(
        durationArb,               // group duration
        tenantConfigArb,
        fc.constantFrom<ContentType>('image', 'url', 'html'),
        fc.constantFrom<SourceType>('url', 'playlist'),
        (groupDuration, tenantConfig, type, source) => {
          const content: PreparedContent = {
            id: 'static-group',
            type,
            source,
            mediaUrl: '/media/img.jpg',
            duration: 10,
            metadata: {},
          };
          const screenConfig: ScreenConfig = { durationSeconds: null };
          const groupConfig: GroupConfig = { durationSeconds: groupDuration };

          const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
          expect(result).toBe(groupDuration);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('static content without screen or group override uses tenant default (lowest priority)', () => {
    fc.assert(
      fc.property(
        tenantConfigArb,
        fc.constantFrom<ContentType>('image', 'url', 'html'),
        fc.constantFrom<SourceType>('url', 'playlist'),
        (tenantConfig, type, source) => {
          const content: PreparedContent = {
            id: 'static-tenant',
            type,
            source,
            mediaUrl: '/media/img.jpg',
            duration: 10,
            metadata: {},
          };
          const screenConfig: ScreenConfig = { durationSeconds: null };
          // Group with null duration or no group at all
          const groupConfig: GroupConfig | null = null;

          const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
          expect(result).toBe(tenantConfig.defaultDurationSeconds);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('for any random content/config combination, resolveDuration matches the documented priority rules', () => {
    fc.assert(
      fc.property(
        preparedContentArb,
        screenConfigArb,
        groupConfigArb,
        tenantConfigArb,
        (content, screenConfig, groupConfig, tenantConfig) => {
          const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
          const expected = expectedDuration(content, screenConfig, groupConfig, tenantConfig);

          expect(result).toBe(expected);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('result is always a positive number', () => {
    fc.assert(
      fc.property(
        preparedContentArb,
        screenConfigArb,
        groupConfigArb,
        tenantConfigArb,
        (content, screenConfig, groupConfig, tenantConfig) => {
          const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
          expect(result).toBeGreaterThan(0);
          expect(typeof result).toBe('number');
          expect(Number.isFinite(result)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});
