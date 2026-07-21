import { useState } from 'react';
import { Upload, X, FileImage, Film, CheckCircle2, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useBulkUpload } from '@/features/content/hooks';
import { useBulkAssign } from '../hooks';
import type { BulkAssignResponse } from '../api';

const MAX_FILES = 50;
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

type Phase = 'select' | 'uploading' | 'assigning' | 'done';

interface BulkUploadAssignPanelProps {
  orderLineId: string;
  onAssignComplete?: () => void;
}

/**
 * Panel that allows uploading files from the computer and auto-assigning
 * them to the OrderLine by resolution matching in one step.
 *
 * Flow: select files → upload to library → auto-assign by resolution → show summary
 */
export function BulkUploadAssignPanel({ orderLineId, onAssignComplete }: BulkUploadAssignPanelProps) {
  const [phase, setPhase] = useState<Phase>('select');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [assignResult, setAssignResult] = useState<BulkAssignResponse | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const bulkUpload = useBulkUpload();
  const bulkAssign = useBulkAssign(orderLineId);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setSelectedFiles((prev) => [...prev, ...files].slice(0, MAX_FILES));
    e.target.value = '';
  }

  function handleRemoveFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleUploadAndAssign() {
    if (selectedFiles.length === 0) return;
    setPhase('uploading');
    setUploadProgress(0);
    setErrorMessage(null);

    // Step 1: Upload files to library
    bulkUpload.mutate(
      {
        files: selectedFiles,
        tagIds: [],
        onUploadProgress: setUploadProgress,
      },
      {
        onSuccess: (uploadResult) => {
          setUploadedCount(uploadResult.summary.successful);

          if (uploadResult.summary.successful === 0) {
            setErrorMessage('Ningún archivo se subió correctamente.');
            setPhase('done');
            return;
          }

          // Step 2: Auto-assign uploaded content by resolution
          const contentIds = uploadResult.successes.map((s) => s.data.id);
          setPhase('assigning');

          bulkAssign.mutate(
            { content_ids: contentIds, weight: 100 },
            {
              onSuccess: (assignRes) => {
                setAssignResult(assignRes);
                setPhase('done');
                onAssignComplete?.();
              },
              onError: (err) => {
                setErrorMessage(
                  (err as Error & { response?: { data?: { message?: string } } }).response?.data?.message
                    ?? 'Error al asignar creativos'
                );
                setPhase('done');
              },
            },
          );
        },
        onError: (err) => {
          setErrorMessage(
            (err as Error & { response?: { data?: { message?: string } } }).response?.data?.message
              ?? 'Error al subir archivos'
          );
          setPhase('select');
        },
      },
    );
  }

  // ─── Done phase ────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className="space-y-4 py-4">
        {assignResult && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span>{uploadedCount} archivo(s) subido(s), <strong>{assignResult.created}</strong> creativo(s) asignado(s)</span>
            </div>
            {assignResult.unmatched_contents.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                <span>{assignResult.unmatched_contents.length} sin coincidencia de resolución</span>
              </div>
            )}
          </>
        )}
        {errorMessage && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    );
  }

  // ─── Uploading / Assigning phase ───────────────────────────────────────────
  if (phase === 'uploading' || phase === 'assigning') {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <Upload className="h-8 w-8 animate-pulse text-primary" />
        <p className="text-sm text-muted-foreground">
          {phase === 'uploading' ? 'Subiendo archivos...' : 'Asignando por resolución...'}
        </p>
        {phase === 'uploading' && (
          <div className="w-full max-w-xs">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
            <p className="mt-1 text-center text-xs text-muted-foreground">{uploadProgress}%</p>
          </div>
        )}
      </div>
    );
  }

  // ─── Select phase ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 hover:border-muted-foreground/50 transition-colors">
        <Upload className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Selecciona archivos para subir y asignar automáticamente por resolución
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => document.getElementById('bulk-upload-assign-input')?.click()}
        >
          Seleccionar archivos ({selectedFiles.length}/{MAX_FILES})
        </Button>
        <input
          id="bulk-upload-assign-input"
          type="file"
          className="hidden"
          accept={ACCEPTED_TYPES}
          multiple
          onChange={handleFileSelect}
        />
      </div>

      {selectedFiles.length > 0 && (
        <>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded border p-2 text-sm">
            {selectedFiles.map((file, i) => (
              <li key={`${file.name}-${i}`} className="flex items-center gap-2">
                {file.type.startsWith('video/') ? (
                  <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileImage className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(i)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex justify-end">
            <Button onClick={handleUploadAndAssign}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Subir y asignar ({selectedFiles.length})
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
