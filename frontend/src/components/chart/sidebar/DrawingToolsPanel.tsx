// ============================================================================
// DrawingToolsPanel.tsx - Drawing tool selection section with flyout menus
// Contains all the drawing tool icon buttons (trend, line, fib, shape, brush,
// text, position, lock/hide, measure, trash) with their popover sub-menus.
// Each tool group has a primary button (last-selected tool) and a chevron
// that opens the full submenu. Favorites are star-toggled per tool.
// Extracted from ChartLeftSidebar to isolate the ~900 lines of drawing UI.
// ============================================================================

import { useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Star, Plus, X, Minus, Type, Square, RectangleHorizontal, Paintbrush,
  ArrowUpCircle, ArrowDownCircle, Trash2, Lock, Unlock, Eye, EyeOff, Ruler, Keyboard,
  ChevronRight, ArrowRight, MoveVertical, Circle, Triangle, RotateCw,
  Octagon, Diamond, Pentagon, Hexagon, Heart, ArrowBigRight, Highlighter,
  MousePointer2, DollarSign, Settings, Bell
} from "lucide-react";
import { UnifiedLayoutButton, type LayoutType } from "@/components/chart/MultiTimeframeLayoutSelector";
import { DrawingTool, Drawing } from "@/components/chart/ChartDrawingOverlay";
import { LongPositionIcon, ShortPositionIcon } from "@/components/chart/DrawingToolIcons";
import { getDrawingFavorites, toggleDrawingFavorite } from "@/components/chart/FavoritesDrawingToolbar";
import LoginModal from "@/components/auth/LoginModal";

interface DrawingToolsPanelProps {
  activeTool?: DrawingTool;
  onToolSelect?: (tool: DrawingTool) => void;
  drawings?: Drawing[];
  onClearAllDrawings?: () => void;
  selectedDrawingId?: string | null;
  onDeleteSelectedDrawing?: (id: string) => void;
  drawingsLocked?: boolean;
  onToggleLock?: () => void;
  drawingsHidden?: boolean;
  onToggleHide?: () => void;
  indicatorCount?: number;
  onClearIndicators?: () => void;
  // Drawing shortcuts dialog opener (moved here so it sits above the trash icon)
  onOpenShortcutsDialog?: () => void;
  // Bottom panel toggle for paper trading
  mobileTradingOpen?: boolean;
  onToggleMobileTrading?: () => void;
  bottomPanelHidden?: boolean;
  onToggleBottomPanel?: () => void;
  // Phone-only: layout + settings buttons rendered above the trash icon
  // (on tablet/desktop these live elsewhere, so all of these are optional).
  onOpenSettings?: (tab?: string) => void;
  multiTimeframeLayout?: LayoutType;
  onLayoutChange?: (layout: string) => void;
  syncSettings?: any;
  onSyncSettingsChange?: (s: any) => void;
  layoutSymbol?: string;
  layoutTimeframe?: string;
  layoutDrawings?: any[];
  layoutIndicators?: any;
  onLoadLayout?: (layout: any) => void;
  onOpenSaveDialog?: () => void;
  // Phone-only: calendar + bell rendered between folder (layout) and settings.
  // Tablet/desktop keep these in their original spots (top of sidebar / RightToolbar).
  onToggleCalendar?: () => void;
  calendarPanelActive?: boolean;
  onShowAlertDialog?: () => void;
  alertCount?: number;
}

// Helper: renders a single tool button in a popover menu with star-favorite toggle
function ToolMenuItem({
  toolId,
  label,
  icon,
  isActive,
  drawingFavorites,
  onSelect,
  onToggleFavorite,
}: {
  toolId: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  drawingFavorites: string[];
  onSelect: () => void;
  onToggleFavorite: (id: string) => void;
}) {
  {/* Compact menu item matching TradingView's tight, clean style:
      h-8 + px-3 for dense rows, gap-2.5 for icon-to-label spacing,
      text-[13px] for the slightly smaller label font */}
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`w-full group justify-start gap-2.5 h-8 px-3 rounded-none text-popover-foreground hover:bg-muted hover:text-foreground ${isActive ? 'active-tool bg-foreground/10 text-foreground' : ''}`}
      onPointerDown={(e) => { e.preventDefault(); onSelect(); }}
      onClick={onSelect}
    >
      {icon}
      <span className="text-[13px] font-normal flex-1 text-left">{label}</span>
      <button
        className={`ml-auto p-0.5 rounded transition-all ${drawingFavorites.includes(toolId) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(toolId); }}
        title={drawingFavorites.includes(toolId) ? 'Remove from Favorites' : 'Add to Favorites'}
      >
        <Star className={`h-3 w-3 ${drawingFavorites.includes(toolId) ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground hover:text-yellow-500'}`} />
      </button>
    </Button>
  );
}

export default function DrawingToolsPanel({
  activeTool,
  onToolSelect,
  drawings = [],
  onClearAllDrawings,
  selectedDrawingId,
  onDeleteSelectedDrawing,
  drawingsLocked = false,
  onToggleLock,
  drawingsHidden = false,
  onToggleHide,
  indicatorCount = 0,
  onClearIndicators,
  onOpenShortcutsDialog,
  mobileTradingOpen,
  onToggleMobileTrading,
  bottomPanelHidden = false,
  onToggleBottomPanel,
  onOpenSettings,
  multiTimeframeLayout,
  onLayoutChange,
  syncSettings,
  onSyncSettingsChange,
  layoutSymbol,
  layoutTimeframe,
  layoutDrawings,
  layoutIndicators,
  onLoadLayout,
  onOpenSaveDialog,
  onToggleCalendar,
  calendarPanelActive = false,
  onShowAlertDialog,
  alertCount = 0,
}: DrawingToolsPanelProps) {
  const { user } = useAuth();
  const [showLoginForFavorites, setShowLoginForFavorites] = useState(false);
  const [drawingFavorites, setDrawingFavorites] = useState<string[]>(getDrawingFavorites);
  // Track which sub-tool is selected for each group's primary button display
  const [selectedTrendTool, setSelectedTrendTool] = useState<'trend' | 'trendRay' | 'parallelChannel' | 'straightArrow'>('trend');
  const [selectedLineTool, setSelectedLineTool] = useState<'horizontal' | 'horizontalRay' | 'vertical' | 'line'>('horizontal');
  const [selectedFibTool, setSelectedFibTool] = useState<'fibonacci' | 'fibExtension'>('fibonacci');
  const [selectedShapeTool, setSelectedShapeTool] = useState<'rectangle' | 'square' | 'circle' | 'oval' | 'triangle' | 'freeTriangle' | 'parallelogram' | 'octagon' | 'diamond' | 'pentagon' | 'hexagon' | 'star' | 'cross' | 'arrowBlock' | 'wedge' | 'heart'>('rectangle');
  const [selectedBrushTool, setSelectedBrushTool] = useState<'brush' | 'highlighter' | 'arrow'>('brush');
  // Popover open states
  const [trendToolMenuOpen, setTrendToolMenuOpen] = useState(false);
  const [lineToolMenuOpen, setLineToolMenuOpen] = useState(false);
  const [fibToolMenuOpen, setFibToolMenuOpen] = useState(false);
  const [shapeToolMenuOpen, setShapeToolMenuOpen] = useState(false);
  const [brushToolMenuOpen, setBrushToolMenuOpen] = useState(false);

  // Auth-gated favorite toggle: show login modal if not signed in
  const handleToggleFavorite = useCallback((toolId: string) => {
    if (!user) { setShowLoginForFavorites(true); return; }
    setDrawingFavorites(toggleDrawingFavorite(toolId));
  }, [user]);

  if (!onToolSelect) return null;

  // Popover menu wrapper used by every tool group
  const renderToolGroup = (
    menuOpen: boolean,
    setMenuOpen: (open: boolean) => void,
    selectedTool: string,
    toolOptions: string[],
    primaryIcon: React.ReactNode,
    menuContent: React.ReactNode,
  ) => (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <div className="relative">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`relative h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all ${
                  toolOptions.includes(activeTool as string)
                    ? 'text-foreground before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-foreground before:rounded-r'
                    : 'text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground'
                }`}
                onClick={() => {
                  if (activeTool === selectedTool) { onToolSelect(null); }
                  else { onToolSelect(selectedTool as DrawingTool); }
                }}
              >
                {primaryIcon}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs lg:text-sm">{selectedTool}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <PopoverTrigger asChild>
          <button
            className="absolute -right-1 top-1/2 -translate-y-1/2 w-5 h-10 flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground transition-colors"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </PopoverTrigger>
      </div>
      {/* w-auto lets the menu hug its content instead of being a fixed 288px;
          min-w-[180px] prevents it from collapsing too small on short labels */}
      <PopoverContent side="right" align="start" className="drawing-tool-menu w-auto min-w-[180px] p-0 bg-card border border-border shadow-xl rounded-lg z-50 overflow-hidden" sideOffset={8}>
        {menuContent}
      </PopoverContent>
    </Popover>
  );

  // Icon lookup for trend tools
  const trendIcons: Record<string, React.ReactNode> = {
    trend: <svg className="h-5 w-5 lg:h-[38px] lg:w-[38px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="20" x2="20" y2="4" /><circle cx="4" cy="20" r="1.5" fill="currentColor" /><circle cx="20" cy="4" r="1.5" fill="currentColor" /></svg>,
    trendRay: <svg className="h-5 w-5 lg:h-[38px] lg:w-[38px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="12" r="1.5" fill="currentColor" /><line x1="5.5" y1="12" x2="20" y2="4" /></svg>,
    parallelChannel: <svg className="h-5 w-5 lg:h-[38px] lg:w-[38px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="18" x2="22" y2="10" /><line x1="2" y1="10" x2="22" y2="2" /></svg>,
    straightArrow: <ArrowRight className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
  };
  const lineIcons: Record<string, React.ReactNode> = {
    horizontal: <Minus className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    horizontalRay: <svg className="h-5 w-5 lg:h-[38px] lg:w-[38px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="12" r="1.5" fill="currentColor" /><line x1="5.5" y1="12" x2="20" y2="12" /><polyline points="17,9 20,12 17,15" /></svg>,
    vertical: <MoveVertical className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    line: <svg className="h-5 w-5 lg:h-[38px] lg:w-[38px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="20" x2="20" y2="4" /></svg>,
  };
  const shapeIcons: Record<string, React.ReactNode> = {
    rectangle: <RectangleHorizontal className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    square: <Square className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    circle: <Circle className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    oval: <Circle className="h-5 w-5 lg:h-[38px] lg:w-[38px]" style={{ transform: 'scaleX(1.3)' }} />,
    triangle: <Triangle className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    freeTriangle: <Triangle className="h-5 w-5 lg:h-[38px] lg:w-[38px]" style={{ opacity: 0.7 }} />,
    parallelogram: <svg className="h-5 w-5 lg:h-[38px] lg:w-[38px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6,4 22,4 18,20 2,20" /></svg>,
    octagon: <Octagon className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    diamond: <Diamond className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    pentagon: <Pentagon className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    hexagon: <Hexagon className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    star: <Star className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    cross: <Plus className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    arrowBlock: <ArrowBigRight className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    wedge: <Triangle className="h-5 w-5 lg:h-[38px] lg:w-[38px]" style={{ transform: 'rotate(-90deg)' }} />,
    heart: <Heart className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
  };
  const brushIcons: Record<string, React.ReactNode> = {
    brush: <Paintbrush className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    highlighter: <Highlighter className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
    arrow: <MousePointer2 className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />,
  };

  // Helper to create a tool menu item and update selected tool
  const makeSelectHandler = (setSelected: (t: any) => void, setOpen: (o: boolean) => void, tool: string) => () => {
    setSelected(tool);
    onToolSelect(tool as DrawingTool);
    setOpen(false);
  };

  return (
    <>
      <div className="flex flex-col gap-0">
        {/* Trend Lines Group */}
        {renderToolGroup(
          trendToolMenuOpen, setTrendToolMenuOpen, selectedTrendTool,
          ['trend', 'trendRay', 'parallelChannel', 'straightArrow'],
          trendIcons[selectedTrendTool],
          <div className="flex flex-col gap-px py-1">
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Trend Lines</div>
            {[
              { id: 'trend', label: 'Trend Line' },
              { id: 'trendRay', label: 'Trend Line Ray' },
              { id: 'parallelChannel', label: 'Parallel Channel' },
              { id: 'straightArrow', label: 'Arrow' },
            ].map(t => (
              <ToolMenuItem key={t.id} toolId={t.id} label={t.label} icon={trendIcons[t.id]} isActive={activeTool === t.id} drawingFavorites={drawingFavorites} onSelect={makeSelectHandler(setSelectedTrendTool, setTrendToolMenuOpen, t.id)} onToggleFavorite={handleToggleFavorite} />
            ))}
          </div>
        )}
        {/* Lines Group */}
        {renderToolGroup(
          lineToolMenuOpen, setLineToolMenuOpen, selectedLineTool,
          ['horizontal', 'horizontalRay', 'vertical', 'line'],
          lineIcons[selectedLineTool],
          <div className="flex flex-col gap-px py-1">
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Lines</div>
            {[
              { id: 'horizontal', label: 'Horizontal Line' },
              { id: 'horizontalRay', label: 'Horizontal Ray' },
              { id: 'vertical', label: 'Vertical Line' },
              { id: 'line', label: 'Straight Line' },
            ].map(t => (
              <ToolMenuItem key={t.id} toolId={t.id} label={t.label} icon={lineIcons[t.id]} isActive={activeTool === t.id} drawingFavorites={drawingFavorites} onSelect={makeSelectHandler(setSelectedLineTool, setLineToolMenuOpen, t.id)} onToggleFavorite={handleToggleFavorite} />
            ))}
          </div>
        )}
        {/* Fibonacci Group */}
        {renderToolGroup(
          fibToolMenuOpen, setFibToolMenuOpen, selectedFibTool,
          ['fibonacci', 'fibExtension'],
          <svg className="h-5 w-5 lg:h-[38px] lg:w-[38px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="4" x2="21" y2="4" /><line x1="3" y1="9" x2="17" y2="9" opacity="0.7" /><line x1="3" y1="14" x2="13" y2="14" opacity="0.5" /><line x1="3" y1="19" x2="21" y2="19" /><line x1="18" y1="4" x2="6" y2="19" strokeWidth="1.5" strokeDasharray="3 2" /></svg>,
          <div className="flex flex-col gap-px py-1">
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Fibonacci</div>
            {[
              { id: 'fibonacci', label: 'Fib Retracement', icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="4" x2="21" y2="4" /><line x1="3" y1="9" x2="17" y2="9" opacity="0.7" /><line x1="3" y1="14" x2="13" y2="14" opacity="0.5" /><line x1="3" y1="19" x2="21" y2="19" /><line x1="18" y1="4" x2="6" y2="19" strokeWidth="1.5" strokeDasharray="3 2" /></svg> },
              { id: 'fibExtension', label: 'Fib Extension', icon: <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="20" x2="21" y2="20" /><line x1="3" y1="14" x2="17" y2="14" opacity="0.7" /><line x1="3" y1="8" x2="13" y2="8" opacity="0.5" /><line x1="3" y1="3" x2="21" y2="3" /><line x1="6" y1="20" x2="18" y2="3" strokeWidth="1.5" strokeDasharray="3 2" /><polyline points="15,3 18,3 18,6" strokeWidth="1.5" /></svg> },
            ].map(t => (
              <ToolMenuItem key={t.id} toolId={t.id} label={t.label} icon={t.icon} isActive={activeTool === t.id} drawingFavorites={drawingFavorites} onSelect={makeSelectHandler(setSelectedFibTool, setFibToolMenuOpen, t.id)} onToggleFavorite={handleToggleFavorite} />
            ))}
          </div>
        )}
        {/* Shapes Group */}
        {renderToolGroup(
          shapeToolMenuOpen, setShapeToolMenuOpen, selectedShapeTool,
          Object.keys(shapeIcons),
          shapeIcons[selectedShapeTool],
          <div className="flex flex-col gap-px py-1">
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Shapes</div>
            {['rectangle', 'square', 'circle', 'triangle', 'oval', 'freeTriangle', 'parallelogram', 'octagon'].map(id => (
              <ToolMenuItem key={id} toolId={id} label={id.charAt(0).toUpperCase() + id.slice(1).replace(/([A-Z])/g, ' $1')} icon={shapeIcons[id]} isActive={activeTool === id} drawingFavorites={drawingFavorites} onSelect={makeSelectHandler(setSelectedShapeTool, setShapeToolMenuOpen, id)} onToggleFavorite={handleToggleFavorite} />
            ))}
            {/* Visual separator between primary and secondary shape groups */}
            <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">More Shapes</div>
            {['diamond', 'pentagon', 'hexagon', 'star', 'cross', 'arrowBlock', 'wedge', 'heart'].map(id => (
              <ToolMenuItem key={id} toolId={id} label={id === 'arrowBlock' ? 'Arrow Block' : id.charAt(0).toUpperCase() + id.slice(1)} icon={shapeIcons[id]} isActive={activeTool === id} drawingFavorites={drawingFavorites} onSelect={makeSelectHandler(setSelectedShapeTool, setShapeToolMenuOpen, id)} onToggleFavorite={handleToggleFavorite} />
            ))}
          </div>
        )}
        {/* Brushes Group */}
        {renderToolGroup(
          brushToolMenuOpen, setBrushToolMenuOpen, selectedBrushTool,
          ['brush', 'highlighter', 'arrow'],
          brushIcons[selectedBrushTool],
          <div className="flex flex-col gap-px py-1">
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Brushes</div>
            {[
              { id: 'brush', label: 'Brush' },
              { id: 'highlighter', label: 'Highlighter' },
              { id: 'arrow', label: 'Arrow' },
            ].map(t => (
              <ToolMenuItem key={t.id} toolId={t.id} label={t.label} icon={brushIcons[t.id]} isActive={activeTool === t.id} drawingFavorites={drawingFavorites} onSelect={makeSelectHandler(setSelectedBrushTool, setBrushToolMenuOpen, t.id)} onToggleFavorite={handleToggleFavorite} />
            ))}
          </div>
        )}
        {/* Text tool */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={`relative h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all ${activeTool === 'text' ? 'text-foreground before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-foreground before:rounded-r' : 'text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground'}`} onClick={() => onToolSelect(activeTool === 'text' ? null : 'text')}>
                <Type className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs lg:text-sm">Text</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {/* Long Position */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={`relative h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all ${activeTool === 'long' ? 'text-neon-green before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-neon-green before:rounded-r' : 'text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10 hover:text-neon-green'}`} onClick={() => onToolSelect(activeTool === 'long' ? null : 'long')}>
                <LongPositionIcon className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs lg:text-sm">Long Position</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {/* Short Position */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={`relative h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all ${activeTool === 'short' ? 'text-neon-pink before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-neon-pink before:rounded-r' : 'text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10 hover:text-neon-pink'}`} onClick={() => onToolSelect(activeTool === 'short' ? null : 'short')}>
                <ShortPositionIcon className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs lg:text-sm">Short Position</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {/* Lock drawings */}
        {onToggleLock && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className={`relative h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all ${drawingsLocked ? 'text-yellow-400 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-yellow-400 before:rounded-r' : 'text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground'}`} onClick={onToggleLock}>
                  {drawingsLocked ? <Lock className="h-5 w-5 lg:h-[38px] lg:w-[38px]" /> : <Unlock className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs lg:text-sm">{drawingsLocked ? 'Unlock Drawings' : 'Lock Drawings'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {/* Hide drawings */}
        {onToggleHide && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className={`relative h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all ${drawingsHidden ? 'text-muted-foreground before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-muted-foreground before:rounded-r' : 'text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground'}`} onClick={onToggleHide}>
                  {drawingsHidden ? <EyeOff className="h-5 w-5 lg:h-[38px] lg:w-[38px]" /> : <Eye className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs lg:text-sm">{drawingsHidden ? 'Show Drawings' : 'Hide Drawings'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {/* Measure tool */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={`relative h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all ${activeTool === 'measure' ? 'text-electric-blue before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-electric-blue before:rounded-r' : 'text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground'}`} onClick={() => onToolSelect(activeTool === 'measure' ? null : 'measure')}>
                <Ruler className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs lg:text-sm">Measure Tool</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {/* Paper Trading toggle removed; now handled by chevron in the bottom time bar */}
        {/* Divider: separates drawing tools from utility/destructive actions */}
        <div className="w-7 lg:w-9 h-px bg-border mx-auto my-0.5" />
        {/* Phone-only utility group above trash: Layout (folder) and Settings. */}
        {/* Tablet/desktop render these elsewhere (ChartControlsPanel for tablet, */}
        {/* RightToolbar/DesktopChartHeader for desktop) so md:hidden keeps the */}
        {/* originals untouched there. */}
        {onLayoutChange && multiTimeframeLayout && (
          <div className="md:hidden">
            <UnifiedLayoutButton
              selectedLayout={multiTimeframeLayout}
              onLayoutChange={onLayoutChange}
              syncSettings={syncSettings}
              onSyncSettingsChange={onSyncSettingsChange || (() => {})}
              isMultiPanelActive={multiTimeframeLayout !== "1x1"}
              onExitMultiPanel={() => onLayoutChange("1x1")}
              symbol={layoutSymbol || ''}
              timeframe={layoutTimeframe || ''}
              drawings={layoutDrawings || []}
              indicators={layoutIndicators}
              onLoadLayout={onLoadLayout || (() => {})}
              onOpenSaveDialog={onOpenSaveDialog || (() => {})}
              hideExitButton
              className="h-10 w-10 rounded-none transition-all text-foreground/80 hover:bg-muted/50 hover:text-foreground p-0 border-0 bg-transparent shadow-none flex items-center justify-center"
            />
          </div>
        )}
        {/* Calendar (phone-only): between folder and settings. Active-panel */}
        {/* indicator bar matches the top-of-sidebar version on tablet. */}
        {onToggleCalendar && (
          <div className="md:hidden">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className={`relative h-10 w-10 rounded-none transition-all ${calendarPanelActive ? 'text-foreground before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-foreground before:rounded-r' : 'text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground'}`} onClick={onToggleCalendar}>
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /><circle cx="17.5" cy="17.5" r="4" fill="var(--background, white)" stroke="currentColor" strokeWidth="1.75" /><line x1="17.5" y1="15.5" x2="17.5" y2="17.5" /><line x1="17.5" y1="17.5" x2="19" y2="18.5" /></svg>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">Calendar</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        {/* Alerts / Bell (phone-only): between calendar and settings. */}
        {onShowAlertDialog && (
          <div className="md:hidden">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative h-10 w-10 rounded-none transition-all text-foreground/80 hover:bg-muted/50 hover:text-foreground" onClick={onShowAlertDialog}>
                    <Bell className="h-5 w-5" />
                    {alertCount > 0 && (
                      <span className="absolute -top-1 -right-1 h-3 min-w-[12px] px-0.5 text-[8px] bg-electric-blue text-white rounded-full flex items-center justify-center">{alertCount}</span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">Alerts</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        {onOpenSettings && (
          <div className="md:hidden">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-10 rounded-none transition-all text-foreground/80 hover:bg-muted/50 hover:text-foreground" onClick={() => onOpenSettings?.()}>
                    <Settings className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">Settings</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        {/* Drawing shortcuts button: opens dialog to configure keyboard
            shortcuts for drawing tools. Positioned above trash so utility
            actions are grouped below the divider.
            Hidden on phone: there's no physical keyboard so the dialog is
            useless and the icon was just taking sidebar real estate. */}
        {onOpenShortcutsDialog && (
          <div className="hidden md:block">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground" onClick={onOpenShortcutsDialog}>
                    <Keyboard className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs lg:text-sm">Drawing Shortcuts</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        {/* Delete / Clear drawings+indicators */}
        {(drawings.length > 0 || indicatorCount > 0) && (
          <div className="relative">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon"
                    className={`h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all text-muted-foreground hover:bg-destructive/10 hover:text-destructive ${selectedDrawingId ? 'text-destructive/70' : ''}`}
                    onClick={() => { if (selectedDrawingId && onDeleteSelectedDrawing) { onDeleteSelectedDrawing(selectedDrawingId); } }}
                  >
                    <Trash2 className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs lg:text-sm">{selectedDrawingId ? 'Delete Selected Drawing' : 'Delete (select a drawing first)'}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Popover>
              <PopoverTrigger asChild>
                <button className="absolute -right-1 top-1/2 -translate-y-1/2 w-5 h-10 flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                  <ChevronRight className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" className="w-auto p-1 bg-card border border-border shadow-lg">
                <div className="flex flex-col">
                  {selectedDrawingId && onDeleteSelectedDrawing && (
                    <Button variant="ghost" size="sm" className="justify-start h-8 px-3 text-xs font-normal hover:bg-destructive/10 hover:text-destructive" onClick={() => onDeleteSelectedDrawing(selectedDrawingId)}>Remove selected drawing</Button>
                  )}
                  {onClearAllDrawings && (
                    <Button variant="ghost" size="sm" className="justify-start h-8 px-3 text-xs font-normal hover:bg-muted" onClick={() => onClearAllDrawings()}>Remove {drawings.length} drawing{drawings.length !== 1 ? 's' : ''}</Button>
                  )}
                  {onClearIndicators && (
                    <Button variant="ghost" size="sm" className="justify-start h-8 px-3 text-xs font-normal hover:bg-muted" onClick={() => onClearIndicators()}>Remove {indicatorCount} indicator{indicatorCount !== 1 ? 's' : ''}</Button>
                  )}
                  {onClearAllDrawings && onClearIndicators && (drawings.length > 0 || indicatorCount > 0) && (
                    <Button variant="ghost" size="sm" className="justify-start h-8 px-3 text-xs font-normal hover:bg-muted" onClick={() => { if (onClearAllDrawings) onClearAllDrawings(); if (onClearIndicators) onClearIndicators(); }}>
                      Remove {drawings.length} drawing{drawings.length !== 1 ? 's' : ''} & {indicatorCount} indicator{indicatorCount !== 1 ? 's' : ''}
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
      {/* Login modal for favorites auth gate */}
      <LoginModal open={showLoginForFavorites} onOpenChange={setShowLoginForFavorites} message="Sign in to save your favorite drawing tools and sync them across devices." />
    </>
  );
}
