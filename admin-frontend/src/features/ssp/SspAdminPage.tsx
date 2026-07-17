import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingState } from '@/components/shared/LoadingState';

import { sspApi, type SspDefinition, type CredentialField } from './api';

export default function SspAdminPage() {
  const { data: definitions, isLoading } = useQuery({
    queryKey: ['ssp-definitions'],
    queryFn: () => sspApi.listDefinitions(),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editingDef, setEditingDef] = useState<SspDefinition | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sspApi.deleteDefinition(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssp-definitions'] });
      toast.success('SSP eliminado');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      sspApi.updateDefinition(id, { active }),
    onSuccess: (_, { active }) => {
      queryClient.invalidateQueries({ queryKey: ['ssp-definitions'] });
      toast.success(active ? 'SSP activado' : 'SSP desactivado');
    },
  });

  if (isLoading) return <LoadingState rows={3} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Proveedores SSP</h1>
          <p className="text-muted-foreground">Catálogo global de proveedores de publicidad programática</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Agregar SSP
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {definitions?.map((def) => (
          <Card key={def.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {def.logo_url ? (
                    <img src={def.logo_url} alt={def.name} className="h-8 w-8 rounded object-contain" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary font-bold text-xs">
                      {def.name.charAt(0)}
                    </div>
                  )}
                  <CardTitle className="text-base">{def.name}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={def.active}
                    onCheckedChange={(checked) =>
                      toggleActiveMutation.mutate({ id: def.id, active: checked })
                    }
                  />
                  <Badge variant={def.active ? 'success' : 'secondary'}>
                    {def.active ? 'Activo' : 'Inactivo'}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">{def.description ?? def.base_url}</p>
              <p className="text-xs text-muted-foreground">
                Campos: {def.credential_fields.map((f) => f.label).join(', ')}
              </p>
              <div className="flex gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setEditingDef(def)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Editar
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteMutation.mutate(def.id)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Eliminar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create/Edit Dialog */}
      <SspDefinitionFormDialog
        open={createOpen || editingDef !== null}
        onOpenChange={(open) => {
          if (!open) { setCreateOpen(false); setEditingDef(null); }
        }}
        definition={editingDef}
      />
    </div>
  );
}

// ─── Form Dialog ─────────────────────────────────────────────────────────────

function SspDefinitionFormDialog({
  open,
  onOpenChange,
  definition,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: SspDefinition | null;
}) {
  const isEdit = definition !== null;
  const [name, setName] = useState(definition?.name ?? '');
  const [slug, setSlug] = useState(definition?.slug ?? '');
  const [baseUrl, setBaseUrl] = useState(definition?.base_url ?? '');
  const [logoUrl, setLogoUrl] = useState(definition?.logo_url ?? '');
  const [description, setDescription] = useState(definition?.description ?? '');
  const [active, setActive] = useState(definition?.active ?? true);
  const [fields, setFields] = useState<CredentialField[]>(
    definition?.credential_fields ?? [{ key: '', label: '', type: 'password' }]
  );

  const createMutation = useMutation({
    mutationFn: (data: any) => isEdit ? sspApi.updateDefinition(definition!.id, data) : sspApi.createDefinition(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssp-definitions'] });
      toast.success(isEdit ? 'SSP actualizado' : 'SSP creado');
      onOpenChange(false);
    },
    onError: () => toast.error('Error al guardar'),
  });

  function handleSubmit() {
    createMutation.mutate({
      name,
      slug,
      base_url: baseUrl,
      logo_url: logoUrl || null,
      description: description || null,
      active,
      credential_fields: fields.filter((f) => f.key && f.label),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar' : 'Agregar'} Proveedor SSP</DialogTitle>
          <DialogDescription>Configura los datos del proveedor y los campos de credenciales que el tenant admin deberá completar.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Prodooh SSP" />
            </div>
            <div className="space-y-1">
              <Label>Slug</Label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="prodooh" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>URL Base del API</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://ssp.example.com" />
          </div>

          <div className="space-y-1">
            <Label>Logo URL (opcional)</Label>
            <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
          </div>

          <div className="space-y-1">
            <Label>Descripción (opcional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Plataforma programática..." />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="ssp-active">Activo (visible para tenants)</Label>
            <Switch id="ssp-active" checked={active} onCheckedChange={setActive} />
          </div>

          <div className="space-y-2">
            <Label>Campos de credenciales</Label>
            {fields.map((field, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  value={field.key}
                  onChange={(e) => { const f = [...fields]; f[idx] = { ...f[idx], key: e.target.value }; setFields(f); }}
                  placeholder="key (api_key)"
                  className="flex-1"
                />
                <Input
                  value={field.label}
                  onChange={(e) => { const f = [...fields]; f[idx] = { ...f[idx], label: e.target.value }; setFields(f); }}
                  placeholder="Label (API Key)"
                  className="flex-1"
                />
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={() => setFields([...fields, { key: '', label: '', type: 'password' }])}>
              + Agregar campo
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!name || !slug || !baseUrl || createMutation.isPending}>
            {isEdit ? 'Guardar' : 'Crear'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
