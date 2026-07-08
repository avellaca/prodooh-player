import { describe, it, expect } from 'vitest';
import type { SourceType, ContentType, PreparedContent, ContentSource } from '../../src/sources';

describe('Content Source Types', () => {
  it('should allow creating a valid PreparedContent object', () => {
    const content: PreparedContent = {
      id: 'test-123',
      type: 'image',
      source: 'playlist',
      mediaUrl: '/media/image.jpg',
      duration: 10,
      metadata: { filename: 'image.jpg' },
    };

    expect(content.id).toBe('test-123');
    expect(content.type).toBe('image');
    expect(content.source).toBe('playlist');
    expect(content.mediaUrl).toBe('/media/image.jpg');
    expect(content.duration).toBe(10);
    expect(content.metadata).toEqual({ filename: 'image.jpg' });
    expect(content.element).toBeUndefined();
  });

  it('should allow PreparedContent with an optional element', () => {
    const el = document.createElement('img');
    const content: PreparedContent = {
      id: 'img-456',
      type: 'image',
      source: 'prodooh',
      mediaUrl: 'https://cdn.example.com/ad.jpg',
      duration: 15,
      metadata: { print_id: 'pop-789', campaign_id: 42 },
      element: el,
    };

    expect(content.element).toBe(el);
    expect(content.element).toBeInstanceOf(HTMLElement);
  });

  it('should support all SourceType values', () => {
    const sources: SourceType[] = ['prodooh', 'gam', 'url', 'playlist'];
    expect(sources).toHaveLength(4);
    expect(sources).toContain('prodooh');
    expect(sources).toContain('gam');
    expect(sources).toContain('url');
    expect(sources).toContain('playlist');
  });

  it('should support all ContentType values', () => {
    const types: ContentType[] = ['image', 'video', 'url', 'html'];
    expect(types).toHaveLength(4);
    expect(types).toContain('image');
    expect(types).toContain('video');
    expect(types).toContain('url');
    expect(types).toContain('html');
  });

  it('should allow implementing the ContentSource interface', () => {
    const mockSource: ContentSource = {
      id: 'playlist',
      prefetch: async () => ({
        id: 'item-1',
        type: 'video',
        source: 'playlist',
        mediaUrl: '/media/video.mp4',
        duration: 30,
        metadata: {},
      }),
      confirmPlay: async () => {},
      reportFailure: async () => {},
      isAvailable: () => true,
    };

    expect(mockSource.id).toBe('playlist');
    expect(mockSource.isAvailable()).toBe(true);
  });

  it('should resolve prefetch to PreparedContent or null', async () => {
    const availableSource: ContentSource = {
      id: 'prodooh',
      prefetch: async () => ({
        id: 'ad-001',
        type: 'image',
        source: 'prodooh',
        mediaUrl: 'https://sandbox.api.prodooh.com/media/ad.jpg',
        duration: 10,
        metadata: { print_id: 'pop-001' },
      }),
      confirmPlay: async () => {},
      reportFailure: async () => {},
      isAvailable: () => true,
    };

    const unavailableSource: ContentSource = {
      id: 'gam',
      prefetch: async () => null,
      confirmPlay: async () => {},
      reportFailure: async () => {},
      isAvailable: () => false,
    };

    const content = await availableSource.prefetch();
    expect(content).not.toBeNull();
    expect(content!.id).toBe('ad-001');

    const noContent = await unavailableSource.prefetch();
    expect(noContent).toBeNull();
  });
});
