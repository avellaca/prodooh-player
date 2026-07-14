import { useCallback, useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Content } from '@/types/models';

export interface ContentThumbnailProps {
  content: Content;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 120,
  md: 160,
  lg: 200,
} as const;

/**
 * ContentThumbnail displays a content item as a card with lazy-loaded thumbnail.
 *
 * - Uses native `loading="lazy"` on img elements
 * - Uses IntersectionObserver for additional control (load only when visible)
 * - Shows skeleton placeholder while loading
 * - For videos: shows a thumbnail with a play icon overlay
 * - Calls onClick when clicked (parent handles lightbox)
 *
 * Thumbnail URL: `/api/admin/content/${content.id}/preview/file`
 */
export function ContentThumbnail({
  content,
  onClick,
  size = 'md',
  className,
}: ContentThumbnailProps) {
  const dimension = sizeMap[size];
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const isVideo = content.mime_type.startsWith('video/');
  const thumbnailUrl = `/api/admin/content/${content.id}/preview/file`;

  // IntersectionObserver: only render <img> once the card enters the viewport.
  // This is a legitimate useEffect — synchronizing with a browser API.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleLoad = useCallback(() => setIsLoaded(true), []);
  const handleError = useCallback(() => {
    setHasError(true);
    setIsLoaded(true);
  }, []);

  return (
    <Card
      ref={containerRef}
      className={cn(
        'group relative cursor-pointer overflow-hidden transition-shadow hover:shadow-md',
        onClick && 'hover:ring-2 hover:ring-primary/50',
        className,
      )}
      style={{ width: dimension, height: dimension, minWidth: dimension, minHeight: dimension }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-label={`Vista previa de ${content.filename}`}
    >
      {/* Skeleton placeholder shown while image hasn't loaded */}
      {!isLoaded && (
        <Skeleton className="absolute inset-0 h-full w-full rounded-lg" />
      )}

      {/* Image rendered only once visible (IntersectionObserver) */}
      {isVisible && !hasError && (
        <img
          src={thumbnailUrl}
          alt={content.filename}
          loading="lazy"
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            'h-full w-full object-cover transition-opacity duration-200',
            isLoaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}

      {/* Error fallback */}
      {hasError && (
        <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
          {content.filename}
        </div>
      )}

      {/* Video play icon overlay */}
      {isVideo && isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60">
            <Play className="h-5 w-5 fill-white text-white" />
          </div>
        </div>
      )}

      {/* Always-visible play badge for videos */}
      {isVideo && (
        <div className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60">
          <Play className="h-3 w-3 fill-white text-white" />
        </div>
      )}
    </Card>
  );
}
