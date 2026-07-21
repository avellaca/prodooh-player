import { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { queryClient } from '@/lib/query-client';
import { useReorderCreatives } from '../hooks';
import type { Creative } from '../types';

interface DragDropCreativeListProps {
  creatives: Creative[];
  targetId: string;
  orderLineId: string;
  onDelete?: (creative: Creative) => void;
}

export function DragDropCreativeList({
  creatives,
  targetId,
  orderLineId,
  onDelete,
}: DragDropCreativeListProps) {
  const reorderMutation = useReorderCreatives(targetId, orderLineId);

  // Local ordering state for optimistic UI
  const [optimisticOrder, setOptimisticOrder] = useState<Creative[] | null>(null);

  const displayedCreatives = optimisticOrder ?? sortedByPosition(creatives);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const items = optimisticOrder ?? sortedByPosition(creatives);
      const oldIndex = items.findIndex((c) => c.id === active.id);
      const newIndex = items.findIndex((c) => c.id === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(items, oldIndex, newIndex);

      // Optimistic update
      setOptimisticOrder(reordered);

      // Also update the query cache optimistically
      const updatedCreatives = reordered.map((c, idx) => ({ ...c, position: idx }));
      queryClient.setQueryData(['targets', targetId, 'creatives'], updatedCreatives);

      // Fire API call
      const newIds = reordered.map((c) => c.id);
      reorderMutation.mutate(newIds, {
        onSuccess: () => {
          setOptimisticOrder(null);
        },
        onError: () => {
          setOptimisticOrder(null);
        },
      });
    },
    [creatives, optimisticOrder, targetId, reorderMutation],
  );

  if (displayedCreatives.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        No hay creativos asignados a esta pantalla.
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={displayedCreatives.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1">
          {displayedCreatives.map((creative, index) => (
            <SortableCreativeItem
              key={creative.id}
              creative={creative}
              position={index}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// ─── Sortable Item ───────────────────────────────────────────────────────────

interface SortableCreativeItemProps {
  creative: Creative;
  position: number;
  onDelete?: (creative: Creative) => void;
}

function SortableCreativeItem({ creative, position, onDelete }: SortableCreativeItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: creative.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border p-2 bg-background hover:bg-muted/20 transition-colors"
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing touch-none p-1 rounded hover:bg-muted"
        aria-label="Arrastrar para reordenar"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>

      {/* Position indicator */}
      <Badge variant="secondary" className="shrink-0 h-6 w-6 p-0 flex items-center justify-center text-xs font-mono">
        {position + 1}
      </Badge>

      {/* Thumbnail */}
      <CreativeThumbnail creative={creative} />

      {/* Content info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {creative.content?.filename ?? 'Contenido'}
        </p>
        {creative.content?.mime_type && (
          <p className="text-xs text-muted-foreground">
            {creative.content.mime_type.startsWith('video/') ? 'Video' : 'Imagen'}
          </p>
        )}
      </div>

      {/* Delete action */}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
          onClick={() => onDelete(creative)}
          title="Eliminar creativo"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sortedByPosition(creatives: Creative[]): Creative[] {
  return [...creatives].sort((a, b) => {
    const posA = a.position ?? Number.MAX_SAFE_INTEGER;
    const posB = b.position ?? Number.MAX_SAFE_INTEGER;
    return posA - posB;
  });
}

function CreativeThumbnail({ creative }: { creative: Creative }) {
  if (creative.content?.mime_type?.startsWith('image/')) {
    return (
      <img
        src={`/api/admin/content/${creative.content_id}/preview/file`}
        alt={creative.content?.filename ?? 'Creativo'}
        className="h-10 w-10 rounded border object-cover shrink-0"
      />
    );
  }

  return (
    <div className="h-10 w-10 rounded border bg-muted flex items-center justify-center shrink-0">
      <span className="text-[9px] text-muted-foreground font-medium">
        {creative.content?.mime_type?.startsWith('video/') ? 'VID' : '?'}
      </span>
    </div>
  );
}
