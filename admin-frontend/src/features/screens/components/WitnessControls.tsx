import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, Zap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/axios';
import { queryClient } from '@/lib/query-client';

interface WitnessControlsProps {
  screenId: string;
  numSlots: number;
  slotDuration: number;
}

export function WitnessControls({ screenId, numSlots, slotDuration }: WitnessControlsProps) {
  const [showSpeedModal, setShowSpeedModal] = useState(false);
  const [factor, setFactor] = useState('2');
  const [loops, setLoops] = useState('3');

  // Send speed override command
  const speedMutation = useMutation({
    mutationFn: (data: { factor: number; expires_at: string }) =>
      api.post(`/admin/screens/${screenId}/commands`, {
        type: 'speed_override',
        factor: data.factor,
        expires_at: data.expires_at,
      }),
    onSuccess: () => {
      toast.success(`Modo testigo activado (x${factor}, ${loops} loops)`);
      setShowSpeedModal(false);
    },
    onError: () => {
      toast.error('Error al activar el modo testigo');
    },
  });

  // Request screenshot command
  const [screenshotProgress, setScreenshotProgress] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialCountRef = useRef<number>(0);

  function stopScreenshotProgress() {
    setScreenshotProgress(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  const screenshotMutation = useMutation({
    mutationFn: () =>
      api.post(`/admin/screens/${screenId}/commands`, {
        type: 'screenshot',
      }),
    onSuccess: () => {
      toast.success('Captura solicitada. Esperando respuesta del dispositivo...');
      setScreenshotProgress(true);
      // Store initial count to detect new arrivals
      initialCountRef.current = queryClient.getQueryData<any[]>(['screens', screenId, 'screenshots'])?.length ?? 0;

      // Poll for new screenshots every 3s
      pollIntervalRef.current = setInterval(async () => {
        await queryClient.invalidateQueries({ queryKey: ['screens', screenId, 'screenshots'] });
        const current = queryClient.getQueryData<any[]>(['screens', screenId, 'screenshots']);
        if (current && current.length > initialCountRef.current) {
          // New screenshot arrived — stop progress
          stopScreenshotProgress();
          toast.success('¡Captura recibida!');
        }
      }, 3000);

      // Auto-stop after 45s
      timeoutRef.current = setTimeout(() => {
        stopScreenshotProgress();
      }, 45000);
    },
    onError: () => {
      toast.error('Error al solicitar la captura');
    },
  });

  function handleActivateWitness() {
    const loopDurationSeconds = numSlots * slotDuration;
    // Divide by factor because the loop runs faster when accelerated
    const totalSeconds = (loopDurationSeconds * Number(loops)) / Number(factor);
    const expiresAt = new Date(Date.now() + totalSeconds * 1000).toISOString();

    speedMutation.mutate({
      factor: Number(factor),
      expires_at: expiresAt,
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowSpeedModal(true)}
      >
        <Zap className="mr-2 h-4 w-4" />
        Modo Testigo
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => screenshotMutation.mutate()}
        disabled={screenshotMutation.isPending || screenshotProgress}
      >
        {screenshotMutation.isPending || screenshotProgress ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Camera className="mr-2 h-4 w-4" />
        )}
        {screenshotProgress ? 'Esperando captura...' : 'Tomar Captura'}
      </Button>

      {/* Progress bar while waiting for screenshot */}
      {screenshotProgress && (
        <div className="w-full mt-2">
          <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full"
              style={{ animation: 'screenshot-progress 45s linear forwards' }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Esperando respuesta del dispositivo (máx. 45s)...
          </p>
        </div>
      )}

      {/* Speed Override Modal */}
      <Dialog open={showSpeedModal} onOpenChange={setShowSpeedModal}>
        <DialogContent className="sm:max-w-[350px]">
          <DialogHeader>
            <DialogTitle>Modo Testigo</DialogTitle>
            <DialogDescription>
              Acelera la reproducción temporalmente para capturar testigos de todos los creativos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Velocidad</Label>
              <Select value={factor} onValueChange={setFactor}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">x2 (doble velocidad)</SelectItem>
                  <SelectItem value="3">x3 (triple velocidad)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Duración (loops)</Label>
              <Select value={loops} onValueChange={setLoops}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 loop ({numSlots * slotDuration}s)</SelectItem>
                  <SelectItem value="2">2 loops ({numSlots * slotDuration * 2}s)</SelectItem>
                  <SelectItem value="3">3 loops ({numSlots * slotDuration * 3}s)</SelectItem>
                  <SelectItem value="4">4 loops ({numSlots * slotDuration * 4}s)</SelectItem>
                  <SelectItem value="5">5 loops ({numSlots * slotDuration * 5}s)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Las impresiones durante el modo testigo se marcan como "witness" y no cuentan para la entrega.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSpeedModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleActivateWitness} disabled={speedMutation.isPending}>
              {speedMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Activar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
