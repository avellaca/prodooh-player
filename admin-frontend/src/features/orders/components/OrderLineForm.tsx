import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { orderLineSchema, type OrderLineFormValues } from "../schemas";
import { FormField } from "@/components/forms/FormField";
import { ActiveDatesPicker } from "./ActiveDatesPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  by_slot?: boolean;
  slots_purchased?: number | null;
}

interface OrderLineFormProps {
  defaultValues?: Partial<OrderLineFormValues>;
  onSubmit: (data: OrderLineSubmitPayload) => void;
  isSubmitting?: boolean;
  parentOrder: { starts_at: string; ends_at: string };
  /** Number of ad_slots available (from tenant config: num_slots - ssp_slots - playlist_slots) */
  adSlots?: number;
  /** loops_per_day for target_spots calculation display */
  loopsPerDay?: number;
  /** Max ad_slots across all screens in the network (for "Por Slot" max) */
  maxAdSlots?: number;
  /** Min ad_slots across all screens (for range display) */
  minAdSlots?: number;
  /** Min spots/day across all screens */
  minSpotsPerDay?: number;
  /** Max spots/day across all screens */
  maxSpotsPerDay?: number;
}

export function OrderLineForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
  parentOrder,
  adSlots,
  loopsPerDay,
  maxAdSlots,
  minAdSlots,
  minSpotsPerDay,
  maxSpotsPerDay,
}: OrderLineFormProps) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
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
      by_slot: false,
      slots_purchased: undefined,
      ...defaultValues,
    },
  });

  // Watch values for derived calculations in render
  const spotsInput = watch("spots_input");
  const activeDates = watch("active_dates");
  const priorityTier = watch("priority_tier");
  const bySlot = watch("by_slot");
  const slotsPurchased = watch("slots_purchased");

  // Derived state: pace is disabled for patrocinio and red_interna
  const isPaceDisabled = priorityTier === "patrocinio" || priorityTier === "red_interna";

  // Derived state: "Por Slot" toggle only shows for patrocinio
  const showBySlotToggle = priorityTier === "patrocinio";

  // Calculate target_spots from slots when by_slot is active
  const computedTargetSpotsFromSlots =
    bySlot && slotsPurchased && loopsPerDay
      ? slotsPurchased * loopsPerDay
      : null;

  // Always spots_por_dia: total = input × days
  const totalSpots = (Number(spotsInput) || 0) * (activeDates ?? []).length;

  function handleFormSubmit(formValues: OrderLineFormValues) {
    const dateRange = deriveDateRange(formValues.active_dates);

    // Force uniform pace for patrocinio and red_interna
    const effectivePace: "asap" | "uniform" =
      formValues.priority_tier === "patrocinio" || formValues.priority_tier === "red_interna"
        ? "uniform"
        : formValues.delivery_pace;

    // Calculate target_spots based on by_slot mode
    let computedTotalSpots: number;
    if (formValues.priority_tier === "patrocinio" && formValues.by_slot && formValues.slots_purchased && loopsPerDay) {
      computedTotalSpots = formValues.slots_purchased * loopsPerDay;
    } else {
      computedTotalSpots = formValues.spots_input * formValues.active_dates.length;
    }

    const payload: OrderLineSubmitPayload = {
      name: formValues.name,
      priority_tier: formValues.priority_tier,
      starts_at: dateRange?.starts_at ?? "",
      ends_at: dateRange?.ends_at ?? "",
      active_dates: formValues.active_dates,
      target_spots: computedTotalSpots,
      delivery_pace: effectivePace,
      share_weight: formValues.share_weight,
      status: formValues.status,
      by_slot: formValues.priority_tier === "patrocinio" ? formValues.by_slot : false,
      slots_purchased: formValues.priority_tier === "patrocinio" && formValues.by_slot
        ? formValues.slots_purchased ?? null
        : null,
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
              onValueChange={(value) => {
                field.onChange(value);
                // Reset by_slot when changing away from patrocinio
                if (value !== "patrocinio") {
                  setValue("by_slot", false);
                  setValue("slots_purchased", undefined);
                }
                // Force pace to uniform for non-estandar tiers
                if (value === "patrocinio" || value === "red_interna") {
                  setValue("delivery_pace", "uniform");
                }
              }}
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
          render={({ field }) => {
            // Minimum date is today (local time) — can't select past dates
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const effectiveMin = parentOrder.starts_at && parentOrder.starts_at > todayStr
              ? parentOrder.starts_at
              : todayStr;

            return (
              <ActiveDatesPicker
                value={field.value ?? []}
                onChange={field.onChange}
                minDate={effectiveMin}
                maxDate={parentOrder.ends_at || undefined}
                disabled={isSubmitting}
              />
            );
          }}
        />
        {errors.active_dates?.message && (
          <p className="text-sm text-red-500">
            {errors.active_dates.message as string}
          </p>
        )}
      </div>

      {/* Delivery Pace - disabled for patrocinio/red_interna, enabled for estandar */}
      <div className="space-y-2">
        <Label htmlFor="delivery_pace">Ritmo de entrega</Label>
        {isPaceDisabled ? (
          <div>
            <Input
              id="delivery_pace_display"
              value="Uniforme"
              disabled
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground mt-1">
              El ritmo es siempre uniforme para {priorityTier === "patrocinio" ? "Patrocinio" : "Red interna"}
            </p>
          </div>
        ) : (
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
        )}
        {errors.delivery_pace?.message && (
          <p className="text-sm text-red-500">
            {errors.delivery_pace.message as string}
          </p>
        )}
      </div>

      {/* "Por Slot" toggle - only visible for patrocinio tier */}
      {showBySlotToggle && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="by_slot" className="text-sm font-medium">
              Por Slot
            </Label>
            <Controller
              name="by_slot"
              control={control}
              render={({ field }) => (
                <Switch
                  id="by_slot"
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked);
                    if (checked) {
                      setValue("slots_purchased", 1);
                    }
                  }}
                  disabled={isSubmitting}
                />
              )}
            />
          </div>

          {bySlot ? (
            <div className="space-y-2">
              <Label htmlFor="slots_purchased">Slots</Label>
              <Input
                id="slots_purchased"
                type="number"
                min={1}
                max={maxAdSlots ?? adSlots ?? 100}
                disabled={isSubmitting}
                className={cn(
                  errors.slots_purchased && "border-red-500 focus-visible:ring-red-500"
                )}
                {...register("slots_purchased")}
              />
              {(minAdSlots && maxAdSlots && minAdSlots !== maxAdSlots) ? (
                <p className="text-xs text-muted-foreground">
                  Máx. {maxAdSlots} slots (según inventario)
                </p>
              ) : null}
              {(() => {
                const currentSlots = Number(slotsPurchased) || 0;
                if (currentSlots <= 0) return null;
                const days = (activeDates ?? []).length;

                if (loopsPerDay) {
                  const spotsDay = currentSlots * loopsPerDay;
                  const total = spotsDay * days;
                  return (
                    <p className="text-xs text-muted-foreground">
                      Aprox. {spotsDay.toLocaleString()} spots/día
                      {days > 0 && <> · Total: {total.toLocaleString()} spots ({days} días)</>}
                      {' por pantalla'}
                    </p>
                  );
                }

                const defaultLoops = Math.floor(61200 / ((maxAdSlots ?? adSlots ?? 7 + (2 + 1)) * 10));
                const spotsDay = currentSlots * defaultLoops;
                const total = spotsDay * days;
                return (
                  <p className="text-xs text-muted-foreground">
                    Aprox. {spotsDay.toLocaleString()} spots/día
                    {days > 0 && <> · Total: {total.toLocaleString()} spots ({days} días)</>}
                    {' por pantalla'}
                  </p>
                );
              })()}
            </div>
          ) : (
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
                  Total: {totalSpots.toLocaleString()} spots ({Number(spotsInput) || 0} por día × {(activeDates ?? []).length} días) por pantalla
                </p>
              )}
              {errors.spots_input?.message && (
                <p className="text-sm text-red-500">
                  {errors.spots_input.message as string}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Spots input - shown when NOT patrocinio (patrocinio has its own section above) */}
      {!showBySlotToggle && (
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
              Total: {totalSpots.toLocaleString()} spots ({Number(spotsInput) || 0} por día × {(activeDates ?? []).length} días) por pantalla
            </p>
          )}
          {errors.spots_input?.message && (
            <p className="text-sm text-red-500">
              {errors.spots_input.message as string}
            </p>
          )}
        </div>
      )}

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


      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {defaultValues ? "Guardar cambios" : "Crear línea"}
        </Button>
      </div>
    </form>
  );
}
