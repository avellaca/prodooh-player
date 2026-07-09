import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface TokenRevealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  title?: string;
}

export function TokenRevealDialog({
  open,
  onOpenChange,
  token,
  title = "Token de dispositivo",
}: TokenRevealDialogProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      toast.success("Token copiado al portapapeles");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Este token solo se muestra una vez y no podrá recuperarse. Cópialo
            ahora y guárdalo en un lugar seguro.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-muted p-4 font-mono text-sm break-all">
          {token}
        </div>
        <DialogFooter>
          <Button onClick={handleCopy} className="gap-2">
            {copied ? (
              <>
                <Check className="h-4 w-4" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copiar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
