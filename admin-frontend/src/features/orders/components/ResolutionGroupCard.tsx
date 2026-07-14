import { useState } from 'react';
import { Plus, ChevronDown, ChevronUp, Image, Film } from 'lucide-react';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CoverageIndicator } from './CoverageIndicator';
import { LibrarySelector } from './LibrarySelector';
import { DirectUploadDialog } from './DirectUploadDialog';
import { ScreenCreativeList } from './ScreenCreativeList';
import { useTargetCreatives, useBulkCreateByResolution } from '../hooks';
import type { ResolutionGroup } from '../types';

const MAX_THUMBNAILS = 4;

interface ResolutionGroupCardProps {
  group: ResolutionGroup;
  orderLineId: string;
  onCreativeAdded: () => void;
}

export function ResolutionGroupCard({
  group,
  orderLineId,
  onCreativeAdded,
}: ResolutionGroupCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  // Fetch creatives from the first target to show representative thumbnails
  const firstTargetId = group.screens[0]?.target_id;
  const { data: creatives } = useTargetCreatives(firstTargetId);

  const bulkMutation = useBulkCreateByResolution(orderLineId);

  // Filter creatives to only show those matching this resolution group
  // (resolution matches OR legacy creatives with null resolution)
  const creativesWithContent = (creatives ?? []).filter((c) => {
    if (!c.content) return false;
    const matchesRes =
      (c.resolution_width === group.resolution_width && c.resolution_height === group.resolution_height) ||
      (c.resolution_width == null && c.resolution_height == null);
    return matchesRes;
  });
  const visibleThumbnails = creativesWithContent.slice(0, MAX_THUMBNAILS);
  const extraCount = creativesWithContent.length - MAX_THUMBNAILS;

  async function handleLibrarySelect(contentIds: string[]) {
    for (const contentId of contentIds) {
      await bulkMutation.mutateAsync({
        content_id: contentId,
        resolution_width: group.resolution_width,
        resolution_height: group.resolution_height,
        weight: 100,
      });
    }
    setIsAddDialogOpen(false);
    onCreativeAdded();
  }

  function handleUploadSuccess() {
    setIsUploadDialogOpen(false);
    setIsAddDialogOpen(false);
    onCreativeAdded();
  }

  function handleSwitchToUpload() {
    setIsAddDialogOpen(false);
    setIsUploadDialogOpen(true);
  }

  function handleToggleExpand() {
    setIsExpanded((prev) => !prev);
  }

  function handleOpenAddDialog() {
    setIsAddDialogOpen(true);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold">
              {group.resolution_width}×{group.resolution_height} — {group.screen_count} pantallas
            </h3>
            <CoverageIndicator coverage={group.coverage} />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Creative thumbnails */}
          {creativesWithContent.length > 0 ? (
            <div className="flex items-center gap-2">
              {visibleThumbnails.map((creative) => (
                <div
                  key={creative.id}
                  className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md border bg-muted"
                >
                  {creative.content?.mime_type?.startsWith('image/') ? (
                    <img
                      src={`/api/admin/content/${creative.content_id}/preview/file`}
                      alt={creative.content?.filename ?? 'Creative'}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="text-xs text-muted-foreground truncate px-1">
                        {creative.content?.filename ?? 'Video'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {extraCount > 0 && (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-muted">
                  <span className="text-xs font-medium text-muted-foreground">
                    +{extraCount} más
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-dashed p-4">
              <Image className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Sin creativos asignados</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" onClick={handleOpenAddDialog}>
              <Plus className="h-4 w-4" />
              Agregar creativo
            </Button>
            <Button variant="outline" size="sm" onClick={handleToggleExpand}>
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Ocultar pantallas
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Ver pantallas
                </>
              )}
            </Button>
          </div>

          {/* Expanded section: ScreenCreativeList */}
          {isExpanded && (
            <div className="rounded-md border">
              <ScreenCreativeList
                screens={group.screens}
                orderLineId={orderLineId}
                resolutionWidth={group.resolution_width}
                resolutionHeight={group.resolution_height}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add creative dialog with tabs: Biblioteca / Subir nuevo */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Agregar creativo — {group.resolution_width}×{group.resolution_height}</DialogTitle>
            <DialogDescription>
              Se asignará a las {group.screen_count} pantallas de este grupo de resolución.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="biblioteca" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="biblioteca" className="flex-1">
                Biblioteca
              </TabsTrigger>
              <TabsTrigger value="subir" className="flex-1">
                Subir nuevo
              </TabsTrigger>
            </TabsList>

            <TabsContent value="biblioteca" className="mt-4">
              <LibrarySelector
                width={group.resolution_width}
                height={group.resolution_height}
                onSelect={handleLibrarySelect}
                onUploadClick={handleSwitchToUpload}
                isSubmitting={bulkMutation.isPending}
              />
            </TabsContent>

            <TabsContent value="subir" className="mt-4">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Sube un archivo con resolución {group.resolution_width}×{group.resolution_height} para asignarlo a todas las pantallas del grupo.
                </p>
                <Button variant="secondary" onClick={handleSwitchToUpload}>
                  Abrir diálogo de upload
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Direct upload dialog */}
      <DirectUploadDialog
        open={isUploadDialogOpen}
        onOpenChange={setIsUploadDialogOpen}
        resolutionWidth={group.resolution_width}
        resolutionHeight={group.resolution_height}
        orderLineId={orderLineId}
        onSuccess={handleUploadSuccess}
      />
    </>
  );
}
