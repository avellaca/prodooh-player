/**
 * Low-level HTTP client wrapper for backend API communication.
 * Uses the Fetch API (available in Chromium) with automatic Bearer token
 * attachment and graceful network error handling.
 *
 * Validates: Requirements 1.2, 1.4
 */

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
}

export class BackendApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** Set the Bearer token for authenticated requests */
  setToken(token: string | null): void {
    this.token = token;
  }

  /** Get the currently set token */
  getToken(): string | null {
    return this.token;
  }

  /** Perform a GET request */
  async get<T = unknown>(path: string, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    return this.request<T>('GET', path, undefined, headers);
  }

  /** Perform a POST request */
  async post<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    return this.request<T>('POST', path, body, headers);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<HttpResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...extraHeaders,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, init);
      let data: T | null = null;

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        data = (await response.json()) as T;
      }

      return {
        ok: response.ok,
        status: response.status,
        data,
      };
    } catch {
      // Network error (backend unreachable, DNS failure, etc.)
      return {
        ok: false,
        status: 0,
        data: null,
      };
    }
  }
}
