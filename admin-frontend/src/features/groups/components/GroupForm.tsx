import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { groupSchema, type CreateGroupInput } from "@/schemas/group.schema";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface GroupFormProps {
  defaultValues?: Partial<CreateGroupInput>;
  onSubmit: (data: CreateGroupInput) => void;
  isSubmitting?: boolean;
}

export function GroupForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
}: GroupFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateGroupInput>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: "",
      duration_seconds: undefined,
      orientation: undefined,
      resolution_width: undefined,
      resolution_height: undefined,
      ...defaultValues,
    },
  });

  const orientation = watch("orientation");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <FormField
        label="Nombre"
        name="name"
        register={register}
        errors={errors}
        placeholder="Nombre del grupo"
        disabled={isSubmitting}
      />

      <FormField
        label="Duración por defecto (segundos)"
        name="duration_seconds"
        register={register}
        errors={errors}
        type="number"
        placeholder="30"
        disabled={isSubmitting}
      />

      <div className="space-y-2">
        <Label>Orientación</Label>
        <Select
          value={orientation ?? ""}
          onValueChange={(value) =>
            setValue("orientation", value as "landscape" | "portrait")
          }
          disabled={isSubmitting}
        >
          <SelectTrigger>
            <SelectValue placeholder="Seleccionar orientación" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="landscape">Landscape</SelectItem>
            <SelectItem value="portrait">Portrait</SelectItem>
          </SelectContent>
        </Select>
        {errors.orientation && (
          <p className="text-sm text-red-500">{errors.orientation.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Ancho (px)"
          name="resolution_width"
          register={register}
          errors={errors}
          type="number"
          placeholder="1920"
          disabled={isSubmitting}
        />
        <FormField
          label="Alto (px)"
          name="resolution_height"
          register={register}
          errors={errors}
          type="number"
          placeholder="1080"
          disabled={isSubmitting}
        />
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
