import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, Film, Image, Send } from 'lucide-react';

import { screenCommandsApi } from '@/features/orders/api';
import { useContent } from '@/features/content/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PreviewContentProps {
  screenId: string;
}

export function PreviewContent({ screenId }: PreviewContentProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState<string>('');
  const [durationSeconds, setDurationSeconds] = useState<string>('');

  const { data: contentList, isLoading: isLoadingContent } = useContent();

  const sendPreviewMutation = useMutation({
    mutationFn: (params: { contentId: string; durationSeconds?: number }) => {
      const assetUrl = `/api/device/content/${params.contentId}/file`;
      return screenCommandsApi.send(screenId, {
        type: 'preview_content',
        content_id: params.contentId,
        asset_url: assetUrl,
        duration_seconds: params.durationSeconds,
      });
    },
    onSuccess: () => {
      toast.success('Contenido enviado — aparecerá en los próximos 30 segundos');
      setSelectedContentId('');
      setDurationSeconds('');
      setIsExpanded(false);
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al enviar contenido de previsualización');
    },
  });

  function handleSend() {
    if (!selectedContentId) return;

    const duration = durationSeconds ? Number(durationSeconds) : undefined;
    sendPreviewMutation.mutate({
      contentId: selectedContentId,
      durationSeconds: duration,
    });
  }

  const selectedContent = contentList?.find((c) => c.id === selectedContentId);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Previsualizar contenido</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {!isExpanded ? (
          <Button onClick={() => setIsExpanded(true)} variant="outline">
            <Eye className="mr-2 h-4 w-4" />
            Previsualizar contenido
          </Button>
        ) : (
          <div className="space-y-4">
            {/* Content selector */}
            <div className="space-y-2">
              <Label htmlFor="preview-content-select">Contenido</Label>
              <Select
                value={selectedContentId}
                onValueChange={setSelectedContentId}
                disabled={isLoadingContent}
              >
                <SelectTrigger id="preview-content-select">
                  <SelectValue placeholder={isLoadingContent ? 'Cargando...' : 'Seleccionar contenido'} />
                </SelectTrigger>
                <SelectContent>
                  {contentList?.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <div className="flex items-center gap-2">
                        {item.mime_type.startsWith('video/') ? (
                          <Film className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Image className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="truncate max-w-[200px]">{item.filename}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.width}×{item.height}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Selected content preview thumbnail */}
            {selectedContent && (
              <div className="flex items-center gap-3 rounded-md border p-2">
                <div className="h-12 w-12 overflow-hidden rounded bg-muted">
                  <img
                    src={`/api/admin/content/${selectedContent.id}/preview/file`}
                    alt={selectedContent.filename}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-col text-sm">
                  <span className="font-medium truncate max-w-[200px]">{selectedContent.filename}</span>
                  <span className="text-xs text-muted-foreground">
                    {selectedContent.width}×{selectedContent.height}
                    {selectedContent.duration_seconds != null && ` · ${selectedContent.duration_seconds}s`}
                  </span>
                </div>
              </div>
            )}

            {/* Duration field */}
            <div className="space-y-2">
              <Label htmlFor="preview-duration">
                Duración (segundos)
                <span className="ml-1 text-xs text-muted-foreground">— opcional</span>
              </Label>
              <Input
                id="preview-duration"
                type="number"
                min={1}
                placeholder={selectedContent?.duration_seconds != null
                  ? `Default: ${selectedContent.duration_seconds}s`
                  : 'Duración del spot'}
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(e.target.value)}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSend}
                disabled={!selectedContentId || sendPreviewMutation.isPending}
              >
                <Send className="mr-2 h-4 w-4" />
                {sendPreviewMutation.isPending ? 'Enviando...' : 'Enviar a pantalla'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setIsExpanded(false);
                  setSelectedContentId('');
                  setDurationSeconds('');
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
