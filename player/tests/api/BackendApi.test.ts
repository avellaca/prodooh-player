import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackendApi } from '../../src/api/BackendApi';
import { BackendApiClient } from '../../src/api/BackendApiClient';

/**
 * Tests for BackendApi device authentication client.
 * Validates: Requirements 1.2, 1.4
 */

// Helper: create a minimal JWT token with given payload
function createTestJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = btoa('fake-signature');
  return `${header}.${body}.${signature}`;
}

// Helper: create a JWT with a specific exp timestamp (in seconds)
function createJwtWithExp(expSeconds: number): string {
  return createTestJwt({ sub: 'screen-123', exp: expSeconds });
}

describe('BackendApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createApi(overrides?: Partial<{ baseUrl: string; venueId: string; deviceToken: string }>) {
    return new BackendApi({
      baseUrl: overrides?.baseUrl ?? 'http://localhost:8000',
      venueId: overrides?.venueId ?? 'venue-001',
      deviceToken: overrides?.deviceToken ?? 'secret-token',
    });
  }

  describe('authenticate()', () => {
    it('should POST to /api/device/auth with correct body', async () => {
      const expTime = Math.floor(Date.now() / 1000) + 3600;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 3600 }),
      });

      const api = createApi();
      const result = await api.authenticate();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://localhost:8000/api/device/auth');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        device_token: 'secret-token',
        venue_id: 'venue-001',
      });
    });

    it('should store the token and mark as authenticated on success', async () => {
      const expTime = Math.floor(Date.now() / 1000) + 3600;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 3600 }),
      });

      const api = createApi();
      await api.authenticate();

      expect(api.getToken()).toBe(jwt);
      expect(api.isAuthenticated()).toBe(true);
    });

    it('should return false when backend returns 401', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Unauthorized' }),
      });

      const api = createApi();
      const result = await api.authenticate();

      expect(result).toBe(false);
      expect(api.getToken()).toBeNull();
      expect(api.isAuthenticated()).toBe(false);
    });

    it('should return false when network is unreachable (graceful degradation)', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const api = createApi();
      const result = await api.authenticate();

      expect(result).toBe(false);
      expect(api.getToken()).toBeNull();
      expect(api.isAuthenticated()).toBe(false);
    });

    it('should set Bearer token on the underlying client', async () => {
      const expTime = Math.floor(Date.now() / 1000) + 3600;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 3600 }),
      });

      const api = createApi();
      await api.authenticate();

      expect(api.getClient().getToken()).toBe(jwt);
    });
  });

  describe('isAuthenticated()', () => {
    it('should return false when no token exists', () => {
      const api = createApi();
      expect(api.isAuthenticated()).toBe(false);
    });

    it('should return false when token has expired', async () => {
      // Expired 10 seconds ago
      const expTime = Math.floor(Date.now() / 1000) - 10;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: -10 }),
      });

      const api = createApi();
      await api.authenticate();

      expect(api.isAuthenticated()).toBe(false);
    });

    it('should return true when token is still valid', async () => {
      const expTime = Math.floor(Date.now() / 1000) + 7200;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 7200 }),
      });

      const api = createApi();
      await api.authenticate();

      expect(api.isAuthenticated()).toBe(true);
    });
  });

  describe('refreshIfNeeded()', () => {
    it('should authenticate if no token exists', async () => {
      const expTime = Math.floor(Date.now() / 1000) + 3600;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 3600 }),
      });

      const api = createApi();
      const result = await api.refreshIfNeeded();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('should not re-authenticate if token is far from expiry', async () => {
      // Token expires in 2 hours (well above 60s buffer)
      const expTime = Math.floor(Date.now() / 1000) + 7200;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 7200 }),
      });

      const api = createApi();
      await api.authenticate();
      fetchMock.mockClear();

      const result = await api.refreshIfNeeded();

      expect(result).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should re-authenticate if token is close to expiry', async () => {
      // Token expires in 30 seconds (below 60s buffer)
      const expTime = Math.floor(Date.now() / 1000) + 30;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 30 }),
      });

      const api = createApi();
      await api.authenticate();
      fetchMock.mockClear();

      // Now mock a new token for refresh
      const newExpTime = Math.floor(Date.now() / 1000) + 3600;
      const newJwt = createJwtWithExp(newExpTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: newJwt, expires_in: 3600 }),
      });

      const result = await api.refreshIfNeeded();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(api.getToken()).toBe(newJwt);
    });

    it('should return false if refresh fails due to network error', async () => {
      // Token expires in 10 seconds (below buffer)
      const expTime = Math.floor(Date.now() / 1000) + 10;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 10 }),
      });

      const api = createApi();
      await api.authenticate();
      fetchMock.mockClear();

      // Network failure on refresh
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const result = await api.refreshIfNeeded();

      expect(result).toBe(false);
    });
  });

  describe('JWT expiry parsing', () => {
    it('should use exp claim from JWT payload for expiry calculation', async () => {
      // Token with exp 2 hours from now
      const expTime = Math.floor(Date.now() / 1000) + 7200;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 3600 }), // expires_in says 1h but JWT says 2h
      });

      const api = createApi();
      await api.authenticate();

      // Should use JWT exp (2h), not expires_in (1h), so still authenticated
      expect(api.isAuthenticated()).toBe(true);
    });

    it('should fallback to expires_in when JWT has no exp claim', async () => {
      // JWT without exp claim
      const jwt = createTestJwt({ sub: 'screen-123' });

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 3600 }),
      });

      const api = createApi();
      await api.authenticate();

      expect(api.isAuthenticated()).toBe(true);
      expect(api.getToken()).toBe(jwt);
    });
  });

  describe('BackendApiClient integration', () => {
    it('should attach Bearer token to subsequent requests after auth', async () => {
      const expTime = Math.floor(Date.now() / 1000) + 3600;
      const jwt = createJwtWithExp(expTime);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ access_token: jwt, expires_in: 3600 }),
      });

      const api = createApi();
      await api.authenticate();
      fetchMock.mockClear();

      // Make a subsequent request using the client
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ venue_id: 'venue-001' }),
      });

      await api.getClient().get('/api/device/config');

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init.headers['Authorization']).toBe(`Bearer ${jwt}`);
    });

    it('should handle non-JSON responses gracefully', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html>Error</html>',
      });

      const api = createApi();
      const result = await api.authenticate();

      // No JSON data means auth can't succeed
      expect(result).toBe(false);
    });
  });
});
