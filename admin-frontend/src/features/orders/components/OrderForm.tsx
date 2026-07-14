import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { orderSchema, type OrderFormValues } from "../schemas";
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
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface OrderFormProps {
  defaultValues?: Partial<OrderFormValues>;
  onSubmit: (data: OrderFormValues) => void;
  isSubmitting?: boolean;
}

export function OrderForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
}: OrderFormProps) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      name: "",
      advertiser_name: "",
      starts_at: "",
      ends_at: "",
      status: "draft",
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
        placeholder="Nombre del pedido"
        disabled={isSubmitting}
      />

      <FormField
        label="Anunciante"
        name="advertiser_name"
        register={register}
        errors={errors}
        placeholder="Nombre del anunciante"
        disabled={isSubmitting}
      />

      <FormField
        label="Fecha de inicio"
        name="starts_at"
        type="date"
        register={register}
        errors={errors}
        disabled={isSubmitting}
      />

      <FormField
        label="Fecha de fin"
        name="ends_at"
        type="date"
        register={register}
        errors={errors}
        disabled={isSubmitting}
      />

      <div className="space-y-2">
        <Label htmlFor="status">Estado</Label>
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={isSubmitting}
            >
              <SelectTrigger
                id="status"
                className={cn(
                  errors.status && "border-red-500 focus-visible:ring-red-500"
                )}
              >
                <SelectValue placeholder="Seleccionar estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Borrador</SelectItem>
                <SelectItem value="active">Activo</SelectItem>
                <SelectItem value="paused">Pausado</SelectItem>
                <SelectItem value="finished">Finalizado</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        {errors.status?.message && (
          <p className="text-sm text-red-500">
            {errors.status.message as string}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {defaultValues ? "Guardar cambios" : "Crear pedido"}
        </Button>
      </div>
    </form>
  );
}
