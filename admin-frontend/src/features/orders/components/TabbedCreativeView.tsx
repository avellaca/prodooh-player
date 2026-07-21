import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { ByResolutionTab } from './ByResolutionTab';
import { ByGroupTab } from './ByGroupTab';
import { ByScreenTab } from './ByScreenTab';
import type { ResolutionGroup, PlaybackMode } from '../types';

export interface TabbedCreativeViewProps {
  resolutions: ResolutionGroup[] | undefined;
  resolutionsLoading: boolean;
  resolutionsError: boolean;
  refetchResolutions: () => void;
  orderLineId: string;
  playbackMode: PlaybackMode;
  onCreativeAdded: () => void;
  onOpenLibrarySelector: () => void;
  onOpenCopyDialog?: () => void;
}

/**
 * Container component with 3 tabs for viewing/managing creatives:
 * - "Por Resolución" (default) — groups screens by resolution
 * - "Por Grupo" — groups screens by ScreenGroup
 * - "Por Pantalla" — flat list of individual screens
 */
export function TabbedCreativeView({
  resolutions,
  resolutionsLoading,
  resolutionsError,
  refetchResolutions,
  orderLineId,
  playbackMode,
  onCreativeAdded,
  onOpenLibrarySelector,
  onOpenCopyDialog,
}: TabbedCreativeViewProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Creativos</h2>
        {onOpenCopyDialog && (
          <Button variant="outline" size="sm" onClick={onOpenCopyDialog}>
            <Copy className="h-4 w-4" />
            Copiar a otra línea
          </Button>
        )}
      </div>
      <Tabs defaultValue="by-resolution">
        <TabsList>
          <TabsTrigger value="by-resolution">Por Resolución</TabsTrigger>
          <TabsTrigger value="by-group">Por Grupo</TabsTrigger>
          <TabsTrigger value="by-screen">Por Pantalla</TabsTrigger>
        </TabsList>

        <TabsContent value="by-resolution">
          <ByResolutionTab
            resolutions={resolutions}
            resolutionsLoading={resolutionsLoading}
            resolutionsError={resolutionsError}
            refetchResolutions={refetchResolutions}
            orderLineId={orderLineId}
            playbackMode={playbackMode}
            onCreativeAdded={onCreativeAdded}
            onOpenLibrarySelector={onOpenLibrarySelector}
          />
        </TabsContent>

        <TabsContent value="by-group">
          <ByGroupTab
            resolutions={resolutions}
            resolutionsLoading={resolutionsLoading}
            resolutionsError={resolutionsError}
            refetchResolutions={refetchResolutions}
            orderLineId={orderLineId}
            playbackMode={playbackMode}
            onCreativeAdded={onCreativeAdded}
            onOpenLibrarySelector={onOpenLibrarySelector}
          />
        </TabsContent>

        <TabsContent value="by-screen">
          <ByScreenTab
            resolutions={resolutions}
            resolutionsLoading={resolutionsLoading}
            resolutionsError={resolutionsError}
            refetchResolutions={refetchResolutions}
            orderLineId={orderLineId}
            playbackMode={playbackMode}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
