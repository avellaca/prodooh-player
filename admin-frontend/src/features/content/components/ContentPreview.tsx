import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/axios";
import type { Content } from "@/types/models";

interface ContentPreviewProps {
  content: Content | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Fetches the file as a blob using the authenticated axios instance,
 * then creates an object URL for display in <img>/<video>.
 */
function useContentBlobUrl(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['content', id, 'blob'],
    queryFn: async () => {
      // Fetch the actual file with auth headers via axios (responseType: blob)
      const fileRes = await api.get(`/admin/content/${id}/preview/file`, {
        responseType: 'blob',
      });

      return URL.createObjectURL(fileRes.data as Blob);
    },
    enabled,
    staleTime: 60_000,
  });
}

export function ContentPreview({
  content,
  open,
  onOpenChange,
}: ContentPreviewProps) {
  const { data: blobUrl, isLoading } = useContentBlobUrl(
    content?.id,
    open && !!content?.id,
  );

  const isVideo = content?.mime_type.startsWith("video/");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{content?.filename ?? "Vista previa"}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center">
          {isLoading || !blobUrl ? (
            <div className="flex h-64 items-center justify-center text-muted-foreground">
              Cargando vista previa...
            </div>
          ) : isVideo ? (
            <video
              src={blobUrl}
              controls
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
          ) : (
            <img
              src={blobUrl}
              alt={content?.filename ?? "Preview"}
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
