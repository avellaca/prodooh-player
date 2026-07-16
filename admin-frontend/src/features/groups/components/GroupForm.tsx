import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { groupSchema, type CreateGroupInput } from "@/schemas/group.schema";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface GroupFormProps {
  defaultValues?: Partial<CreateGroupInput>;
  onSubmit: (data: CreateGroupInput) => void;
  isSubmitting?: boolean;
  /** Inherited values from tenant (shown as placeholder/reference) */
  inheritedValues?: {
    num_slots?: number;
    duration_seconds?: number;
  };
}

export function GroupForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
  inheritedValues,
}: GroupFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateGroupInput>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: "",
      duration_seconds: undefined,
      num_slots: undefined,
      ...defaultValues,
    },
  });

  const currentNumSlots = watch("num_slots");
  const currentDuration = watch("duration_seconds");

  const numSlotsIsOverride = currentNumSlots != null && currentNumSlots !== undefined;
  const durationIsOverride = currentDuration != null && currentDuration !== undefined;

  function handleFormSubmit(data: CreateGroupInput) {
    // Convert empty strings / 0 to null (means "inherit from tenant")
    const cleaned = {
      ...data,
      num_slots: data.num_slots || null,
      duration_seconds: data.duration_seconds || null,
    };
    onSubmit(cleaned);
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <FormField
        label="Nombre"
        name="name"
        register={register}
        errors={errors}
        placeholder="Nombre del grupo"
        disabled={isSubmitting}
      />

      {/* Duration with inheritance indicator */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="duration_seconds">Duración por slot (segundos)</Label>
          {inheritedValues?.duration_seconds && !durationIsOverride && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Heredado del Network: {inheritedValues.duration_seconds}s
            </span>
          )}
          {durationIsOverride && inheritedValues?.duration_seconds && (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setValue("duration_seconds", null as any)}
            >
              Usar heredado ({inheritedValues.duration_seconds}s)
            </button>
          )}
        </div>
        <Input
          id="duration_seconds"
          type="number"
          min={1}
          placeholder={inheritedValues?.duration_seconds ? `${inheritedValues.duration_seconds} (heredado)` : "10"}
          disabled={isSubmitting}
          className={cn(
            errors.duration_seconds && "border-red-500",
            !durationIsOverride && "text-muted-foreground"
          )}
          {...register("duration_seconds")}
        />
        {errors.duration_seconds && (
          <p className="text-sm text-red-500">{errors.duration_seconds.message}</p>
        )}
        {durationIsOverride && inheritedValues?.duration_seconds && currentDuration !== inheritedValues.duration_seconds && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <Info className="h-3 w-3" />
            Este valor es un override. Las pantallas de este grupo usarán {currentDuration}s en vez de {inheritedValues.duration_seconds}s del Network.
          </p>
        )}
      </div>

      {/* Num slots with inheritance indicator */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="num_slots">Número de slots</Label>
          {inheritedValues?.num_slots && !numSlotsIsOverride && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Heredado del Network: {inheritedValues.num_slots}
            </span>
          )}
          {numSlotsIsOverride && inheritedValues?.num_slots && (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setValue("num_slots", null as any)}
            >
              Usar heredado ({inheritedValues.num_slots})
            </button>
          )}
        </div>
        <Input
          id="num_slots"
          type="number"
          min={1}
          max={100}
          placeholder={inheritedValues?.num_slots ? `${inheritedValues.num_slots} (heredado)` : "10"}
          disabled={isSubmitting}
          className={cn(
            errors.num_slots && "border-red-500",
            !numSlotsIsOverride && "text-muted-foreground"
          )}
          {...register("num_slots")}
        />
        {errors.num_slots && (
          <p className="text-sm text-red-500">{errors.num_slots.message}</p>
        )}
        {numSlotsIsOverride && inheritedValues?.num_slots && currentNumSlots !== inheritedValues.num_slots && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <Info className="h-3 w-3" />
            Este valor es un override. Las pantallas de este grupo usarán {currentNumSlots} slots en vez de {inheritedValues.num_slots} del Network.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {defaultValues ? "Guardar cambios" : "Crear grupo"}
        </Button>
      </div>
    </form>
  );
}
