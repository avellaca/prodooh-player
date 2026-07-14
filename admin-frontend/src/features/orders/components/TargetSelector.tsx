import { useState, useRef, useCallback } from 'react';
import { Monitor, Layers, X, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTargets, useCreateTarget, useDeleteTarget } from '../hooks';
import { useScreens } from '@/features/screens/hooks';
import { useGroups } from '@/features/groups/hooks';
import type { OrderLineTarget } from '../types';
import { cn } from '@/lib/utils';

export interface TargetSelectorProps {
  orderLineId: string;
}

/**
 * Displays currently assigned targets (screens and groups) for an OrderLine
 * and provides searchable selectors to assign new screens/groups or remove existing ones.
 */
export function TargetSelector({ orderLineId }: TargetSelectorProps) {
  const { data: targets = [], isLoading: targetsLoading } = useTargets(orderLineId);
  const { data: screens = [], isLoading: screensLoading } = useScreens();
  const { data: groups = [], isLoading: groupsLoading } = useGroups();

  const createTarget = useCreateTarget(orderLineId);
  const deleteTarget = useDeleteTarget(orderLineId);

  // Derive available screens (exclude already-assigned ones)
  const assignedScreenIds = new Set(
    targets
      .filter((t: OrderLineTarget) => t.screen_id != null)
      .map((t: OrderLineTarget) => t.screen_id),
  );
  const availableScreens = screens.filter((s) => !assignedScreenIds.has(s.id));

  // Derive available groups (exclude already-assigned ones)
  const assignedGroupIds = new Set(
    targets
      .filter((t: OrderLineTarget) => t.screen_group_id != null)
      .map((t: OrderLineTarget) => t.screen_group_id),
  );
  const availableGroups = groups.filter((g) => !assignedGroupIds.has(g.id));

  function handleAssignScreen(screenId: string) {
    createTarget.mutate({ screen_id: screenId });
  }

  function handleAssignGroup(groupId: string) {
    createTarget.mutate({ screen_group_id: groupId });
  }

  function handleRemoveTarget(targetId: string) {
    deleteTarget.mutate(targetId);
  }

  if (targetsLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando targets…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Pantallas y grupos asignados</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Assigned targets list */}
        {targets.length > 0 && (
          <ul className="space-y-2" role="list" aria-label="Targets asignados">
            {targets.map((target: OrderLineTarget) => (
              <li
                key={target.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  {target.screen_id ? (
                    <>
                      <Monitor className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        {target.screen?.name ?? target.screen_id}
                      </span>
                      {target.screen?.venue_id && (
                        <span className="text-xs text-muted-foreground">
                          ({target.screen.venue_id})
                        </span>
                      )}
                      <Badge variant="secondary">Pantalla</Badge>
                    </>
                  ) : (
                    <>
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        {target.screen_group?.name ?? target.screen_group_id}
                      </span>
                      <Badge variant="outline">Grupo</Badge>
                    </>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={deleteTarget.isPending}
                  onClick={() => handleRemoveTarget(target.id)}
                  aria-label={`Desasignar ${target.screen?.name ?? target.screen_group?.name ?? 'target'}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {targets.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No hay pantallas ni grupos asignados.
          </p>
        )}

        {/* Searchable selectors */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SearchableSelector
            label="Asignar pantalla"
            placeholder="Buscar por nombre o venue ID..."
            items={availableScreens.map((s) => ({
              id: s.id,
              label: s.name,
              sublabel: s.venue_id,
            }))}
            onSelect={handleAssignScreen}
            disabled={screensLoading || createTarget.isPending}
            icon={<Monitor className="h-4 w-4 text-muted-foreground" />}
          />
          <SearchableSelector
            label="Asignar grupo"
            placeholder="Buscar grupo..."
            items={availableGroups.map((g) => ({
              id: g.id,
              label: g.name,
            }))}
            onSelect={handleAssignGroup}
            disabled={groupsLoading || createTarget.isPending}
            icon={<Layers className="h-4 w-4 text-muted-foreground" />}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Searchable Selector ─────────────────────────────────────────────────────

interface SearchableItem {
  id: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectorProps {
  label: string;
  placeholder: string;
  items: SearchableItem[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}

function SearchableSelector({
  label,
  placeholder,
  items,
  onSelect,
  disabled = false,
  icon,
}: SearchableSelectorProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = items.filter((item) => {
    const q = query.toLowerCase();
    return (
      item.label.toLowerCase().includes(q) ||
      (item.sublabel?.toLowerCase().includes(q) ?? false)
    );
  });

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      setQuery('');
      setOpen(false);
    },
    [onSelect],
  );

  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Close dropdown if focus moves outside the container
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
    }
  }, []);

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">
        {label}
      </label>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          className="pl-8"
        />
      </div>
      {open && filtered.length > 0 && (
        <ul
          className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
          role="listbox"
        >
          {filtered.slice(0, 20).map((item) => (
            <li
              key={item.id}
              role="option"
              aria-selected={false}
              className={cn(
                "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer",
                "hover:bg-accent hover:text-accent-foreground"
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur before click fires
                handleSelect(item.id);
              }}
            >
              {icon}
              <span>{item.label}</span>
              {item.sublabel && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {item.sublabel}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && query && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-3 shadow-md">
          <p className="text-sm text-muted-foreground text-center">Sin resultados</p>
        </div>
      )}
    </div>
  );
}
