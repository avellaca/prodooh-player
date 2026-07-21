import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { DurationWarning } from '../utils/duration-validation';

interface DurationWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warning: DurationWarning | null;
  /** Called when user chooses to proceed with the assignment despite the warning */
  onConfirm: () => void;
  /** Called when user cancels */
  onCancel: () => void;
}

/**
 * Non-blocking warning dialog shown when assigning a video whose duration
 * exceeds the slot duration of one or more target screens.
 *
 * The user can proceed with the assignment anyway.
 */
export function DurationWarningDialog({
  open,
  onOpenChange,
  warning,
  onConfirm,
  onCancel,
}: DurationWarningDialogProps) {
  if (!warning) return null;

  function handleCancel() {
    onCancel();
    onOpenChange(false);
  }

  function handleConfirm() {
    onConfirm();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            Advertencia de duración
          </DialogTitle>
          <DialogDescription>
            El video tiene una duración mayor al slot configurado en algunas pantallas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-2">
            <p className="text-sm font-medium text-amber-800">
              Duración del video: {warning.videoDuration}s
            </p>
            <ul className="text-sm text-amber-700 space-y-1 max-h-32 overflow-y-auto">
              {warning.screens.map((screen) => (
                <li key={screen.name}>
                  • <strong>{screen.name}</strong>: slot de {screen.slotDuration}s
                </li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-muted-foreground">
            El video podría cortarse durante la reproducción en estas pantallas.
            ¿Deseas asignar de todos modos?
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm}>
              Asignar de todos modos
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
