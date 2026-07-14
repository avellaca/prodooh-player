import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ActiveDatesPickerProps {
  value: string[]; // ISO date strings YYYY-MM-DD
  onChange: (dates: string[]) => void;
  minDate?: string;
  maxDate?: string;
  disabled?: boolean;
}

type SelectionMode = "range" | "multi-range" | "individual";

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

/** Generate all dates between start and end (inclusive) */
function getDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const startDate = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  const current = new Date(startDate);
  while (current <= endDate) {
    dates.push(toISODate(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const DAY_HEADERS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const MODE_LABELS: Record<SelectionMode, string> = {
  range: "Rango",
  "multi-range": "Multi-rango",
  individual: "Días individuales",
};

export function ActiveDatesPicker({
  value,
  onChange,
  minDate,
  maxDate,
  disabled = false,
}: ActiveDatesPickerProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [mode, setMode] = useState<SelectionMode>("range");

  // For range/multi-range: track the start of current range being selected
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDayOffset = getFirstDayOfWeek(viewYear, viewMonth);

  const isDateDisabled = useCallback(
    (dateStr: string) => {
      if (minDate && dateStr < minDate) return true;
      if (maxDate && dateStr > maxDate) return true;
      return false;
    },
    [minDate, maxDate]
  );

  // Compute preview range for visual feedback while selecting
  const previewDates = useMemo(() => {
    if (!rangeStart || !hoveredDate) return new Set<string>();
    const start = rangeStart < hoveredDate ? rangeStart : hoveredDate;
    const end = rangeStart < hoveredDate ? hoveredDate : rangeStart;
    return new Set(getDateRange(start, end));
  }, [rangeStart, hoveredDate]);

  const handleDayClick = useCallback(
    (dateStr: string) => {
      if (disabled || isDateDisabled(dateStr)) return;

      if (mode === "individual") {
        // Toggle individual day
        if (selectedSet.has(dateStr)) {
          onChange(value.filter((d) => d !== dateStr));
        } else {
          onChange([...value, dateStr].sort());
        }
      } else if (mode === "range") {
        // Single range: first click = start, second click = complete range
        if (!rangeStart) {
          setRangeStart(dateStr);
        } else {
          const start = rangeStart < dateStr ? rangeStart : dateStr;
          const end = rangeStart < dateStr ? dateStr : rangeStart;
          const rangeDates = getDateRange(start, end).filter(
            (d) => !isDateDisabled(d)
          );
          onChange(rangeDates);
          setRangeStart(null);
        }
      } else if (mode === "multi-range") {
        // Multi-range: first click = start, second click = add range to existing
        if (!rangeStart) {
          setRangeStart(dateStr);
        } else {
          const start = rangeStart < dateStr ? rangeStart : dateStr;
          const end = rangeStart < dateStr ? dateStr : rangeStart;
          const rangeDates = getDateRange(start, end).filter(
            (d) => !isDateDisabled(d)
          );
          const merged = new Set([...value, ...rangeDates]);
          onChange(Array.from(merged).sort());
          setRangeStart(null);
        }
      }
    },
    [disabled, isDateDisabled, mode, rangeStart, selectedSet, value, onChange]
  );

  const handlePrevMonth = useCallback(() => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }, [viewMonth]);

  const handleNextMonth = useCallback(() => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }, [viewMonth]);

  function handleModeChange(newMode: SelectionMode) {
    setMode(newMode);
    setRangeStart(null);
    setHoveredDate(null);
  }

  function handleClearAll() {
    onChange([]);
    setRangeStart(null);
  }

  // Build the grid cells
  const cells: Array<{ day: number; dateStr: string } | null> = [];
  for (let i = 0; i < firstDayOffset; i++) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toISODate(new Date(viewYear, viewMonth, day));
    cells.push({ day, dateStr });
  }

  return (
    <div className="space-y-3">
      {/* Mode selector */}
      <div className="flex gap-1 rounded-lg border p-1">
        {(Object.keys(MODE_LABELS) as SelectionMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => handleModeChange(m)}
            disabled={disabled}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              mode === m
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Header with month navigation */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handlePrevMonth}
          disabled={disabled}
          aria-label="Mes anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleNextMonth}
          disabled={disabled}
          aria-label="Mes siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1">
        {DAY_HEADERS.map((header) => (
          <div
            key={header}
            className="text-center text-xs font-medium text-muted-foreground py-1"
          >
            {header}
          </div>
        ))}
      </div>

      {/* Allowed range indicator */}
      {minDate && maxDate && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md px-2 py-1 bg-muted/30">
          <span className="inline-block h-2 w-2 rounded-full bg-primary/30" />
          <span>Rango permitido: {minDate} — {maxDate}</span>
        </div>
      )}

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, idx) => {
          if (!cell) {
            return <div key={`empty-${idx}`} />;
          }

          const isSelected = selectedSet.has(cell.dateStr);
          const isDayDisabled = isDateDisabled(cell.dateStr);
          const isPreview = previewDates.has(cell.dateStr);
          const isRangeStartDay = cell.dateStr === rangeStart;
          const isInAllowedRange =
            (!minDate || cell.dateStr >= minDate) &&
            (!maxDate || cell.dateStr <= maxDate);
          const isBoundaryDay =
            cell.dateStr === minDate || cell.dateStr === maxDate;

          return (
            <button
              key={cell.dateStr}
              type="button"
              disabled={disabled || isDayDisabled}
              onClick={() => handleDayClick(cell.dateStr)}
              onMouseEnter={() => {
                if (rangeStart && (mode === "range" || mode === "multi-range")) {
                  setHoveredDate(cell.dateStr);
                }
              }}
              className={cn(
                "h-8 w-full rounded text-sm transition-colors",
                !isDayDisabled && !disabled &&
                  "hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isInAllowedRange &&
                  !isSelected &&
                  !isPreview &&
                  "bg-muted/40",
                isBoundaryDay &&
                  !isSelected &&
                  "ring-1 ring-primary/40",
                isSelected &&
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                !isSelected && isPreview &&
                  "bg-primary/20 text-primary",
                isRangeStartDay &&
                  "ring-2 ring-primary ring-offset-1",
                isDayDisabled && "opacity-30 cursor-not-allowed line-through text-muted-foreground",
                disabled && "cursor-not-allowed opacity-50"
              )}
              aria-label={`${cell.day} de ${MONTH_NAMES[viewMonth]}`}
              aria-pressed={isSelected}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {value.length > 0
            ? `${value.length} ${value.length === 1 ? "día seleccionado" : "días seleccionados"}`
            : mode === "individual"
            ? "Clic en días individuales"
            : rangeStart
            ? "Selecciona el fin del rango"
            : "Selecciona el inicio del rango"}
        </p>
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={handleClearAll}
            disabled={disabled}
          >
            Limpiar
          </Button>
        )}
      </div>
    </div>
  );
}
