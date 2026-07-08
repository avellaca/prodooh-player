/**
 * Device authentication client for the backend API.
 * Handles POST /api/device/auth, JWT token storage, expiry tracking,
 * and graceful degradation when the backend is unreachable.
 *
 * Validates: Requirements 1.2, 1.4
 */

import { BackendApiClient } from './BackendApiClient';

export interface BackendApiConfig {
  baseUrl: string;
  venueId: string;
  deviceToken: string;
}

interface AuthResponse {
  access_token: string;
  expires_in: number;
}

/** Decode JWT payload without signature verification (client-side only) */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1]!;
    // Base64url → Base64
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Buffer in seconds before actual expiry to trigger refresh */
const REFRESH_BUFFER_SECONDS = 60;

export class BackendApi {
  private client: BackendApiClient;
  private config: BackendApiConfig;
  private token: string | null = null;
  private expiresAt: number | null = null;

  constructor(config: BackendApiConfig) {
    this.config = config;
    this.client = new BackendApiClient(config.baseUrl);
  }

  /**
   * Authenticate with the backend using device_token and venue_id.
   * Returns true on success, false on failure (network error, invalid creds).
   * Does NOT throw — graceful degradation.
   */
  async authenticate(): Promise<boolean> {
    const response = await this.client.post<AuthResponse>('/api/device/auth', {
      device_token: this.config.deviceToken,
      venue_id: this.config.venueId,
    });

    if (!response.ok || !response.data) {
      this.token = null;
      this.expiresAt = null;
      return false;
    }

    const { access_token, expires_in } = response.data;
    this.setTokenFromResponse(access_token, expires_in);
    return true;
  }

  /** Returns the current JWT token, or null if not authenticated */
  getToken(): string | null {
    return this.token;
  }

  /** Returns the underlying HTTP client (with token already set) for other API calls */
  getClient(): BackendApiClient {
    return this.client;
  }

  /**
   * Check if the device is currently authenticated with a valid (non-expired) token.
   */
  isAuthenticated(): boolean {
    if (!this.token || !this.expiresAt) return false;
    return Date.now() < this.expiresAt;
  }

  /**
   * Re-authenticate if the token is close to expiry (within REFRESH_BUFFER_SECONDS).
   * Returns true if token is still valid or refresh succeeded, false otherwise.
   */
  async refreshIfNeeded(): Promise<boolean> {
    if (!this.token || !this.expiresAt) {
      return this.authenticate();
    }

    const timeUntilExpiry = this.expiresAt - Date.now();
    if (timeUntilExpiry > REFRESH_BUFFER_SECONDS * 1000) {
      // Token is still well within validity
      return true;
    }

    // Token is about to expire or already expired — re-authenticate
    return this.authenticate();
  }

  private setTokenFromResponse(accessToken: string, expiresIn: number): void {
    this.token = accessToken;
    this.client.setToken(accessToken);

    // Prefer `exp` claim from JWT payload for accurate expiry
    const payload = decodeJwtPayload(accessToken);
    if (payload && typeof payload['exp'] === 'number') {
      this.expiresAt = payload['exp'] * 1000; // convert seconds to ms
    } else {
      // Fallback: use expires_in from response
      this.expiresAt = Date.now() + expiresIn * 1000;
    }
  }
}
