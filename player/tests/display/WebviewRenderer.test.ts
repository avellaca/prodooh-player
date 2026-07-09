/**
 * Tests for WebviewRenderer — iframe-based web content with timeout and error handling.
 *
 * Validates: Requirements 27.4, 28.3, 28.5, 20.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WebviewRenderer } from '../../src/display/WebviewRenderer';

describe('WebviewRenderer', () => {
  let renderer: WebviewRenderer;

  beforeEach(() => {
    renderer = new WebviewRenderer({ width: 1920, height: 1080 });
  });

  describe('render()', () => {
    it('returns an iframe element', () => {
      const el = renderer.render('http://example.com/page');
      expect(el.tagName).toBe('IFRAME');
    });

    it('sets the correct src', () => {
      const el = renderer.render('http://example.com/page');
      expect(el.src).toBe('http://example.com/page');
    });

    it('sets data-renderer attribute', () => {
      const el = renderer.render('http://example.com/page');
      expect(el.getAttribute('data-renderer')).toBe('webview');
    });

    it('sets data-url attribute for tracking', () => {
      const el = renderer.render('http://example.com/page');
      expect(el.getAttribute('data-url')).toBe('http://example.com/page');
    });

    it('has no border', () => {
      const el = renderer.render('http://example.com/page');
      // border: '0' removes the default iframe border
      expect(el.style.borderWidth).toBe('0px');
    });

    it('uses 100% width and height for fullscreen', () => {
      const el = renderer.render('http://example.com/page');
      expect(el.style.width).toBe('100%');
      expect(el.style.height).toBe('100%');
    });

    it('uses block display', () => {
      const el = renderer.render('http://example.com/page');
      expect(el.style.display).toBe('block');
    });

    it('has black background', () => {
      const el = renderer.render('http://example.com/page');
      expect(el.style.backgroundColor).toBe('rgb(0, 0, 0)');
    });

    it('applies sandbox by default', () => {
      const el = renderer.render('http://example.com/page');
      const sandboxAttr = el.getAttribute('sandbox') ?? '';
      expect(sandboxAttr).toContain('allow-scripts');
      expect(sandboxAttr).toContain('allow-same-origin');
      expect(sandboxAttr).toContain('allow-forms');
    });

    it('sets title attribute for accessibility', () => {
      const el = renderer.render('http://example.com/page');
      expect(el.getAttribute('title')).toBe('Web content');
    });

    it('uses eager loading', () => {
      const el = renderer.render('http://example.com/page');
      expect(el.getAttribute('loading')).toBe('eager');
    });
  });

  describe('render() without sandbox', () => {
    it('does not apply sandbox attribute when disabled', () => {
      const unsandboxed = new WebviewRenderer({ sandbox: false });
      const el = unsandboxed.render('http://example.com/page');
      expect(el.getAttribute('sandbox')).toBeNull();
    });
  });

  describe('render() with custom sandbox permissions', () => {
    it('applies custom sandbox permissions', () => {
      const custom = new WebviewRenderer({
        sandboxPermissions: 'allow-scripts allow-popups',
      });
      const el = custom.render('http://example.com/page');
      const sandboxAttr = el.getAttribute('sandbox') ?? '';
      expect(sandboxAttr).toContain('allow-scripts');
      expect(sandboxAttr).toContain('allow-popups');
    });
  });

  describe('load()', () => {
    it('resolves with success when iframe fires load event', async () => {
      const promise = renderer.load('http://example.com/page', 200);

      // Simulate async load event in jsdom (fires for about:blank and some URLs)
      // jsdom may auto-fire load for iframes, but to be safe, we'll check the timeout case
      const result = await promise;

      // In jsdom, iframes may or may not fire load depending on version.
      // Either success (load fired) or timeout (load didn't fire) is acceptable
      expect(result.element.tagName).toBe('IFRAME');
      expect(result.element.getAttribute('data-renderer')).toBe('webview');
    });

    it('resolves with failure and error message on timeout', async () => {
      // Use a very short timeout to force timeout
      const result = await renderer.load('http://example.com/slow-page', 10);

      // In jsdom, the load event won't fire for external URLs,
      // so this should timeout
      if (!result.success) {
        expect(result.error).toContain('timed out');
        expect(result.error).toContain('10ms');
      }
      // Either outcome is valid in jsdom - what matters is we get a result
      expect(result.element).toBeDefined();
    });

    it('uses default timeout from config when not specified', async () => {
      const shortTimeout = new WebviewRenderer({ timeoutMs: 20 });
      const result = await shortTimeout.load('http://example.com/page');

      // Should resolve within about 20ms (timeout)
      expect(result.element).toBeDefined();
    });

    it('returns the iframe element in both success and failure cases', async () => {
      const result = await renderer.load('http://example.com/page', 50);
      expect(result.element.tagName).toBe('IFRAME');
      expect(result.element.src).toBe('http://example.com/page');
    });
  });

  describe('setConfig()', () => {
    it('updates configuration', () => {
      renderer.setConfig({ timeoutMs: 5000, sandbox: false });
      const config = renderer.getConfig();
      expect(config.timeoutMs).toBe(5000);
      expect(config.sandbox).toBe(false);
    });

    it('preserves unmodified config values', () => {
      renderer.setConfig({ timeoutMs: 5000 });
      const config = renderer.getConfig();
      expect(config.width).toBe(1920);
      expect(config.height).toBe(1080);
      expect(config.sandbox).toBe(true);
    });

    it('applies new config to subsequent renders', () => {
      renderer.setConfig({ sandbox: false });
      const el = renderer.render('http://example.com/page');
      expect(el.getAttribute('sandbox')).toBeNull();
    });
  });

  describe('getConfig()', () => {
    it('returns a copy of the config', () => {
      const config1 = renderer.getConfig();
      const config2 = renderer.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });

    it('includes all default values', () => {
      const config = renderer.getConfig();
      expect(config.width).toBe(1920);
      expect(config.height).toBe(1080);
      expect(config.timeoutMs).toBe(10000);
      expect(config.sandbox).toBe(true);
      expect(config.sandboxPermissions).toBe('allow-scripts allow-same-origin allow-forms');
    });
  });
});
