import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { orderCreateSchema, type OrderCreateFormValues } from "../schemas";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface OrderFormProps {
  defaultValues?: Partial<OrderCreateFormValues>;
  onSubmit: (data: OrderCreateFormValues) => void;
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
    formState: { errors },
  } = useForm<OrderCreateFormValues>({
    resolver: zodResolver(orderCreateSchema),
    defaultValues: {
      name: "",
      advertiser_name: "",
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

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {defaultValues ? "Guardar cambios" : "Crear pedido"}
        </Button>
      </div>
    </form>
  );
}
