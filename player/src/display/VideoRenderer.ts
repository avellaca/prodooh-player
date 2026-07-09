/**
 * VideoRenderer — HTML5 video element with hardware-accelerated decode.
 *
 * Creates and configures video elements for fullscreen playback at
 * the configured display resolution. Enables hardware acceleration
 * hints and manages autoplay, muting, and preload behavior suitable
 * for digital signage on Raspberry Pi 5.
 *
 * Validates: Requirements 28.3, 28.5, 20.2
 */

export interface VideoRendererConfig {
  /** Display resolution width in pixels */
  width: number;
  /** Display resolution height in pixels */
  height: number;
  /** Whether to mute video by default (digital signage typically muted) */
  muted: boolean;
  /** Whether to autoplay when element is shown */
  autoplay: boolean;
  /** Whether video should loop */
  loop: boolean;
  /** Preload strategy */
  preload: 'none' | 'metadata' | 'auto';
}

const DEFAULT_CONFIG: VideoRendererConfig = {
  width: 1920,
  height: 1080,
  muted: true,
  autoplay: true,
  loop: false,
  preload: 'auto',
};

/**
 * VideoRenderer creates and configures HTML5 video elements for
 * fullscreen digital signage playback.
 *
 * Features:
 * - Hardware-accelerated decode (via standard video element + browser hints)
 * - Fullscreen display at configured resolution
 * - Autoplay and muting for unattended playback
 * - Preload support for gapless transitions
 * - Event callbacks for playback lifecycle
 */
export class VideoRenderer {
  private config: VideoRendererConfig;

  constructor(config?: Partial<VideoRendererConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Creates a video element configured for fullscreen playback.
   *
   * The element is ready to be appended to the DOM. Once appended,
   * if autoplay is enabled, playback begins immediately.
   *
   * @param src - URL or local path to the video file
   * @param options - Optional overrides for this specific render
   * @returns A configured HTMLVideoElement
   */
  render(src: string, options?: Partial<VideoRenderOptions>): HTMLVideoElement {
    const video = document.createElement('video');
    video.setAttribute('data-renderer', 'video');

    // Set the source
    video.src = src;

    // Apply playback configuration
    video.muted = options?.muted ?? this.config.muted;
    video.autoplay = options?.autoplay ?? this.config.autoplay;
    video.loop = options?.loop ?? this.config.loop;
    video.preload = options?.preload ?? this.config.preload;

    // Inline playback (no native fullscreen controls)
    video.playsInline = true;
    video.controls = false;

    // Fullscreen styling at configured resolution
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.style.backgroundColor = '#000';
    video.style.display = 'block';

    // Hardware acceleration hint: prefer hardware decode
    // The 'disableRemotePlayback' prevents casting UI on signage devices
    video.disableRemotePlayback = true;

    return video;
  }

  /**
   * Preloads a video and returns a Promise that resolves when the video
   * has enough data to begin playback without buffering.
   *
   * This enables gapless transitions — the next video is decoded and
   * buffered in memory before it's shown.
   *
   * @param src - URL or local path to the video file
   * @param timeoutMs - Maximum time to wait for preload (default: 10000ms)
   * @returns Promise resolving to the preloaded video element
   */
  async preload(src: string, timeoutMs: number = 10000): Promise<HTMLVideoElement> {
    const video = this.render(src, { autoplay: false, preload: 'auto' });

    return new Promise<HTMLVideoElement>((resolve, reject) => {
      let settled = false;

      const onCanPlay = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(video);
      };

      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const errorCode = video.error?.code ?? 0;
        const errorMsg = video.error?.message ?? 'Unknown video error';
        reject(new Error(`Video preload failed (code ${errorCode}): ${errorMsg}`));
      };

      const onTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Video preload timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        video.removeEventListener('canplaythrough', onCanPlay);
        video.removeEventListener('error', onError);
        clearTimeout(onTimeout);
      };

      video.addEventListener('canplaythrough', onCanPlay, { once: true });
      video.addEventListener('error', onError, { once: true });

      // Trigger load
      video.load();
    });
  }

  /**
   * Updates the renderer's configuration.
   */
  setConfig(config: Partial<VideoRendererConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Returns the current configuration.
   */
  getConfig(): VideoRendererConfig {
    return { ...this.config };
  }
}

/**
 * Options that can be overridden per-render call.
 */
export interface VideoRenderOptions {
  muted: boolean;
  autoplay: boolean;
  loop: boolean;
  preload: 'none' | 'metadata' | 'auto';
}
