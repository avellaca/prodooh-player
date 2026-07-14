import { CheckCircle2, AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";

interface CoverageIndicatorProps {
  coverage: { with_creative: number; total: number };
}

export function CoverageIndicator({ coverage }: CoverageIndicatorProps) {
  const isComplete = coverage.with_creative === coverage.total;

  if (isComplete) {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Completo
      </Badge>
    );
  }

  return (
    <Badge variant="warning" className="gap-1">
      <AlertTriangle className="h-3 w-3" />
      {coverage.with_creative} de {coverage.total} pantallas con creativo
    </Badge>
  );
}
