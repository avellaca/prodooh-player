import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { toast } from 'sonner';
import { Check, Eye, EyeOff, Loader2, Lock, Pencil, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { sspApi, type SspConnectionStatus, type CredentialField } from './api';
import { cn } from '@/lib/utils';

export default function SspPage() {
  const { data: connections, isLoading } = useQuery({
    queryKey: ['ssp-connections'],
    queryFn: () => sspApi.listConnections(),
  });

  const [connectingDef, setConnectingDef] = useState<SspConnectionStatus | null>(null);

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => sspApi.disconnect(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssp-connections'] });
      toast.success('SSP desconectado');
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Proveedores SSP</h1>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2].map((i) => <div key={i} className="h-40 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Proveedores SSP</h1>
        <p className="text-muted-foreground">Conecta plataformas de publicidad programática para llenar los slots SSP.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {connections?.map((ssp) => (
          <div
            key={ssp.id}
            className={cn(
              'relative rounded-lg border-2 p-5 transition-all',
              ssp.connected && ssp.active && 'border-green-500 bg-green-50/30',
              !ssp.active && 'opacity-60 border-dashed',
              ssp.active && !ssp.connected && 'border-muted hover:border-primary/50 cursor-pointer',
            )}
            onClick={() => {
              if (ssp.active && !ssp.connected) setConnectingDef(ssp);
            }}
          >
            {/* Connected check mark */}
            {ssp.connected && ssp.active && (
              <div className="absolute top-3 right-3">
                <Check className="h-5 w-5 text-green-600" />
              </div>
            )}

            {/* Inactive lock */}
            {!ssp.active && (
              <div className="absolute top-3 right-3">
                <Lock className="h-4 w-4 text-muted-foreground" />
              </div>
            )}

            {/* Logo + Name */}
            <div className="flex items-center gap-3 mb-3">
              {ssp.logo_url ? (
                <img src={ssp.logo_url} alt={ssp.name} className="h-10 w-10 rounded object-contain" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded bg-primary/10 text-primary font-bold text-sm">
                  {ssp.name.charAt(0)}
                </div>
              )}
              <div>
                <p className="font-medium">{ssp.name}</p>
                {ssp.description && <p className="text-xs text-muted-foreground">{ssp.description}</p>}
              </div>
            </div>

            {/* Status */}
            {!ssp.active && (
              <p className="text-xs text-muted-foreground italic">No disponible (desactivado por el administrador)</p>
            )}

            {ssp.active && !ssp.connected && (
              <p className="text-xs text-muted-foreground">Clic para configurar credenciales</p>
            )}

            {ssp.active && ssp.connected && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-green-700 font-medium">Conectado</p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-6 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConnectingDef(ssp);
                    }}
                    title="Editar credenciales"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-destructive h-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (ssp.connection_id) disconnectMutation.mutate(ssp.connection_id);
                    }}
                  >
                    Desconectar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Connect Dialog */}
      {connectingDef && (
        <ConnectSspDialog
          ssp={connectingDef}
          open={true}
          onOpenChange={(open) => { if (!open) setConnectingDef(null); }}
          onSuccess={() => setConnectingDef(null)}
        />
      )}
    </div>
  );
}

// ─── Connect Dialog with password fields + eye toggle ────────────────────────

function ConnectSspDialog({ ssp, open, onOpenChange, onSuccess }: {
  ssp: SspConnectionStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  const isEditing = ssp.connected;

  const [pingError, setPingError] = useState<string | null>(null);

  const connectMutation = useMutation({
    mutationFn: () => sspApi.connect({
      ssp_definition_id: ssp.id,
      credentials: values,
    }),
    onSuccess: () => {
      setPingError(null);
      queryClient.invalidateQueries({ queryKey: ['ssp-connections'] });
      toast.success(isEditing ? `${ssp.name} actualizado` : `${ssp.name} conectado exitosamente`);
      onSuccess();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message ?? 'Error al conectar.';
      const isPingFail = error?.response?.data?.ping_failed === true;
      if (isPingFail) {
        setPingError(message);
      } else {
        toast.error(message);
      }
    },
  });

  const allFilled = ssp.credential_fields.every((f) => values[f.key]?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {ssp.logo_url ? (
              <img src={ssp.logo_url} alt={ssp.name} className="h-8 w-8 rounded object-contain shrink-0" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary font-bold text-xs">
                {ssp.name.charAt(0)}
              </div>
            )}
            <DialogTitle>{isEditing ? 'Editar' : 'Conectar'} {ssp.name}</DialogTitle>
          </div>
          <DialogDescription>
            {isEditing
              ? `Actualiza las credenciales de ${ssp.name}.`
              : `Ingresa las credenciales proporcionadas por ${ssp.name}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {pingError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3">
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{pingError}</p>
            </div>
          )}
          {ssp.credential_fields.map((field: CredentialField) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`ssp-${field.key}`}>{field.label}</Label>
              <div className="relative">
                <Input
                  id={`ssp-${field.key}`}
                  type={visible[field.key] ? 'text' : 'password'}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  placeholder={field.label}
                  autoComplete="off"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setVisible({ ...visible, [field.key]: !visible[field.key] })}
                >
                  {visible[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => connectMutation.mutate()}
            disabled={!allFilled || connectMutation.isPending}
          >
            {connectMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? 'Guardar' : 'Conectar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
