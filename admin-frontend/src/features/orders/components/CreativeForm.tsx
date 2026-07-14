import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { creativeSchema, type CreativeFormValues } from "../schemas";
import { useContent } from "@/features/content/hooks";
import { ActiveDatesPicker } from "./ActiveDatesPicker";
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
import { cn } from "@/lib/utils";
import { Loader2, Image, Film } from "lucide-react";

interface CreativeFormProps {
  defaultValues?: Partial<CreativeFormValues>;
  onSubmit: (data: CreativeFormValues) => void;
  isSubmitting?: boolean;
  parentOrderLine?: { starts_at: string; ends_at: string };
}

function ContentThumbnailIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("video/")) {
    return <Film className="h-4 w-4 text-muted-foreground" />;
  }
  return <Image className="h-4 w-4 text-muted-foreground" />;
}

export function CreativeForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
  parentOrderLine,
}: CreativeFormProps) {
  const { data: contentItems, isLoading: isLoadingContent } = useContent();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<CreativeFormValues>({
    resolver: zodResolver(creativeSchema),
    defaultValues: {
      content_id: "",
      weight: 1,
      active_dates: [],
      ...defaultValues,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Content selector */}
      <div className="space-y-2">
        <Label htmlFor="content_id">Contenido</Label>
        {isLoadingContent ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando contenido...
          </div>
        ) : (
          <Controller
            name="content_id"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isSubmitting}
              >
                <SelectTrigger
                  id="content_id"
                  className={cn(
                    errors.content_id &&
                      "border-red-500 focus-visible:ring-red-500"
                  )}
                >
                  <SelectValue placeholder="Seleccionar contenido" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {contentItems?.map((item) => (
                    <SelectItem key={item.id} value={item.id} className="py-2">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-muted">
                          <img
                            src={`/api/admin/content/${item.id}/preview/file`}
                            alt={item.filename}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="truncate max-w-[180px] text-sm">
                            {item.filename}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {item.width}×{item.height}
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                  {(!contentItems || contentItems.length === 0) && (
                    <div className="py-2 px-3 text-sm text-muted-foreground">
                      No hay contenido disponible
                    </div>
                  )}
                </SelectContent>
              </Select>
            )}
          />
        )}
        {errors.content_id?.message && (
          <p className="text-sm text-red-500">
            {errors.content_id.message as string}
          </p>
        )}
      </div>

      {/* Weight field */}
      <div className="space-y-2">
        <Label htmlFor="weight">Peso</Label>
        <Input
          id="weight"
          type="number"
          min={1}
          disabled={isSubmitting}
          className={cn(
            errors.weight && "border-red-500 focus-visible:ring-red-500"
          )}
          {...register("weight")}
        />
        <p className="text-xs text-muted-foreground">
          Mayor peso = más frecuencia de reproducción relativa
        </p>
        {errors.weight?.message && (
          <p className="text-sm text-red-500">
            {errors.weight.message as string}
          </p>
        )}
      </div>

      {/* Active dates picker */}
      <div className="space-y-2">
        <Label>Fechas activas</Label>
        <Controller
          name="active_dates"
          control={control}
          render={({ field }) => (
            <ActiveDatesPicker
              value={field.value}
              onChange={field.onChange}
              minDate={parentOrderLine?.starts_at}
              maxDate={parentOrderLine?.ends_at}
              disabled={isSubmitting}
            />
          )}
        />
        {parentOrderLine && (
          <p className="text-xs text-muted-foreground">
            La línea padre es activa del {parentOrderLine.starts_at} al{" "}
            {parentOrderLine.ends_at}
          </p>
        )}
        {errors.active_dates?.message && (
          <p className="text-sm text-red-500">
            {errors.active_dates.message as string}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {defaultValues ? "Guardar cambios" : "Agregar creativo"}
        </Button>
      </div>
    </form>
  );
}
