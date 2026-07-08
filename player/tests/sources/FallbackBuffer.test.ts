import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FallbackBuffer } from '../../src/sources/FallbackBuffer';
import type { PlaylistSource } from '../../src/sources/PlaylistSource';
import type { PreparedContent } from '../../src/sources/types';

/**
 * Tests for FallbackBuffer — buffer management logic.
 * In jsdom environment, we skip actual image.decode() and video.canplaythrough.
 * Focus is on buffer fill/drain logic and factory content fallback.
 *
 * Validates: Requirements 4.1, 6.3, 6.4, 25.1, 25.2, 25.3
 */

function createMockPlaylistSource(items: PreparedContent[]): PlaylistSource {
  let index = 0;
  return {
    id: 'playlist',
    prefetch: vi.fn(async () => {
      if (items.length === 0) return null;
      if (index >= items.length) index = 0;
      const item = items[index]!;
      index++;
      return item;
    }),
    confirmPlay: vi.fn(async () => {}),
    reportFailure: vi.fn(async () => {}),
    isAvailable: vi.fn(() => items.length > 0),
  } as unknown as PlaylistSource;
}

function makePreparedContent(id: string, type: 'image' | 'video' | 'url' = 'image'): PreparedContent {
  return {
    id,
    type,
    source: 'playlist',
    mediaUrl: type === 'url' ? `https://example.com/${id}` : `/media/${id}.${type === 'video' ? 'mp4' : 'jpg'}`,
    duration: 10,
    metadata: { position: 0 },
  };
}

describe('FallbackBuffer', () => {
  describe('constructor', () => {
    it('should initialize with default minBufferSize of 1', () => {
      const source = createMockPlaylistSource([]);
      const buffer = new FallbackBuffer({ playlistSource: source });
      expect(buffer.getSize()).toBe(0);
      expect(buffer.hasContent()).toBe(false);
    });

    it('should accept custom minBufferSize', () => {
      const source = createMockPlaylistSource([]);
      const buffer = new FallbackBuffer({ playlistSource: source, minBufferSize: 3 });
      expect(buffer.getSize()).toBe(0);
    });
  });

  describe('replenish()', () => {
    it('should fill buffer to minBufferSize from PlaylistSource', async () => {
      const items = [makePreparedContent('item-1'), makePreparedContent('item-2')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source, minBufferSize: 2 });

      await buffer.replenish();

      expect(buffer.getSize()).toBe(2);
      expect(buffer.hasContent()).toBe(true);
    });

    it('should fill buffer with exactly minBufferSize items (default 1)', async () => {
      const items = [makePreparedContent('item-1'), makePreparedContent('item-2')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source });

      await buffer.replenish();

      expect(buffer.getSize()).toBe(1);
    });

    it('should use factory content when playlist is empty', async () => {
      const source = createMockPlaylistSource([]);
      const buffer = new FallbackBuffer({ playlistSource: source });

      await buffer.replenish();

      expect(buffer.getSize()).toBe(1);
      expect(buffer.hasContent()).toBe(true);

      const content = buffer.getNext();
      expect(content.id).toBe('factory-prodooh-branding');
      expect(content.metadata.isFactory).toBe(true);
      expect(content.element).toBeDefined();
    });

    it('should not add items if buffer is already at minBufferSize', async () => {
      const items = [makePreparedContent('item-1'), makePreparedContent('item-2')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source, minBufferSize: 1 });

      await buffer.replenish();
      expect(buffer.getSize()).toBe(1);

      await buffer.replenish();
      expect(buffer.getSize()).toBe(1);
    });

    it('should not run concurrently (re-entrant guard)', async () => {
      const items = [makePreparedContent('item-1')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source, minBufferSize: 1 });

      // Call replenish twice simultaneously
      const p1 = buffer.replenish();
      const p2 = buffer.replenish();

      await Promise.all([p1, p2]);

      // Should only have 1 item (not 2)
      expect(buffer.getSize()).toBe(1);
    });
  });

  describe('getNext()', () => {
    it('should return the first buffered item and reduce buffer size', async () => {
      const items = [makePreparedContent('item-1'), makePreparedContent('item-2')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source, minBufferSize: 2 });

      await buffer.replenish();
      expect(buffer.getSize()).toBe(2);

      const content = buffer.getNext();
      expect(content.id).toBe('item-1');
      expect(buffer.getSize()).toBe(1);
    });

    it('should return factory content when buffer is empty', () => {
      const source = createMockPlaylistSource([]);
      const buffer = new FallbackBuffer({ playlistSource: source });

      const content = buffer.getNext();
      expect(content.id).toBe('factory-prodooh-branding');
      expect(content.type).toBe('html');
      expect(content.source).toBe('playlist');
      expect(content.metadata.isFactory).toBe(true);
    });

    it('should kick off async replenish after getNext()', async () => {
      const items = [makePreparedContent('item-1'), makePreparedContent('item-2')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source, minBufferSize: 1 });

      await buffer.replenish();
      expect(buffer.getSize()).toBe(1);

      buffer.getNext();

      // Allow the async replenish to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(buffer.getSize()).toBe(1);
    });

    it('should return items in FIFO order', async () => {
      const items = [
        makePreparedContent('first'),
        makePreparedContent('second'),
        makePreparedContent('third'),
      ];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source, minBufferSize: 3 });

      await buffer.replenish();

      expect(buffer.getNext().id).toBe('first');
      expect(buffer.getNext().id).toBe('second');
      expect(buffer.getNext().id).toBe('third');
    });
  });

  describe('hasContent()', () => {
    it('should return false when buffer is empty', () => {
      const source = createMockPlaylistSource([]);
      const buffer = new FallbackBuffer({ playlistSource: source });
      expect(buffer.hasContent()).toBe(false);
    });

    it('should return true after replenish fills buffer', async () => {
      const items = [makePreparedContent('item-1')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source });

      await buffer.replenish();
      expect(buffer.hasContent()).toBe(true);
    });
  });

  describe('getSize()', () => {
    it('should return 0 initially', () => {
      const source = createMockPlaylistSource([]);
      const buffer = new FallbackBuffer({ playlistSource: source });
      expect(buffer.getSize()).toBe(0);
    });

    it('should reflect number of items after replenish', async () => {
      const items = [
        makePreparedContent('a'),
        makePreparedContent('b'),
        makePreparedContent('c'),
      ];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source, minBufferSize: 3 });

      await buffer.replenish();
      expect(buffer.getSize()).toBe(3);
    });

    it('should decrease after getNext()', async () => {
      const items = [makePreparedContent('item-1'), makePreparedContent('item-2')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source, minBufferSize: 2 });

      await buffer.replenish();
      expect(buffer.getSize()).toBe(2);

      buffer.getNext();
      expect(buffer.getSize()).toBe(1);
    });
  });

  describe('factory content', () => {
    it('should have Prodooh branding element', async () => {
      const source = createMockPlaylistSource([]);
      const buffer = new FallbackBuffer({ playlistSource: source });

      await buffer.replenish();
      const content = buffer.getNext();

      expect(content.element).toBeInstanceOf(HTMLElement);
      expect((content.element as HTMLElement).textContent).toBe('Prodooh');
      expect((content.element as HTMLElement).dataset.factory).toBe('true');
    });

    it('should have duration of 10 seconds', async () => {
      const source = createMockPlaylistSource([]);
      const buffer = new FallbackBuffer({ playlistSource: source });

      await buffer.replenish();
      const content = buffer.getNext();

      expect(content.duration).toBe(10);
    });

    it('should have consistent id for factory content', () => {
      const source = createMockPlaylistSource([]);
      const buffer = new FallbackBuffer({ playlistSource: source });

      const content1 = buffer.getNext();
      const content2 = buffer.getNext();

      expect(content1.id).toBe('factory-prodooh-branding');
      expect(content2.id).toBe('factory-prodooh-branding');
    });
  });

  describe('pre-rendering', () => {
    it('should create an img element for image content', async () => {
      const items = [makePreparedContent('img-1', 'image')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source });

      await buffer.replenish();
      const content = buffer.getNext();

      expect(content.element).toBeInstanceOf(HTMLImageElement);
      expect((content.element as HTMLImageElement).src).toContain('/media/img-1.jpg');
    });

    it('should create a video element for video content', async () => {
      const items = [makePreparedContent('vid-1', 'video')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source });

      await buffer.replenish();
      const content = buffer.getNext();

      expect(content.element).toBeInstanceOf(HTMLVideoElement);
      expect((content.element as HTMLVideoElement).preload).toBe('auto');
      expect((content.element as HTMLVideoElement).muted).toBe(true);
    });

    it('should create an iframe element for url content', async () => {
      const items = [makePreparedContent('url-1', 'url')];
      const source = createMockPlaylistSource(items);
      const buffer = new FallbackBuffer({ playlistSource: source });

      await buffer.replenish();
      const content = buffer.getNext();

      expect(content.element).toBeInstanceOf(HTMLIFrameElement);
      expect((content.element as HTMLIFrameElement).src).toContain('https://example.com/url-1');
    });
  });
});
