import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TransitionAnimator,
  validateTransitionConfig,
  isValidTransitionType,
  clampDuration,
  DEFAULT_TRANSITION_CONFIG,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
} from '../../src/display/TransitionAnimator';
import type { TransitionConfig, TransitionType } from '../../src/display/TransitionAnimator';

/**
 * Tests for TransitionAnimator — CSS-based transitions between content.
 *
 * Validates: Requirements 23.1, 23.2, 23.3, 23.4, 23.5
 */

describe('TransitionAnimator', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '1920px';
    container.style.height = '1080px';
    document.body.appendChild(container);

    // Mock requestAnimationFrame to execute immediately in tests
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  function createContentElement(id: string): HTMLDivElement {
    const el = document.createElement('div');
    el.dataset.contentId = id;
    el.textContent = `Content: ${id}`;
    return el;
  }

  describe('constructor and configuration', () => {
    it('should use default config when no config provided', () => {
      const animator = new TransitionAnimator();
      const config = animator.getConfig();
      expect(config.type).toBe('fade');
      expect(config.durationMs).toBe(500);
    });

    it('should accept valid custom config', () => {
      const animator = new TransitionAnimator({ type: 'slide', durationMs: 1000 });
      const config = animator.getConfig();
      expect(config.type).toBe('slide');
      expect(config.durationMs).toBe(1000);
    });

    it('should clamp duration below minimum to MIN_DURATION_MS', () => {
      const animator = new TransitionAnimator({ type: 'fade', durationMs: 50 });
      expect(animator.getConfig().durationMs).toBe(MIN_DURATION_MS);
    });

    it('should clamp duration above maximum to MAX_DURATION_MS', () => {
      const animator = new TransitionAnimator({ type: 'fade', durationMs: 5000 });
      expect(animator.getConfig().durationMs).toBe(MAX_DURATION_MS);
    });

    it('should update config via setConfig', () => {
      const animator = new TransitionAnimator({ type: 'cut' });
      animator.setConfig({ type: 'slide', durationMs: 800 });
      expect(animator.getConfig().type).toBe('slide');
      expect(animator.getConfig().durationMs).toBe(800);
    });
  });

  describe('cut transition', () => {
    it('should instantly show incoming and remove outgoing', async () => {
      const animator = new TransitionAnimator({ type: 'cut' });
      const outgoing = createContentElement('old');
      const incoming = createContentElement('new');

      container.appendChild(outgoing);

      await animator.transition(outgoing, incoming, container);

      expect(container.contains(incoming)).toBe(true);
      expect(container.contains(outgoing)).toBe(false);
      expect(incoming.style.opacity).toBe('1');
    });

    it('should handle null outgoing element', async () => {
      const animator = new TransitionAnimator({ type: 'cut' });
      const incoming = createContentElement('first');

      await animator.transition(null, incoming, container);

      expect(container.contains(incoming)).toBe(true);
      expect(incoming.style.opacity).toBe('1');
    });

    it('should position incoming element absolutely filling container', async () => {
      const animator = new TransitionAnimator({ type: 'cut' });
      const incoming = createContentElement('new');

      await animator.transition(null, incoming, container);

      expect(incoming.style.position).toBe('absolute');
      expect(incoming.style.top).toBe('0px');
      expect(incoming.style.left).toBe('0px');
      expect(incoming.style.width).toBe('100%');
      expect(incoming.style.height).toBe('100%');
    });
  });

  describe('fade transition', () => {
    it('should place incoming below outgoing before fading', async () => {
      const animator = new TransitionAnimator({ type: 'fade', durationMs: 200 });
      const outgoing = createContentElement('old');
      const incoming = createContentElement('new');

      container.appendChild(outgoing);

      // Start transition but don't await yet — check intermediate state
      const promise = animator.transition(outgoing, incoming, container);

      // Incoming should be in container and visible at z-index 1
      expect(container.contains(incoming)).toBe(true);
      expect(incoming.style.opacity).toBe('1');

      await promise;
    });

    it('should remove outgoing and promote incoming after fade completes', async () => {
      const animator = new TransitionAnimator({ type: 'fade', durationMs: 200 });
      const outgoing = createContentElement('old');
      const incoming = createContentElement('new');

      container.appendChild(outgoing);

      await animator.transition(outgoing, incoming, container);

      expect(container.contains(outgoing)).toBe(false);
      expect(container.contains(incoming)).toBe(true);
      expect(incoming.style.zIndex).toBe('2');
    });

    it('should set CSS transition property on outgoing element', async () => {
      const animator = new TransitionAnimator({ type: 'fade', durationMs: 750 });
      const outgoing = createContentElement('old');
      const incoming = createContentElement('new');

      container.appendChild(outgoing);

      const promise = animator.transition(outgoing, incoming, container);

      // Outgoing should have a transition set
      expect(outgoing.style.transition).toContain('opacity');
      expect(outgoing.style.transition).toContain('750ms');

      await promise;
    });

    it('should handle null outgoing gracefully', async () => {
      const animator = new TransitionAnimator({ type: 'fade', durationMs: 200 });
      const incoming = createContentElement('first');

      await animator.transition(null, incoming, container);

      expect(container.contains(incoming)).toBe(true);
      expect(incoming.style.zIndex).toBe('2');
    });

    it('should ensure no black frame: incoming visible before outgoing fades', async () => {
      const animator = new TransitionAnimator({ type: 'fade', durationMs: 200 });
      const outgoing = createContentElement('old');
      const incoming = createContentElement('new');

      container.appendChild(outgoing);

      // Capture state after starting but before completion
      let incomingVisibleDuringTransition = false;

      const originalRAF = window.requestAnimationFrame;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        // Check incoming state before outgoing starts fading
        if (incoming.style.opacity === '1' && container.contains(incoming)) {
          incomingVisibleDuringTransition = true;
        }
        cb(0);
        return 0;
      });

      await animator.transition(outgoing, incoming, container);

      expect(incomingVisibleDuringTransition).toBe(true);
    });
  });

  describe('slide transition', () => {
    it('should place incoming in final position below outgoing', async () => {
      const animator = new TransitionAnimator({ type: 'slide', durationMs: 200 });
      const outgoing = createContentElement('old');
      const incoming = createContentElement('new');

      container.appendChild(outgoing);

      const promise = animator.transition(outgoing, incoming, container);

      expect(container.contains(incoming)).toBe(true);
      expect(incoming.style.transform).toBe('translateX(0)');
      expect(incoming.style.opacity).toBe('1');

      await promise;
    });

    it('should slide outgoing to the left (translateX -100%)', async () => {
      const animator = new TransitionAnimator({ type: 'slide', durationMs: 200 });
      const outgoing = createContentElement('old');
      const incoming = createContentElement('new');

      container.appendChild(outgoing);

      const promise = animator.transition(outgoing, incoming, container);

      // After requestAnimationFrame fires, outgoing should be sliding
      expect(outgoing.style.transform).toBe('translateX(-100%)');

      await promise;
    });

    it('should set CSS transform transition on outgoing', async () => {
      const animator = new TransitionAnimator({ type: 'slide', durationMs: 600 });
      const outgoing = createContentElement('old');
      const incoming = createContentElement('new');

      container.appendChild(outgoing);

      const promise = animator.transition(outgoing, incoming, container);

      expect(outgoing.style.transition).toContain('transform');
      expect(outgoing.style.transition).toContain('600ms');

      await promise;
    });

    it('should remove outgoing and promote incoming after slide completes', async () => {
      const animator = new TransitionAnimator({ type: 'slide', durationMs: 200 });
      const outgoing = createContentElement('old');
      const incoming = createContentElement('new');

      container.appendChild(outgoing);

      await animator.transition(outgoing, incoming, container);

      expect(container.contains(outgoing)).toBe(false);
      expect(container.contains(incoming)).toBe(true);
      expect(incoming.style.zIndex).toBe('2');
    });

    it('should handle null outgoing gracefully', async () => {
      const animator = new TransitionAnimator({ type: 'slide', durationMs: 200 });
      const incoming = createContentElement('first');

      await animator.transition(null, incoming, container);

      expect(container.contains(incoming)).toBe(true);
      expect(incoming.style.zIndex).toBe('2');
    });
  });

  describe('concurrent transition handling', () => {
    it('should do instant cut if transition already in progress', async () => {
      const animator = new TransitionAnimator({ type: 'fade', durationMs: 1000 });
      const el1 = createContentElement('el1');
      const el2 = createContentElement('el2');
      const el3 = createContentElement('el3');

      container.appendChild(el1);

      // Start first transition (won't resolve due to no transitionend event)
      const p1 = animator.transition(el1, el2, container);

      // While first is in progress, start another
      expect(animator.isInProgress()).toBe(true);
      await animator.transition(el2, el3, container);

      // el3 should be in the container
      expect(container.contains(el3)).toBe(true);

      await p1; // Let the first one resolve via timeout
    });

    it('should report isInProgress correctly', async () => {
      const animator = new TransitionAnimator({ type: 'cut' });
      const outgoing = createContentElement('old');
      const incoming = createContentElement('new');

      container.appendChild(outgoing);

      expect(animator.isInProgress()).toBe(false);
      await animator.transition(outgoing, incoming, container);
      expect(animator.isInProgress()).toBe(false);
    });
  });

  describe('content type independence (Req 23.5)', () => {
    it('should transition between an image and a video element', async () => {
      const animator = new TransitionAnimator({ type: 'fade', durationMs: 200 });

      const img = document.createElement('img');
      img.src = '/media/test.jpg';

      const video = document.createElement('video');
      video.src = '/media/test.mp4';

      container.appendChild(img);

      await animator.transition(img, video, container);

      expect(container.contains(video)).toBe(true);
      expect(container.contains(img)).toBe(false);
    });

    it('should transition between a video and an iframe', async () => {
      const animator = new TransitionAnimator({ type: 'slide', durationMs: 200 });

      const video = document.createElement('video');
      video.src = '/media/test.mp4';

      const iframe = document.createElement('iframe');
      iframe.src = 'https://example.com';

      container.appendChild(video);

      await animator.transition(video, iframe, container);

      expect(container.contains(iframe)).toBe(true);
      expect(container.contains(video)).toBe(false);
    });

    it('should transition between an iframe and a div (html content)', async () => {
      const animator = new TransitionAnimator({ type: 'cut' });

      const iframe = document.createElement('iframe');
      iframe.src = 'https://example.com';

      const div = document.createElement('div');
      div.textContent = 'HTML content';

      container.appendChild(iframe);

      await animator.transition(iframe, div, container);

      expect(container.contains(div)).toBe(true);
      expect(container.contains(iframe)).toBe(false);
    });
  });
});

describe('validateTransitionConfig', () => {
  it('should return defaults for empty input', () => {
    const config = validateTransitionConfig({});
    expect(config.type).toBe('fade');
    expect(config.durationMs).toBe(500);
  });

  it('should accept valid types', () => {
    expect(validateTransitionConfig({ type: 'cut' }).type).toBe('cut');
    expect(validateTransitionConfig({ type: 'fade' }).type).toBe('fade');
    expect(validateTransitionConfig({ type: 'slide' }).type).toBe('slide');
  });

  it('should default invalid type to fade', () => {
    expect(validateTransitionConfig({ type: 'zoom' as any }).type).toBe('fade');
    expect(validateTransitionConfig({ type: '' as any }).type).toBe('fade');
  });

  it('should clamp duration to valid range', () => {
    expect(validateTransitionConfig({ durationMs: 100 }).durationMs).toBe(200);
    expect(validateTransitionConfig({ durationMs: 5000 }).durationMs).toBe(2000);
    expect(validateTransitionConfig({ durationMs: 200 }).durationMs).toBe(200);
    expect(validateTransitionConfig({ durationMs: 2000 }).durationMs).toBe(2000);
    expect(validateTransitionConfig({ durationMs: 750 }).durationMs).toBe(750);
  });

  it('should handle NaN and Infinity as invalid (clamp to minimum)', () => {
    expect(validateTransitionConfig({ durationMs: NaN }).durationMs).toBe(200);
    expect(validateTransitionConfig({ durationMs: Infinity }).durationMs).toBe(200);
    expect(validateTransitionConfig({ durationMs: -Infinity }).durationMs).toBe(200);
  });

  it('should round fractional durations', () => {
    expect(validateTransitionConfig({ durationMs: 500.7 }).durationMs).toBe(501);
    expect(validateTransitionConfig({ durationMs: 300.2 }).durationMs).toBe(300);
  });
});

describe('isValidTransitionType', () => {
  it('should return true for valid types', () => {
    expect(isValidTransitionType('cut')).toBe(true);
    expect(isValidTransitionType('fade')).toBe(true);
    expect(isValidTransitionType('slide')).toBe(true);
  });

  it('should return false for invalid types', () => {
    expect(isValidTransitionType('zoom')).toBe(false);
    expect(isValidTransitionType('')).toBe(false);
    expect(isValidTransitionType('FADE')).toBe(false);
  });
});

describe('clampDuration', () => {
  it('should return value if within range', () => {
    expect(clampDuration(200)).toBe(200);
    expect(clampDuration(500)).toBe(500);
    expect(clampDuration(1000)).toBe(1000);
    expect(clampDuration(2000)).toBe(2000);
  });

  it('should clamp below minimum to MIN_DURATION_MS', () => {
    expect(clampDuration(0)).toBe(200);
    expect(clampDuration(-100)).toBe(200);
    expect(clampDuration(199)).toBe(200);
  });

  it('should clamp above maximum to MAX_DURATION_MS', () => {
    expect(clampDuration(2001)).toBe(2000);
    expect(clampDuration(10000)).toBe(2000);
  });

  it('should handle NaN as below minimum', () => {
    expect(clampDuration(NaN)).toBe(200);
  });
});
