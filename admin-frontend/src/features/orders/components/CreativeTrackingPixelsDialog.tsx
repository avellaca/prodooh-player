import { Radio } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { TrackingPixelPanel } from './TrackingPixelPanel';

interface CreativeTrackingPixelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creativeId: string;
  creativeName?: string;
}

export function CreativeTrackingPixelsDialog({
  open,
  onOpenChange,
  creativeId,
  creativeName,
}: CreativeTrackingPixelsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5" />
            Tracking Pixels — {creativeName ?? 'Creativo'}
          </DialogTitle>
          <DialogDescription>
            Configura tracking pixels para este creativo individual.
          </DialogDescription>
        </DialogHeader>
        <TrackingPixelPanel
          trackableType="creatives"
          trackableId={creativeId}
          title="Pixels del creativo"
        />
      </DialogContent>
    </Dialog>
  );
}

interface CreativePixelButtonProps {
  creativeId: string;
  creativeName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Small button that triggers the CreativeTrackingPixelsDialog.
 * Render this alongside delete/edit buttons on creative cards.
 */
export function CreativePixelButton({
  creativeId,
  creativeName,
  open,
  onOpenChange,
}: CreativePixelButtonProps) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => onOpenChange(true)}
        title="Tracking Pixels"
      >
        <Radio className="h-3.5 w-3.5" />
      </Button>
      <CreativeTrackingPixelsDialog
        open={open}
        onOpenChange={onOpenChange}
        creativeId={creativeId}
        creativeName={creativeName}
      />
    </>
  );
}
