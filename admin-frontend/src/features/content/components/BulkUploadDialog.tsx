import { useState } from 'react';
import { Upload, X, CheckCircle2, XCircle, Plus } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

import { useBulkUpload, useTags, useCreateTag } from '../hooks';
import type { BulkUploadResult } from '../api';
import type { Tag } from '@/types/models';

const MAX_FILES = 50;
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';

type DialogPhase = 'select' | 'uploading' | 'summary';

export function BulkUploadDialog() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<DialogPhase>('select');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [newTagName, setNewTagName] = useState('');

  const { data: tags = [] } = useTags();
  const createTag = useCreateTag();
  const bulkUpload = useBulkUpload();

  function resetState() {
    setPhase('select');
    setSelectedFiles([]);
    setSelectedTagIds([]);
    setUploadProgress(0);
    setResult(null);
    setNewTagName('');
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) resetState();
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const combined = [...selectedFiles, ...files].slice(0, MAX_FILES);
    setSelectedFiles(combined);
    e.target.value = '';
  }

  function handleRemoveFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleToggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }

  function handleCreateTag() {
    const name = newTagName.trim();
    if (!name) return;
    createTag.mutate(name, {
      onSuccess: (tag: Tag) => {
        setSelectedTagIds((prev) => [...prev, tag.id]);
        setNewTagName('');
      },
    });
  }

  function handleUpload() {
    if (selectedFiles.length === 0) return;
    setPhase('uploading');
    setUploadProgress(0);

    bulkUpload.mutate(
      {
        files: selectedFiles,
        tagIds: selectedTagIds,
        onUploadProgress: setUploadProgress,
      },
      {
        onSuccess: (data) => {
          setResult(data);
          setPhase('summary');
        },
        onError: () => {
          setPhase('select');
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 h-4 w-4" />
          Carga masiva
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {phase === 'select' && 'Carga masiva de archivos'}
            {phase === 'uploading' && 'Subiendo archivos...'}
            {phase === 'summary' && 'Resultado de la carga'}
          </DialogTitle>
          <DialogDescription>
            {phase === 'select' && `Selecciona hasta ${MAX_FILES} archivos y asigna tags opcionales.`}
            {phase === 'uploading' && 'Por favor espera mientras se suben los archivos.'}
            {phase === 'summary' && 'Resumen de archivos procesados.'}
          </DialogDescription>
        </DialogHeader>

        {phase === 'select' && (
          <SelectPhase
            files={selectedFiles}
            tags={tags}
            selectedTagIds={selectedTagIds}
            newTagName={newTagName}
            onFileSelect={handleFileSelect}
            onRemoveFile={handleRemoveFile}
            onToggleTag={handleToggleTag}
            onNewTagNameChange={setNewTagName}
            onCreateTag={handleCreateTag}
            isCreatingTag={createTag.isPending}
          />
        )}

        {phase === 'uploading' && <UploadingPhase progress={uploadProgress} />}

        {phase === 'summary' && result && <SummaryPhase result={result} />}

        <DialogFooter>
          {phase === 'select' && (
            <Button onClick={handleUpload} disabled={selectedFiles.length === 0}>
              Subir {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''}
            </Button>
          )}
          {phase === 'summary' && (
            <Button onClick={() => handleOpenChange(false)}>Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Sub-components ---

interface SelectPhaseProps {
  files: File[];
  tags: Tag[];
  selectedTagIds: string[];
  newTagName: string;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (index: number) => void;
  onToggleTag: (tagId: string) => void;
  onNewTagNameChange: (value: string) => void;
  onCreateTag: () => void;
  isCreatingTag: boolean;
}

function SelectPhase({
  files,
  tags,
  selectedTagIds,
  newTagName,
  onFileSelect,
  onRemoveFile,
  onToggleTag,
  onNewTagNameChange,
  onCreateTag,
  isCreatingTag,
}: SelectPhaseProps) {
  return (
    <div className="space-y-4">
      {/* File picker */}
      <div>
        <label className="text-sm font-medium">Archivos ({files.length}/{MAX_FILES})</label>
        <div className="mt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={files.length >= MAX_FILES}
            onClick={() => document.getElementById('bulk-upload-input')?.click()}
          >
            <Plus className="mr-1 h-3 w-3" />
            Seleccionar archivos
          </Button>
          <input
            id="bulk-upload-input"
            type="file"
            className="hidden"
            accept={ACCEPTED_TYPES}
            multiple
            onChange={onFileSelect}
          />
        </div>

        {files.length > 0 && (
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded border p-2 text-sm">
            {files.map((file, i) => (
              <li key={`${file.name}-${i}`} className="flex items-center justify-between gap-2">
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveFile(i)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remover ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Tag selector */}
      <div>
        <label className="text-sm font-medium">Tags (opcional)</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge
              key={tag.id}
              variant={selectedTagIds.includes(tag.id) ? 'default' : 'outline'}
              className="cursor-pointer select-none"
              onClick={() => onToggleTag(tag.id)}
            >
              {tag.name}
            </Badge>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            placeholder="Nuevo tag..."
            value={newTagName}
            onChange={(e) => onNewTagNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCreateTag();
              }
            }}
            className="h-8 text-sm"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={onCreateTag}
            disabled={!newTagName.trim() || isCreatingTag}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function UploadingPhase({ progress }: { progress: number }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <Upload className="h-10 w-10 animate-pulse text-primary" />
      <div className="w-full max-w-xs">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-1.5 text-center text-sm text-muted-foreground">{progress}%</p>
      </div>
    </div>
  );
}

function SummaryPhase({ result }: { result: BulkUploadResult }) {
  const { summary, successes, failures } = result;

  return (
    <div className="space-y-3">
      {/* Stats overview */}
      <div className="flex gap-4 text-sm">
        <span className="flex items-center gap-1 text-green-700">
          <CheckCircle2 className="h-4 w-4" /> {summary.successful} exitoso(s)
        </span>
        {summary.failed > 0 && (
          <span className="flex items-center gap-1 text-red-700">
            <XCircle className="h-4 w-4" /> {summary.failed} fallido(s)
          </span>
        )}
      </div>

      {/* Successes */}
      {successes.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Subidos correctamente</p>
          <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-sm">
            {successes.map((s) => (
              <li key={s.data.id} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 shrink-0 text-green-600" />
                <span className="truncate">{s.data.filename}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Failures */}
      {failures.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Fallidos</p>
          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-sm">
            {failures.map((f) => (
              <li key={`failure-${f.index}`} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <XCircle className="h-3 w-3 shrink-0 text-red-600" />
                  <span className="truncate font-medium">{f.filename}</span>
                </span>
                <span className="ml-5 text-xs text-muted-foreground">
                  {f.errors.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
