/**
 * Tests for ImageRenderer — image rendering with rotation metadata.
 *
 * Validates: Requirements 24.3, 28.3, 28.5, 20.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ImageRenderer,
  isValidRotation,
  normalizeRotation,
} from '../../src/display/ImageRenderer';
import type { RotationDegrees } from '../../src/display/ImageRenderer';

describe('ImageRenderer', () => {
  let renderer: ImageRenderer;

  beforeEach(() => {
    renderer = new ImageRenderer({ width: 1920, height: 1080 });
  });

  describe('render() with no rotation (0°)', () => {
    it('returns an img element', () => {
      const el = renderer.render('http://example.com/image.jpg', 0);
      expect(el.tagName).toBe('IMG');
    });

    it('sets the correct src', () => {
      const el = renderer.render('http://example.com/image.jpg', 0) as HTMLImageElement;
      expect(el.src).toBe('http://example.com/image.jpg');
    });

    it('sets data-renderer attribute', () => {
      const el = renderer.render('http://example.com/image.jpg', 0);
      expect(el.getAttribute('data-renderer')).toBe('image');
    });

    it('sets data-rotation to 0', () => {
      const el = renderer.render('http://example.com/image.jpg', 0);
      expect(el.getAttribute('data-rotation')).toBe('0');
    });

    it('uses object-fit contain for fullscreen display', () => {
      const el = renderer.render('http://example.com/image.jpg', 0) as HTMLImageElement;
      expect(el.style.objectFit).toBe('contain');
    });

    it('uses 100% width and height for fullscreen', () => {
      const el = renderer.render('http://example.com/image.jpg', 0) as HTMLImageElement;
      expect(el.style.width).toBe('100%');
      expect(el.style.height).toBe('100%');
    });

    it('defaults to 0° when rotation is omitted', () => {
      const el = renderer.render('http://example.com/image.jpg');
      expect(el.tagName).toBe('IMG');
      expect(el.getAttribute('data-rotation')).toBe('0');
    });
  });

  describe('render() with 180° rotation', () => {
    it('returns a wrapper div with a rotated img inside', () => {
      const el = renderer.render('http://example.com/image.jpg', 180);
      expect(el.tagName).toBe('DIV');
      expect(el.getAttribute('data-rotation')).toBe('180');

      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.style.transform).toBe('rotate(180deg)');
    });

    it('sets 100% dimensions for 180° rotation (no dimension swap needed)', () => {
      const el = renderer.render('http://example.com/image.jpg', 180);
      const img = el.querySelector('img')!;
      expect(img.style.width).toBe('100%');
      expect(img.style.height).toBe('100%');
    });
  });

  describe('render() with 90° rotation', () => {
    it('returns a wrapper div with a rotated img inside', () => {
      const el = renderer.render('http://example.com/image.jpg', 90);
      expect(el.tagName).toBe('DIV');
      expect(el.getAttribute('data-rotation')).toBe('90');

      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.style.transform).toBe('rotate(90deg)');
    });

    it('swaps dimensions for 90° rotation', () => {
      const el = renderer.render('http://example.com/image.jpg', 90);
      const img = el.querySelector('img')!;
      // For 90° rotation with 1920x1080 config:
      // Width should become height (1080), height should become width (1920)
      expect(img.style.width).toBe('1080px');
      expect(img.style.height).toBe('1920px');
    });
  });

  describe('render() with 270° rotation', () => {
    it('returns a wrapper div with a rotated img inside', () => {
      const el = renderer.render('http://example.com/image.jpg', 270);
      expect(el.tagName).toBe('DIV');

      const img = el.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.style.transform).toBe('rotate(270deg)');
    });

    it('swaps dimensions for 270° rotation', () => {
      const el = renderer.render('http://example.com/image.jpg', 270);
      const img = el.querySelector('img')!;
      expect(img.style.width).toBe('1080px');
      expect(img.style.height).toBe('1920px');
    });
  });

  describe('render() with portrait config', () => {
    it('handles portrait resolution correctly for 90° rotation', () => {
      const portrait = new ImageRenderer({ width: 1080, height: 1920 });
      const el = portrait.render('http://example.com/image.jpg', 90);
      const img = el.querySelector('img')!;
      // For portrait 1080x1920 with 90° rotation:
      // Width gets height (1920), height gets width (1080)
      expect(img.style.width).toBe('1920px');
      expect(img.style.height).toBe('1080px');
    });
  });

  describe('setConfig()', () => {
    it('updates resolution configuration', () => {
      renderer.setConfig({ width: 3840, height: 2160 });
      const config = renderer.getConfig();
      expect(config.width).toBe(3840);
      expect(config.height).toBe(2160);
    });

    it('applies new config to subsequent renders', () => {
      renderer.setConfig({ width: 3840, height: 2160 });
      const el = renderer.render('http://example.com/image.jpg', 90);
      const img = el.querySelector('img')!;
      expect(img.style.width).toBe('2160px');
      expect(img.style.height).toBe('3840px');
    });
  });
});

describe('isValidRotation()', () => {
  it('returns true for valid rotation values', () => {
    expect(isValidRotation(0)).toBe(true);
    expect(isValidRotation(90)).toBe(true);
    expect(isValidRotation(180)).toBe(true);
    expect(isValidRotation(270)).toBe(true);
  });

  it('returns false for invalid rotation values', () => {
    expect(isValidRotation(45)).toBe(false);
    expect(isValidRotation(360)).toBe(false);
    expect(isValidRotation(-90)).toBe(false);
    expect(isValidRotation('90')).toBe(false);
    expect(isValidRotation(null)).toBe(false);
    expect(isValidRotation(undefined)).toBe(false);
  });
});

describe('normalizeRotation()', () => {
  it('returns valid rotation values unchanged', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
  });

  it('defaults to 0 for non-number values', () => {
    expect(normalizeRotation(null)).toBe(0);
    expect(normalizeRotation(undefined)).toBe(0);
    expect(normalizeRotation('90')).toBe(0);
    expect(normalizeRotation({})).toBe(0);
  });

  it('normalizes negative values', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(-270)).toBe(90);
  });

  it('normalizes values over 360', () => {
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(720)).toBe(0);
  });

  it('snaps to nearest 90° for non-exact values', () => {
    // Math.round(45/90) = 1, so 45 snaps to 90 (midpoint rounds up)
    expect(normalizeRotation(45)).toBe(90);
    expect(normalizeRotation(80)).toBe(90);
    expect(normalizeRotation(135)).toBe(180);
    expect(normalizeRotation(200)).toBe(180);
    expect(normalizeRotation(260)).toBe(270);
    // Values close to 0
    expect(normalizeRotation(10)).toBe(0);
    expect(normalizeRotation(44)).toBe(0);
  });

  it('defaults to 0 for NaN and Infinity', () => {
    expect(normalizeRotation(NaN)).toBe(0);
    expect(normalizeRotation(Infinity)).toBe(0);
    expect(normalizeRotation(-Infinity)).toBe(0);
  });
});
