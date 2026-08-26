import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChartZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function ChartZoomControls({ onZoomIn, onZoomOut, onReset }: ChartZoomControlsProps) {
  return (
    <div className="group absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
      <div className="flex items-center gap-1 glass-strong rounded-lg p-1 border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <Button
          variant="ghost"
          size="sm"
          onClick={onZoomOut}
          className="h-8 w-8 p-0 hover:bg-electric-blue/20 hover:text-electric-blue transition-all"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="h-8 w-8 p-0 hover:bg-neon-purple/20 hover:text-neon-purple transition-all"
          title="Reset zoom"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onZoomIn}
          className="h-8 w-8 p-0 hover:bg-electric-blue/20 hover:text-electric-blue transition-all"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
