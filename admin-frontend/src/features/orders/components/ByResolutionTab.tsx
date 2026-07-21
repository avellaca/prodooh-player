import { useRef, useCallback } from 'react';
import { Library } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';

import { ResolutionDashboard } from './ResolutionDashboard';
import { ResolutionGroupCard } from './ResolutionGroupCard';
import type { ResolutionGroup, PlaybackMode } from '../types';

export interface ByResolutionTabProps {
  resolutions: ResolutionGroup[] | undefined;
  resolutionsLoading: boolean;
  resolutionsError: boolean;
  refetchResolutions: () => void;
  orderLineId: string;
  playbackMode: PlaybackMode;
  onCreativeAdded: () => void;
  onOpenLibrarySelector: () => void;
}

function resolutionKey(group: ResolutionGroup): string {
  return `${group.resolution_width}x${group.resolution_height}`;
}

/**
 * "Por Resolución" tab content.
 * Renders the ResolutionDashboard and ResolutionGroupCards — the existing
 * creative management view grouped by screen resolution.
 */
export function ByResolutionTab({
  resolutions,
  resolutionsLoading,
  resolutionsError,
  refetchResolutions,
  orderLineId,
  playbackMode,
  onCreativeAdded,
  onOpenLibrarySelector,
}: ByResolutionTabProps) {
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleGroupClick = useCallback((group: ResolutionGroup) => {
    const key = resolutionKey(group);
    const el = groupRefs.current[key];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  if (resolutionsLoading) {
    return <LoadingState rows={4} />;
  }

  if (resolutionsError) {
    return (
      <ErrorState
        message="Error al cargar resoluciones"
        onRetry={refetchResolutions}
      />
    );
  }

  if (!resolutions || resolutions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">
            No hay pantallas asignadas a esta línea de pedido. Asigna pantallas o grupos para comenzar a gestionar creativos.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Resolution Dashboard */}
      <ResolutionDashboard
        resolutions={resolutions}
        onGroupClick={handleGroupClick}
      />

      {/* Resolution Group Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Creativos por resolución</h2>
          <Button variant="outline" size="sm" onClick={onOpenLibrarySelector}>
            <Library className="h-4 w-4" />
            Bulk de creativos
          </Button>
        </div>
        {resolutions.map((group) => {
          const key = resolutionKey(group);
          return (
            <div
              key={key}
              ref={(el) => { groupRefs.current[key] = el; }}
            >
              <ResolutionGroupCard
                group={group}
                orderLineId={orderLineId}
                playbackMode={playbackMode}
                onCreativeAdded={onCreativeAdded}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
