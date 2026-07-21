import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { exceedsSlotDuration, DEFAULT_SLOT_DURATION_SECONDS } from '../utils/duration-validation';
import type { Content } from '@/types/models';

interface DurationWarningBadgeProps {
  content: Pick<Content, 'duration_seconds' | 'mime_type'> | undefined | null;
  /**
   * Slot duration in seconds for the target screen.
   * Resolved via hierarchy: screen → group → tenant → 10s default.
   */
  slotDurationSeconds?: number;
}

/**
 * Shows a warning badge on creative cards when a video's duration
 * exceeds the configured slot duration for the screen.
 *
 * Non-blocking — informational only.
 */
export function DurationWarningBadge({
  content,
  slotDurationSeconds = DEFAULT_SLOT_DURATION_SECONDS,
}: DurationWarningBadgeProps) {
  if (!content) return null;

  const exceeds = exceedsSlotDuration(content, slotDurationSeconds);
  if (!exceeds) return null;

  return (
    <Badge
      variant="outline"
      className="shrink-0 gap-1 text-xs border-amber-400 text-amber-600 bg-amber-50"
      title={`Video de ${content.duration_seconds}s excede el slot de ${slotDurationSeconds}s`}
    >
      <AlertTriangle className="h-3 w-3" />
      {content.duration_seconds}s &gt; {slotDurationSeconds}s
    </Badge>
  );
}
