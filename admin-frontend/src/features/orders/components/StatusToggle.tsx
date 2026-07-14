import { Loader2, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface StatusToggleProps {
  status: 'draft' | 'active' | 'paused' | 'finished';
  onToggle: (newStatus: 'active' | 'paused') => void;
  isLoading?: boolean;
}

/**
 * Quick-action toggle button for pausing/activating Orders and OrderLines.
 * Only renders an interactive button when status is 'active' or 'paused'.
 * The parent component handles the mutation and passes isLoading from mutation state.
 */
export function StatusToggle({ status, onToggle, isLoading = false }: StatusToggleProps) {
  // Only togglable between active and paused
  if (status !== 'active' && status !== 'paused') {
    return null;
  }

  const isActive = status === 'active';
  const nextStatus = isActive ? 'paused' : 'active';
  const label = isActive ? 'Pausar' : 'Activar';

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={isLoading}
      onClick={() => onToggle(nextStatus)}
      aria-label={label}
      className={cn(
        'h-8 w-8',
        isActive && 'text-amber-600 hover:text-amber-700 hover:bg-amber-50',
        !isActive && 'text-green-600 hover:text-green-700 hover:bg-green-50',
      )}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isActive ? (
        <Pause className="h-4 w-4" />
      ) : (
        <Play className="h-4 w-4" />
      )}
    </Button>
  );
}
