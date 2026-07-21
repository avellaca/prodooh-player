import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTags, useCreateTag } from "../hooks";
import type { Tag } from "@/types/models";

interface BulkTagAssignProps {
  /** Currently selected tag IDs for the bulk operation */
  selectedTagIds: string[];
  /** Callback when selected tags change */
  onTagsChange: (tagIds: string[]) => void;
}

/**
 * Component for selecting/creating tags during bulk upload.
 * Displays a tag picker with the ability to create new tags inline.
 */
export function BulkTagAssign({ selectedTagIds, onTagsChange }: BulkTagAssignProps) {
  const [newTagName, setNewTagName] = useState("");

  const { data: allTags = [] } = useTags();
  const createTag = useCreateTag();

  const selectedSet = new Set(selectedTagIds);
  const selectedTags = allTags.filter((t) => selectedSet.has(t.id));
  const availableTags = allTags.filter((t) => !selectedSet.has(t.id));

  function handleToggleTag(tag: Tag) {
    if (selectedSet.has(tag.id)) {
      onTagsChange(selectedTagIds.filter((id) => id !== tag.id));
    } else {
      onTagsChange([...selectedTagIds, tag.id]);
    }
  }

  function handleCreateTag() {
    const trimmed = newTagName.trim();
    if (!trimmed) return;

    // If a tag with this name already exists, just select it
    const existing = allTags.find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      if (!selectedSet.has(existing.id)) {
        onTagsChange([...selectedTagIds, existing.id]);
      }
      setNewTagName("");
      return;
    }

    createTag.mutate(trimmed, {
      onSuccess: (tag) => {
        setNewTagName("");
        onTagsChange([...selectedTagIds, tag.id]);
      },
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateTag();
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Tags para asignar al lote</p>

      {/* Selected tags */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedTags.map((tag) => (
            <Badge key={tag.id} variant="secondary" className="gap-1 pr-1">
              {tag.name}
              <button
                type="button"
                onClick={() => handleToggleTag(tag)}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remover tag ${tag.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Available tags */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {availableTags.map((tag) => (
            <Badge
              key={tag.id}
              variant="outline"
              className="cursor-pointer hover:bg-secondary transition-colors"
              onClick={() => handleToggleTag(tag)}
            >
              <Plus className="h-3 w-3 mr-0.5" />
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Create new tag inline */}
      <div className="flex gap-2">
        <Input
          placeholder="Nuevo tag..."
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-8 text-sm"
          maxLength={100}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCreateTag}
          disabled={!newTagName.trim() || createTag.isPending}
          className="h-8"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
