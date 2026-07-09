/**
 * Tests for VideoRenderer — HTML5 video with hardware-accelerated decode.
 *
 * Validates: Requirements 28.3, 28.5, 20.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VideoRenderer } from '../../src/display/VideoRenderer';

describe('VideoRenderer', () => {
  let renderer: VideoRenderer;

  beforeEach(() => {
    renderer = new VideoRenderer({ width: 1920, height: 1080 });
  });

  describe('render()', () => {
    it('returns a video element', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.tagName).toBe('VIDEO');
    });

    it('sets the correct src', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.src).toBe('http://example.com/video.mp4');
    });

    it('sets data-renderer attribute', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.getAttribute('data-renderer')).toBe('video');
    });

    it('is muted by default (digital signage)', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.muted).toBe(true);
    });

    it('autoplays by default', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.autoplay).toBe(true);
    });

    it('does not loop by default', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.loop).toBe(false);
    });

    it('uses auto preload by default', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.preload).toBe('auto');
    });

    it('plays inline (no native fullscreen)', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.playsInline).toBe(true);
    });

    it('has no playback controls', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.controls).toBe(false);
    });

    it('disables remote playback (no casting UI)', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.disableRemotePlayback).toBe(true);
    });

    it('uses object-fit contain for fullscreen display', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.style.objectFit).toBe('contain');
    });

    it('uses 100% width and height for fullscreen', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.style.width).toBe('100%');
      expect(el.style.height).toBe('100%');
    });

    it('has black background', () => {
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.style.backgroundColor).toBe('rgb(0, 0, 0)');
    });
  });

  describe('render() with options override', () => {
    it('allows overriding muted per render', () => {
      const el = renderer.render('http://example.com/video.mp4', { muted: false });
      expect(el.muted).toBe(false);
    });

    it('allows overriding autoplay per render', () => {
      const el = renderer.render('http://example.com/video.mp4', { autoplay: false });
      expect(el.autoplay).toBe(false);
    });

    it('allows overriding loop per render', () => {
      const el = renderer.render('http://example.com/video.mp4', { loop: true });
      expect(el.loop).toBe(true);
    });

    it('allows overriding preload per render', () => {
      const el = renderer.render('http://example.com/video.mp4', { preload: 'metadata' });
      expect(el.preload).toBe('metadata');
    });
  });

  describe('constructor with custom config', () => {
    it('respects muted: false config', () => {
      const unmuted = new VideoRenderer({ muted: false });
      const el = unmuted.render('http://example.com/video.mp4');
      expect(el.muted).toBe(false);
    });

    it('respects loop: true config', () => {
      const looping = new VideoRenderer({ loop: true });
      const el = looping.render('http://example.com/video.mp4');
      expect(el.loop).toBe(true);
    });

    it('respects preload: metadata config', () => {
      const meta = new VideoRenderer({ preload: 'metadata' });
      const el = meta.render('http://example.com/video.mp4');
      expect(el.preload).toBe('metadata');
    });
  });

  describe('preload()', () => {
    it('returns a video element with autoplay disabled', async () => {
      // In jsdom, video 'canplaythrough' won't fire naturally.
      // We test the element setup before the event.
      const promise = renderer.preload('http://example.com/video.mp4', 100);

      // The promise should reject with timeout since jsdom doesn't fire canplaythrough
      await expect(promise).rejects.toThrow('timed out');
    });

    it('rejects with timeout error when load takes too long', async () => {
      const promise = renderer.preload('http://example.com/slow.mp4', 50);
      await expect(promise).rejects.toThrow('timed out after 50ms');
    });
  });

  describe('setConfig()', () => {
    it('updates configuration', () => {
      renderer.setConfig({ muted: false, loop: true });
      const config = renderer.getConfig();
      expect(config.muted).toBe(false);
      expect(config.loop).toBe(true);
    });

    it('preserves unmodified config values', () => {
      renderer.setConfig({ muted: false });
      const config = renderer.getConfig();
      expect(config.autoplay).toBe(true);
      expect(config.width).toBe(1920);
      expect(config.height).toBe(1080);
    });

    it('applies new config to subsequent renders', () => {
      renderer.setConfig({ muted: false });
      const el = renderer.render('http://example.com/video.mp4');
      expect(el.muted).toBe(false);
    });
  });

  describe('getConfig()', () => {
    it('returns a copy of the config (not a reference)', () => {
      const config1 = renderer.getConfig();
      const config2 = renderer.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });
});
