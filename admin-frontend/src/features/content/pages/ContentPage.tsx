import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { Eye, Trash2 } from "lucide-react";

import { DataTable } from "@/components/shared/DataTable";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";

import { useContent, useDeleteContent } from "../hooks";
import { UploadDropzone } from "../components/UploadDropzone";
import { ContentPreview } from "../components/ContentPreview";
import { RotateMenu } from "../components/RotateMenu";
import type { Content } from "@/types/models";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getContentType(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "Imagen";
  if (mimeType.startsWith("video/")) return "Video";
  return mimeType;
}

export default function ContentPage() {
  const [previewContent, setPreviewContent] = useState<Content | null>(null);
  const [deletingContent, setDeletingContent] = useState<Content | null>(null);

  const { data: content, isLoading, isError, refetch } = useContent();
  const deleteContent = useDeleteContent();

  const columns: ColumnDef<Content, unknown>[] = [
    {
      accessorKey: "filename",
      header: "Nombre",
    },
    {
      accessorKey: "mime_type",
      header: "Tipo",
      cell: ({ row }) => getContentType(row.original.mime_type),
    },
    {
      id: "dimensions",
      header: "Dimensiones",
      cell: ({ row }) => {
        const { width, height } = row.original;
        return width && height ? `${width}×${height}` : "—";
      },
    },
    {
      accessorKey: "file_size_bytes",
      header: "Tamaño",
      cell: ({ row }) => formatFileSize(row.original.file_size_bytes),
    },
    {
      accessorKey: "created_at",
      header: "Fecha",
      cell: ({ row }) =>
        format(new Date(row.original.created_at), "dd/MM/yyyy HH:mm"),
    },
    {
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPreviewContent(item)}
            >
              <Eye className="h-4 w-4" />
              <span className="sr-only">Vista previa</span>
            </Button>
            <RotateMenu contentId={item.id} />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDeletingContent(item)}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Eliminar</span>
            </Button>
          </div>
        );
      },
    },
  ];

  function handleDelete() {
    if (!deletingContent) return;
    deleteContent.mutate(deletingContent.id, {
      onSuccess: () => setDeletingContent(null),
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Contenido</h1>
        <LoadingState />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Contenido</h1>
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Contenido</h1>

      <UploadDropzone onUploadSuccess={() => {}} />

      <DataTable columns={columns} data={content ?? []} />

      {/* Preview Dialog */}
      <ContentPreview
        content={previewContent}
        open={previewContent !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewContent(null);
        }}
      />

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deletingContent !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingContent(null);
        }}
        title="Eliminar contenido"
        description={`¿Estás seguro de que deseas eliminar "${deletingContent?.filename}"? Esta acción no se puede deshacer.`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
