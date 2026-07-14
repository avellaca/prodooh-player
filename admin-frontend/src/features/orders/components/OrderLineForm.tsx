import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { orderLineSchema, type OrderLineFormValues } from "../schemas";
import { FormField } from "@/components/forms/FormField";
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
import { Loader2 } from "lucide-react";
import {
  deriveDateRange,
} from "../utils/orderline-calculations";

export interface OrderLineSubmitPayload {
  name: string;
  priority_tier: "patrocinio" | "estandar" | "red_interna";
  starts_at: string;
  ends_at: string;
  active_dates: string[];
  target_spots: number;
  delivery_pace: "asap" | "uniform";
  share_weight: number;
  status: "draft" | "active" | "paused" | "finished";
}

interface OrderLineFormProps {
  defaultValues?: Partial<OrderLineFormValues>;
  onSubmit: (data: OrderLineSubmitPayload) => void;
  isSubmitting?: boolean;
  parentOrder: { starts_at: string; ends_at: string };
}

export function OrderLineForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
  parentOrder,
}: OrderLineFormProps) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<OrderLineFormValues>({
    resolver: zodResolver(orderLineSchema),
    defaultValues: {
      name: "",
      priority_tier: "estandar",
      spots_mode: "spots_por_dia",
      spots_input: 1,
      delivery_pace: "uniform",
      share_weight: 1,
      status: "draft",
      active_dates: [],
      ...defaultValues,
    },
  });

  // Watch values for derived calculations in render
  const spotsInput = watch("spots_input");
  const activeDates = watch("active_dates");

  // Always spots_por_dia: total = input × days
  const totalSpots = (Number(spotsInput) || 0) * (activeDates ?? []).length;

  function handleFormSubmit(formValues: OrderLineFormValues) {
    const dateRange = deriveDateRange(formValues.active_dates);
    const computedTotalSpots = formValues.spots_input * formValues.active_dates.length;

    const payload: OrderLineSubmitPayload = {
      name: formValues.name,
      priority_tier: formValues.priority_tier,
      starts_at: dateRange?.starts_at ?? "",
      ends_at: dateRange?.ends_at ?? "",
      active_dates: formValues.active_dates,
      target_spots: computedTotalSpots,
      delivery_pace: formValues.delivery_pace,
      share_weight: formValues.share_weight,
      status: formValues.status,
    };

    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <FormField
        label="Nombre"
        name="name"
        register={register}
        errors={errors}
        placeholder="Nombre de la línea"
        disabled={isSubmitting}
      />

      <div className="space-y-2">
        <Label htmlFor="priority_tier">Nivel de prioridad</Label>
        <Controller
          name="priority_tier"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={isSubmitting}
            >
              <SelectTrigger
                id="priority_tier"
                className={cn(
                  errors.priority_tier &&
                    "border-red-500 focus-visible:ring-red-500"
                )}
              >
                <SelectValue placeholder="Seleccionar prioridad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="patrocinio">Patrocinio</SelectItem>
                <SelectItem value="estandar">Estándar</SelectItem>
                <SelectItem value="red_interna">Red interna</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        {errors.priority_tier?.message && (
          <p className="text-sm text-red-500">
            {errors.priority_tier.message as string}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Fechas activas</Label>
        <Controller
          name="active_dates"
          control={control}
          render={({ field }) => (
            <ActiveDatesPicker
              value={field.value ?? []}
              onChange={field.onChange}
              minDate={parentOrder.starts_at}
              maxDate={parentOrder.ends_at}
              disabled={isSubmitting}
            />
          )}
        />
        {errors.active_dates?.message && (
          <p className="text-sm text-red-500">
            {errors.active_dates.message as string}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="spots_input">Spots por día</Label>
        <Input
          id="spots_input"
          type="number"
          min={1}
          disabled={isSubmitting}
          className={cn(
            errors.spots_input && "border-red-500 focus-visible:ring-red-500"
          )}
          {...register("spots_input")}
        />
        {(activeDates ?? []).length > 0 && (
          <p className="text-xs text-muted-foreground">
            Total: {totalSpots.toLocaleString()} spots ({Number(spotsInput) || 0} por día × {(activeDates ?? []).length} días)
          </p>
        )}
        {errors.spots_input?.message && (
          <p className="text-sm text-red-500">
            {errors.spots_input.message as string}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="delivery_pace">Ritmo de entrega</Label>
        <Controller
          name="delivery_pace"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={isSubmitting}
            >
              <SelectTrigger
                id="delivery_pace"
                className={cn(
                  errors.delivery_pace &&
                    "border-red-500 focus-visible:ring-red-500"
                )}
              >
                <SelectValue placeholder="Seleccionar ritmo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asap">Lo antes posible</SelectItem>
                <SelectItem value="uniform">Uniforme</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        {errors.delivery_pace?.message && (
          <p className="text-sm text-red-500">
            {errors.delivery_pace.message as string}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="share_weight">Peso de reparto</Label>
        <Input
          id="share_weight"
          type="number"
          min={1}
          disabled={isSubmitting}
          className={cn(
            errors.share_weight && "border-red-500 focus-visible:ring-red-500"
          )}
          {...register("share_weight")}
        />
        {errors.share_weight?.message && (
          <p className="text-sm text-red-500">
            {errors.share_weight.message as string}
          </p>
        )}
      </div>

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
          {defaultValues ? "Guardar cambios" : "Crear línea"}
        </Button>
      </div>
    </form>
  );
}
