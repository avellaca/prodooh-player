import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GamVastSource } from '../../src/sources/GamVastSource';

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

describe('GamVastSource', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor and isAvailable', () => {
    it('should create instance with default timeout of 5000ms', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });
      expect(source.id).toBe('gam');
      expect(source.isAvailable()).toBe(true);
    });

    it('should accept custom timeout', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
        timeout: 3000,
      });
      expect(source.isAvailable()).toBe(true);
    });

    it('should return false for isAvailable when adTagUrl is empty', () => {
      const source = new GamVastSource({ adTagUrl: '' });
      expect(source.isAvailable()).toBe(false);
    });

    it('should return false for isAvailable when adTagUrl has no sandbox indicators', () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/production/real-ads',
      });
      expect(source.isAvailable()).toBe(false);
    });

    it('should recognize various sandbox/test indicators', () => {
      const validUrls = [
        'https://pubads.g.doubleclick.net/test/ads',
        'https://pubads.g.doubleclick.net/sandbox/tags',
        'https://example.com/sample_tag/vast',
        'https://example.com/debug/ads',
        'https://example.com/adunit/test/1234',
        'https://example.com/ads/test_ad',
        'https://example.com/test/vast.xml',
      ];

      for (const url of validUrls) {
        const source = new GamVastSource({ adTagUrl: url });
        expect(source.isAvailable()).toBe(true);
      }
    });
  });

  describe('prefetch', () => {
    it('should return null if adTagUrl does not pass sandbox validation', async () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/production/ads',
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
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const result = await source.prefetch();

      expect(result).not.toBeNull();
      expect(result!.source).toBe('gam');
      expect(result!.type).toBe('video');
      expect(result!.mediaUrl).toBe('https://cdn.example.com/ads/test-video.mp4');
      expect(result!.duration).toBe(30);
      expect(result!.metadata).toEqual({
        vastDuration: 30,
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });
      expect(result!.id).toMatch(/^gam-/);
    });

    it('should fetch and parse a valid VAST response with image', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => IMAGE_VAST_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const result = await source.prefetch();

      expect(result).not.toBeNull();
      expect(result!.type).toBe('image');
      expect(result!.mediaUrl).toBe('https://cdn.example.com/ads/banner.jpg');
      expect(result!.duration).toBe(10);
    });

    it('should return null on empty VAST (no ad available)', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => EMPTY_VAST_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
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
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const result = await source.prefetch();

      expect(result).not.toBeNull();
      expect(result!.duration).toBe(15);
    });

    it('should return null on malformed XML', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => MALFORMED_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should return null on HTTP error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should return null on timeout (AbortError)', async () => {
      fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should return null when response body is empty', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => '',
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should pass abort signal to fetch', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => VALID_VAST_XML,
      });

      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
        timeout: 3000,
      });

      await source.prefetch();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://pubads.g.doubleclick.net/test/ads',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  describe('confirmPlay', () => {
    it('should be a no-op', async () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const content = {
        id: 'gam-123',
        type: 'video' as const,
        source: 'gam' as const,
        mediaUrl: 'https://cdn.example.com/ads/test.mp4',
        duration: 30,
        metadata: {},
      };

      // Should not throw
      await expect(source.confirmPlay(content)).resolves.toBeUndefined();
    });
  });

  describe('reportFailure', () => {
    it('should be a no-op', async () => {
      const source = new GamVastSource({
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const content = {
        id: 'gam-123',
        type: 'video' as const,
        source: 'gam' as const,
        mediaUrl: 'https://cdn.example.com/ads/test.mp4',
        duration: 30,
        metadata: {},
      };

      // Should not throw
      await expect(source.reportFailure(content, 'decode error')).resolves.toBeUndefined();
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
          adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
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
        adTagUrl: 'https://pubads.g.doubleclick.net/test/ads',
      });

      const result = await source.prefetch();
      expect(result).not.toBeNull();
      expect(result!.duration).toBe(15);
    });
  });
});
