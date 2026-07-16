import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { AvailabilityInfo } from '../api';

interface AvailabilityAlertModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availability: AvailabilityInfo;
  onConfirm: () => void;
  onModify: () => void;
  isConfirming?: boolean;
}

/**
 * Modal that displays availability/saturation information when activating
 * an OrderLine with insufficient inventory capacity.
 *
 * Offers two actions:
 * - "Estoy de acuerdo" → proceed with activation (force=true)
 * - "Modificar" → return to edit form
 */
export function AvailabilityAlertModal({
  open,
  onOpenChange,
  availability,
  onConfirm,
  onModify,
  isConfirming = false,
}: AvailabilityAlertModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <DialogTitle>Disponibilidad insuficiente</DialogTitle>
          </div>
          <DialogDescription>
            {availability.warning_message ??
              'El inventario disponible podría ser insuficiente para cumplir los spots objetivo de esta línea.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-4 rounded-md border p-4 text-sm">
            <div>
              <p className="font-medium text-muted-foreground">Spots objetivo</p>
              <p className="text-lg font-semibold">{availability.target_spots.toLocaleString()}</p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Capacidad disponible</p>
              <p className="text-lg font-semibold">{availability.available_capacity.toLocaleString()}</p>
            </div>
            <div className="col-span-2">
              <p className="font-medium text-muted-foreground">Saturación</p>
              <p className="text-lg font-semibold text-amber-600">
                {availability.saturation_percent.toFixed(1)}%
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Puedes continuar con la activación a pesar de la saturación, o modificar la línea de pedido para ajustar los spots objetivo.
          </p>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={onModify}
            disabled={isConfirming}
          >
            Modificar
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? 'Activando...' : 'Estoy de acuerdo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
