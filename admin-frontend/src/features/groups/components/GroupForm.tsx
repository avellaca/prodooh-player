import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { groupSchema, type CreateGroupInput } from "@/schemas/group.schema";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
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
    formState: { errors },
  } = useForm<CreateGroupInput>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: "",
      duration_seconds: undefined,
      ...defaultValues,
    },
  });

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

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {defaultValues ? "Guardar cambios" : "Crear grupo"}
        </Button>
      </div>
    </form>
  );
}
