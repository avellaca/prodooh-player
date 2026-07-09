/**
 * FactoryContent — Prodooh branding animation bundled with the player.
 *
 * Provides pre-loaded factory content in both landscape and portrait orientations.
 * Used as the last-resort fallback when:
 * - The playlist is empty AND there is no connectivity
 * - The device boots for the first time before initial sync
 *
 * Once the first real playlist is adopted, factory content stops appearing
 * in normal rotation but remains stored on-device as an emergency fallback.
 *
 * Validates: Requirements 25.1, 25.2, 25.3, 25.4
 */

import type { PreparedContent, ContentType } from './types';

/** Supported screen orientations for factory content selection */
export type ScreenOrientation = 'landscape' | 'portrait';

/** Factory content identifiers */
export const FACTORY_LANDSCAPE_ID = 'factory-prodooh-branding-landscape';
export const FACTORY_PORTRAIT_ID = 'factory-prodooh-branding-portrait';
export const FACTORY_CONTENT_DURATION = 10; // seconds

/**
 * Configuration for FactoryContent provider.
 */
export interface FactoryContentConfig {
  /** Screen orientation to select the appropriate branding asset */
  orientation?: ScreenOrientation;
}

/**
 * FactoryContent manages Prodooh branding assets that ship with the player.
 *
 * Features:
 * - Orientation-aware: serves landscape or portrait branding based on config
 * - Tracks playlist adoption state to stop showing in normal rotation
 * - Always available as last-resort fallback (never deleted from device)
 * - Pre-renders branded HTML element for instant display
 */
export class FactoryContent {
  private orientation: ScreenOrientation;
  private playlistAdopted: boolean = false;

  constructor(config?: FactoryContentConfig) {
    this.orientation = config?.orientation ?? 'landscape';
  }

  /**
   * Returns true if a real playlist has been adopted.
   * When true, factory content should not appear in normal rotation,
   * only as emergency fallback when everything else fails.
   */
  isPlaylistAdopted(): boolean {
    return this.playlistAdopted;
  }

  /**
   * Mark that a real playlist has been adopted.
   * After this, factory content stops showing in normal rotation (Req 25.3).
   */
  markPlaylistAdopted(): void {
    this.playlistAdopted = true;
  }

  /**
   * Reset playlist adoption state (e.g. for testing or device wipe).
   */
  resetAdoptionState(): void {
    this.playlistAdopted = false;
  }

  /**
   * Get the current orientation setting.
   */
  getOrientation(): ScreenOrientation {
    return this.orientation;
  }

  /**
   * Update the orientation (e.g. when config is synced from backend).
   */
  setOrientation(orientation: ScreenOrientation): void {
    this.orientation = orientation;
  }

  /**
   * Returns true if factory content should be used.
   * Factory content is available when:
   * - No real playlist has been adopted yet (first boot / no sync)
   * - OR as a last-resort fallback (called directly by FallbackBuffer when playlist is empty)
   *
   * The distinction: when playlistAdopted is false, factory shows in normal rotation.
   * When playlistAdopted is true, factory only shows if explicitly requested as fallback.
   */
  shouldShowInRotation(): boolean {
    return !this.playlistAdopted;
  }

  /**
   * Load factory content for the current orientation.
   * Returns a PreparedContent with a pre-rendered branded HTML element.
   *
   * This is always available regardless of network or playlist state,
   * making it the true last-resort fallback (Req 25.2).
   */
  loadContent(): PreparedContent {
    const isLandscape = this.orientation === 'landscape';
    const id = isLandscape ? FACTORY_LANDSCAPE_ID : FACTORY_PORTRAIT_ID;

    const element = this.createBrandingElement(isLandscape);

    return {
      id,
      type: 'html' as ContentType,
      source: 'playlist',
      mediaUrl: '',
      duration: FACTORY_CONTENT_DURATION,
      metadata: {
        isFactory: true,
        orientation: this.orientation,
        description: `Prodooh branding animation — ${this.orientation}`,
      },
      element,
    };
  }

  /**
   * Creates the Prodooh branding HTML element with animated styling.
   * Adapts layout for landscape vs portrait orientation.
   *
   * The animation uses CSS keyframes for a subtle pulse/fade effect
   * that gives the impression of motion without requiring a video file.
   */
  private createBrandingElement(isLandscape: boolean): HTMLElement {
    const container = document.createElement('div');
    container.dataset.factory = 'true';
    container.dataset.orientation = isLandscape ? 'landscape' : 'portrait';

    // Base container styles
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.backgroundColor = '#1a1a2e';
    container.style.color = '#ffffff';
    container.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    container.style.overflow = 'hidden';
    container.style.position = 'relative';

    // Background gradient layer
    const bgGradient = document.createElement('div');
    bgGradient.style.position = 'absolute';
    bgGradient.style.top = '0';
    bgGradient.style.left = '0';
    bgGradient.style.width = '100%';
    bgGradient.style.height = '100%';
    bgGradient.style.background = 'radial-gradient(ellipse at center, #16213e 0%, #0f3460 50%, #1a1a2e 100%)';
    bgGradient.style.opacity = '0.8';
    container.appendChild(bgGradient);

    // Content wrapper (above gradient)
    const content = document.createElement('div');
    content.style.position = 'relative';
    content.style.zIndex = '1';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.alignItems = 'center';
    content.style.justifyContent = 'center';
    content.style.textAlign = 'center';
    content.style.padding = isLandscape ? '2rem 4rem' : '4rem 2rem';

    // Logo / brand name
    const logo = document.createElement('div');
    logo.style.fontSize = isLandscape ? '5rem' : '4rem';
    logo.style.fontWeight = '700';
    logo.style.letterSpacing = '0.1em';
    logo.style.textTransform = 'uppercase';
    logo.style.marginBottom = '1rem';
    logo.textContent = 'Prodooh';
    content.appendChild(logo);

    // Tagline
    const tagline = document.createElement('div');
    tagline.style.fontSize = isLandscape ? '1.5rem' : '1.2rem';
    tagline.style.fontWeight = '300';
    tagline.style.opacity = '0.7';
    tagline.style.letterSpacing = '0.2em';
    tagline.textContent = 'DIGITAL SIGNAGE';
    content.appendChild(tagline);

    // Animated accent line
    const accentLine = document.createElement('div');
    accentLine.style.width = isLandscape ? '200px' : '150px';
    accentLine.style.height = '3px';
    accentLine.style.backgroundColor = '#e94560';
    accentLine.style.marginTop = '2rem';
    accentLine.style.borderRadius = '2px';
    content.appendChild(accentLine);

    container.appendChild(content);

    // Add CSS animation via a style element
    const style = document.createElement('style');
    style.textContent = `
      @keyframes prodooh-pulse {
        0%, 100% { opacity: 0.7; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.02); }
      }
      @keyframes prodooh-accent {
        0%, 100% { width: ${isLandscape ? '200px' : '150px'}; opacity: 0.8; }
        50% { width: ${isLandscape ? '300px' : '200px'}; opacity: 1; }
      }
    `;
    container.appendChild(style);

    // Apply animation to content wrapper
    content.style.animation = 'prodooh-pulse 4s ease-in-out infinite';
    accentLine.style.animation = 'prodooh-accent 3s ease-in-out infinite';

    return container;
  }
}
