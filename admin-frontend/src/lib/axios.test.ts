import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { api, TOKEN_KEY } from './axios';

describe('axios instance', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('instance configuration', () => {
    it('should have default Accept header set to application/json', () => {
      expect(api.defaults.headers['Accept']).toBe('application/json');
    });

    it('should have default Content-Type header set to application/json', () => {
      expect(api.defaults.headers['Content-Type']).toBe('application/json');
    });

    it('should export TOKEN_KEY as admin_token', () => {
      expect(TOKEN_KEY).toBe('admin_token');
    });
  });

  describe('request interceptor', () => {
    it('should add Authorization header when token exists in localStorage', async () => {
      localStorage.setItem(TOKEN_KEY, 'test-token-123');

      // Get the request interceptor handler (first one added)
      const interceptors = (api.interceptors.request as unknown as { handlers: Array<{ fulfilled: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig }> }).handlers;
      const handler = interceptors[0].fulfilled;

      const config = {
        headers: new axios.AxiosHeaders(),
      } as InternalAxiosRequestConfig;

      const result = handler(config);
      expect(result.headers.Authorization).toBe('Bearer test-token-123');
    });

    it('should not add Authorization header when no token in localStorage', async () => {
      const interceptors = (api.interceptors.request as unknown as { handlers: Array<{ fulfilled: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig }> }).handlers;
      const handler = interceptors[0].fulfilled;

      const config = {
        headers: new axios.AxiosHeaders(),
      } as InternalAxiosRequestConfig;

      const result = handler(config);
      expect(result.headers.Authorization).toBeUndefined();
    });
  });

  describe('response interceptor', () => {
    it('should remove token and redirect on 401 response', async () => {
      localStorage.setItem(TOKEN_KEY, 'test-token-123');

      Object.defineProperty(window, 'location', {
        value: { href: '' },
        writable: true,
      });

      const interceptors = (api.interceptors.response as unknown as { handlers: Array<{ rejected: (error: unknown) => Promise<unknown> }> }).handlers;
      const errorHandler = interceptors[0].rejected;

      const error = { response: { status: 401 } };

      await expect(errorHandler(error)).rejects.toEqual(error);
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(window.location.href).toBe('/login');
    });

    it('should not remove token on non-401 errors', async () => {
      localStorage.setItem(TOKEN_KEY, 'test-token-123');

      const interceptors = (api.interceptors.response as unknown as { handlers: Array<{ rejected: (error: unknown) => Promise<unknown> }> }).handlers;
      const errorHandler = interceptors[0].rejected;

      const error = { response: { status: 500 } };

      await expect(errorHandler(error)).rejects.toEqual(error);
      expect(localStorage.getItem(TOKEN_KEY)).toBe('test-token-123');
    });

    it('should pass through successful responses', () => {
      const interceptors = (api.interceptors.response as unknown as { handlers: Array<{ fulfilled: (response: unknown) => unknown }> }).handlers;
      const successHandler = interceptors[0].fulfilled;

      const response = { status: 200, data: { ok: true } };
      expect(successHandler(response)).toBe(response);
    });
  });
});
