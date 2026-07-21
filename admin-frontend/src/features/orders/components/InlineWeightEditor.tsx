import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';
import { queryClient } from '@/lib/query-client';
import { creativesApi } from '../api';
import type { PlaybackMode } from '../types';

interface InlineWeightEditorProps {
  creativeId: string;
  weight: number;
  targetId: string;
  orderLineId: string;
  playbackMode?: PlaybackMode;
}

/**
 * Inline editor for creative weight.
 * Displays the weight value as clickable text. On click, transforms into a numeric input.
 * Confirms on Enter or blur. Validates: rejects < 1 and non-numeric values.
 * Hidden when playbackMode is 'sequential'.
 */
export function InlineWeightEditor({
  creativeId,
  weight,
  targetId,
  orderLineId,
  playbackMode = 'round_robin',
}: InlineWeightEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(weight));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateMutation = useMutation({
    mutationFn: (newWeight: number) =>
      creativesApi.update(creativeId, { weight: newWeight }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets', targetId, 'creatives'] });
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'resolutions'] });
      toast.success('Peso actualizado');
      setIsEditing(false);
      setError(null);
    },
    onError: (err: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(err.response?.data?.message ?? 'Error al actualizar peso');
    },
  });

  // Hidden in sequential mode
  if (playbackMode === 'sequential') {
    return null;
  }

  function validate(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === '' || !/^\d+$/.test(trimmed)) {
      setError('Debe ser un número entero');
      return null;
    }
    const parsed = parseInt(trimmed, 10);
    if (parsed < 1) {
      setError('El peso debe ser ≥ 1');
      return null;
    }
    setError(null);
    return parsed;
  }

  function handleConfirm() {
    const validated = validate(editValue);
    if (validated === null) return;

    // Only mutate if value changed
    if (validated === weight) {
      setIsEditing(false);
      setError(null);
      return;
    }

    updateMutation.mutate(validated);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(String(weight));
      setError(null);
    }
  }

  function handleStartEdit() {
    setEditValue(String(weight));
    setError(null);
    setIsEditing(true);
    // Focus the input after state update via ref callback below
    requestAnimationFrame(() => {
      inputRef.current?.select();
    });
  }

  if (isEditing) {
    return (
      <div className="inline-flex flex-col gap-0.5">
        <div className="inline-flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Peso:</span>
          <Input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value);
              if (error) setError(null);
            }}
            onBlur={handleConfirm}
            onKeyDown={handleKeyDown}
            className="h-6 w-16 px-1.5 text-xs"
            disabled={updateMutation.isPending}
            aria-label="Editar peso del creativo"
            aria-invalid={!!error}
            autoFocus
          />
        </div>
        {error && (
          <span className="text-[10px] text-destructive" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleStartEdit}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-muted"
      title="Clic para editar peso"
      aria-label={`Peso: ${weight}. Clic para editar`}
    >
      <span>Peso: {weight}</span>
    </button>
  );
}
