import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { tenantSchema, type CreateTenantInput } from "@/schemas/tenant.schema";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface TenantFormProps {
  defaultValues?: CreateTenantInput;
  onSubmit: (data: CreateTenantInput) => void;
  isSubmitting?: boolean;
}

export function TenantForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
}: TenantFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateTenantInput>({
    resolver: zodResolver(tenantSchema),
    defaultValues: defaultValues ?? { name: "" },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <FormField
        label="Nombre"
        name="name"
        register={register}
        errors={errors}
        placeholder="Nombre del tenant"
        disabled={isSubmitting}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {defaultValues ? "Guardar cambios" : "Crear tenant"}
        </Button>
      </div>
    </form>
  );
}
