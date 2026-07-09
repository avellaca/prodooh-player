import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRotateContent } from "../hooks";

interface RotateMenuProps {
  contentId: string;
}

export function RotateMenu({ contentId }: RotateMenuProps) {
  const rotateContent = useRotateContent();

  function handleRotate(rotation: number) {
    rotateContent.mutate({ id: contentId, rotation });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={rotateContent.isPending}
        >
          <RotateCw className="h-4 w-4" />
          <span className="sr-only">Rotar</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleRotate(90)}>
          Rotar 90°
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleRotate(180)}>
          Rotar 180°
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleRotate(270)}>
          Rotar 270°
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
