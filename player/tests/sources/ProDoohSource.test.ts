import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProDoohSource } from '../../src/sources/ProDoohSource';
import type { ProDoohSourceConfig } from '../../src/sources/ProDoohSource';
import type { PreparedContent } from '../../src/sources/types';

const defaultConfig: ProDoohSourceConfig = {
  apiKey: 'sandbox-api-key',
  networkId: 'sandbox-network',
  venueId: 'sandbox-screen-1',
  baseUrl: 'https://sandbox.api.prodooh.com',
  width: '1920',
  height: '1080',
};

const mockAdResponse = {
  media: 'https://cdn.prodooh.com/ad/creative-123.jpg',
  type: 'image/jpeg',
  print_id: 'pop-uuid-001',
  proof_of_play: 'https://sandbox.api.prodooh.com/v1/ad/proof_of_play/pop-uuid-001',
  expiration: 'https://sandbox.api.prodooh.com/public/v1/expiration/pop-uuid-001',
  media_id: 42,
  campaign_id: 7,
};

describe('ProDoohSource', () => {
  let source: ProDoohSource;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    source = new ProDoohSource(defaultConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('isAvailable()', () => {
    it('should return true when apiKey and networkId are configured', () => {
      expect(source.isAvailable()).toBe(true);
    });

    it('should return false when apiKey is empty', () => {
      const src = new ProDoohSource({ ...defaultConfig, apiKey: '' });
      expect(src.isAvailable()).toBe(false);
    });

    it('should return false when networkId is empty', () => {
      const src = new ProDoohSource({ ...defaultConfig, networkId: '' });
      expect(src.isAvailable()).toBe(false);
    });
  });

  describe('prefetch()', () => {
    it('should POST to the correct endpoint with correct body', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAdResponse,
      });

      await source.prefetch();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://sandbox.api.prodooh.com/v1/ad',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            api_key: 'sandbox-api-key',
            network_id: 'sandbox-network',
            venue_id: 'sandbox-screen-1',
            width: '1920',
            height: '1080',
            supported_media: ['image/jpeg', 'image/jpg', 'image/png', 'video/mp4', 'video/mpeg', 'video/mpg'],
          }),
        }),
      );
    });

    it('should return PreparedContent on successful response with media', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAdResponse,
      });

      const content = await source.prefetch();

      expect(content).not.toBeNull();
      expect(content!.id).toBe('pop-uuid-001');
      expect(content!.type).toBe('image');
      expect(content!.source).toBe('prodooh');
      expect(content!.mediaUrl).toBe('https://cdn.prodooh.com/ad/creative-123.jpg');
      expect(content!.metadata.print_id).toBe('pop-uuid-001');
      expect(content!.metadata.proof_of_play_url).toBe(mockAdResponse.proof_of_play);
      expect(content!.metadata.expiration_url).toBe(mockAdResponse.expiration);
      expect(content!.metadata.media_id).toBe(42);
      expect(content!.metadata.campaign_id).toBe(7);
    });

    it('should return correct ContentType for video MIME', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockAdResponse, type: 'video/mp4' }),
      });

      const content = await source.prefetch();
      expect(content!.type).toBe('video');
    });

    it('should return null on "no fill" response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'no fill' }),
      });

      const content = await source.prefetch();
      expect(content).toBeNull();
    });

    it('should return null on "no ad configured" error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'No ad configured for this screen' }),
      });

      const content = await source.prefetch();
      expect(content).toBeNull();
    });

    it('should return null on HTTP error (401)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const content = await source.prefetch();
      expect(content).toBeNull();
    });

    it('should return null on HTTP error (429 rate limit)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

      const content = await source.prefetch();
      expect(content).toBeNull();
    });

    it('should return null on HTTP error (500)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const content = await source.prefetch();
      expect(content).toBeNull();
    });

    it('should return null on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const content = await source.prefetch();
      expect(content).toBeNull();
    });

    it('should return null when response is missing media field', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ print_id: 'abc', type: 'image/jpeg' }),
      });

      const content = await source.prefetch();
      expect(content).toBeNull();
    });

    it('should return null when response is missing print_id', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ media: 'https://cdn.example.com/ad.jpg', type: 'image/jpeg' }),
      });

      const content = await source.prefetch();
      expect(content).toBeNull();
    });

    it('should strip trailing slashes from baseUrl', async () => {
      const src = new ProDoohSource({ ...defaultConfig, baseUrl: 'https://sandbox.api.prodooh.com/' });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAdResponse,
      });

      await src.prefetch();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://sandbox.api.prodooh.com/v1/ad',
        expect.anything(),
      );
    });
  });

  describe('Rate Limiting', () => {
    it('should allow first request immediately', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAdResponse,
      });

      const content = await source.prefetch();
      expect(content).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should return null if called within 10 seconds of last request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAdResponse,
      });

      await source.prefetch(); // First call
      vi.advanceTimersByTime(5_000); // Only 5s passed

      const content = await source.prefetch(); // Should be rate-limited
      expect(content).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1); // No second fetch
    });

    it('should allow request after 10 seconds have passed', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockAdResponse,
      });

      await source.prefetch(); // First call
      vi.advanceTimersByTime(10_000); // 10s passed

      const content = await source.prefetch(); // Should be allowed
      expect(content).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should track rate limit even on failed requests', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await source.prefetch(); // First call (fails)
      vi.advanceTimersByTime(5_000);

      const content = await source.prefetch(); // Should be rate-limited
      expect(content).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirmPlay()', () => {
    it('should call the proof_of_play URL with GET', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 201 });

      const content: PreparedContent = {
        id: 'pop-uuid-001',
        type: 'image',
        source: 'prodooh',
        mediaUrl: 'https://cdn.prodooh.com/ad.jpg',
        duration: 10,
        metadata: {
          print_id: 'pop-uuid-001',
          proof_of_play_url: 'https://sandbox.api.prodooh.com/v1/ad/proof_of_play/pop-uuid-001',
          expiration_url: 'https://sandbox.api.prodooh.com/public/v1/expiration/pop-uuid-001',
        },
      };

      await source.confirmPlay(content);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://sandbox.api.prodooh.com/v1/ad/proof_of_play/pop-uuid-001',
        { method: 'GET', mode: 'no-cors' },
      );
    });

    it('should not throw on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const content: PreparedContent = {
        id: 'pop-uuid-001',
        type: 'image',
        source: 'prodooh',
        mediaUrl: 'https://cdn.prodooh.com/ad.jpg',
        duration: 10,
        metadata: {
          print_id: 'pop-uuid-001',
          proof_of_play_url: 'https://sandbox.api.prodooh.com/v1/ad/proof_of_play/pop-uuid-001',
        },
      };

      await expect(source.confirmPlay(content)).resolves.toBeUndefined();
    });

    it('should do nothing if proof_of_play_url is not in metadata', async () => {
      const content: PreparedContent = {
        id: 'pop-uuid-001',
        type: 'image',
        source: 'prodooh',
        mediaUrl: 'https://cdn.prodooh.com/ad.jpg',
        duration: 10,
        metadata: {},
      };

      await source.confirmPlay(content);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('reportFailure()', () => {
    it('should call the expiration URL with GET', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 201 });

      const content: PreparedContent = {
        id: 'pop-uuid-001',
        type: 'image',
        source: 'prodooh',
        mediaUrl: 'https://cdn.prodooh.com/ad.jpg',
        duration: 10,
        metadata: {
          print_id: 'pop-uuid-001',
          expiration_url: 'https://sandbox.api.prodooh.com/public/v1/expiration/pop-uuid-001',
        },
      };

      await source.reportFailure(content, 'decode error');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://sandbox.api.prodooh.com/public/v1/expiration/pop-uuid-001',
        { method: 'GET', mode: 'no-cors' },
      );
    });

    it('should not throw on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const content: PreparedContent = {
        id: 'pop-uuid-001',
        type: 'image',
        source: 'prodooh',
        mediaUrl: 'https://cdn.prodooh.com/ad.jpg',
        duration: 10,
        metadata: {
          expiration_url: 'https://sandbox.api.prodooh.com/public/v1/expiration/pop-uuid-001',
        },
      };

      await expect(source.reportFailure(content, 'timeout')).resolves.toBeUndefined();
    });

    it('should do nothing if expiration_url is not in metadata', async () => {
      const content: PreparedContent = {
        id: 'pop-uuid-001',
        type: 'image',
        source: 'prodooh',
        mediaUrl: 'https://cdn.prodooh.com/ad.jpg',
        duration: 10,
        metadata: {},
      };

      await source.reportFailure(content, 'error');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('id property', () => {
    it('should have id equal to "prodooh"', () => {
      expect(source.id).toBe('prodooh');
    });
  });
});
