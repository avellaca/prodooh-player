/**
 * ImageRenderer — Renders images with rotation metadata applied.
 *
 * Supports rotation values of 0°, 90°, 180°, 270° as stored in
 * the content's metadata (set via backend rotation endpoint).
 * Uses CSS transforms for GPU-accelerated rotation without
 * modifying the original file.
 *
 * Validates: Requirements 24.3, 28.3, 28.5, 20.2
 */

export type RotationDegrees = 0 | 90 | 180 | 270;

export interface ImageRendererConfig {
  /** Display resolution width in pixels */
  width: number;
  /** Display resolution height in pixels */
  height: number;
}

const DEFAULT_CONFIG: ImageRendererConfig = {
  width: 1920,
  height: 1080,
};

/**
 * Validates that a rotation value is one of the allowed degrees.
 */
export function isValidRotation(value: unknown): value is RotationDegrees {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/**
 * Normalizes a rotation value to one of the valid degrees (0, 90, 180, 270).
 * Invalid or missing values default to 0.
 */
export function normalizeRotation(value: unknown): RotationDegrees {
  if (isValidRotation(value)) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Normalize to 0-359 range, then snap to nearest 90°
    const normalized = ((value % 360) + 360) % 360;
    const snapped = Math.round(normalized / 90) * 90;
    if (isValidRotation(snapped)) {
      return snapped;
    }
  }
  return 0;
}

/**
 * ImageRenderer creates and configures an img element for fullscreen display
 * with rotation metadata applied via CSS transforms.
 */
export class ImageRenderer {
  private config: ImageRendererConfig;

  constructor(config?: Partial<ImageRendererConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Creates an image element configured for fullscreen display
   * with the specified rotation applied.
   *
   * @param src - URL or local path to the image
   * @param rotation - Rotation in degrees (0, 90, 180, 270). Defaults to 0.
   * @returns A configured HTMLImageElement (or wrapper div for rotated images)
   */
  render(src: string, rotation?: RotationDegrees | unknown): HTMLElement {
    const degrees = normalizeRotation(rotation);

    const img = document.createElement('img');
    img.src = src;
    img.setAttribute('data-renderer', 'image');
    img.setAttribute('data-rotation', String(degrees));

    // Base styles for fullscreen display
    img.style.display = 'block';
    img.style.objectFit = 'contain';
    img.style.backgroundColor = '#000';

    if (degrees === 0) {
      // No rotation — simple fullscreen image
      img.style.width = '100%';
      img.style.height = '100%';
      return img;
    }

    // For rotated images, wrap in a container to manage sizing properly.
    // When rotated 90° or 270°, the image dimensions swap, so we need
    // to adjust the element dimensions to fill the container correctly.
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-renderer', 'image');
    wrapper.setAttribute('data-rotation', String(degrees));
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.overflow = 'hidden';
    wrapper.style.backgroundColor = '#000';

    // Apply rotation transform
    img.style.transform = `rotate(${degrees}deg)`;

    if (degrees === 90 || degrees === 270) {
      // Swap dimensions: use the container height as width and vice versa
      // to fill the screen properly when content is rotated perpendicular
      img.style.width = `${this.config.height}px`;
      img.style.height = `${this.config.width}px`;
      img.style.maxWidth = `${this.config.height}px`;
      img.style.maxHeight = `${this.config.width}px`;
    } else {
      // 180° rotation — same dimensions, just flipped
      img.style.width = '100%';
      img.style.height = '100%';
    }

    wrapper.appendChild(img);
    return wrapper;
  }

  /**
   * Updates the renderer's resolution configuration.
   */
  setConfig(config: Partial<ImageRendererConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Returns the current resolution configuration.
   */
  getConfig(): ImageRendererConfig {
    return { ...this.config };
  }
}
