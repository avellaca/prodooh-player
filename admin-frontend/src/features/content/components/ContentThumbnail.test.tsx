import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ContentThumbnail } from './ContentThumbnail';
import type { Content } from '@/types/models';

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

let intersectionCallback: IntersectionObserverCallback;

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
  }
  observe = mockObserve;
  disconnect = mockDisconnect;
  unobserve = vi.fn();
}

beforeEach(() => {
  mockObserve.mockClear();
  mockDisconnect.mockClear();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

function makeContent(overrides: Partial<Content> = {}): Content {
  return {
    id: 'content-123',
    tenant_id: 'tenant-1',
    filename: 'test-image.png',
    mime_type: 'image/png',
    storage_path: '/storage/test.png',
    file_size_bytes: 1024,
    width: 1920,
    height: 1080,
    duration_seconds: null,
    orientation: 'landscape',
    rotation: 0,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function triggerIntersection() {
  intersectionCallback(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
}

describe('ContentThumbnail', () => {
  it('renders with minimum 120px size for sm variant', () => {
    const { container } = render(
      <ContentThumbnail content={makeContent()} size="sm" />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.width).toBe('120px');
    expect(card.style.height).toBe('120px');
    expect(card.style.minWidth).toBe('120px');
    expect(card.style.minHeight).toBe('120px');
  });

  it('renders with 160px for md (default) variant', () => {
    const { container } = render(
      <ContentThumbnail content={makeContent()} />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.width).toBe('160px');
    expect(card.style.height).toBe('160px');
  });

  it('renders with 200px for lg variant', () => {
    const { container } = render(
      <ContentThumbnail content={makeContent()} size="lg" />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.width).toBe('200px');
    expect(card.style.height).toBe('200px');
  });

  it('shows skeleton placeholder before image loads', () => {
    const { container } = render(
      <ContentThumbnail content={makeContent()} />,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('does not render img before IntersectionObserver triggers', () => {
    render(<ContentThumbnail content={makeContent()} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders img with loading="lazy" after becoming visible', () => {
    render(<ContentThumbnail content={makeContent()} />);
    act(() => { triggerIntersection(); });
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('src', '/api/admin/content/content-123/preview/file');
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<ContentThumbnail content={makeContent()} onClick={handleClick} />);

    const card = screen.getByRole('button', { name: /vista previa de test-image.png/i });
    fireEvent.click(card);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard activation with Enter', () => {
    const handleClick = vi.fn();
    render(<ContentThumbnail content={makeContent()} onClick={handleClick} />);

    const card = screen.getByRole('button', { name: /vista previa de test-image.png/i });
    fireEvent.keyDown(card, { key: 'Enter' });

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard activation with Space', () => {
    const handleClick = vi.fn();
    render(<ContentThumbnail content={makeContent()} onClick={handleClick} />);

    const card = screen.getByRole('button', { name: /vista previa de test-image.png/i });
    fireEvent.keyDown(card, { key: ' ' });

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('shows play icon overlay for video content', () => {
    const videoContent = makeContent({
      mime_type: 'video/mp4',
      filename: 'demo.mp4',
    });

    const { container } = render(
      <ContentThumbnail content={videoContent} />,
    );

    // The always-visible play badge should be present
    const playIcons = container.querySelectorAll('svg');
    expect(playIcons.length).toBeGreaterThan(0);
  });

  it('does not show play icon for image content', () => {
    const imageContent = makeContent({
      mime_type: 'image/jpeg',
      filename: 'photo.jpg',
    });

    const { container } = render(
      <ContentThumbnail content={imageContent} />,
    );

    // No play icon for images
    const playIcons = container.querySelectorAll('svg');
    expect(playIcons.length).toBe(0);
  });

  it('observes the container element with IntersectionObserver', () => {
    const { container } = render(
      <ContentThumbnail content={makeContent()} />,
    );

    expect(mockObserve).toHaveBeenCalledWith(container.firstElementChild);
  });

  it('disconnects observer after element becomes visible', () => {
    render(<ContentThumbnail content={makeContent()} />);
    act(() => { triggerIntersection(); });

    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('does not set role="button" when no onClick provided', () => {
    const { container } = render(
      <ContentThumbnail content={makeContent()} />,
    );

    expect(container.firstElementChild).not.toHaveAttribute('role', 'button');
  });

  it('applies custom className', () => {
    const { container } = render(
      <ContentThumbnail content={makeContent()} className="my-custom-class" />,
    );

    expect(container.firstElementChild).toHaveClass('my-custom-class');
  });
});
