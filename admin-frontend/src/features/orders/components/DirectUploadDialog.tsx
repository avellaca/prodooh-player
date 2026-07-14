import { useState, useRef } from 'react';
import { Upload, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { queryClient } from '@/lib/query-client';
import { contentApi as contentUploadApi } from '@/features/content/api';
import { bulkCreativesApi, creativesApi } from '../api';
import type { Content } from '@/types/models';

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';

type UploadPhase = 'idle' | 'uploading' | 'assigning' | 'success' | 'error';

interface DirectUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resolutionWidth: number;
  resolutionHeight: number;
  orderLineId: string;
  targetId?: string; // If present, upload for individual screen
  onSuccess: () => void;
}

export function DirectUploadDialog({
  open,
  onOpenChange,
  resolutionWidth,
  resolutionHeight,
  orderLineId,
  targetId,
  onSuccess,
}: DirectUploadDialogProps) {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [screenCount, setScreenCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mutation: Upload content file
  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      contentUploadApi.upload(file, {
        onUploadProgress: (percent) => setUploadProgress(percent),
      }),
  });

  // Mutation: Assign bulk by resolution
  const bulkAssignMutation = useMutation({
    mutationFn: (contentId: string) =>
      bulkCreativesApi.createByResolution(orderLineId, {
        content_id: contentId,
        resolution_width: resolutionWidth,
        resolution_height: resolutionHeight,
        weight: 100,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'resolutions'] });
      queryClient.invalidateQueries({ queryKey: ['content'] });
    },
  });

  // Mutation: Assign to individual target
  const targetAssignMutation = useMutation({
    mutationFn: (contentId: string) =>
      creativesApi.createForTarget(targetId!, {
        content_id: contentId,
        weight: 100,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['targets', targetId, 'creatives'] });
      queryClient.invalidateQueries({ queryKey: ['order-lines', orderLineId, 'resolutions'] });
      queryClient.invalidateQueries({ queryKey: ['content'] });
    },
  });

  function resetState() {
    setPhase('idle');
    setUploadProgress(0);
    setErrorMessage(null);
    setScreenCount(0);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    await handleUploadFlow(file);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    // Validate file type
    const validTypes = ACCEPTED_TYPES.split(',');
    if (!validTypes.includes(file.type)) {
      setPhase('error');
      setErrorMessage('Tipo de archivo no soportado. Usa JPEG, PNG, WebP, MP4 o WebM.');
      return;
    }

    await handleUploadFlow(file);
  }

  async function handleUploadFlow(file: File) {
    setPhase('uploading');
    setUploadProgress(0);
    setErrorMessage(null);

    try {
      // Phase 1: Upload file to library
      const content: Content = await uploadMutation.mutateAsync(file);

      // Check resolution match
      if (content.width !== resolutionWidth || content.height !== resolutionHeight) {
        setPhase('error');
        setErrorMessage(
          `La resolución del archivo (${content.width}×${content.height}) no coincide con la resolución requerida (${resolutionWidth}×${resolutionHeight}). El archivo se guardó en la Biblioteca.`
        );
        queryClient.invalidateQueries({ queryKey: ['content'] });
        return;
      }

      // Phase 2: Assign to screens
      setPhase('assigning');

      if (targetId) {
        // Individual: assign to specific target
        setScreenCount(1);
        await targetAssignMutation.mutateAsync(content.id);
      } else {
        // Bulk: assign to all screens of this resolution
        const result = await bulkAssignMutation.mutateAsync(content.id);
        setScreenCount(result.creatives_created);
      }

      setPhase('success');
      toast.success(
        targetId
          ? 'Creativo subido y asignado a la pantalla'
          : `Creativo subido y asignado a ${screenCount || 'las'} pantallas`
      );
      onSuccess();

      // Auto-close after brief delay
      setTimeout(() => {
        handleOpenChange(false);
      }, 1200);
    } catch (error: unknown) {
      setPhase('error');
      const axiosError = error as { response?: { data?: { message?: string } } };
      setErrorMessage(
        axiosError?.response?.data?.message ?? 'Error durante el proceso de upload y asignación.'
      );
    }
  }

  const isProcessing = phase === 'uploading' || phase === 'assigning';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subir archivo</DialogTitle>
          <DialogDescription>
            {targetId
              ? `Sube un archivo ${resolutionWidth}×${resolutionHeight} para esta pantalla`
              : `Sube un archivo ${resolutionWidth}×${resolutionHeight} para asignar a todas las pantallas del grupo`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Idle / Drop zone */}
          {phase === 'idle' && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 transition-colors hover:border-muted-foreground/50"
            >
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                Arrastra un archivo aquí o haz clic para seleccionar
              </p>
              <p className="text-xs text-muted-foreground">
                JPEG, PNG, WebP, MP4, WebM — Resolución: {resolutionWidth}×{resolutionHeight}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Seleccionar archivo
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={ACCEPTED_TYPES}
                onChange={handleFileSelect}
              />
            </div>
          )}

          {/* Uploading phase */}
          {phase === 'uploading' && (
            <div className="space-y-3 rounded-lg border p-6">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium">Subiendo archivo...</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {uploadProgress}%
              </p>
            </div>
          )}

          {/* Assigning phase */}
          {phase === 'assigning' && (
            <div className="space-y-3 rounded-lg border p-6">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium">
                  Asignando a {targetId ? '1 pantalla' : `pantallas ${resolutionWidth}×${resolutionHeight}`}...
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-full animate-pulse bg-primary/60" />
              </div>
            </div>
          )}

          {/* Success phase */}
          {phase === 'success' && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-800 dark:bg-green-950">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium text-green-700 dark:text-green-300">
                {targetId
                  ? 'Archivo subido y asignado a la pantalla'
                  : `Archivo subido y asignado a ${screenCount} pantalla${screenCount !== 1 ? 's' : ''}`}
              </p>
            </div>
          )}

          {/* Error phase */}
          {phase === 'error' && (
            <div className="space-y-3">
              <div className="flex gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
                <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">{errorMessage}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={resetState}
              >
                Intentar de nuevo
              </Button>
            </div>
          )}

          {/* Cancel button during processing */}
          {isProcessing && (
            <p className="text-xs text-muted-foreground text-center">
              No cierres este diálogo hasta que el proceso termine.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
