import { useState } from 'react';
import { Copy, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

import { useOrders, useOrderLines } from '../hooks';
import { copyCreativesApi } from '../api';
import type { CopyCreativesResponse } from '../api';
import { queryClient } from '@/lib/query-client';

type Phase = 'select' | 'copying' | 'success' | 'error';

interface CopyCreativesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceOrderLineId: string;
  sourceOrderId: string;
  onSuccess: () => void;
}

/**
 * Dialog that allows copying creatives from the current OrderLine to another.
 * Shows order lines from the same order and other orders of the same tenant.
 */
export function CopyCreativesDialog({
  open,
  onOpenChange,
  sourceOrderLineId,
  sourceOrderId,
  onSuccess,
}: CopyCreativesDialogProps) {
  const [selectedOrderId, setSelectedOrderId] = useState<string>(sourceOrderId);
  const [selectedLineId, setSelectedLineId] = useState<string>('');
  const [phase, setPhase] = useState<Phase>('select');
  const [result, setResult] = useState<CopyCreativesResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch all orders for the tenant
  const { data: orders, isLoading: ordersLoading } = useOrders();

  // Fetch order lines for the selected order
  const { data: orderLines, isLoading: linesLoading } = useOrderLines(selectedOrderId);

  // Filter out the source order line from the target list
  const availableLines = orderLines?.filter((line) => line.id !== sourceOrderLineId) ?? [];

  const copyMutation = useMutation({
    mutationFn: (targetLineId: string) =>
      copyCreativesApi.copy(sourceOrderLineId, targetLineId),
    onSuccess: (data) => {
      setResult(data);
      setPhase('success');
      queryClient.invalidateQueries({ queryKey: ['order-lines', sourceOrderLineId, 'resolutions'] });
      queryClient.invalidateQueries({ queryKey: ['targets'] });
      onSuccess();
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      setErrorMessage(error.response?.data?.message ?? 'Error al copiar creativos');
      setPhase('error');
    },
  });

  function resetState() {
    setSelectedOrderId(sourceOrderId);
    setSelectedLineId('');
    setPhase('select');
    setResult(null);
    setErrorMessage(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  }

  function handleCopy() {
    if (!selectedLineId) return;
    setPhase('copying');
    copyMutation.mutate(selectedLineId);
  }

  function handleOrderChange(orderId: string) {
    setSelectedOrderId(orderId);
    setSelectedLineId('');
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copiar creativos a otra línea</DialogTitle>
          <DialogDescription>
            Selecciona la línea de pedido destino. Los creativos se copiarán según coincidencia de resolución.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Select phase */}
          {phase === 'select' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="target-order">Pedido</Label>
                <Select
                  value={selectedOrderId}
                  onValueChange={handleOrderChange}
                  disabled={ordersLoading}
                >
                  <SelectTrigger id="target-order">
                    <SelectValue placeholder="Selecciona un pedido" />
                  </SelectTrigger>
                  <SelectContent>
                    {orders?.map((order) => (
                      <SelectItem key={order.id} value={order.id}>
                        {order.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="target-line">Línea de pedido destino</Label>
                <Select
                  value={selectedLineId}
                  onValueChange={setSelectedLineId}
                  disabled={linesLoading || !selectedOrderId}
                >
                  <SelectTrigger id="target-line">
                    <SelectValue placeholder={
                      linesLoading
                        ? 'Cargando líneas...'
                        : availableLines.length === 0
                          ? 'No hay líneas disponibles'
                          : 'Selecciona una línea'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLines.map((line) => (
                      <SelectItem key={line.id} value={line.id}>
                        {line.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full"
                onClick={handleCopy}
                disabled={!selectedLineId}
              >
                <Copy className="h-4 w-4" />
                Copiar creativos
              </Button>
            </>
          )}

          {/* Copying phase */}
          {phase === 'copying' && (
            <div className="space-y-3 rounded-lg border p-6">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium">Copiando creativos...</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-full animate-pulse bg-primary/60" />
              </div>
            </div>
          )}

          {/* Success phase */}
          {phase === 'success' && result && (
            <div className="space-y-3">
              <div className="flex flex-col items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-800 dark:bg-green-950">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                <p className="text-sm font-medium text-green-700 dark:text-green-300">
                  Creativos copiados exitosamente
                </p>
              </div>
              <div className="rounded-lg border p-4 space-y-1">
                <p className="text-sm">
                  <span className="font-medium">Creados:</span> {result.created}
                </p>
                <p className="text-sm">
                  <span className="font-medium">Omitidos (sin coincidencia):</span> {result.skipped}
                </p>
                <p className="text-sm">
                  <span className="font-medium">Pantallas cubiertas:</span> {result.covered_screens.length}
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleOpenChange(false)}
              >
                Cerrar
              </Button>
            </div>
          )}

          {/* Error phase */}
          {phase === 'error' && (
            <div className="space-y-3">
              <div className="flex gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
                <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">{errorMessage}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={resetState}
              >
                Intentar de nuevo
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
