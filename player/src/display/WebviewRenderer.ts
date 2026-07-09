/**
 * WebviewRenderer — iframe-based web content with timeout and error handling.
 *
 * Loads URLs in an iframe element with configurable timeout and error
 * handling. Designed for digital signage use cases where web content
 * (dashboards, dynamic ads, info pages) is loaded in a sandboxed frame.
 *
 * Features:
 * - Configurable load timeout (default 10s)
 * - Error handling for load failures and timeouts
 * - Sandboxed iframe for security
 * - Fullscreen display at configured resolution
 *
 * Validates: Requirements 27.4, 28.3, 28.5, 20.2
 */

export interface WebviewRendererConfig {
  /** Display resolution width in pixels */
  width: number;
  /** Display resolution height in pixels */
  height: number;
  /** Maximum time in ms to wait for page load (default: 10000) */
  timeoutMs: number;
  /** Whether to sandbox the iframe (restricts scripts, forms, etc.) */
  sandbox: boolean;
  /** Sandbox permissions if sandboxed (e.g., 'allow-scripts allow-same-origin') */
  sandboxPermissions: string;
}

const DEFAULT_CONFIG: WebviewRendererConfig = {
  width: 1920,
  height: 1080,
  timeoutMs: 10000,
  sandbox: true,
  sandboxPermissions: 'allow-scripts allow-same-origin allow-forms',
};

export type WebviewLoadResult =
  | { success: true; element: HTMLIFrameElement }
  | { success: false; element: HTMLIFrameElement; error: string };

/**
 * WebviewRenderer creates and manages iframe elements for displaying
 * web content in a digital signage context.
 */
export class WebviewRenderer {
  private config: WebviewRendererConfig;

  constructor(config?: Partial<WebviewRendererConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Creates an iframe element configured for fullscreen web content display.
   * This is a synchronous operation that returns the element immediately.
   * The content will load asynchronously.
   *
   * @param url - The URL to load in the iframe
   * @returns A configured HTMLIFrameElement
   */
  render(url: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-renderer', 'webview');
    iframe.setAttribute('data-url', url);

    // Set the source
    iframe.src = url;

    // Fullscreen styling
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.style.backgroundColor = '#000';

    // Security: sandbox the iframe
    // Use setAttribute for broader DOM compatibility (jsdom, older browsers)
    if (this.config.sandbox) {
      iframe.setAttribute('sandbox', this.config.sandboxPermissions);
    }

    // Accessibility and semantics
    iframe.setAttribute('title', 'Web content');
    iframe.setAttribute('loading', 'eager');

    return iframe;
  }

  /**
   * Loads a URL in an iframe and waits for it to finish loading,
   * with timeout and error handling.
   *
   * @param url - The URL to load
   * @param timeoutMs - Optional timeout override in milliseconds
   * @returns Promise resolving to a load result (success or failure with error message)
   */
  async load(url: string, timeoutMs?: number): Promise<WebviewLoadResult> {
    const timeout = timeoutMs ?? this.config.timeoutMs;
    const iframe = this.render(url);

    return new Promise<WebviewLoadResult>((resolve) => {
      let settled = false;

      const onLoad = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ success: true, element: iframe });
      };

      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          success: false,
          element: iframe,
          error: `Failed to load URL: ${url}`,
        });
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          success: false,
          element: iframe,
          error: `Load timed out after ${timeout}ms for URL: ${url}`,
        });
      }, timeout);

      const cleanup = () => {
        iframe.removeEventListener('load', onLoad);
        iframe.removeEventListener('error', onError);
        clearTimeout(timer);
      };

      iframe.addEventListener('load', onLoad, { once: true });
      iframe.addEventListener('error', onError, { once: true });
    });
  }

  /**
   * Updates the renderer's configuration.
   */
  setConfig(config: Partial<WebviewRendererConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Returns the current configuration.
   */
  getConfig(): WebviewRendererConfig {
    return { ...this.config };
  }
}
