import { useState } from 'react';
import { Eye, Clock, Film, Image, Radio, List, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

import { useLoopPreview } from '../hooks';
import type { LoopPreviewSlot, LoopPreviewCandidate } from '../api';

interface LoopPreviewModalProps {
  screenId: string;
  screenName: string;
}

/**
 * LoopPreviewModal shows a visual timeline of the loop for a specific screen.
 * Triggered via a "Preview" button per screen row.
 */
export function LoopPreviewModal({ screenId, screenName }: LoopPreviewModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-xs gap-1"
        onClick={() => setOpen(true)}
        title="Preview del loop"
      >
        <Eye className="h-3 w-3" />
        Preview
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview del Loop — {screenName}</DialogTitle>
            <DialogDescription>
              Simulación visual de la secuencia de reproducción de esta pantalla.
            </DialogDescription>
          </DialogHeader>

          {open && (
            <LoopPreviewContent screenId={screenId} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Content (only rendered when modal is open) ──────────────────────────────

function LoopPreviewContent({ screenId }: { screenId: string }) {
  const { data, isLoading, isError, refetch } = useLoopPreview(screenId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-sm text-muted-foreground">Error al cargar el preview del loop.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center gap-4 rounded-lg border p-3 bg-muted/30">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Duración total:</span>
          <span>{data.total_duration_seconds}s</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <List className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Slots:</span>
          <span>{data.slots.length}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {data.playback_mode === 'sequential' ? (
            <List className="h-4 w-4 text-muted-foreground" />
          ) : (
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">Modo:</span>
          <Badge variant="outline" className="text-xs">
            {data.playback_mode === 'sequential' ? 'Secuencial' : 'Round Robin'}
          </Badge>
        </div>
      </div>

      {/* Loop timeline */}
      <div className="space-y-2">
        {data.slots.map((slot) => (
          <SlotCard key={slot.position} slot={slot} playbackMode={data.playback_mode} />
        ))}
      </div>
    </div>
  );
}

// ─── SlotCard ────────────────────────────────────────────────────────────────

function SlotCard({ slot, playbackMode }: { slot: LoopPreviewSlot; playbackMode: string }) {
  const slotTypeLabel = getSlotTypeLabel(slot.type);
  const slotTypeColor = getSlotTypeColor(slot.type);

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Slot header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-muted/40 border-b">
        <span className="text-xs font-mono text-muted-foreground w-8">
          #{slot.position + 1}
        </span>
        <Badge variant="outline" className={`text-xs ${slotTypeColor}`}>
          {slotTypeLabel}
        </Badge>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {slot.duration_seconds}s
        </div>
        {slot.type === 'ad' && (
          <Badge variant="secondary" className="text-xs ml-auto">
            {slot.strategy === 'sequential' ? 'Secuencial' : 'Round Robin'}
          </Badge>
        )}
      </div>

      {/* Candidates */}
      {slot.candidates.length > 0 ? (
        <div className="p-3 space-y-2">
          {slot.candidates.map((candidate, index) => (
            <CandidateRow
              key={candidate.creative_id}
              candidate={candidate}
              index={index}
              isSequential={slot.strategy === 'sequential' || playbackMode === 'sequential'}
            />
          ))}
        </div>
      ) : (
        <div className="p-3 text-xs text-muted-foreground italic">
          Sin candidatos
        </div>
      )}
    </div>
  );
}

// ─── CandidateRow ────────────────────────────────────────────────────────────

function CandidateRow({
  candidate,
  index,
  isSequential,
}: {
  candidate: LoopPreviewCandidate;
  index: number;
  isSequential: boolean;
}) {
  const isVideo = candidate.mime_type?.startsWith('video/');
  const isImage = candidate.mime_type?.startsWith('image/');

  return (
    <div className="flex items-center gap-3 rounded border p-2 bg-background">
      {/* Position indicator */}
      <span className="text-xs font-mono text-muted-foreground w-6 text-center shrink-0">
        {isSequential ? `${index + 1}.` : '•'}
      </span>

      {/* Thumbnail */}
      <div className="h-9 w-14 shrink-0 rounded border bg-muted overflow-hidden flex items-center justify-center">
        {candidate.thumbnail_url ? (
          <img
            src={candidate.thumbnail_url}
            alt={candidate.filename}
            className="h-full w-full object-cover"
          />
        ) : isVideo ? (
          <Film className="h-4 w-4 text-muted-foreground" />
        ) : isImage ? (
          <Image className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Radio className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{candidate.filename}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isVideo && candidate.duration_seconds != null && (
            <span>{candidate.duration_seconds}s</span>
          )}
          {candidate.mime_type && (
            <span>{candidate.mime_type.split('/')[1]?.toUpperCase()}</span>
          )}
        </div>
      </div>

      {/* Weight or position info */}
      <div className="shrink-0">
        {isSequential ? (
          <Badge variant="outline" className="text-xs">
            Pos {(candidate.position ?? index) + 1}
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">
            Peso: {candidate.weight}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSlotTypeLabel(type: string): string {
  switch (type) {
    case 'ad':
      return 'Publicidad';
    case 'ssp':
      return 'SSP';
    case 'playlist':
      return 'Playlist';
    default:
      return type;
  }
}

function getSlotTypeColor(type: string): string {
  switch (type) {
    case 'ad':
      return 'border-blue-200 text-blue-700';
    case 'ssp':
      return 'border-amber-200 text-amber-700';
    case 'playlist':
      return 'border-green-200 text-green-700';
    default:
      return '';
  }
}
