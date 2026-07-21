import { useState, useMemo } from 'react';
import { Search, ArrowUpDown } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';

import { ScreenCreativeList } from './ScreenCreativeList';
import type { ResolutionGroup, PlaybackMode } from '../types';

const PAGE_SIZE = 20;

type SortOption = 'name-asc' | 'name-desc' | 'resolution-asc' | 'resolution-desc';

interface FlatScreen {
  id: string;
  name: string;
  target_id: string;
  resolution_width: number;
  resolution_height: number;
}

export interface ByScreenTabProps {
  resolutions: ResolutionGroup[] | undefined;
  resolutionsLoading: boolean;
  resolutionsError: boolean;
  refetchResolutions: () => void;
  orderLineId: string;
  playbackMode: PlaybackMode;
}

/**
 * "Por Pantalla" tab content.
 * Shows a flat list of all screens with search, sort, pagination (>20 screens),
 * and full creative management per screen.
 */
export function ByScreenTab({
  resolutions,
  resolutionsLoading,
  resolutionsError,
  refetchResolutions,
  orderLineId,
  playbackMode,
}: ByScreenTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('name-asc');
  const [currentPage, setCurrentPage] = useState(1);

  // Flatten all screens from resolution groups with their resolution info
  const allScreens: FlatScreen[] = useMemo(() => {
    if (!resolutions) return [];
    return resolutions.flatMap((group) =>
      group.screens.map((screen) => ({
        id: screen.id,
        name: screen.name,
        target_id: screen.target_id,
        resolution_width: group.resolution_width,
        resolution_height: group.resolution_height,
      }))
    );
  }, [resolutions]);

  // Filter by search query
  const filteredScreens = useMemo(() => {
    if (!searchQuery.trim()) return allScreens;
    const query = searchQuery.toLowerCase().trim();
    return allScreens.filter((screen) =>
      screen.name.toLowerCase().includes(query)
    );
  }, [allScreens, searchQuery]);

  // Sort screens
  const sortedScreens = useMemo(() => {
    const sorted = [...filteredScreens];
    switch (sortBy) {
      case 'name-asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'resolution-asc':
        sorted.sort((a, b) => {
          const aRes = a.resolution_width * a.resolution_height;
          const bRes = b.resolution_width * b.resolution_height;
          return aRes - bRes || a.name.localeCompare(b.name);
        });
        break;
      case 'resolution-desc':
        sorted.sort((a, b) => {
          const aRes = a.resolution_width * a.resolution_height;
          const bRes = b.resolution_width * b.resolution_height;
          return bRes - aRes || a.name.localeCompare(b.name);
        });
        break;
    }
    return sorted;
  }, [filteredScreens, sortBy]);

  // Paginate when >20 screens
  const totalPages = Math.ceil(sortedScreens.length / PAGE_SIZE);
  const needsPagination = sortedScreens.length > PAGE_SIZE;

  // Reset page when filter/sort changes — derived from state, no useEffect needed
  const effectiveCurrentPage = currentPage > totalPages ? 1 : currentPage;
  const displayedScreens = needsPagination
    ? sortedScreens.slice((effectiveCurrentPage - 1) * PAGE_SIZE, effectiveCurrentPage * PAGE_SIZE)
    : sortedScreens;

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setCurrentPage(1);
  }

  function handleSortChange(value: string) {
    setSortBy(value as SortOption);
    setCurrentPage(1);
  }

  if (resolutionsLoading) {
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

  if (!resolutions || resolutions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">
            No hay pantallas asignadas a esta línea de pedido.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search + Sort controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar pantalla por nombre..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={sortBy} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[200px]">
            <ArrowUpDown className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Ordenar por" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name-asc">Nombre A→Z</SelectItem>
            <SelectItem value="name-desc">Nombre Z→A</SelectItem>
            <SelectItem value="resolution-asc">Resolución ↑</SelectItem>
            <SelectItem value="resolution-desc">Resolución ↓</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground shrink-0">
          {filteredScreens.length} pantalla{filteredScreens.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Screen list */}
      {displayedScreens.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">
              No se encontraron pantallas que coincidan con "{searchQuery}".
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {displayedScreens.map((screen) => (
              <ScreenCreativeList
                key={screen.id}
                screens={[{
                  id: screen.id,
                  name: `${screen.name} (${screen.resolution_width}×${screen.resolution_height})`,
                  target_id: screen.target_id,
                }]}
                orderLineId={orderLineId}
                resolutionWidth={screen.resolution_width}
                resolutionHeight={screen.resolution_height}
                playbackMode={playbackMode}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {needsPagination && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={effectiveCurrentPage <= 1}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {effectiveCurrentPage} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={effectiveCurrentPage >= totalPages}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}
