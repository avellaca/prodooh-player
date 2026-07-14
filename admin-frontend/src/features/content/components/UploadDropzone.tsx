import { useState } from "react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUploadContent } from "../hooks";
import { cn } from "@/lib/utils";

interface UploadDropzoneProps {
  onUploadSuccess: () => void;
  disabled?: boolean;
  disabledTooltip?: string;
}

export function UploadDropzone({ onUploadSuccess, disabled = false, disabledTooltip }: UploadDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadCount, setUploadCount] = useState({ current: 0, total: 0 });
  const uploadContent = useUploadContent();

  function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setUploadCount({ current: 0, total: files.length });
    uploadSequential(files, 0);
  }

  function uploadSequential(files: File[], index: number) {
    if (index >= files.length) {
      setUploadProgress(null);
      setUploadCount({ current: 0, total: 0 });
      onUploadSuccess();
      return;
    }

    setUploadCount((prev) => ({ ...prev, current: index + 1 }));
    setUploadProgress(0);

    uploadContent.mutate(
      {
        file: files[index],
        options: {
          onUploadProgress: (percent) => setUploadProgress(percent),
        },
      },
      {
        onSuccess: () => {
          uploadSequential(files, index + 1);
        },
        onError: () => {
          setUploadProgress(null);
          setUploadCount({ current: 0, total: 0 });
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
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    handleFiles(files);
    e.target.value = "";
  }

  const isDisabled = disabled || uploadContent.isPending;

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

      {uploadProgress !== null && (
        <div className="mt-2 w-full max-w-xs">
          {uploadCount.total > 1 && (
            <p className="mb-1 text-center text-xs text-muted-foreground">
              Archivo {uploadCount.current} de {uploadCount.total}
            </p>
          )}
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            {uploadProgress}%
          </p>
        </div>
      )}
    </div>
  );
}
