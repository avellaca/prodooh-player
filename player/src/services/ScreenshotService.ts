/**
 * ScreenshotService — captures the current frame on demand and uploads
 * it as a JPEG to the backend via multipart POST.
 *
 * Triggered by the HeartbeatService's CommandHandler when a 'screenshot'
 * command is received from the backend.
 *
 * Validates: Requirements 17.1, 17.2
 */

import type { CommandHandler, DeviceCommand } from '../sync/HeartbeatService';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScreenshotResponse {
  id: string;
  url: string;
}

/**
 * Interface for capturing the current display frame.
 * Implementations can use canvas.toBlob, html2canvas, or screen capture API.
 */
export interface ScreenCaptureProvider {
  /** Capture the current frame as a JPEG Blob */
  captureFrame(): Promise<Blob>;
}

export interface ScreenshotServiceOptions {
  /** Base URL for the backend API (e.g., http://localhost:8000) */
  baseUrl: string;

  /** Function to get the current Bearer token */
  getToken: () => string | null;

  /** Provider that captures the current screen frame */
  captureProvider: ScreenCaptureProvider;

  /** Timeout in milliseconds for the entire capture + upload operation (default: 30000) */
  timeoutMs?: number;
}

// ─── ScreenshotService ───────────────────────────────────────────────────────

export class ScreenshotService implements CommandHandler {
  private baseUrl: string;
  private getToken: () => string | null;
  private captureProvider: ScreenCaptureProvider;
  private timeoutMs: number;

  constructor(options: ScreenshotServiceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getToken = options.getToken;
    this.captureProvider = options.captureProvider;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /**
   * Handle a device command from the heartbeat response.
   * Only processes 'screenshot' commands; ignores others.
   */
  async handleCommand(command: DeviceCommand): Promise<void> {
    if (command.type !== 'screenshot') {
      return;
    }
    await this.captureAndUpload();
  }

  /**
   * Capture the current frame and upload it to the backend.
   * Throws if capture fails, upload fails, or the 30s timeout is exceeded.
   */
  async captureAndUpload(): Promise<ScreenshotResponse> {
    // Race the entire operation against a timeout
    const result = await this.withTimeout(this.doCaptureAndUpload());
    return result;
  }

  private async doCaptureAndUpload(): Promise<ScreenshotResponse> {
    // Capture the frame
    const blob = await this.captureProvider.captureFrame();

    // Build multipart form data
    const formData = new FormData();
    formData.append('image', blob, 'screenshot.jpg');
    formData.append('captured_at', new Date().toISOString());

    // Upload to backend
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/api/device/screenshot`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Screenshot upload failed with status ${response.status}`);
    }

    const data = (await response.json()) as ScreenshotResponse;
    return data;
  }

  /**
   * Race a promise against a timeout. Rejects with an error if the timeout expires first.
   */
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Screenshot operation timed out'));
        }
      }, this.timeoutMs);

      promise.then(
        (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }
        },
        (error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        },
      );
    });
  }
}
