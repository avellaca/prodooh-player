import { useState } from "react";
import { Upload, X, FileImage, Film } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BulkTagAssign } from "./BulkTagAssign";
import { useBulkUpload } from "../hooks";
import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  onUploadSuccess: () => void;
  disabled?: boolean;
  disabledTooltip?: string;
}

type Phase = "idle" | "review" | "uploading";

export function UploadDropzone({ onUploadSuccess, disabled = false, disabledTooltip }: UploadDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);

  const bulkUpload = useBulkUpload();

  function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setSelectedFiles(files);
    setSelectedTagIds([]);
    setPhase("review");
  }

  function handleRemoveFile(index: number) {
    setSelectedFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setPhase("idle");
      }
      return next;
    });
  }

  function handleCancel() {
    setSelectedFiles([]);
    setSelectedTagIds([]);
    setPhase("idle");
  }

  function handleConfirmUpload() {
    setPhase("uploading");
    setUploadProgress(0);

    bulkUpload.mutate(
      {
        files: selectedFiles,
        tagIds: selectedTagIds,
        onUploadProgress: setUploadProgress,
      },
      {
        onSuccess: () => {
          setPhase("idle");
          setSelectedFiles([]);
          setSelectedTagIds([]);
          onUploadSuccess();
        },
        onError: () => {
          setPhase("review");
        },
      },
    );
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled || phase !== "idle") return;
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    handleFiles(files);
    e.target.value = "";
  }

  const isDisabled = disabled || phase === "uploading";

  // ─── Uploading phase ───────────────────────────────────────────────────────
  if (phase === "uploading") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-primary/30 p-6">
        <Upload className="h-8 w-8 animate-pulse text-primary" />
        <p className="text-sm text-muted-foreground">
          Subiendo {selectedFiles.length} archivo{selectedFiles.length > 1 ? "s" : ""}...
        </p>
        <div className="w-full max-w-xs">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="mt-1 text-center text-xs text-muted-foreground">{uploadProgress}%</p>
        </div>
      </div>
    );
  }

  // ─── Review phase (files selected, assign tags before upload) ──────────────
  if (phase === "review") {
    return (
      <div className="space-y-4 rounded-lg border-2 border-dashed border-primary/30 p-4">
        {/* File list */}
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {selectedFiles.length} archivo{selectedFiles.length > 1 ? "s" : ""} seleccionado{selectedFiles.length > 1 ? "s" : ""}
          </p>
          <ul className="max-h-32 space-y-1 overflow-y-auto rounded border p-2 text-sm">
            {selectedFiles.map((file, i) => (
              <li key={`${file.name}-${i}`} className="flex items-center gap-2">
                {file.type.startsWith("video/") ? (
                  <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileImage className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(i)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remover ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Tag assignment */}
        <BulkTagAssign
          selectedTagIds={selectedTagIds}
          onTagsChange={setSelectedTagIds}
        />

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleConfirmUpload}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Subir{selectedFiles.length > 1 ? ` (${selectedFiles.length})` : ""}
          </Button>
        </div>
      </div>
    );
  }

  // ─── Idle phase (dropzone) ─────────────────────────────────────────────────
  return (
    <div
      onDragOver={!disabled ? handleDragOver : undefined}
      onDragLeave={!disabled ? handleDragLeave : undefined}
      onDrop={handleDrop}
      className={cn(
        "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors",
        disabled && "opacity-60 cursor-not-allowed",
        isDragOver
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50",
      )}
    >
      <Upload className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {disabled && disabledTooltip
          ? disabledTooltip
          : "Arrastra archivos aquí o haz clic para seleccionar"}
      </p>
      <Button
        variant="secondary"
        size="sm"
        disabled={isDisabled}
        title={disabled ? disabledTooltip : undefined}
        onClick={() => document.getElementById("file-upload-input")?.click()}
      >
        Seleccionar archivos
      </Button>
      <input
        id="file-upload-input"
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
        multiple
        onChange={handleFileSelect}
      />
    </div>
  );
}
