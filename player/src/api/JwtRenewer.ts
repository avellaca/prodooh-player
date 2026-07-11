/**
 * JWT auto-renewal interceptor for device API communication.
 * Wraps HTTP requests: if a 401 is received, renews the JWT token
 * via the auth endpoint and retries the original request.
 *
 * Uses exponential backoff on renewal failures without blocking playback.
 *
 * Validates: Requirements 12.1, 12.2, 12.3
 */

import { BackendApiClient, HttpResponse } from './BackendApiClient';

export interface AuthResponse {
  token: string;
}

export class JwtRenewer {
  private client: BackendApiClient;
  private authEndpoint: string;

  /** Current backoff delay in ms (resets on success) */
  private backoffMs: number;

  /** Base delay for exponential backoff */
  private readonly baseDelayMs: number;

  /** Maximum backoff delay cap */
  private readonly maxDelayMs: number;

  /** Whether a renewal is currently in progress (prevents concurrent renewals) */
  private renewalInProgress: Promise<boolean> | null = null;

  constructor(
    client: BackendApiClient,
    authEndpoint: string,
    options?: { baseDelayMs?: number; maxDelayMs?: number },
  ) {
    this.client = client;
    this.authEndpoint = authEndpoint;
    this.baseDelayMs = options?.baseDelayMs ?? 1000;
    this.maxDelayMs = options?.maxDelayMs ?? 30000;
    this.backoffMs = this.baseDelayMs;
  }

  /**
   * Wraps a request: if a 401 is received, renews the JWT and retries.
   * Never blocks playback — if renewal fails, returns the failed response.
   */
  async withAutoRenewal<T>(request: () => Promise<HttpResponse<T>>): Promise<HttpResponse<T>> {
    const response = await request();

    if (response.status !== 401) {
      return response;
    }

    // 401 received — attempt to renew the token
    const renewed = await this.renewToken();

    if (renewed) {
      // Token renewed successfully — retry the original request
      return request();
    }

    // Renewal failed — return the original 401 response without blocking
    return response;
  }

  /**
   * Attempts to renew the JWT token via the auth endpoint.
   * Deduplicates concurrent renewal attempts.
   * Returns true if renewal succeeded, false otherwise.
   */
  private async renewToken(): Promise<boolean> {
    // If a renewal is already in progress, wait for it
    if (this.renewalInProgress) {
      return this.renewalInProgress;
    }

    this.renewalInProgress = this.performRenewal();

    try {
      return await this.renewalInProgress;
    } finally {
      this.renewalInProgress = null;
    }
  }

  private async performRenewal(): Promise<boolean> {
    // Wait for backoff delay if we've had previous failures
    if (this.backoffMs > this.baseDelayMs) {
      await this.delay(this.backoffMs);
    }

    const authResponse = await this.client.post<AuthResponse>(this.authEndpoint);

    if (authResponse.ok && authResponse.data?.token) {
      // Success — set new token and reset backoff
      this.client.setToken(authResponse.data.token);
      this.backoffMs = this.baseDelayMs;
      return true;
    }

    // Failure — increase backoff for next attempt
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxDelayMs);
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
