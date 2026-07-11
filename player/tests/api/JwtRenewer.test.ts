import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JwtRenewer } from '../../src/api/JwtRenewer';
import { BackendApiClient, HttpResponse } from '../../src/api/BackendApiClient';

/**
 * Unit tests for JwtRenewer — JWT auto-renewal interceptor.
 * Validates: Requirements 12.1, 12.2, 12.3
 */

describe('JwtRenewer', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: BackendApiClient;
  let renewer: JwtRenewer;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new BackendApiClient('http://localhost:8000');
    client.setToken('initial-token');
    renewer = new JwtRenewer(client, '/api/device/auth', {
      baseDelayMs: 100,
      maxDelayMs: 3200,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Helper: mock a fetch response */
  function mockFetchResponse(status: number, data: unknown = null): void {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => data,
    });
  }

  /** Helper: create a request function that returns a specific response */
  function createRequest(response: HttpResponse): () => Promise<HttpResponse> {
    return vi.fn().mockResolvedValue(response);
  }

  describe('non-401 responses pass through', () => {
    it('should return the response directly when status is 200', async () => {
      const okResponse: HttpResponse = { ok: true, status: 200, data: { items: [] } };
      const request = createRequest(okResponse);

      const result = await renewer.withAutoRenewal(request);

      expect(result).toBe(okResponse);
      expect(request).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return the response directly when status is 500', async () => {
      const errorResponse: HttpResponse = { ok: false, status: 500, data: null };
      const request = createRequest(errorResponse);

      const result = await renewer.withAutoRenewal(request);

      expect(result).toBe(errorResponse);
      expect(request).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return the response directly when status is 403', async () => {
      const forbiddenResponse: HttpResponse = { ok: false, status: 403, data: null };
      const request = createRequest(forbiddenResponse);

      const result = await renewer.withAutoRenewal(request);

      expect(result).toBe(forbiddenResponse);
      expect(request).toHaveBeenCalledOnce();
    });
  });

  describe('401 detection and automatic renewal', () => {
    it('should call POST to auth endpoint when request returns 401', async () => {
      const unauthorizedResponse: HttpResponse = { ok: false, status: 401, data: null };
      const okResponse: HttpResponse = { ok: true, status: 200, data: { items: [] } };

      let callCount = 0;
      const request = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(unauthorizedResponse);
        return Promise.resolve(okResponse);
      });

      // Mock the auth endpoint POST response
      mockFetchResponse(200, { token: 'new-jwt-token' });

      const result = await renewer.withAutoRenewal(request);

      // Should have called POST to auth endpoint
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://localhost:8000/api/device/auth');
      expect(init.method).toBe('POST');
      expect(result).toEqual(okResponse);
    });

    it('should set the new token on the client after successful renewal', async () => {
      const unauthorizedResponse: HttpResponse = { ok: false, status: 401, data: null };
      const okResponse: HttpResponse = { ok: true, status: 200, data: { success: true } };

      let callCount = 0;
      const request = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(unauthorizedResponse);
        return Promise.resolve(okResponse);
      });

      mockFetchResponse(200, { token: 'renewed-token-abc' });

      await renewer.withAutoRenewal(request);

      expect(client.getToken()).toBe('renewed-token-abc');
    });
  });

  describe('retries original request with new token', () => {
    it('should retry the original request after successful renewal', async () => {
      const unauthorizedResponse: HttpResponse = { ok: false, status: 401, data: null };
      const okResponse: HttpResponse = { ok: true, status: 200, data: { manifest: 'v2' } };

      let callCount = 0;
      const request = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(unauthorizedResponse);
        return Promise.resolve(okResponse);
      });

      mockFetchResponse(200, { token: 'fresh-token' });

      const result = await renewer.withAutoRenewal(request);

      // Request called twice: first 401, then retry
      expect(request).toHaveBeenCalledTimes(2);
      expect(result).toEqual(okResponse);
    });

    it('should return the retried response even if retry also fails (non-401)', async () => {
      const unauthorizedResponse: HttpResponse = { ok: false, status: 401, data: null };
      const serverError: HttpResponse = { ok: false, status: 500, data: { error: 'internal' } };

      let callCount = 0;
      const request = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(unauthorizedResponse);
        return Promise.resolve(serverError);
      });

      mockFetchResponse(200, { token: 'new-token' });

      const result = await renewer.withAutoRenewal(request);

      expect(request).toHaveBeenCalledTimes(2);
      expect(result).toEqual(serverError);
    });
  });

  describe('exponential backoff on renewal failure', () => {
    it('should return original 401 response when renewal fails', async () => {
      const unauthorizedResponse: HttpResponse = { ok: false, status: 401, data: null };
      const request = createRequest(unauthorizedResponse);

      // Auth endpoint returns failure
      mockFetchResponse(500, { error: 'auth service unavailable' });

      const result = await renewer.withAutoRenewal(request);

      expect(result).toBe(unauthorizedResponse);
      // Should NOT retry the original request
      expect(request).toHaveBeenCalledOnce();
    });

    it('should apply exponential backoff delay on subsequent renewal attempts', async () => {
      const unauthorizedResponse: HttpResponse = { ok: false, status: 401, data: null };

      // First failed renewal — no backoff yet (first attempt uses baseDelay only if backoff > base)
      const request1 = createRequest(unauthorizedResponse);
      mockFetchResponse(500, null);
      await renewer.withAutoRenewal(request1);

      // Second failed renewal — should now have backoff of 200ms (100 * 2)
      const request2 = createRequest(unauthorizedResponse);
      mockFetchResponse(500, null);

      const renewalPromise = renewer.withAutoRenewal(request2);

      // Advance time to satisfy the backoff delay
      await vi.advanceTimersByTimeAsync(200);

      await renewalPromise;

      // Third attempt — backoff should be 400ms (200 * 2)
      const request3 = createRequest(unauthorizedResponse);
      mockFetchResponse(500, null);

      const renewalPromise3 = renewer.withAutoRenewal(request3);
      await vi.advanceTimersByTimeAsync(400);
      await renewalPromise3;

      // Verify all auth calls were made
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should cap backoff at maxDelayMs', async () => {
      const unauthorizedResponse: HttpResponse = { ok: false, status: 401, data: null };

      // Fail multiple times to exceed max: 100 → 200 → 400 → 800 → 1600 → 3200 → capped at 3200
      for (let i = 0; i < 6; i++) {
        const request = createRequest(unauthorizedResponse);
        mockFetchResponse(500, null);
        const promise = renewer.withAutoRenewal(request);
        // Advance enough time for any backoff
        await vi.advanceTimersByTimeAsync(10000);
        await promise;
      }

      // Next attempt should still be capped at 3200ms
      const request = createRequest(unauthorizedResponse);
      mockFetchResponse(500, null);
      const startTime = Date.now();
      const promise = renewer.withAutoRenewal(request);

      // Advance 3200ms — should complete
      await vi.advanceTimersByTimeAsync(3200);
      await promise;

      expect(fetchMock).toHaveBeenCalledTimes(7);
    });
  });

  describe('backoff reset after success', () => {
    it('should reset backoff to base delay after successful renewal', async () => {
      const unauthorizedResponse: HttpResponse = { ok: false, status: 401, data: null };
      const okResponse: HttpResponse = { ok: true, status: 200, data: { ok: true } };

      // First: fail renewal to increase backoff
      const request1 = createRequest(unauthorizedResponse);
      mockFetchResponse(500, null);
      await renewer.withAutoRenewal(request1);
      // backoff now = 200

      // Second: fail again to increase backoff
      const request2 = createRequest(unauthorizedResponse);
      mockFetchResponse(500, null);
      const promise2 = renewer.withAutoRenewal(request2);
      await vi.advanceTimersByTimeAsync(200);
      await promise2;
      // backoff now = 400

      // Third: succeed renewal — backoff should reset
      let callCount3 = 0;
      const request3 = vi.fn().mockImplementation(() => {
        callCount3++;
        if (callCount3 === 1) return Promise.resolve(unauthorizedResponse);
        return Promise.resolve(okResponse);
      });
      mockFetchResponse(200, { token: 'success-token' });
      const promise3 = renewer.withAutoRenewal(request3);
      await vi.advanceTimersByTimeAsync(400);
      await promise3;

      // Fourth: fail again — should start at base backoff (no delay on first failure)
      const request4 = createRequest(unauthorizedResponse);
      mockFetchResponse(500, null);
      // This should NOT need a long delay since backoff was reset
      const result4 = await renewer.withAutoRenewal(request4);

      expect(result4).toBe(unauthorizedResponse);
    });
  });

  describe('concurrent 401 deduplication', () => {
    it('should deduplicate concurrent renewal attempts', async () => {
      const unauthorizedResponse: HttpResponse = { ok: false, status: 401, data: null };
      const okResponse: HttpResponse = { ok: true, status: 200, data: { done: true } };

      // Multiple requests that get 401 simultaneously
      const makeRequest = () => {
        let callCount = 0;
        return vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve(unauthorizedResponse);
          return Promise.resolve(okResponse);
        });
      };

      const request1 = makeRequest();
      const request2 = makeRequest();
      const request3 = makeRequest();

      // Auth endpoint responds once with a new token
      mockFetchResponse(200, { token: 'shared-token' });

      // Fire all three concurrently
      const [result1, result2, result3] = await Promise.all([
        renewer.withAutoRenewal(request1),
        renewer.withAutoRenewal(request2),
        renewer.withAutoRenewal(request3),
      ]);

      // All should succeed
      expect(result1).toEqual(okResponse);
      expect(result2).toEqual(okResponse);
      expect(result3).toEqual(okResponse);

      // Only ONE auth call should have been made
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });
});
