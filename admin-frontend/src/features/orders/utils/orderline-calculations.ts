/**
 * Funciones puras de cálculo para OrderLine.
 * Se usan en render y en submit — nunca dentro de useEffect.
 */

/**
 * Deriva starts_at y ends_at del array de fechas activas.
 * Retorna { starts_at, ends_at } o null si el array está vacío.
 */
export function deriveDateRange(activeDates: string[]): { starts_at: string; ends_at: string } | null {
  if (activeDates.length === 0) return null;
  const sorted = [...activeDates].sort();
  return {
    starts_at: sorted[0],
    ends_at: sorted[sorted.length - 1],
  };
}

/**
 * Calcula el total de spots según el modo seleccionado.
 */
export function calculateTotalSpots(
  mode: 'spots_por_dia' | 'spots_por_linea',
  inputValue: number,
  activeDatesCount: number
): number {
  if (mode === 'spots_por_dia') {
    return inputValue * activeDatesCount;
  }
  return inputValue;
}

/**
 * Suma target_spots de un array de order lines, tratando null como 0.
 */
export function sumOrderLineSpots(orderLines: Array<{ target_spots: number | null }>): number {
  return orderLines.reduce((sum, line) => sum + (line.target_spots ?? 0), 0);
}
