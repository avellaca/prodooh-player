import { describe, it, expect, beforeEach } from 'vitest';
import {
  FactoryContent,
  FACTORY_LANDSCAPE_ID,
  FACTORY_PORTRAIT_ID,
  FACTORY_CONTENT_DURATION,
} from '../../src/sources/FactoryContent';

/**
 * Tests for FactoryContent — Prodooh branding animation bundled with player.
 *
 * Validates: Requirements 25.1, 25.2, 25.3, 25.4
 */

describe('FactoryContent', () => {
  let factory: FactoryContent;

  beforeEach(() => {
    factory = new FactoryContent();
  });

  describe('constructor', () => {
    it('should default to landscape orientation', () => {
      expect(factory.getOrientation()).toBe('landscape');
    });

    it('should accept portrait orientation config', () => {
      const portraitFactory = new FactoryContent({ orientation: 'portrait' });
      expect(portraitFactory.getOrientation()).toBe('portrait');
    });

    it('should accept landscape orientation config', () => {
      const landscapeFactory = new FactoryContent({ orientation: 'landscape' });
      expect(landscapeFactory.getOrientation()).toBe('landscape');
    });

    it('should initialize with playlist not adopted', () => {
      expect(factory.isPlaylistAdopted()).toBe(false);
    });
  });

  describe('orientation management', () => {
    it('should update orientation via setOrientation', () => {
      factory.setOrientation('portrait');
      expect(factory.getOrientation()).toBe('portrait');
    });

    it('should switch from landscape to portrait', () => {
      expect(factory.getOrientation()).toBe('landscape');
      factory.setOrientation('portrait');
      expect(factory.getOrientation()).toBe('portrait');
    });
  });

  describe('playlist adoption state (Req 25.3)', () => {
    it('should track that playlist has not been adopted initially', () => {
      expect(factory.isPlaylistAdopted()).toBe(false);
    });

    it('should mark playlist as adopted', () => {
      factory.markPlaylistAdopted();
      expect(factory.isPlaylistAdopted()).toBe(true);
    });

    it('should allow resetting adoption state', () => {
      factory.markPlaylistAdopted();
      expect(factory.isPlaylistAdopted()).toBe(true);
      factory.resetAdoptionState();
      expect(factory.isPlaylistAdopted()).toBe(false);
    });
  });

  describe('shouldShowInRotation()', () => {
    it('should show in rotation when no playlist adopted', () => {
      expect(factory.shouldShowInRotation()).toBe(true);
    });

    it('should NOT show in rotation after playlist is adopted (Req 25.3)', () => {
      factory.markPlaylistAdopted();
      expect(factory.shouldShowInRotation()).toBe(false);
    });

    it('should show again if adoption state is reset', () => {
      factory.markPlaylistAdopted();
      factory.resetAdoptionState();
      expect(factory.shouldShowInRotation()).toBe(true);
    });
  });

  describe('loadContent() — landscape (Req 25.1, 25.4)', () => {
    it('should return PreparedContent with landscape factory ID', () => {
      const content = factory.loadContent();
      expect(content.id).toBe(FACTORY_LANDSCAPE_ID);
    });

    it('should have type html', () => {
      const content = factory.loadContent();
      expect(content.type).toBe('html');
    });

    it('should have source playlist', () => {
      const content = factory.loadContent();
      expect(content.source).toBe('playlist');
    });

    it('should have correct duration', () => {
      const content = factory.loadContent();
      expect(content.duration).toBe(FACTORY_CONTENT_DURATION);
      expect(content.duration).toBe(10);
    });

    it('should have isFactory metadata', () => {
      const content = factory.loadContent();
      expect(content.metadata.isFactory).toBe(true);
    });

    it('should have orientation in metadata', () => {
      const content = factory.loadContent();
      expect(content.metadata.orientation).toBe('landscape');
    });

    it('should provide a pre-rendered HTML element', () => {
      const content = factory.loadContent();
      expect(content.element).toBeInstanceOf(HTMLElement);
    });

    it('should mark the element with data-factory attribute', () => {
      const content = factory.loadContent();
      expect((content.element as HTMLElement).dataset.factory).toBe('true');
    });

    it('should mark the element with data-orientation attribute', () => {
      const content = factory.loadContent();
      expect((content.element as HTMLElement).dataset.orientation).toBe('landscape');
    });

    it('should contain Prodooh branding text', () => {
      const content = factory.loadContent();
      const textContent = (content.element as HTMLElement).textContent;
      expect(textContent).toContain('Prodooh');
      expect(textContent).toContain('DIGITAL SIGNAGE');
    });
  });

  describe('loadContent() — portrait (Req 25.1, 25.4)', () => {
    let portraitFactory: FactoryContent;

    beforeEach(() => {
      portraitFactory = new FactoryContent({ orientation: 'portrait' });
    });

    it('should return PreparedContent with portrait factory ID', () => {
      const content = portraitFactory.loadContent();
      expect(content.id).toBe(FACTORY_PORTRAIT_ID);
    });

    it('should have orientation portrait in metadata', () => {
      const content = portraitFactory.loadContent();
      expect(content.metadata.orientation).toBe('portrait');
    });

    it('should mark the element with portrait data-orientation', () => {
      const content = portraitFactory.loadContent();
      expect((content.element as HTMLElement).dataset.orientation).toBe('portrait');
    });

    it('should contain Prodooh branding text', () => {
      const content = portraitFactory.loadContent();
      const textContent = (content.element as HTMLElement).textContent;
      expect(textContent).toContain('Prodooh');
    });
  });

  describe('loadContent() after orientation change', () => {
    it('should reflect updated orientation', () => {
      const content1 = factory.loadContent();
      expect(content1.id).toBe(FACTORY_LANDSCAPE_ID);

      factory.setOrientation('portrait');
      const content2 = factory.loadContent();
      expect(content2.id).toBe(FACTORY_PORTRAIT_ID);
      expect(content2.metadata.orientation).toBe('portrait');
    });
  });

  describe('last-resort fallback behavior (Req 25.2)', () => {
    it('should always produce content regardless of adoption state', () => {
      // Before adoption
      const content1 = factory.loadContent();
      expect(content1).toBeDefined();
      expect(content1.element).toBeInstanceOf(HTMLElement);

      // After adoption — still available as emergency fallback
      factory.markPlaylistAdopted();
      const content2 = factory.loadContent();
      expect(content2).toBeDefined();
      expect(content2.element).toBeInstanceOf(HTMLElement);
    });

    it('should produce distinct elements on each call (no shared state)', () => {
      const content1 = factory.loadContent();
      const content2 = factory.loadContent();
      expect(content1.element).not.toBe(content2.element);
    });
  });
});
