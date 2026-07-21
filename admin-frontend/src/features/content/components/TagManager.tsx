import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { useTags, useCreateTag, useAssignTags, useRemoveTagFromContent } from "../hooks";
import type { Tag } from "@/types/models";

interface TagManagerProps {
  contentId: string;
  assignedTags: Tag[];
}

export function TagManager({ contentId, assignedTags }: TagManagerProps) {
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  const { data: allTags = [] } = useTags();
  const createTag = useCreateTag();
  const assignTags = useAssignTags();
  const removeTag = useRemoveTagFromContent();

  const assignedTagIds = new Set(assignedTags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !assignedTagIds.has(t.id));

  function handleAssignTag(tagId: string) {
    assignTags.mutate({ contentId, tagIds: [tagId] });
  }

  function handleRemoveTag(tagId: string) {
    removeTag.mutate({ contentId, tagId });
  }

  function handleCreateAndAssign() {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    createTag.mutate(trimmed, {
      onSuccess: (tag) => {
        setNewTagName("");
        assignTags.mutate({ contentId, tagIds: [tag.id] });
      },
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateAndAssign();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div className="flex flex-wrap items-center gap-1 cursor-pointer group">
          {assignedTags.length > 0 ? (
            assignedTags.map((tag) => (
              <Badge key={tag.id} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag.name}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
              + Tags
            </span>
          )}
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Gestionar Tags</DialogTitle>
          <DialogDescription>
            Agrega o elimina tags para organizar este contenido.
          </DialogDescription>
        </DialogHeader>

        {/* Assigned tags with remove */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Tags asignados</p>
          <div className="flex flex-wrap gap-1.5">
            {assignedTags.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin tags asignados</p>
            )}
            {assignedTags.map((tag) => (
              <Badge key={tag.id} variant="secondary" className="gap-1 pr-1">
                {tag.name}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag.id)}
                  className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                  disabled={removeTag.isPending}
                  aria-label={`Remover tag ${tag.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>

        {/* Available tags to add */}
        {availableTags.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Tags disponibles</p>
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="outline"
                  className="cursor-pointer hover:bg-secondary transition-colors"
                  onClick={() => handleAssignTag(tag.id)}
                >
                  <Plus className="h-3 w-3 mr-0.5" />
                  {tag.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Create new tag */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Crear nuevo tag</p>
          <div className="flex gap-2">
            <Input
              placeholder="Nombre del tag"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 text-sm"
              maxLength={100}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCreateAndAssign}
              disabled={!newTagName.trim() || createTag.isPending}
              className="h-8"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
