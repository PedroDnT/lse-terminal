import { cn } from "@/lib/utils";
import { AdvancedColorPicker } from "./AdvancedColorPicker";

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  showOpacity?: boolean;
  opacity?: number;
  onOpacityChange?: (value: number) => void;
}

export function ColorPicker({ 
  value, 
  onChange, 
  className,
  showOpacity = false,
  opacity = 100,
  onOpacityChange,
}: ColorPickerProps) {
  return (
    <AdvancedColorPicker
      value={value}
      onChange={onChange}
      showOpacity={showOpacity}
      opacity={opacity}
      onOpacityChange={onOpacityChange}
      className={className}
    />
  );
}
