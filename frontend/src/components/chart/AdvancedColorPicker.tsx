import { useState } from 'react';
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";

interface AdvancedColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  opacity?: number;
  onOpacityChange?: (value: number) => void;
  showOpacity?: boolean;
  className?: string;
}

// TradingView-style color palette (8 columns, organized by brightness and hue)
const COLOR_PALETTE = [
  // Row 1: Grayscale
  ['#000000', '#434651', '#5d606b', '#787b86', '#9598a1', '#b2b5be', '#d1d4dc', '#ffffff'],
  // Row 2: Reds (dark to light)
  ['#f23645', '#ff5252', '#ff5a5a', '#ff7070', '#ff8787', '#ffa0a0', '#ffb7b7', '#ffd5d5'],
  // Row 3: Oranges
  ['#ff9800', '#ff9100', '#ffab00', '#ffb74d', '#ffc107', '#ffd54f', '#ffe082', '#fff3e0'],
  // Row 4: Yellows
  ['#ffeb3b', '#ffee58', '#fff176', '#fff59d', '#fff9c4', '#fffde7', '#f5f5dc', '#f9fbe7'],
  // Row 5: Greens
  ['#089981', '#4caf50', '#00c853', '#69f0ae', '#81c784', '#a5d6a7', '#c8e6c9', '#e8f5e9'],
  // Row 6: Teals
  ['#00bcd4', '#26c6da', '#4dd0e1', '#80deea', '#b2ebf2', '#e0f7fa', '#84ffff', '#a7ffeb'],
  // Row 7: Blues
  ['#2962ff', '#2196f3', '#42a5f5', '#64b5f6', '#90caf9', '#bbdefb', '#e3f2fd', '#e8eaf6'],
  // Row 8: Purples
  ['#673ab7', '#7c4dff', '#9c27b0', '#ba68c8', '#ce93d8', '#e1bee7', '#f3e5f5', '#ede7f6'],
  // Row 9: Pinks  
  ['#e91e63', '#f06292', '#f48fb1', '#f8bbd9', '#fce4ec', '#ff80ab', '#ff4081', '#f50057'],
  // Row 10: Browns
  ['#795548', '#8d6e63', '#a1887f', '#bcaaa4', '#d7ccc8', '#efebe9', '#6d4c41', '#5d4037'],
];

export function AdvancedColorPicker({
  value,
  onChange,
  opacity = 100,
  onOpacityChange,
  showOpacity = true,
  className
}: AdvancedColorPickerProps) {
  const currentColor = value.toLowerCase();

  const handleOpacityChange = (values: number[]) => {
    onOpacityChange?.(values[0]);
  };

  return (
    <div className={cn("p-2 rounded-lg bg-card border border-border w-fit", className)}>
      {/* Color Grid - compact 8x10 */}
      <div className="grid gap-[2px]">
        {COLOR_PALETTE.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-[2px]">
            {row.map((color) => (
              <button
                key={color}
                className={cn(
                  "w-[18px] h-[18px] rounded-[3px] border transition-all flex-shrink-0",
                  currentColor === color.toLowerCase()
                    ? "border-primary ring-1 ring-primary scale-105 z-10"
                    : "border-transparent hover:border-muted-foreground/40 hover:scale-105"
                )}
                style={{ backgroundColor: color }}
                onClick={() => onChange(color)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Opacity Slider - TradingView style */}
      {showOpacity && onOpacityChange && (
        <div className="mt-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Opacity</span>
            <div className="flex-1 relative h-5 flex items-center">
              {/* Custom gradient track */}
              <div
                className="absolute inset-x-0 h-2 rounded-full overflow-hidden"
                style={{
                  background: `linear-gradient(to right, transparent, ${value})`,
                }}
              />
              {/* Checkered background under gradient */}
              <div
                className="absolute inset-x-0 h-2 rounded-full -z-10"
                style={{
                  backgroundImage: `
                    linear-gradient(45deg, var(--border) 25%, transparent 25%),
                    linear-gradient(-45deg, var(--border) 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, var(--border) 75%),
                    linear-gradient(-45deg, transparent 75%, var(--border) 75%)
                  `,
                  backgroundSize: '6px 6px',
                  backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px',
                  backgroundColor: 'var(--card)',
                }}
              />
              <Slider
                value={[opacity]}
                onValueChange={handleOpacityChange}
                min={0}
                max={100}
                step={1}
                className="w-full"
              />
            </div>
            <span className="text-[11px] text-muted-foreground w-9 text-right font-mono">{opacity}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact version for inline use (same component, just without opacity)
export function CompactColorPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <AdvancedColorPicker
      value={value}
      onChange={onChange}
      showOpacity={false}
      className={className}
    />
  );
}
