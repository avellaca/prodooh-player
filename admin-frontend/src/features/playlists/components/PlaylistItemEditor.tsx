import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, Trash2, Image, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlaylistItemInput } from "@/schemas/playlist.schema";
import type { Content } from "@/types/models";

interface PlaylistItemEditorProps {
  items: PlaylistItemInput[];
  onChange: (items: PlaylistItemInput[]) => void;
  contentList: Content[];
  disabled?: boolean;
}

function ContentThumbnail({ content }: { content: Content | undefined }) {
  const [showPreview, setShowPreview] = useState(false);

  if (!content) {
    return (
      <div className="h-12 w-12 rounded bg-muted flex items-center justify-center shrink-0">
        <Image className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  const previewUrl = `/api/admin/content/${content.id}/preview/file`;
  const isVideo = content.mime_type?.startsWith("video/");

  return (
    <div
      className="relative h-12 w-12 rounded overflow-hidden bg-muted shrink-0 cursor-pointer"
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
    >
      {isVideo ? (
        <div className="h-full w-full flex items-center justify-center bg-black/80">
          <span className="text-white text-xs font-bold">▶</span>
        </div>
      ) : (
        <img
          src={previewUrl}
          alt={content.filename}
          className="h-full w-full object-cover"
        />
      )}

      {/* Hover preview */}
      {showPreview && !isVideo && (
        <div className="fixed z-50 pointer-events-none" style={{ transform: "translate(-50%, -110%)", left: "50%", top: "0" }}>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 shadow-xl rounded-lg overflow-hidden border bg-background">
            <img
              src={previewUrl}
              alt={content.filename}
              className="max-w-[300px] max-h-[200px] object-contain"
            />
            <div className="px-2 py-1 text-xs text-muted-foreground truncate max-w-[300px]">
              {content.filename} ({content.width}×{content.height})
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlaylistItemEditor({
  items,
  onChange,
  contentList,
  disabled = false,
}: PlaylistItemEditorProps) {
  function handleAdd() {
    const newItem: PlaylistItemInput = {
      type: "content",
      content_id: undefined,
      url: undefined,
      duration_seconds: 10,
      position: items.length,
    };
    onChange([...items, newItem]);
  }

  function handleRemove(index: number) {
    const updated = items
      .filter((_, i) => i !== index)
      .map((item, i) => ({ ...item, position: i }));
    onChange(updated);
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const updated = [...items];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    onChange(updated.map((item, i) => ({ ...item, position: i })));
  }

  function handleMoveDown(index: number) {
    if (index === items.length - 1) return;
    const updated = [...items];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    onChange(updated.map((item, i) => ({ ...item, position: i })));
  }

  function handleItemChange(index: number, field: keyof PlaylistItemInput, value: string | number) {
    const updated = items.map((item, i) => {
      if (i !== index) return item;
      if (field === "type") {
        return {
          ...item,
          type: value as PlaylistItemInput["type"],
          content_id: value !== "url" ? item.content_id : undefined,
          url: value === "url" ? item.url : undefined,
        };
      }
      return { ...item, [field]: value };
    });
    onChange(updated);
  }

  function getContentForItem(item: PlaylistItemInput): Content | undefined {
    if (!item.content_id) return undefined;
    return contentList.find((c) => c.id === item.content_id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Ítems de la playlist ({items.length})</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={disabled}
        >
          <Plus className="mr-1 h-4 w-4" />
          Agregar ítem
        </Button>
      </div>

      {items.length === 0 && (
        <div className="flex flex-col items-center py-8 border-2 border-dashed rounded-lg text-center">
          <Image className="h-10 w-10 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            No hay ítems. Agrega contenido para comenzar.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {items.map((item, index) => {
          const content = getContentForItem(item);
          const isUrlType = item.type === "url";

          return (
            <div
              key={index}
              className="flex items-center gap-2 p-2 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
            >
              {/* Drag handle + order */}
              <div className="flex flex-col items-center gap-0.5 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleMoveUp(index)}
                  disabled={disabled || index === 0}
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <span className="text-xs text-muted-foreground font-mono w-5 text-center">
                  {index + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleMoveDown(index)}
                  disabled={disabled || index === items.length - 1}
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
              </div>

              {/* Thumbnail */}
              {isUrlType ? (
                <div className="h-12 w-12 rounded bg-muted flex items-center justify-center shrink-0">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                </div>
              ) : (
                <ContentThumbnail content={content} />
              )}

              {/* Content selection / URL input */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Select
                    value={item.type === "url" ? "url" : "content"}
                    onValueChange={(value) => handleItemChange(index, "type", value)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-[110px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="content">Contenido</SelectItem>
                      <SelectItem value="url">URL</SelectItem>
                    </SelectContent>
                  </Select>

                  {!isUrlType ? (
                    <Select
                      value={item.content_id ?? ""}
                      onValueChange={(value) => handleItemChange(index, "content_id", value)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="flex-1 h-8 text-xs">
                        <SelectValue placeholder="Seleccionar contenido" />
                      </SelectTrigger>
                      <SelectContent>
                        {contentList.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <span className="flex items-center gap-2">
                              <span className="text-muted-foreground">
                                {c.mime_type?.startsWith("video/") ? "🎬" : "🖼️"}
                              </span>
                              <span className="truncate">{c.filename}</span>
                              <span className="text-muted-foreground text-[10px]">
                                {c.width}×{c.height}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type="url"
                      placeholder="https://ejemplo.com"
                      value={item.url ?? ""}
                      onChange={(e) => handleItemChange(index, "url", e.target.value)}
                      disabled={disabled}
                      className="flex-1 h-8 text-xs"
                    />
                  )}
                </div>

                {/* Content name below for context */}
                {content && (
                  <p className="text-[11px] text-muted-foreground truncate pl-1">
                    {content.filename} • {content.orientation} • {content.width}×{content.height}
                  </p>
                )}
              </div>

              {/* Duration */}
              <div className="shrink-0 w-16">
                <Input
                  type="number"
                  min={1}
                  value={item.duration_seconds}
                  onChange={(e) =>
                    handleItemChange(index, "duration_seconds", parseInt(e.target.value, 10) || 0)
                  }
                  disabled={disabled}
                  className="h-8 text-xs text-center"
                  title="Duración (seg)"
                />
                <span className="text-[10px] text-muted-foreground block text-center">seg</span>
              </div>

              {/* Delete */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive shrink-0"
                onClick={() => handleRemove(index)}
                disabled={disabled}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Eliminar ítem</span>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
