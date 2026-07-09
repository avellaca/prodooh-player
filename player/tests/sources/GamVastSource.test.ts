import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GamVastSource } from '../../src/sources/GamVastSource';
import type { GamLogger } from '../../src/sources/GamVastSource';

/** Sample VAST XML with a valid ad */
const VALID_VAST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="12345">
    <InLine>
      <AdTitle>Test Ad</AdTitle>
      <Creatives>
        <Creative>
          <Linear>
            <Duration>00:00:30</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="1920" height="1080">
                https://cdn.example.com/ads/test-video.mp4
              </MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

/** VAST XML with no ad (empty response) */
const EMPTY_VAST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
</VAST>`;

/** VAST XML with an image MediaFile */
const IMAGE_VAST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="67890">
    <InLine>
      <Creatives>
        <Creative>
          <Linear>
            <Duration>00:00:10</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="image/jpeg" width="1920" height="1080">
                https://cdn.example.com/ads/banner.jpg
              </MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

/** VAST XML without a Duration element */
const NO_DURATION_VAST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="99999">
    <InLine>
      <Creatives>
        <Creative>
          <Linear>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="1920" height="1080">
                https://cdn.example.com/ads/no-duration.mp4
              </MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

/** Malformed XML */
const MALFORMED_XML = `<VAST><this is not valid xml`;

/** Creates a silent logger for tests (captures calls without console output) */
function createMockLogger(): GamLogger & { errorCalls: string[]; warnCalls: string[] } {
  const logger = {
    errorCalls: [] as string[],
    warnCalls: [] as string[],
    error(msg: string, ..._args: unknown[]) {
      logger.errorCalls.push(msg);
    },
    warn(msg: string, ..._args: unknown[]) {
      logger.warnCalls.push(msg);
    },
  };
  return logger;
}

describe('GamVastSource', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor and isAvailable', () => {
    it('should create instance with default timeout of 5000ms', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });
      expect(source.id).toBe('gam');
      expect(source.isAvailable()).toBe(true);
    });

    it('should accept custom timeout', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        timeout: 3000,
        logger: mockLogger,
      });
      expect(source.isAvailable()).toBe(true);
    });

    it('should return false for isAvailable when adTagUrl is empty', () => {
      const source = new GamVastSource({ adTagUrl: '', logger: mockLogger });
      expect(source.isAvailable()).toBe(false);
    });

    it('should return false for isAvailable when adTagUrl is on unknown domain', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://evil.example.com/test/ads',
        logger: mockLogger,
      });
      expect(source.isAvailable()).toBe(false);
    });

    it('should return false for isAvailable when adTagUrl has no sandbox indicators', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/production/real-ads',
        logger: mockLogger,
      });
      expect(source.isAvailable()).toBe(false);
    });

    it('should recognize various sandbox/test indicators on valid GAM domains', () => {
      const validUrls = [
        'https://pubads.g.doubleclick.net/gampad/test/ads',
        'https://securepubads.g.doubleclick.net/gampad/sandbox/tags',
        'https://pagead2.googlesyndication.com/sample_tag/vast',
        'https://googleads.g.doubleclick.net/debug/ads',
        'https://pubads.g.doubleclick.net/adunit/test/1234',
        'https://pubads.g.doubleclick.net/gampad/test_ad',
        'https://pubads.g.doubleclick.net/test/vast.xml',
      ];

      for (const url of validUrls) {
        const source = new GamVastSource({ adTagUrl: url, logger: mockLogger });
        expect(source.isAvailable()).toBe(true);
      }
    });
  });

  describe('sandbox tag validation (Req 3.1)', () => {
    it('should reject and log error for non-GAM domain', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://evil-ads.example.com/test/ads',
        logger: mockLogger,
      });

      expect(source.validateSandboxTag('https://evil-ads.example.com/test/ads')).toBe(false);
      expect(mockLogger.errorCalls.length).toBeGreaterThan(0);
      expect(mockLogger.errorCalls[0]).toContain('not a recognized GAM domain');
    });

    it('should reject and log error for valid GAM domain without sandbox indicator', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/production/ads',
        logger: mockLogger,
      });

      expect(
        source.validateSandboxTag('https://pubads.g.doubleclick.net/gampad/production/ads'),
      ).toBe(false);
      expect(mockLogger.errorCalls.length).toBeGreaterThan(0);
      expect(mockLogger.errorCalls[0]).toContain('does not contain a sandbox/test indicator');
    });

    it('should reject and log error for empty URL', () => {
      const source = new GamVastSource({ adTagUrl: '', logger: mockLogger });

      expect(source.validateSandboxTag('')).toBe(false);
      expect(mockLogger.errorCalls.length).toBeGreaterThan(0);
      expect(mockLogger.errorCalls[0]).toContain('empty or invalid');
    });

    it('should reject and log error for invalid URL format', () => {
      const source = new GamVastSource({ adTagUrl: 'not-a-url', logger: mockLogger });

      expect(source.validateSandboxTag('not-a-url')).toBe(false);
      expect(mockLogger.errorCalls.length).toBeGreaterThan(0);
      expect(mockLogger.errorCalls[0]).toContain('not a valid URL');
    });

    it('should accept valid GAM domain with sandbox indicator', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      expect(
        source.validateSandboxTag('https://pubads.g.doubleclick.net/gampad/test/ads'),
      ).toBe(true);
      expect(mockLogger.errorCalls.length).toBe(0);
    });

    it('should accept securepubads.g.doubleclick.net domain', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://securepubads.g.doubleclick.net/gampad/sandbox/ads',
        logger: mockLogger,
      });

      expect(
        source.validateSandboxTag('https://securepubads.g.doubleclick.net/gampad/sandbox/ads'),
      ).toBe(true);
      expect(mockLogger.errorCalls.length).toBe(0);
    });

    it('should prevent production impressions (Req 3.4)', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/production/campaign',
        logger: mockLogger,
      });

      // No sandbox indicator → should refuse
      expect(
        source.validateSandboxTag(
          'https://pubads.g.doubleclick.net/gampad/ads?iu=/production/campaign',
        ),
      ).toBe(false);
      expect(mockLogger.errorCalls[0]).toContain('prevent production impressions');
    });
  });

  describe('prefetch', () => {
    it('should return null if adTagUrl does not pass sandbox validation', async () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/production/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return null and not fetch when domain is not GAM', async () => {
      const source = new GamVastSource({
        adTagUrl: 'https://unknown-domain.com/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fetch and parse a valid VAST response with video', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => VALID_VAST_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();

      expect(result).not.toBeNull();
      expect(result!.source).toBe('gam');
      expect(result!.type).toBe('video');
      expect(result!.mediaUrl).toBe('https://cdn.example.com/ads/test-video.mp4');
      expect(result!.duration).toBe(30);
      expect(result!.metadata).toEqual({
        vastDuration: 30,
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        sandbox: true,
      });
      expect(result!.id).toMatch(/^gam-/);
    });

    it('should fetch and parse a valid VAST response with image', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => IMAGE_VAST_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();

      expect(result).not.toBeNull();
      expect(result!.type).toBe('image');
      expect(result!.mediaUrl).toBe('https://cdn.example.com/ads/banner.jpg');
      expect(result!.duration).toBe(10);
    });

    it('should return null on empty VAST (no ad available) - Req 3.3', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => EMPTY_VAST_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should default duration to 15 seconds when Duration element is missing', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => NO_DURATION_VAST_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();

      expect(result).not.toBeNull();
      expect(result!.duration).toBe(15);
    });

    it('should return null on malformed XML - Req 3.3', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => MALFORMED_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should return null on HTTP error response - Req 3.3', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should return null on network error - Req 3.3', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should return null on timeout (AbortError) - Req 3.3', async () => {
      fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should return null when response body is empty - Req 3.3', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => '',
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should pass abort signal to fetch for timeout handling', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => VALID_VAST_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        timeout: 3000,
        logger: mockLogger,
      });

      await source.prefetch();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://pubads.g.doubleclick.net/gampad/test/ads',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should mark content metadata with sandbox: true (Req 3.4)', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => VALID_VAST_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();
      expect(result).not.toBeNull();
      expect(result!.metadata.sandbox).toBe(true);
    });
  });

  describe('confirmPlay (Req 3.4)', () => {
    it('should be a no-op to prevent reporting sandbox impressions', async () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const content = {
        id: 'gam-123',
        type: 'video' as const,
        source: 'gam' as const,
        mediaUrl: 'https://cdn.example.com/ads/test.mp4',
        duration: 30,
        metadata: { sandbox: true },
      };

      await expect(source.confirmPlay(content)).resolves.toBeUndefined();
      // Verify no network requests were made (no impression tracking)
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('reportFailure', () => {
    it('should be a no-op', async () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const content = {
        id: 'gam-123',
        type: 'video' as const,
        source: 'gam' as const,
        mediaUrl: 'https://cdn.example.com/ads/test.mp4',
        duration: 30,
        metadata: {},
      };

      await expect(source.reportFailure(content, 'decode error')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('duration parsing', () => {
    it('should correctly parse various HH:MM:SS durations', async () => {
      const testCases = [
        { duration: '00:00:15', expected: 15 },
        { duration: '00:01:00', expected: 60 },
        { duration: '00:01:30', expected: 90 },
        { duration: '01:00:00', expected: 3600 },
      ];

      for (const { duration, expected } of testCases) {
        const vastXml = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="1">
    <InLine>
      <Creatives>
        <Creative>
          <Linear>
            <Duration>${duration}</Duration>
            <MediaFiles>
              <MediaFile>https://cdn.example.com/test.mp4</MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

        fetchMock.mockResolvedValue({
          ok: true,
          text: async () => vastXml,
        });

        const source = new GamVastSource({
          adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
          logger: mockLogger,
        });

        const result = await source.prefetch();
        expect(result).not.toBeNull();
        expect(result!.duration).toBe(expected);
      }
    });

    it('should default to 15 seconds for invalid duration format', async () => {
      const vastXml = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="1">
    <InLine>
      <Creatives>
        <Creative>
          <Linear>
            <Duration>invalid</Duration>
            <MediaFiles>
              <MediaFile>https://cdn.example.com/test.mp4</MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => vastXml,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/gampad/test/ads',
        logger: mockLogger,
      });

      const result = await source.prefetch();
      expect(result).not.toBeNull();
      expect(result!.duration).toBe(15);
    });
  });
});
