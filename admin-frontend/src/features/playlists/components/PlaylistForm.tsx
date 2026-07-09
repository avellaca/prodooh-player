import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { playlistSchema, type CreatePlaylistInput, type PlaylistItemInput } from "@/schemas/playlist.schema";
import { PlaylistItemEditor } from "./PlaylistItemEditor";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useContent } from "@/features/content/hooks";

interface PlaylistFormProps {
  defaultValues?: Partial<CreatePlaylistInput>;
  onSubmit: (data: CreatePlaylistInput) => void;
  isSubmitting?: boolean;
}

export function PlaylistForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
}: PlaylistFormProps) {
  const { data: contentList } = useContent();
  const [items, setItems] = useState<PlaylistItemInput[]>(
    defaultValues?.items ?? []
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreatePlaylistInput>({
    resolver: zodResolver(playlistSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      items: defaultValues?.items ?? [],
    },
  });

  function handleFormSubmit(data: CreatePlaylistInput) {
    // Resolve "content" type to "image" or "video" based on the content's mime_type
    const resolvedItems = items.map((item) => {
      if (item.type === 'content' && item.content_id) {
        const content = contentList?.find((c) => c.id === item.content_id);
        const resolvedType = content?.mime_type?.startsWith('video/') ? 'video' : 'image';
        return { ...item, type: resolvedType as PlaylistItemInput['type'] };
      }
      return item;
    });
    onSubmit({ ...data, items: resolvedItems });
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <FormField
        label="Nombre"
        name="name"
        register={register}
        errors={errors}
        placeholder="Nombre de la playlist"
        disabled={isSubmitting}
      />

      <PlaylistItemEditor
        items={items}
        onChange={setItems}
        contentList={contentList ?? []}
        disabled={isSubmitting}
      />

      {errors.items && (
        <p className="text-sm text-red-500">
          {typeof errors.items.message === "string"
            ? errors.items.message
            : "Revisa los ítems de la playlist"}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {defaultValues ? "Guardar cambios" : "Crear playlist"}
        </Button>
      </div>
    </form>
  );
}
