import { useState } from 'react';
import { Library, Upload, Layers } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

import { LibrarySelectorModal } from './LibrarySelectorModal';
import { BulkUploadAssignPanel } from './BulkUploadAssignPanel';

interface BulkCreativesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderLineId: string;
  assignedContentIds?: Set<string>;
  onAssignComplete?: () => void;
}

/**
 * Modal with two modes for bulk creative assignment:
 * 1. "Desde biblioteca" — select from existing library content (existing LibrarySelectorModal flow)
 * 2. "Subir imágenes" — upload files from computer + auto-assign by resolution
 */
export function BulkCreativesModal({
  open,
  onOpenChange,
  orderLineId,
  assignedContentIds,
  onAssignComplete,
}: BulkCreativesModalProps) {
  const [activeTab, setActiveTab] = useState<string>('library');

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setActiveTab('library');
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Bulk de creativos
          </DialogTitle>
          <DialogDescription>
            Asigna creativos masivamente a esta línea por coincidencia de resolución.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="library" className="gap-2">
              <Library className="h-4 w-4" />
              Desde biblioteca
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="h-4 w-4" />
              Subir imágenes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="flex-1 min-h-0 mt-4">
            <LibrarySelectorInline
              orderLineId={orderLineId}
              assignedContentIds={assignedContentIds}
              onAssignComplete={() => {
                onAssignComplete?.();
                handleClose(false);
              }}
            />
          </TabsContent>

          <TabsContent value="upload" className="flex-1 min-h-0 mt-4">
            <BulkUploadAssignPanel
              orderLineId={orderLineId}
              onAssignComplete={() => {
                onAssignComplete?.();
                handleClose(false);
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inline Library Selector (embedded in the modal, not a separate Dialog) ──

import { useState as useStateInline, useMemo } from 'react';
import { Search, Image, Film, Check, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAllContent, useBulkAssign } from '../hooks';
import { useTags } from '@/features/content/hooks';
import { matchesSearch } from './LibrarySelectorModal';
import type { Content, Tag } from '@/types/models';
import type { BulkAssignResponse } from '../api';

function LibrarySelectorInline({
  orderLineId,
  assignedContentIds = new Set(),
  onAssignComplete,
}: {
  orderLineId: string;
  assignedContentIds?: Set<string>;
  onAssignComplete?: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<BulkAssignResponse | null>(null);

  const { data: contents, isLoading } = useAllContent();
  const { data: tags } = useTags();
  const bulkAssign = useBulkAssign(orderLineId);

  const filteredContents = useMemo(() => {
    if (!contents) return [];
    return contents.filter((c) => matchesSearch(c, searchQuery));
  }, [contents, searchQuery]);

  function handleItemClick(contentId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contentId)) next.delete(contentId);
      else next.add(contentId);
      return next;
    });
  }

  function handleConfirm() {
    bulkAssign.mutate(
      { content_ids: Array.from(selectedIds), weight: 100 },
      {
        onSuccess: (res) => {
          setResult(res);
          setSelectedIds(new Set());
          onAssignComplete?.();
        },
      },
    );
  }

  function handleTagClick(tagName: string) {
    setSearchQuery(tagName);
  }

  if (result) {
    return (
      <div className="space-y-4 py-4">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span><strong>{result.created}</strong> creativo(s) asignado(s)</span>
        </div>
        {result.unmatched_contents.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            <span>{result.unmatched_contents.length} sin coincidencia de resolución</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0 max-h-[55vh]">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, tag o dimensiones..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Tags chips */}
      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 15).map((tag: Tag) => (
            <Badge
              key={tag.id}
              variant={searchQuery === tag.name ? 'default' : 'secondary'}
              className="cursor-pointer text-xs"
              onClick={() => handleTagClick(tag.name)}
            >
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video rounded-md" />
            ))}
          </div>
        ) : filteredContents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Image className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? `Sin resultados para "${searchQuery}"` : 'Biblioteca vacía'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {filteredContents.map((content: Content) => {
              const isSelected = selectedIds.has(content.id);
              const isAssigned = assignedContentIds.has(content.id);
              return (
                <button
                  key={content.id}
                  type="button"
                  onClick={() => handleItemClick(content.id)}
                  disabled={bulkAssign.isPending}
                  className={`relative flex flex-col rounded-md border-2 overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 text-left ${
                    isSelected ? 'border-primary ring-2 ring-primary/50' : 'border-transparent'
                  }`}
                >
                  <div className="relative aspect-video bg-muted">
                    {content.mime_type.startsWith('image/') ? (
                      <img
                        src={`/api/admin/content/${content.id}/preview/file`}
                        alt={content.filename}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Film className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                        <div className="rounded-full bg-primary p-1">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                    {isAssigned && (
                      <div className="absolute top-1 right-1">
                        <Badge variant="secondary" className="text-[9px] px-1 py-0">Ya asignado</Badge>
                      </div>
                    )}
                  </div>
                  <div className="p-1.5 border-t bg-card">
                    <p className="text-xs truncate">{content.filename}</p>
                    <p className="text-[10px] text-muted-foreground">{content.width}×{content.height}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-sm text-muted-foreground">
          {selectedIds.size > 0 ? `${selectedIds.size} seleccionado(s)` : `${filteredContents.length} disponible(s)`}
        </span>
        <Button onClick={handleConfirm} disabled={selectedIds.size === 0 || bulkAssign.isPending}>
          {bulkAssign.isPending ? 'Asignando...' : `Asignar (${selectedIds.size})`}
        </Button>
      </div>
    </div>
  );
}
