import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Library, Plus, FolderOpen } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';

import { useScreens } from '@/features/screens/hooks';
import { ScreenCreativeList } from './ScreenCreativeList';
import { LibrarySelector } from './LibrarySelector';
import { bulkCreativesApi } from '../api';
import { queryClient } from '@/lib/query-client';
import type { ResolutionGroup, ResolutionScreen, PlaybackMode } from '../types';
import type { Screen } from '@/types/models';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ScreenGroupEntry {
  groupId: string | null;
  groupName: string;
  screens: GroupScreen[];
}

interface GroupScreen {
  id: string;
  name: string;
  target_id: string;
  resolution_width: number;
  resolution_height: number;
}

export interface ByGroupTabProps {
  resolutions: ResolutionGroup[] | undefined;
  resolutionsLoading: boolean;
  resolutionsError: boolean;
  refetchResolutions: () => void;
  orderLineId: string;
  playbackMode: PlaybackMode;
  onCreativeAdded: () => void;
  onOpenLibrarySelector: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Flattens all screens from resolution groups and enriches them with
 * ScreenGroup info from the full screens list.
 */
function buildScreenGroups(
  resolutions: ResolutionGroup[],
  allScreens: Screen[],
): ScreenGroupEntry[] {
  // Build a lookup map for full screen data (includes group_id)
  const screenMap = new Map<string, Screen>();
  for (const screen of allScreens) {
    screenMap.set(screen.id, screen);
  }

  // Collect all assigned screens from the resolutions data
  const groupedMap = new Map<string | null, GroupScreen[]>();
  const groupNameMap = new Map<string | null, string>();

  for (const resolution of resolutions) {
    for (const resScreen of resolution.screens) {
      const fullScreen = screenMap.get(resScreen.id);
      const groupId = fullScreen?.group_id ?? null;
      const groupName = fullScreen?.screen_group?.name ?? 'Sin grupo';

      if (!groupedMap.has(groupId)) {
        groupedMap.set(groupId, []);
        groupNameMap.set(groupId, groupName);
      }

      groupedMap.get(groupId)!.push({
        id: resScreen.id,
        name: resScreen.name,
        target_id: resScreen.target_id,
        resolution_width: resolution.resolution_width,
        resolution_height: resolution.resolution_height,
      });
    }
  }

  // Convert to sorted array: named groups first (alphabetical), "Sin grupo" last
  const entries: ScreenGroupEntry[] = [];

  const sortedKeys = Array.from(groupedMap.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const nameA = groupNameMap.get(a) ?? '';
    const nameB = groupNameMap.get(b) ?? '';
    return nameA.localeCompare(nameB);
  });

  for (const key of sortedKeys) {
    entries.push({
      groupId: key,
      groupName: groupNameMap.get(key) ?? 'Sin grupo',
      screens: groupedMap.get(key) ?? [],
    });
  }

  return entries;
}

// ─── Component ──────────────────────────────────────────────────────────────────

/**
 * "Por Grupo" tab content.
 * Groups assigned screens by their ScreenGroup and renders creative
 * management controls at the group level.
 */
export function ByGroupTab({
  resolutions,
  resolutionsLoading,
  resolutionsError,
  refetchResolutions,
  orderLineId,
  playbackMode,
  onCreativeAdded,
  onOpenLibrarySelector,
}: ByGroupTabProps) {
  const { data: allScreens, isLoading: screensLoading } = useScreens();

  const isLoading = resolutionsLoading || screensLoading;

  // Derive screen groups from resolutions + full screen data
  const screenGroups = useMemo(() => {
    if (!resolutions || !allScreens) return [];
    return buildScreenGroups(resolutions, allScreens);
  }, [resolutions, allScreens]);

  if (isLoading) {
    return <LoadingState rows={4} />;
  }

  if (resolutionsError) {
    return (
      <ErrorState
        message="Error al cargar pantallas"
        onRetry={refetchResolutions}
      />
    );
  }

  if (screenGroups.length === 0) {
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
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Creativos por grupo</h2>
        <Button variant="outline" size="sm" onClick={onOpenLibrarySelector}>
          <Library className="h-4 w-4" />
          Bulk de creativos
        </Button>
      </div>

      <div className="space-y-4">
        {screenGroups.map((group) => (
          <ScreenGroupCard
            key={group.groupId ?? '__ungrouped__'}
            group={group}
            orderLineId={orderLineId}
            playbackMode={playbackMode}
            onCreativeAdded={onCreativeAdded}
          />
        ))}
      </div>
    </div>
  );
}

// ─── ScreenGroupCard ────────────────────────────────────────────────────────────

interface ScreenGroupCardProps {
  group: ScreenGroupEntry;
  orderLineId: string;
  playbackMode: PlaybackMode;
  onCreativeAdded: () => void;
}

function ScreenGroupCard({
  group,
  orderLineId,
  playbackMode,
  onCreativeAdded,
}: ScreenGroupCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  // For bulk operations at group level: assign a creative to ALL screens in this group
  const bulkMutation = useMutation({
    mutationFn: async (contentIds: string[]) => {
      // Create a creative for each screen in the group
      const results: Array<Promise<unknown>> = [];
      for (const screen of group.screens) {
        for (const contentId of contentIds) {
          results.push(
            bulkCreativesApi.createByResolution(orderLineId, {
              content_id: contentId,
              resolution_width: screen.resolution_width,
              resolution_height: screen.resolution_height,
              weight: 100,
            }),
          );
        }
      }
      await Promise.all(results);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'resolutions'] });
      queryClient.invalidateQueries({ queryKey: ['targets'] });
      toast.success(`Creativos asignados a las ${group.screens.length} pantallas del grupo`);
      setIsAddDialogOpen(false);
      onCreativeAdded();
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al asignar creativos al grupo');
    },
  });

  function handleLibrarySelect(contentIds: string[]) {
    bulkMutation.mutate(contentIds);
  }

  // Get unique resolutions in this group for display
  const uniqueResolutions = useMemo(() => {
    const set = new Set<string>();
    for (const screen of group.screens) {
      set.add(`${screen.resolution_width}×${screen.resolution_height}`);
    }
    return Array.from(set);
  }, [group.screens]);

  // Build ResolutionScreen array for ScreenCreativeList
  const screensForList: ResolutionScreen[] = group.screens.map((s) => ({
    id: s.id,
    name: s.name,
    target_id: s.target_id,
  }));

  // Find the most common resolution in the group for filtering in LibrarySelector
  const primaryResolution = useMemo(() => {
    if (group.screens.length === 0) return { width: 0, height: 0 };
    // Use the first screen's resolution as representative
    return {
      width: group.screens[0].resolution_width,
      height: group.screens[0].resolution_height,
    };
  }, [group.screens]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-center gap-3">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
            <div>
              <h3 className="text-base font-semibold">{group.groupName}</h3>
              <p className="text-xs text-muted-foreground">
                {group.screens.length} pantalla{group.screens.length !== 1 ? 's' : ''}
                {uniqueResolutions.length > 0 && (
                  <> · {uniqueResolutions.join(', ')}</>
                )}
              </p>
            </div>
            {group.groupId === null && (
              <Badge variant="secondary" className="text-xs">Sin grupo</Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Agregar creativo al grupo
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsExpanded((prev) => !prev)}>
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Ocultar pantallas
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Ver pantallas ({group.screens.length})
                </>
              )}
            </Button>
          </div>

          {/* Expanded section: screen list with creatives */}
          {isExpanded && (
            <div className="rounded-md border">
              <ScreenCreativeList
                screens={screensForList}
                orderLineId={orderLineId}
                resolutionWidth={primaryResolution.width}
                resolutionHeight={primaryResolution.height}
                playbackMode={playbackMode}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add creative dialog for the group */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Agregar creativo — {group.groupName}</DialogTitle>
            <DialogDescription>
              Se asignará a las {group.screens.length} pantallas de este grupo.
              {uniqueResolutions.length > 1 && (
                <> Este grupo contiene pantallas con múltiples resoluciones ({uniqueResolutions.join(', ')}). Solo se asignarán creativos a pantallas con resolución coincidente.</>
              )}
            </DialogDescription>
          </DialogHeader>

          <LibrarySelector
            width={primaryResolution.width}
            height={primaryResolution.height}
            onSelect={handleLibrarySelect}
            isSubmitting={bulkMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
