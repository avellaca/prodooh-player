import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useScreenManifest } from '../hooks';
import type { ManifestItem, ManifestItemType } from '../types';

interface ManifestSummaryProps {
  screenId: string;
}

const TYPE_LABELS: Record<ManifestItemType, string> = {
  order_line_creative: 'Pedido',
  prodooh_ssp_call: 'SSP',
  playlist_item: 'Playlist',
};

const TYPE_VARIANTS: Record<ManifestItemType, 'default' | 'secondary' | 'outline'> = {
  order_line_creative: 'default',
  prodooh_ssp_call: 'secondary',
  playlist_item: 'outline',
};

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function computeComposition(items: ManifestItem[]) {
  const counts: Record<ManifestItemType, number> = {
    order_line_creative: 0,
    prodooh_ssp_call: 0,
    playlist_item: 0,
  };

  for (const item of items) {
    if (item.type in counts) {
      counts[item.type]++;
    }
  }

  return counts;
}

export function ManifestSummary({ screenId }: ManifestSummaryProps) {
  const { data: manifest, isLoading, isError } = useScreenManifest(screenId);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Manifiesto actual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-52" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Manifiesto actual</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Error al cargar el manifiesto.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!manifest) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Manifiesto actual</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sin manifiesto generado — el motor de prioridad aún no ha procesado esta pantalla.
          </p>
        </CardContent>
      </Card>
    );
  }

  const composition = computeComposition(manifest.items);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">Manifiesto actual</CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Ver detalle
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detalle del manifiesto</DialogTitle>
              <DialogDescription>
                Versión {manifest.version.slice(0, 8)}… — {manifest.items.length} ítems
              </DialogDescription>
            </DialogHeader>
            <ManifestItemsTable items={manifest.items} />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Versión</span>
            <p className="font-mono text-xs">{manifest.version.slice(0, 12)}…</p>
          </div>
          <div>
            <span className="text-muted-foreground">Generado</span>
            <p>{formatDate(manifest.generated_at)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Total spots</span>
            <p className="font-semibold">{manifest.total_spots}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Composición</span>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {composition.order_line_creative > 0 && (
                <Badge variant="default" className="text-xs">
                  {composition.order_line_creative} pedidos
                </Badge>
              )}
              {composition.prodooh_ssp_call > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {composition.prodooh_ssp_call} SSP
                </Badge>
              )}
              {composition.playlist_item > 0 && (
                <Badge variant="outline" className="text-xs">
                  {composition.playlist_item} playlist
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ManifestItemsTable({ items }: { items: ManifestItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        El manifiesto no contiene ítems.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Pos.</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead className="w-24">Duración</TableHead>
          <TableHead>Contenido</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.position}>
            <TableCell className="font-mono text-xs">
              {item.position + 1}
            </TableCell>
            <TableCell>
              <Badge variant={TYPE_VARIANTS[item.type]}>
                {TYPE_LABELS[item.type]}
              </Badge>
            </TableCell>
            <TableCell className="text-xs">
              {item.duration_seconds}s
            </TableCell>
            <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
              {getItemName(item)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function getItemName(item: ManifestItem): string {
  switch (item.type) {
    case 'order_line_creative':
      return item.creative_id ? `Creativo ${item.creative_id.slice(0, 8)}…` : '—';
    case 'prodooh_ssp_call':
      return 'Llamada programática';
    case 'playlist_item':
      return item.playlist_item_id ? `Playlist item ${item.playlist_item_id.slice(0, 8)}…` : '—';
    default:
      return '—';
  }
}
