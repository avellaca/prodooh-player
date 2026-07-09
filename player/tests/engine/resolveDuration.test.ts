/**
 * Unit tests for resolveDuration function.
 * Tests the hierarchy-based duration resolution logic.
 *
 * Validates: Requirements 15.4, 15.5, 15.6, 15.7
 */

import { describe, it, expect } from 'vitest';
import {
  resolveDuration,
  type ScreenConfig,
  type GroupConfig,
  type TenantConfig,
} from '../../src/engine/resolveDuration';
import type { PreparedContent } from '../../src/sources/types';

// --- Helpers ---

function makeContent(overrides: Partial<PreparedContent> = {}): PreparedContent {
  return {
    id: 'test-content-1',
    type: 'image',
    source: 'playlist',
    mediaUrl: '/media/test.jpg',
    duration: 10,
    metadata: {},
    ...overrides,
  };
}

const defaultScreenConfig: ScreenConfig = { durationSeconds: null };
const defaultGroupConfig: GroupConfig = { durationSeconds: null };
const defaultTenantConfig: TenantConfig = { defaultDurationSeconds: 10 };

// --- Video content tests (Req 15.5) ---

describe('resolveDuration - Video content', () => {
  it('uses natural video duration from metadata', () => {
    const content = makeContent({
      type: 'video',
      source: 'playlist',
      metadata: { videoDuration: 45 },
    });

    const result = resolveDuration(content, defaultScreenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(45);
  });

  it('uses natural video duration regardless of screen override', () => {
    const content = makeContent({
      type: 'video',
      source: 'playlist',
      metadata: { videoDuration: 30 },
    });
    const screenConfig: ScreenConfig = { durationSeconds: 15 };

    const result = resolveDuration(content, screenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(30);
  });

  it('uses natural video duration regardless of group override', () => {
    const content = makeContent({
      type: 'video',
      source: 'prodooh',
      metadata: { videoDuration: 60 },
    });
    const groupConfig: GroupConfig = { durationSeconds: 20 };

    const result = resolveDuration(content, defaultScreenConfig, groupConfig, defaultTenantConfig);
    expect(result).toBe(60);
  });

  it('falls back to content.duration when videoDuration metadata is missing', () => {
    const content = makeContent({
      type: 'video',
      source: 'playlist',
      duration: 25,
      metadata: {},
    });

    const result = resolveDuration(content, defaultScreenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(25);
  });
});

// --- VAST content tests (Req 15.6) ---

describe('resolveDuration - VAST content (GAM)', () => {
  it('uses VAST XML duration from metadata', () => {
    const content = makeContent({
      type: 'video',
      source: 'gam',
      metadata: { vastDuration: 15 },
    });

    // Note: video from GAM → video rule takes precedence first
    // But if it's a video, videoDuration wins. Let's test with an image-type ad.
    const imageAd = makeContent({
      type: 'image',
      source: 'gam',
      metadata: { vastDuration: 20 },
    });

    const result = resolveDuration(imageAd, defaultScreenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(20);
  });

  it('uses VAST duration regardless of screen or group overrides', () => {
    const content = makeContent({
      type: 'image',
      source: 'gam',
      metadata: { vastDuration: 30 },
    });
    const screenConfig: ScreenConfig = { durationSeconds: 5 };
    const groupConfig: GroupConfig = { durationSeconds: 8 };

    const result = resolveDuration(content, screenConfig, groupConfig, defaultTenantConfig);
    expect(result).toBe(30);
  });

  it('falls through to hierarchy when vastDuration metadata is missing for GAM source', () => {
    const content = makeContent({
      type: 'image',
      source: 'gam',
      metadata: {},
    });
    const screenConfig: ScreenConfig = { durationSeconds: 12 };

    const result = resolveDuration(content, screenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(12);
  });
});

// --- Prodooh API content tests (Req 15.7) ---

describe('resolveDuration - Prodooh API content', () => {
  it('uses API-provided duration from metadata', () => {
    const content = makeContent({
      type: 'image',
      source: 'prodooh',
      metadata: { apiDuration: 8 },
    });

    const result = resolveDuration(content, defaultScreenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(8);
  });

  it('uses API duration regardless of screen override', () => {
    const content = makeContent({
      type: 'image',
      source: 'prodooh',
      metadata: { apiDuration: 12 },
    });
    const screenConfig: ScreenConfig = { durationSeconds: 5 };

    const result = resolveDuration(content, screenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(12);
  });

  it('falls through to hierarchy when apiDuration is not provided', () => {
    const content = makeContent({
      type: 'image',
      source: 'prodooh',
      metadata: {},
    });
    const screenConfig: ScreenConfig = { durationSeconds: 7 };

    const result = resolveDuration(content, screenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(7);
  });

  it('falls through to tenant default when no overrides exist and apiDuration missing', () => {
    const content = makeContent({
      type: 'image',
      source: 'prodooh',
      metadata: {},
    });

    const result = resolveDuration(content, defaultScreenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(10);
  });
});

// --- Static content hierarchy tests (Req 15.4) ---

describe('resolveDuration - Static content hierarchy', () => {
  it('uses screen override when available (highest priority)', () => {
    const content = makeContent({ type: 'image', source: 'playlist' });
    const screenConfig: ScreenConfig = { durationSeconds: 15 };
    const groupConfig: GroupConfig = { durationSeconds: 20 };
    const tenantConfig: TenantConfig = { defaultDurationSeconds: 10 };

    const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
    expect(result).toBe(15);
  });

  it('uses group override when screen has no override', () => {
    const content = makeContent({ type: 'image', source: 'playlist' });
    const screenConfig: ScreenConfig = { durationSeconds: null };
    const groupConfig: GroupConfig = { durationSeconds: 20 };
    const tenantConfig: TenantConfig = { defaultDurationSeconds: 10 };

    const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
    expect(result).toBe(20);
  });

  it('uses tenant default when neither screen nor group has override', () => {
    const content = makeContent({ type: 'image', source: 'playlist' });
    const screenConfig: ScreenConfig = { durationSeconds: null };
    const groupConfig: GroupConfig = { durationSeconds: null };
    const tenantConfig: TenantConfig = { defaultDurationSeconds: 10 };

    const result = resolveDuration(content, screenConfig, groupConfig, tenantConfig);
    expect(result).toBe(10);
  });

  it('uses tenant default when group is null (screen not in a group)', () => {
    const content = makeContent({ type: 'image', source: 'playlist' });
    const screenConfig: ScreenConfig = { durationSeconds: null };
    const tenantConfig: TenantConfig = { defaultDurationSeconds: 12 };

    const result = resolveDuration(content, screenConfig, null, tenantConfig);
    expect(result).toBe(12);
  });

  it('works for URL-type content with screen override', () => {
    const content = makeContent({ type: 'url', source: 'url' });
    const screenConfig: ScreenConfig = { durationSeconds: 25 };

    const result = resolveDuration(content, screenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(25);
  });

  it('works for URL-type content falling through to tenant default', () => {
    const content = makeContent({ type: 'url', source: 'url' });
    const tenantConfig: TenantConfig = { defaultDurationSeconds: 8 };

    const result = resolveDuration(content, defaultScreenConfig, null, tenantConfig);
    expect(result).toBe(8);
  });
});

// --- Priority order tests ---

describe('resolveDuration - Priority ordering', () => {
  it('video type always takes precedence over everything', () => {
    const content = makeContent({
      type: 'video',
      source: 'gam',
      metadata: { videoDuration: 90, vastDuration: 15 },
    });
    const screenConfig: ScreenConfig = { durationSeconds: 5 };

    // Video type wins over VAST duration and screen override
    const result = resolveDuration(content, screenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(90);
  });

  it('VAST duration takes precedence over hierarchy for non-video GAM content', () => {
    const content = makeContent({
      type: 'html',
      source: 'gam',
      metadata: { vastDuration: 20 },
    });
    const screenConfig: ScreenConfig = { durationSeconds: 5 };

    const result = resolveDuration(content, screenConfig, defaultGroupConfig, defaultTenantConfig);
    expect(result).toBe(20);
  });

  it('API duration takes precedence over hierarchy for prodooh content', () => {
    const content = makeContent({
      type: 'image',
      source: 'prodooh',
      metadata: { apiDuration: 7 },
    });
    const screenConfig: ScreenConfig = { durationSeconds: 15 };
    const groupConfig: GroupConfig = { durationSeconds: 20 };

    const result = resolveDuration(content, screenConfig, groupConfig, defaultTenantConfig);
    expect(result).toBe(7);
  });
});
