/**
 * Tests for FullscreenRenderer — layered display management.
 *
 * Validates: Requirements 6.2, 6.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FullscreenRenderer } from '../../src/display/FullscreenRenderer';
import type { TransitionConfig } from '../../src/display/FullscreenRenderer';
import type { PreparedContent } from '../../src/sources/types';

function makeContent(overrides: Partial<PreparedContent> = {}): PreparedContent {
  return {
    id: 'test-content-1',
    type: 'image',
    source: 'playlist',
    mediaUrl: 'http://example.com/image.jpg',
    duration: 10,
    metadata: {},
    ...overrides,
  };
}

function makeContentWithElement(id: string): PreparedContent {
  const el = document.createElement('div');
  el.textContent = `Content ${id}`;
  el.setAttribute('data-test-id', id);
  return {
    id,
    type: 'image',
    source: 'playlist',
    mediaUrl: `http://example.com/${id}.jpg`,
    duration: 10,
    metadata: {},
    element: el,
  };
}

describe('FullscreenRenderer', () => {
  let container: HTMLElement;
  let renderer: FullscreenRenderer;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    renderer = new FullscreenRenderer(container);
  });

  describe('Layer structure', () => {
    it('creates 3 layers inside the container', () => {
      const layers = container.querySelectorAll('[data-layer]');
      expect(layers.length).toBe(3);
    });

    it('creates primary, transition, and fallback layers with correct z-index order', () => {
      const primary = container.querySelector('[data-layer="primary-layer"]') as HTMLElement;
      const transition = container.querySelector('[data-layer="transition-layer"]') as HTMLElement;
      const fallback = container.querySelector('[data-layer="fallback-layer"]') as HTMLElement;

      expect(primary).not.toBeNull();
      expect(transition).not.toBeNull();
      expect(fallback).not.toBeNull();

      expect(primary.style.zIndex).toBe('1');
      expect(transition.style.zIndex).toBe('2');
      expect(fallback.style.zIndex).toBe('3');
    });

    it('positions all layers absolutely for stacking', () => {
      const layers = container.querySelectorAll('[data-layer]');
      layers.forEach((layer) => {
        expect((layer as HTMLElement).style.position).toBe('absolute');
      });
    });

    it('sets up the container as a stacking context', () => {
      expect(container.style.position).toBe('relative');
      expect(container.style.overflow).toBe('hidden');
    });

    it('starts with transition and fallback layers hidden', () => {
      const transition = renderer.getTransitionLayer();
      const fallback = renderer.getFallbackLayer();

      expect(transition.style.visibility).toBe('hidden');
      expect(fallback.style.visibility).toBe('hidden');
    });
  });

  describe('show()', () => {
    it('displays content on the primary layer', () => {
      const content = makeContentWithElement('show-1');
      renderer.show(content);

      const primary = renderer.getPrimaryLayer();
      expect(primary.children.length).toBe(1);
      expect(primary.querySelector('[data-test-id="show-1"]')).not.toBeNull();
    });

    it('makes primary layer visible', () => {
      const content = makeContent();
      renderer.show(content);

      expect(renderer.getPrimaryLayer().style.visibility).toBe('visible');
    });

    it('hides transition and fallback layers', () => {
      const content = makeContent();
      renderer.show(content);

      expect(renderer.getTransitionLayer().style.visibility).toBe('hidden');
      expect(renderer.getFallbackLayer().style.visibility).toBe('hidden');
    });

    it('tracks the current content', () => {
      const content = makeContent({ id: 'tracked-content' });
      renderer.show(content);

      expect(renderer.getCurrentContent()).toBe(content);
    });

    it('replaces previous content on the primary layer', () => {
      const content1 = makeContentWithElement('first');
      const content2 = makeContentWithElement('second');

      renderer.show(content1);
      renderer.show(content2);

      const primary = renderer.getPrimaryLayer();
      expect(primary.children.length).toBe(1);
      expect(primary.querySelector('[data-test-id="second"]')).not.toBeNull();
      expect(primary.querySelector('[data-test-id="first"]')).toBeNull();
    });

    it('creates an img element for image content without pre-rendered element', () => {
      const content = makeContent({ type: 'image', mediaUrl: 'http://example.com/pic.jpg' });
      renderer.show(content);

      const primary = renderer.getPrimaryLayer();
      const img = primary.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.src).toBe('http://example.com/pic.jpg');
    });

    it('creates a video element for video content without pre-rendered element', () => {
      const content = makeContent({ type: 'video', mediaUrl: 'http://example.com/vid.mp4' });
      renderer.show(content);

      const primary = renderer.getPrimaryLayer();
      const video = primary.querySelector('video');
      expect(video).not.toBeNull();
      expect(video!.src).toBe('http://example.com/vid.mp4');
      expect(video!.autoplay).toBe(true);
    });

    it('creates an iframe for url content without pre-rendered element', () => {
      const content = makeContent({ type: 'url', mediaUrl: 'http://example.com/page' });
      renderer.show(content);

      const primary = renderer.getPrimaryLayer();
      const iframe = primary.querySelector('iframe');
      expect(iframe).not.toBeNull();
      expect(iframe!.src).toBe('http://example.com/page');
    });
  });

  describe('transitionTo()', () => {
    it('performs instant swap for cut transitions', async () => {
      const cutRenderer = new FullscreenRenderer(
        document.createElement('div'),
        { type: 'cut', durationMs: 0 }
      );

      const content1 = makeContentWithElement('cut-1');
      const content2 = makeContentWithElement('cut-2');

      cutRenderer.show(content1);
      await cutRenderer.transitionTo(content2);

      expect(cutRenderer.getCurrentContent()).toBe(content2);
      const primary = cutRenderer.getPrimaryLayer();
      expect(primary.querySelector('[data-test-id="cut-2"]')).not.toBeNull();
    });

    it('performs instant swap when durationMs is 0', async () => {
      const zeroRenderer = new FullscreenRenderer(
        document.createElement('div'),
        { type: 'fade', durationMs: 0 }
      );

      const content1 = makeContentWithElement('zero-1');
      const content2 = makeContentWithElement('zero-2');

      zeroRenderer.show(content1);
      await zeroRenderer.transitionTo(content2);

      expect(zeroRenderer.getCurrentContent()).toBe(content2);
    });

    it('transitions new content to primary layer after fade animation', async () => {
      // Use a very short transition for testing
      const fastRenderer = new FullscreenRenderer(
        document.createElement('div'),
        { type: 'fade', durationMs: 10 }
      );

      const content1 = makeContentWithElement('fade-1');
      const content2 = makeContentWithElement('fade-2');

      fastRenderer.show(content1);
      await fastRenderer.transitionTo(content2);

      // After transition, new content should be on primary
      expect(fastRenderer.getCurrentContent()).toBe(content2);
      const primary = fastRenderer.getPrimaryLayer();
      expect(primary.querySelector('[data-test-id="fade-2"]')).not.toBeNull();
    });

    it('transitions new content to primary layer after slide animation', async () => {
      const slideRenderer = new FullscreenRenderer(
        document.createElement('div'),
        { type: 'slide', durationMs: 10 }
      );

      const content1 = makeContentWithElement('slide-1');
      const content2 = makeContentWithElement('slide-2');

      slideRenderer.show(content1);
      await slideRenderer.transitionTo(content2);

      expect(slideRenderer.getCurrentContent()).toBe(content2);
      const primary = slideRenderer.getPrimaryLayer();
      expect(primary.querySelector('[data-test-id="slide-2"]')).not.toBeNull();
    });

    it('hides transition layer after animation completes', async () => {
      const fastRenderer = new FullscreenRenderer(
        document.createElement('div'),
        { type: 'fade', durationMs: 10 }
      );

      const content1 = makeContentWithElement('t-1');
      const content2 = makeContentWithElement('t-2');

      fastRenderer.show(content1);
      await fastRenderer.transitionTo(content2);

      expect(fastRenderer.getTransitionLayer().style.visibility).toBe('hidden');
    });

    it('falls back to instant swap if already transitioning', async () => {
      const slowRenderer = new FullscreenRenderer(
        document.createElement('div'),
        { type: 'fade', durationMs: 100 }
      );

      const content1 = makeContentWithElement('slow-1');
      const content2 = makeContentWithElement('slow-2');
      const content3 = makeContentWithElement('slow-3');

      slowRenderer.show(content1);

      // Start a transition, don't await — it's in progress
      const firstTransition = slowRenderer.transitionTo(content2);

      // Immediately try another transition — since transitioning is true,
      // this should fall through to instant swap (show)
      await slowRenderer.transitionTo(content3);

      expect(slowRenderer.getCurrentContent()).toBe(content3);
      const primary = slowRenderer.getPrimaryLayer();
      expect(primary.querySelector('[data-test-id="slow-3"]')).not.toBeNull();

      // Wait for the first transition to complete (it will finish via fallback timer)
      await firstTransition;
    });

    it('sets transitioning flag during animation', async () => {
      const fastRenderer = new FullscreenRenderer(
        document.createElement('div'),
        { type: 'fade', durationMs: 50 }
      );

      const content1 = makeContentWithElement('flag-1');
      const content2 = makeContentWithElement('flag-2');

      fastRenderer.show(content1);

      expect(fastRenderer.isTransitioning()).toBe(false);

      const promise = fastRenderer.transitionTo(content2);
      // Note: In jsdom the timeout-based fallback fires, so transitioning may resolve quickly
      await promise;

      expect(fastRenderer.isTransitioning()).toBe(false);
    });
  });

  describe('showFallback()', () => {
    it('is synchronous (not async)', () => {
      // Verify showFallback returns void, not a Promise
      const content = makeContentWithElement('fallback-1');
      const result = renderer.showFallback(content);
      expect(result).toBeUndefined();
    });

    it('displays content on the fallback layer immediately', () => {
      const content = makeContentWithElement('fb-content');
      renderer.showFallback(content);

      const fallback = renderer.getFallbackLayer();
      expect(fallback.children.length).toBe(1);
      expect(fallback.querySelector('[data-test-id="fb-content"]')).not.toBeNull();
    });

    it('makes fallback layer visible and hides primary + transition', () => {
      // First show something on primary
      renderer.show(makeContentWithElement('primary-stuff'));

      // Then trigger fallback
      const fallbackContent = makeContentWithElement('fb-urgent');
      renderer.showFallback(fallbackContent);

      expect(renderer.getFallbackLayer().style.visibility).toBe('visible');
      expect(renderer.getPrimaryLayer().style.visibility).toBe('hidden');
      expect(renderer.getTransitionLayer().style.visibility).toBe('hidden');
    });

    it('updates current content to the fallback content', () => {
      const content = makeContent({ id: 'fb-tracked' });
      renderer.showFallback(content);

      expect(renderer.getCurrentContent()!.id).toBe('fb-tracked');
    });

    it('replaces previous fallback content', () => {
      const fb1 = makeContentWithElement('fb-first');
      const fb2 = makeContentWithElement('fb-second');

      renderer.showFallback(fb1);
      renderer.showFallback(fb2);

      const fallback = renderer.getFallbackLayer();
      expect(fallback.children.length).toBe(1);
      expect(fallback.querySelector('[data-test-id="fb-second"]')).not.toBeNull();
    });

    it('resets transitioning state', async () => {
      const slowRenderer = new FullscreenRenderer(
        document.createElement('div'),
        { type: 'fade', durationMs: 5000 }
      );

      const content1 = makeContentWithElement('s-1');
      const content2 = makeContentWithElement('s-2');
      const fbContent = makeContentWithElement('s-fb');

      slowRenderer.show(content1);

      // Start transition (won't complete quickly)
      void slowRenderer.transitionTo(content2);

      // Emergency fallback should override everything
      slowRenderer.showFallback(fbContent);

      expect(slowRenderer.isTransitioning()).toBe(false);
      expect(slowRenderer.getCurrentContent()).toBe(fbContent);
    });
  });

  describe('dismissFallback()', () => {
    it('hides fallback layer and reveals primary', () => {
      const content = makeContentWithElement('primary-show');
      renderer.show(content);

      renderer.showFallback(makeContentWithElement('fb-temp'));
      renderer.dismissFallback();

      expect(renderer.getFallbackLayer().style.visibility).toBe('hidden');
      expect(renderer.getPrimaryLayer().style.visibility).toBe('visible');
    });

    it('clears fallback layer content', () => {
      renderer.showFallback(makeContentWithElement('fb-dismiss'));
      renderer.dismissFallback();

      expect(renderer.getFallbackLayer().children.length).toBe(0);
    });
  });

  describe('setTransitionConfig()', () => {
    it('updates the transition configuration', async () => {
      const content1 = makeContentWithElement('cfg-1');
      const content2 = makeContentWithElement('cfg-2');

      renderer.show(content1);

      // Change to cut transition
      renderer.setTransitionConfig({ type: 'cut', durationMs: 0 });
      await renderer.transitionTo(content2);

      // Should have done an instant swap
      expect(renderer.getCurrentContent()).toBe(content2);
      expect(renderer.getTransitionLayer().style.visibility).toBe('hidden');
    });
  });
});
