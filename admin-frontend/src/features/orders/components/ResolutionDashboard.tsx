import { Monitor } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ResolutionGroup } from '../types';

export interface ResolutionDashboardProps {
  resolutions: ResolutionGroup[];
  onGroupClick: (group: ResolutionGroup) => void;
}

/** Palette of distinguishable colors for resolution bars */
const BAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-teal-500',
] as const;

/**
 * Dashboard panel showing global creative coverage and per-resolution distribution.
 *
 * Displays:
 * - A progress bar with total coverage: "Cobertura total: X/Y pantallas con creativo (Z%)"
 * - Horizontal bars by resolution with differentiated colors
 * - Click on a bar triggers onGroupClick for smooth-scroll behavior
 *
 * All derived values are computed directly in render (no useEffect).
 */
export function ResolutionDashboard({ resolutions, onGroupClick }: ResolutionDashboardProps) {
  // Global coverage: sum of screens with creative / total screens
  const totalScreens = resolutions.reduce((sum, g) => sum + g.screen_count, 0);
  const screensWithCreative = resolutions.reduce((sum, g) => sum + g.coverage.with_creative, 0);
  const coveragePercent = totalScreens > 0
    ? Math.round((screensWithCreative / totalScreens) * 1000) / 10
    : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Monitor className="h-5 w-5" />
          Distribución de Resoluciones
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Global coverage progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-muted-foreground">
              Cobertura total: {screensWithCreative}/{totalScreens} pantallas con creativo ({coveragePercent}%)
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                coveragePercent === 100 ? 'bg-green-500' : 'bg-blue-500',
              )}
              style={{ width: `${Math.min(coveragePercent, 100)}%` }}
              role="progressbar"
              aria-valuenow={coveragePercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Cobertura total: ${coveragePercent}%`}
            />
          </div>
        </div>

        {/* Distribution bars by resolution */}
        {totalScreens > 0 && (
          <div className="space-y-2">
            {resolutions.map((group, index) => {
              const percent = Math.round((group.screen_count / totalScreens) * 1000) / 10;
              const color = BAR_COLORS[index % BAR_COLORS.length];

              return (
                <button
                  key={`${group.resolution_width}x${group.resolution_height}`}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-accent"
                  onClick={() => onGroupClick(group)}
                  aria-label={`${group.resolution_width}×${group.resolution_height} — ${group.screen_count} pantallas (${percent}%)`}
                >
                  {/* Resolution label */}
                  <span className="w-28 shrink-0 text-sm font-medium">
                    {group.resolution_width}×{group.resolution_height}
                  </span>

                  {/* Horizontal bar */}
                  <div className="flex-1">
                    <div className="h-5 w-full overflow-hidden rounded bg-secondary">
                      <div
                        className={cn('h-full rounded transition-all duration-500', color)}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  {/* Stats */}
                  <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                    {group.screen_count} pant. ({percent}%)
                  </span>

                  {/* Coverage mini-indicator */}
                  <span
                    className={cn(
                      'w-14 shrink-0 text-right text-xs font-medium',
                      group.coverage.with_creative === group.coverage.total
                        ? 'text-green-600'
                        : 'text-amber-600',
                    )}
                  >
                    {group.coverage.with_creative}/{group.coverage.total}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {totalScreens === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay pantallas asignadas a esta línea de pedido.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
