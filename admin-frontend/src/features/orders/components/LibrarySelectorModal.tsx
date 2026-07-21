import { useState, useMemo } from 'react';
import {
  Search,
  Image,
  Film,
  Check,
  Library,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

import { useAllContent, useBulkAssign } from '../hooks';
import { useTags } from '@/features/content/hooks';
import { exceedsSlotDuration, DEFAULT_SLOT_DURATION_SECONDS } from '../utils/duration-validation';
import { DurationWarningDialog } from './DurationWarningDialog';
import type { Content, Tag } from '@/types/models';
import type { BulkAssignResponse } from '../api';
import type { DurationWarning } from '../utils/duration-validation';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function matchesSearch(content: Content, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;

  // Match by filename
  if (content.filename.toLowerCase().includes(q)) return true;

  // Match by dimensions string (e.g. "1920x1080")
  const dims = `${content.width}x${content.height}`;
  if (dims.includes(q)) return true;

  // Match by tag name
  if (content.tags?.some((tag) => tag.name.toLowerCase().includes(q))) return true;

  return false;
}

// ─── Summary Dialog ──────────────────────────────────────────────────────────

interface AssignSummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: BulkAssignResponse | null;
}

function AssignSummaryDialog({ open, onOpenChange, result }: AssignSummaryDialogProps) {
  if (!result) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resumen de asignación</DialogTitle>
          <DialogDescription>
            Resultado del auto-matching por resolución
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span>
              <strong>{result.created}</strong> creativo(s) creado(s)
            </span>
          </div>
          {result.covered_screens.length > 0 && (
            <div className="text-sm text-muted-foreground">
              Pantallas cubiertas: {result.covered_screens.length}
            </div>
          )}
          {result.unmatched_contents.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <span>
                  <strong>{result.unmatched_contents.length}</strong> archivo(s) sin coincidencia
                </span>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                {result.unmatched_contents.map((item) => (
                  <li key={item.id}>
                    • {item.width}×{item.height} — sin pantallas con esa resolución
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface LibrarySelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderLineId: string;
  /** Set of content IDs already assigned to this OrderLine (for "Ya asignado" indicator) */
  assignedContentIds?: Set<string>;
  onAssignComplete?: () => void;
  /** Slot duration in seconds to check video duration warnings. Defaults to 10s. */
  slotDurationSeconds?: number;
}

export function LibrarySelectorModal({
  open,
  onOpenChange,
  orderLineId,
  assignedContentIds = new Set(),
  onAssignComplete,
  slotDurationSeconds = DEFAULT_SLOT_DURATION_SECONDS,
}: LibrarySelectorModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lastResult, setLastResult] = useState<BulkAssignResponse | null>(null);
  const [durationWarning, setDurationWarning] = useState<DurationWarning | null>(null);
  const [durationWarningOpen, setDurationWarningOpen] = useState(false);

  const { data: contents, isLoading: contentsLoading } = useAllContent();
  const { data: tags } = useTags();
  const bulkAssign = useBulkAssign(orderLineId);

  // Filter contents based on search
  const filteredContents = useMemo(() => {
    if (!contents) return [];
    return contents.filter((c) => matchesSearch(c, searchQuery));
  }, [contents, searchQuery]);

  // Collect all unique tags for display
  const allTags = useMemo(() => {
    return tags ?? [];
  }, [tags]);

  function handleItemClick(contentId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contentId)) {
        next.delete(contentId);
      } else {
        next.add(contentId);
      }
      return next;
    });
  }

  function handleConfirm() {
    const contentIds = Array.from(selectedIds);

    // Check if any selected video exceeds slot duration
    const selectedContents = (contents ?? []).filter((c) => selectedIds.has(c.id));
    const exceedingVideos = selectedContents.filter((c) =>
      exceedsSlotDuration(c, slotDurationSeconds)
    );

    if (exceedingVideos.length > 0) {
      // Show non-blocking warning before proceeding
      const warning: DurationWarning = {
        videoDuration: exceedingVideos[0].duration_seconds!,
        screens: exceedingVideos.map((v) => ({
          name: v.filename,
          slotDuration: slotDurationSeconds,
        })),
      };
      setDurationWarning(warning);
      setDurationWarningOpen(true);
      return;
    }

    executeBulkAssign(contentIds);
  }

  function executeBulkAssign(contentIds: string[]) {
    bulkAssign.mutate(
      { content_ids: contentIds, weight: 100 },
      {
        onSuccess: (result) => {
          setLastResult(result);
          setSummaryOpen(true);
          setSelectedIds(new Set());
          onAssignComplete?.();
        },
      },
    );
  }

  function handleDurationWarningConfirm() {
    const contentIds = Array.from(selectedIds);
    executeBulkAssign(contentIds);
  }

  function handleDurationWarningCancel() {
    setDurationWarning(null);
  }

  function handleClose(newOpen: boolean) {
    if (!newOpen) {
      setSelectedIds(new Set());
      setSearchQuery('');
    }
    onOpenChange(newOpen);
  }

  function handleTagClick(tagName: string) {
    setSearchQuery(tagName);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Library className="h-5 w-5" />
              Selector de Biblioteca
            </DialogTitle>
            <DialogDescription>
              Selecciona contenidos para asignar automáticamente por resolución a las pantallas de esta línea.
            </DialogDescription>
          </DialogHeader>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, tag o dimensiones (ej: 1920x1080)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Tag chips for quick filter */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allTags.slice(0, 15).map((tag: Tag) => (
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

          {/* Content grid */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {contentsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-video rounded-md" />
                ))}
              </div>
            ) : filteredContents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Image className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery
                    ? `No se encontraron archivos para "${searchQuery}"`
                    : 'No hay archivos en la Biblioteca'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-1">
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
                        isSelected
                          ? 'border-primary ring-2 ring-primary/50'
                          : 'border-transparent'
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-video bg-muted">
                        {content.mime_type.startsWith('image/') ? (
                          <img
                            src={`/api/admin/content/${content.id}/preview/file`}
                            alt={content.filename}
                            className="h-full w-full object-cover"
                          />
                        ) : content.mime_type.startsWith('video/') ? (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-1">
                            <Film className="h-6 w-6 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground">Video</span>
                          </div>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Image className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}

                        {/* Selection indicator */}
                        {isSelected && (
                          <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                            <div className="rounded-full bg-primary p-1">
                              <Check className="h-3 w-3 text-primary-foreground" />
                            </div>
                          </div>
                        )}

                        {/* "Ya asignado" indicator */}
                        {isAssigned && (
                          <div className="absolute top-1 right-1">
                            <Badge variant="secondary" className="text-[9px] px-1 py-0">
                              Ya asignado
                            </Badge>
                          </div>
                        )}
                      </div>

                      {/* Metadata */}
                      <div className="p-2 space-y-0.5 border-t bg-card">
                        <p className="text-xs font-medium truncate" title={content.filename}>
                          {content.filename}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{content.width}×{content.height}</span>
                          {content.duration_seconds != null && (
                            <span>{content.duration_seconds}s</span>
                          )}
                          <span>{formatFileSize(content.file_size_bytes)}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {formatDate(content.created_at)}
                        </p>
                        {content.tags && content.tags.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 pt-0.5">
                            {content.tags.slice(0, 3).map((tag) => (
                              <Badge key={tag.id} variant="secondary" className="text-[9px] px-1 py-0">
                                {tag.name}
                              </Badge>
                            ))}
                            {content.tags.length > 3 && (
                              <span className="text-[9px] text-muted-foreground">
                                +{content.tags.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer with selection count + confirm */}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">
              {selectedIds.size > 0
                ? `${selectedIds.size} seleccionado${selectedIds.size > 1 ? 's' : ''}`
                : `${filteredContents.length} archivo(s) disponible(s)`}
            </span>
            <Button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0 || bulkAssign.isPending}
            >
              {bulkAssign.isPending
                ? 'Asignando...'
                : `Asignar por resolución (${selectedIds.size})`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Summary dialog shown after assignment */}
      <AssignSummaryDialog
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        result={lastResult}
      />

      {/* Duration warning dialog shown before assignment */}
      <DurationWarningDialog
        open={durationWarningOpen}
        onOpenChange={setDurationWarningOpen}
        warning={durationWarning}
        onConfirm={handleDurationWarningConfirm}
        onCancel={handleDurationWarningCancel}
      />
    </>
  );
}
