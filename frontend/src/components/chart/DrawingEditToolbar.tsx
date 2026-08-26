import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
// BoxSelect is this icon's name in the terminal's lucide version; upstream
// renamed it SquareDashed in a later release.
import { Trash2, GripVertical, Square, BoxSelect as SquareDashed, Activity, Plus, X, Type, Edit3 } from 'lucide-react';
import { Drawing } from './ChartDrawingOverlay';
import { AdvancedColorPicker } from './AdvancedColorPicker';

interface DrawingEditToolbarProps {
  drawing: Drawing;
  onUpdateDrawing: (id: string, updates: Partial<Drawing>) => void;
  onDeleteDrawing: (id: string) => void;
  onClose: () => void;
  // Viewport coords of the click that selected the drawing. The toolbar snaps next to this point on each new selection, clamped to the viewport. Without it the toolbar falls back to a stored or default position.
  anchorPosition?: { x: number; y: number } | null;
}

const LINE_STYLES = [
  { id: 'solid', label: 'Solid', dashArray: undefined },
  { id: 'dashed', label: 'Dashed', dashArray: '8,4' },
  { id: 'dotted', label: 'Dotted', dashArray: '2,4' },
];

const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

// Fixed position for the toolbar (can be customized)
const TOOLBAR_STORAGE_KEY = 'drawing-toolbar-position';
const DEFAULT_POSITION = { x: 100, y: 60 };
// Approximate toolbar footprint, used by clampToViewport so the bar stays fully visible. Real width varies by drawing type so we err on the wide side.
const TOOLBAR_W = 360;
const TOOLBAR_H = 44;
const VIEWPORT_MARGIN = 8;

const clampToViewport = (p: { x: number; y: number }) => {
  if (typeof window === 'undefined') return p;
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - TOOLBAR_W - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - TOOLBAR_H - VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(VIEWPORT_MARGIN, p.x), maxX),
    y: Math.min(Math.max(VIEWPORT_MARGIN, p.y), maxY),
  };
};

const getStoredPosition = () => {
  try {
    const stored = localStorage.getItem(TOOLBAR_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return clampToViewport(parsed);
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_POSITION;
};

export const DrawingEditToolbar = ({
  drawing,
  onUpdateDrawing,
  onDeleteDrawing,
  onClose,
  anchorPosition,
}: DrawingEditToolbarProps) => {
  const [strokeWidth, setStrokeWidth] = useState(drawing.strokeWidth || 2);
  const [colorOpacity, setColorOpacity] = useState(drawing.opacity ?? 100);
  const [fillOpacity, setFillOpacity] = useState(drawing.fillOpacity ?? 100);
  // Initial position: prefer the click anchor (offset slightly so the toolbar doesn't sit on top of the cursor), then fall back to the stored or default position. Always clamped to the viewport.
  const [position, setPosition] = useState(() => {
    if (anchorPosition) return clampToViewport({ x: anchorPosition.x + 16, y: anchorPosition.y + 16 });
    return getStoredPosition();
  });
  // Snap to the new click anchor whenever a different drawing gets selected, so the toolbar always appears next to the user's click rather than at a stale persisted position.
  useEffect(() => {
    if (anchorPosition) {
      setPosition(clampToViewport({ x: anchorPosition.x + 16, y: anchorPosition.y + 16 }));
    }
  }, [drawing.id]); // intentionally only on drawing change, not on anchorPosition itself
  const [isDragging, setIsDragging] = useState(false);
  const [textValue, setTextValue] = useState(drawing.text || '');
  const [isEditingText, setIsEditingText] = useState(false);
  const [fontSize, setFontSize] = useState(drawing.strokeWidth || 14);
  const textInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const currentColor = drawing.color || (drawing.type === 'long' || drawing.type === 'short' ? '#22c55e' : '#64748b');
  const currentStyle = drawing.lineStyle || 'solid';
  const currentFillColor = drawing.fillColor || (drawing.type === 'long' || drawing.type === 'short' ? '#ef4444' : null);
  const currentBorderColor = drawing.borderColor || null;
  const isRectangle = drawing.type === 'rectangle' || drawing.type === 'square' || drawing.type === 'circle' || drawing.type === 'oval' || drawing.type === 'triangle' || drawing.type === 'freeTriangle' || drawing.type === 'parallelogram' || drawing.type === 'octagon' || drawing.type === 'parallelChannel';
  const isLongShort = drawing.type === 'long' || drawing.type === 'short';
  const isFibonacci = drawing.type === 'fibonacci';
  const isText = drawing.type === 'text';
  // Drawings that carry an inline text label via drawing.text (rendered by ChartDrawingOverlay's renderInlineLabel). The toolbar exposes a font/size/bold/italic popover for these.
  const supportsInlineLabel = drawing.type === 'trend' || drawing.type === 'line' || drawing.type === 'rectangle';
  const labelFontSize = drawing.textFontSize ?? 13;
  const [fibLevels, setFibLevels] = useState<number[]>(drawing.fibLevels || DEFAULT_FIB_LEVELS);
  const [newFibLevel, setNewFibLevel] = useState('');

  // Focus text input when editing starts
  useEffect(() => {
    if (isEditingText && textInputRef.current) {
      textInputRef.current.focus();
      textInputRef.current.select();
    }
  }, [isEditingText]);

  // Update text value and font size when drawing changes
  useEffect(() => {
    setTextValue(drawing.text || '');
    setFontSize(drawing.strokeWidth || 14);
  }, [drawing.text, drawing.strokeWidth]);

  const handleTextChange = (value: string) => {
    setTextValue(value);
    onUpdateDrawing(drawing.id, { text: value });
  };



  // Handle opacity changes and save to drawing
  const handleColorOpacityChange = (value: number) => {
    setColorOpacity(value);
    onUpdateDrawing(drawing.id, { opacity: value });
  };

  const handleFillOpacityChange = (value: number) => {
    setFillOpacity(value);
    onUpdateDrawing(drawing.id, { fillOpacity: value });
  };

  // Save position to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(TOOLBAR_STORAGE_KEY, JSON.stringify(position));
    } catch {
      // ignore
    }
  }, [position]);

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    dragRef.current = {
      startX: clientX,
      startY: clientY,
      initialX: position.x,
      initialY: position.y,
    };
    setIsDragging(true);
  };

  // Handle drag move
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current) return;

      // Prevent page scrolling on touch devices
      if ('touches' in e) {
        e.preventDefault();
      }

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - dragRef.current.startX;
      const deltaY = clientY - dragRef.current.startY;

      setPosition(clampToViewport({
        x: dragRef.current.initialX + deltaX,
        y: dragRef.current.initialY + deltaY,
      }));
    };

    const handleEnd = () => {
      setIsDragging(false);
      dragRef.current = null;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    // Use passive: false to allow preventDefault on touch events
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging]);

  const handleColorChange = (color: string) => {
    onUpdateDrawing(drawing.id, { color });
  };

  const handleStrokeWidthChange = (value: number[]) => {
    const width = value[0];
    setStrokeWidth(width);
    onUpdateDrawing(drawing.id, { strokeWidth: width });
  };

  const handleStyleChange = (style: string) => {
    onUpdateDrawing(drawing.id, { lineStyle: style as 'solid' | 'dashed' | 'dotted' });
  };

  const handleFillChange = (fillColor: string | null) => {
    onUpdateDrawing(drawing.id, { fillColor: fillColor || undefined });
  };

  const handleBorderColorChange = (borderColor: string | null) => {
    onUpdateDrawing(drawing.id, { borderColor: borderColor || undefined });
  };

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[500] flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border shadow-xl backdrop-blur-xl bg-card"
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? 'grabbing' : 'default',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Drag Handle */}
      <div
        className="flex items-center justify-center h-7 w-5 cursor-grab active:cursor-grabbing hover:bg-muted rounded transition-colors"
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        title="Drag to move"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="w-px h-5 bg-border/40 mx-0.5" />

      {/* Color Picker - Hide for long/short since they have separate TP/SL color pickers */}
      {!isLongShort && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 hover:bg-muted"
              title="Color"
            >
              <div
                className="h-4 w-4 rounded-full border border-border"
                style={{ backgroundColor: currentColor }}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border-0 bg-transparent shadow-xl" side="bottom" align="start">
            <AdvancedColorPicker
              value={currentColor}
              onChange={handleColorChange}
              showOpacity={true}
              opacity={colorOpacity}
              onOpacityChange={handleColorOpacityChange}
            />
          </PopoverContent>
        </Popover>
      )}

      {/* Stroke Width - Hide for text drawings (they use font size instead) */}
      {!isText && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1 hover:bg-muted text-xs font-mono"
              title="Line Width"
            >
              <div
                className="w-4 rounded-full bg-current"
                // Cap visual preview at 6px so it doesn't overflow the button at high widths
                style={{ height: Math.min(Math.max(2, strokeWidth), 6) }}
              />
              <span className="text-muted-foreground">{strokeWidth}px</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-3" side="top" align="center">
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Width</span>
                <span>{strokeWidth}px</span>
              </div>
              <Slider
                value={[strokeWidth]}
                onValueChange={handleStrokeWidthChange}
                min={0}
                max={8}
                step={1}
                className="w-full"
              />
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Line Style - Hide for text drawings */}
      {!isText && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 hover:bg-muted"
              title="Line Style"
            >
              <svg width="16" height="16" viewBox="0 0 16 16">
                {currentStyle === 'solid' && (
                  <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" />
                )}
                {currentStyle === 'dashed' && (
                  <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeDasharray="4,2" />
                )}
                {currentStyle === 'dotted' && (
                  <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeDasharray="1,3" strokeLinecap="round" />
                )}
              </svg>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" side="top" align="center">
            <div className="flex flex-col gap-1">
              {LINE_STYLES.map((style) => (
                <Button
                  key={style.id}
                  variant="ghost"
                  size="sm"
                  className={`h-8 justify-start gap-2 ${currentStyle === style.id ? 'bg-primary/20' : ''}`}
                  onClick={() => handleStyleChange(style.id)}
                >
                  <svg width="32" height="8" viewBox="0 0 32 8">
                    <line
                      x1="0" y1="4" x2="32" y2="4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray={style.dashArray}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="text-xs">{style.label}</span>
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Fill Option - Only for rectangles */}
      {isRectangle && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 hover:bg-muted"
              title="Fill"
            >
              {currentFillColor ? (
                <Square className="h-4 w-4" style={{ fill: currentFillColor, color: currentColor }} />
              ) : (
                <SquareDashed className="h-4 w-4" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border-0 bg-transparent shadow-xl" side="bottom" align="center">
            <div className="p-2 rounded-lg bg-card border border-border">
              <div className="text-[11px] text-muted-foreground mb-2">Fill Color</div>
              <button
                className={`h-6 w-full rounded border flex items-center justify-center transition-transform hover:scale-[1.02] mb-2 ${!currentFillColor ? 'border-primary bg-primary/10' : 'border-border hover:border-muted-foreground'
                  }`}
                style={{ backgroundColor: !currentFillColor ? undefined : 'transparent' }}
                onClick={() => handleFillChange(null)}
                title="No fill"
              >
                <span className="text-[11px] text-muted-foreground">No Fill</span>
              </button>
              <AdvancedColorPicker
                value={currentFillColor || currentColor}
                onChange={handleFillChange}
                showOpacity={true}
                opacity={fillOpacity}
                onOpacityChange={handleFillOpacityChange}
                className="border-0 p-0"
              />
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Long/Short Position Colors - Profit (top) and Loss (bottom) zones */}
      {isLongShort && (
        <>
          {/* Profit Zone Color (uses color property) */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1 hover:bg-muted"
                title="Profit Zone Color"
              >
                <div
                  className="h-4 w-4 rounded border border-border"
                  style={{ backgroundColor: currentColor }}
                />
                <span className="text-[10px] text-muted-foreground">TP</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 border-0 bg-transparent shadow-xl" side="bottom" align="center">
              <div className="p-2 rounded-lg bg-card border border-border">
                <div className="text-[11px] text-muted-foreground mb-2">Take Profit Color</div>
                <AdvancedColorPicker
                  value={currentColor}
                  onChange={handleColorChange}
                  showOpacity={true}
                  opacity={colorOpacity}
                  onOpacityChange={handleColorOpacityChange}
                  className="border-0 p-0"
                />
              </div>
            </PopoverContent>
          </Popover>

          {/* Loss Zone Color (uses fillColor property) */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1 hover:bg-muted"
                title="Stop Loss Zone Color"
              >
                <div
                  className="h-4 w-4 rounded border border-border"
                  style={{ backgroundColor: currentFillColor || '#ef4444' }}
                />
                <span className="text-[10px] text-muted-foreground">SL</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 border-0 bg-transparent shadow-xl" side="bottom" align="center">
              <div className="p-2 rounded-lg bg-card border border-border">
                <div className="text-[11px] text-muted-foreground mb-2">Stop Loss Color</div>
                <AdvancedColorPicker
                  value={currentFillColor || '#ef4444'}
                  onChange={handleFillChange}
                  showOpacity={true}
                  opacity={fillOpacity}
                  onOpacityChange={handleFillOpacityChange}
                  className="border-0 p-0"
                />
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}

      {/* Fibonacci Levels Editor */}
      {isFibonacci && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1 hover:bg-muted"
              title="Edit Fibonacci Levels"
            >
              <Activity className="h-3.5 w-3.5" />
              <span className="text-[10px] text-muted-foreground">Levels</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" side="top" align="center">
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground">Fibonacci Levels</div>

              {/* Current levels */}
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {fibLevels.sort((a, b) => a - b).map((level, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.001"
                      value={level}
                      onChange={(e) => {
                        const newValue = parseFloat(e.target.value);
                        if (!isNaN(newValue)) {
                          const newLevels = [...fibLevels];
                          newLevels[idx] = newValue;
                          setFibLevels(newLevels);
                          onUpdateDrawing(drawing.id, { fibLevels: newLevels });
                        }
                      }}
                      className="h-7 text-xs font-mono"
                    />
                    <span className="text-xs text-muted-foreground w-12">
                      {(level * 100).toFixed(1)}%
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        const newLevels = fibLevels.filter((_, i) => i !== idx);
                        setFibLevels(newLevels);
                        onUpdateDrawing(drawing.id, { fibLevels: newLevels });
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Add new level */}
              <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                <Input
                  type="number"
                  step="0.001"
                  placeholder="0.5"
                  value={newFibLevel}
                  onChange={(e) => setNewFibLevel(e.target.value)}
                  className="h-7 text-xs font-mono flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => {
                    const value = parseFloat(newFibLevel);
                    if (!isNaN(value) && !fibLevels.includes(value)) {
                      const newLevels = [...fibLevels, value].sort((a, b) => a - b);
                      setFibLevels(newLevels);
                      onUpdateDrawing(drawing.id, { fibLevels: newLevels });
                      setNewFibLevel('');
                    }
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>

              {/* Reset to defaults */}
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs text-muted-foreground"
                onClick={() => {
                  setFibLevels(DEFAULT_FIB_LEVELS);
                  onUpdateDrawing(drawing.id, { fibLevels: DEFAULT_FIB_LEVELS });
                }}
              >
                Reset to Defaults
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Inline label controls for line/trend/rectangle drawings. Edits drawing.text plus the textFontSize/textBold/textItalic fields used by ChartDrawingOverlay.renderInlineLabel. */}
      {supportsInlineLabel && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1 hover:bg-muted"
              title="Text label"
            >
              <Type className="h-3.5 w-3.5" />
              <span className="text-[10px] text-muted-foreground">{labelFontSize}px</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3 space-y-3" side="top" align="center">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Label</div>
              <Input
                value={textValue}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder="Add text..."
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Font size</span>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={8}
                    max={64}
                    value={labelFontSize}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v) && v >= 8 && v <= 64) onUpdateDrawing(drawing.id, { textFontSize: v });
                    }}
                    className="h-6 w-14 text-xs text-center font-mono px-1"
                  />
                  <span className="text-xs text-muted-foreground">px</span>
                </div>
              </div>
              <Slider
                value={[labelFontSize]}
                onValueChange={(v) => onUpdateDrawing(drawing.id, { textFontSize: v[0] })}
                min={8}
                max={64}
                step={1}
                className="w-full"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 w-7 p-0 font-bold ${drawing.textBold ? 'bg-muted' : ''}`}
                onClick={() => onUpdateDrawing(drawing.id, { textBold: !drawing.textBold })}
                title="Bold"
              >
                B
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 w-7 p-0 italic ${drawing.textItalic ? 'bg-muted' : ''}`}
                onClick={() => onUpdateDrawing(drawing.id, { textItalic: !drawing.textItalic })}
                title="Italic"
              >
                I
              </Button>
              {/* Text color: nested Popover so the color swatch sits inside the inline-label popover. Defaults to the drawing's stroke color when textColor is unset. */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 gap-1.5 hover:bg-muted"
                    title="Text color"
                  >
                    <span
                      className="inline-block h-4 w-4 rounded-full border border-border"
                      style={{ backgroundColor: drawing.textColor || currentColor }}
                    />
                    <span className="text-[10px] text-muted-foreground">Color</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 border-0 bg-transparent shadow-xl" side="top" align="start">
                  <AdvancedColorPicker
                    value={drawing.textColor || currentColor}
                    onChange={(c) => onUpdateDrawing(drawing.id, { textColor: c })}
                  />
                </PopoverContent>
              </Popover>
              {drawing.textColor && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-[10px] text-muted-foreground hover:bg-muted"
                  onClick={() => onUpdateDrawing(drawing.id, { textColor: undefined })}
                  title="Match line color"
                >
                  Reset
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Text Drawing Controls */}
      {isText && (
        <>
          {/* Text Content Editor */}
          <Popover open={isEditingText} onOpenChange={setIsEditingText}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1 hover:bg-muted"
                title="Edit Text"
              >
                <Edit3 className="h-3.5 w-3.5" />
                <span className="text-[10px] text-muted-foreground max-w-16 truncate">
                  {textValue || 'Edit'}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" side="top" align="center">
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Text Content</div>
                <Input
                  ref={textInputRef}
                  value={textValue}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setIsEditingText(false);
                    }
                  }}
                  placeholder="Enter text..."
                  className="h-8 text-sm"
                />
              </div>
            </PopoverContent>
          </Popover>

          {/* Font Size Selector - Slider + Input */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1 hover:bg-muted"
                title="Font Size"
              >
                <Type className="h-3.5 w-3.5" />
                <span className="text-[10px] text-muted-foreground">{fontSize}px</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-3" side="top" align="center">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Font Size</span>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={32}
                      value={fontSize}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val >= 1 && val <= 32) {
                          setFontSize(val);
                          onUpdateDrawing(drawing.id, { strokeWidth: val });
                        }
                      }}
                      className="h-6 w-12 text-xs text-center font-mono px-1"
                    />
                    <span className="text-xs text-muted-foreground">px</span>
                  </div>
                </div>
                <Slider
                  value={[fontSize]}
                  onValueChange={(val) => {
                    setFontSize(val[0]);
                    onUpdateDrawing(drawing.id, { strokeWidth: val[0] });
                  }}
                  min={1}
                  max={32}
                  step={1}
                  className="w-full"
                />
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}

      <div className="w-px h-5 bg-border/40 mx-0.5" />

      {/* Delete Button */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        title="Delete Drawing"
        onClick={() => {
          onDeleteDrawing(drawing.id);
          onClose();
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};

export default DrawingEditToolbar;
