import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Grid2X2, Check, X, Info, Plus, FolderOpen, ChevronDown, Trash2, Palette, SlidersHorizontal, Bell, CalendarDays } from "lucide-react";
import { AppearancePanel, ChartSettingsPanel, AlertsPanel, EventsPanel } from "./InlineChartSettings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useChartLayouts, ChartLayout } from "@/hooks/useChartLayouts";
import { Drawing } from "@/components/chart/ChartDrawingOverlay";
import { IndicatorConfig } from "@/components/chart/IndicatorSettings";
export type LayoutType = "1x1" | "2x1" | "1x2" | "2x2" | "3x1" | "1x3" | "4x1" | "3x2" | "2x3" | "4x2";
interface LayoutOption {
  type: LayoutType;
  label: string;
  gridCols: number;
  gridRows: number;
}
// Group layouts by number of panels
const layoutGroups: { count: number; layouts: LayoutOption[] }[] = [
  {
    count: 1,
    layouts: [
      { type: "1x1", label: "Single", gridCols: 1, gridRows: 1 },
    ]
  },
  {
    count: 2,
    layouts: [
      { type: "2x1", label: "2 Horizontal", gridCols: 2, gridRows: 1 },
      { type: "1x2", label: "2 Vertical", gridCols: 1, gridRows: 2 },
    ]
  },
  {
    count: 3,
    layouts: [
      { type: "3x1", label: "3 Horizontal", gridCols: 3, gridRows: 1 },
      { type: "1x3", label: "3 Vertical", gridCols: 1, gridRows: 3 },
    ]
  },
  {
    count: 4,
    layouts: [
      { type: "2x2", label: "2x2 Grid", gridCols: 2, gridRows: 2 },
      { type: "4x1", label: "4 Horizontal", gridCols: 4, gridRows: 1 },
    ]
  },
  {
    count: 6,
    layouts: [
      { type: "3x2", label: "3x2 Grid", gridCols: 3, gridRows: 2 },
      { type: "2x3", label: "2x3 Grid", gridCols: 2, gridRows: 3 },
    ]
  },
  {
    count: 8,
    layouts: [
      { type: "4x2", label: "4x2 Grid", gridCols: 4, gridRows: 2 },
    ]
  },
];
// Flat list for backward compatibility
const layoutOptions: LayoutOption[] = layoutGroups.flatMap(g => g.layouts);
// Visual grid preview component - TradingView style
const LayoutPreview = ({ cols, rows, isSelected }: { cols: number; rows: number; isSelected: boolean }) => {
  const cells = Array.from({ length: cols * rows });
  return (
    <div
      className="rounded transition-all"
      style={{
        display: 'grid',
        gap: '2px',
        width: '40px',
        height: '28px',
        padding: '3px',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        background: 'transparent',
      }}
    >
      {cells.map((_, i) => (
        <div
          key={i}
          className="dark:border-neutral-500"
          style={{
            borderRadius: '2px',
            minWidth: '4px',
            minHeight: '4px',
            // Use --text instead of --foreground because --foreground is not defined
            // as a CSS variable in the theme. Tailwind maps 'foreground' to --text
            // in tailwind.config.ts, but inline styles must use the actual CSS var name.
            background: isSelected ? 'var(--text)' : 'var(--muted-foreground)',
            opacity: isSelected ? 0.85 : 0.3,
            border: isSelected ? '1px solid var(--text)' : '1px solid var(--muted-foreground)',
          }}
        />
      ))}
    </div>
  );
};
interface SyncSettings {
  syncSymbol: boolean;
  syncInterval: boolean;
  syncCrosshair: boolean;
  syncTime: boolean;
}
interface MultiTimeframeLayoutSelectorProps {
  selectedLayout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  syncSettings: SyncSettings;
  onSyncSettingsChange: (settings: SyncSettings) => void;
  isMultiPanelActive: boolean;
  onExitMultiPanel: () => void;
}
const SyncOption = ({
  id,
  label,
  tooltip,
  checked,
  onCheckedChange
}: {
  id: string;
  label: string;
  tooltip: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => (
  <div className="flex items-center justify-between py-0.5">
    <div className="flex items-center gap-1.5">
      <Label htmlFor={id} className="text-sm cursor-pointer text-foreground">
        {label}
      </Label>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[200px] text-xs">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
    <Switch
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="border-foreground/25 data-[state=checked]:bg-electric-blue"
    />
  </div>
);
const MultiTimeframeLayoutSelector = ({
  selectedLayout,
  onLayoutChange,
  syncSettings,
  onSyncSettingsChange,
  isMultiPanelActive,
  onExitMultiPanel,
}: MultiTimeframeLayoutSelectorProps) => {
  const handleLayoutSelect = (layout: LayoutType) => {
    onLayoutChange(layout);
  };
  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`glass border transition-all h-6 md:h-7 lg:h-auto px-1.5 md:px-2 lg:px-3 ${isMultiPanelActive
              ? 'border-foreground/50 bg-foreground/10 text-foreground'
              : 'border-border/30 hover:border-foreground/40 text-black dark:text-white'
              }`}
          >
            <Grid2X2 className="h-3.5 w-3.5 md:h-4 md:w-4 lg:mr-2" />
            <span className="hidden lg:inline">Layout</span>
            {isMultiPanelActive && (
              <span className="hidden lg:inline ml-1 text-xs opacity-70">({selectedLayout})</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 bg-popover border border-border shadow-xl p-0 z-[100]"
          align="end"
          sideOffset={8}
        >
          {/* Layout Grid Selection */}
          <div className="p-4 pb-3">
            <div className="space-y-2">
              {layoutGroups.map((group) => (
                <div key={group.count} className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{group.count}</span>
                  <div className="flex items-center gap-1">
                    {group.layouts.map((option) => (
                      <button
                        key={option.type}
                        onClick={() => handleLayoutSelect(option.type)}
                        className={`relative p-1.5 rounded transition-all ${selectedLayout === option.type
                          ? "bg-foreground/10 ring-1 ring-foreground/60"
                          : "hover:bg-muted"
                          }`}
                        title={option.label}
                      >
                        <LayoutPreview
                          cols={option.gridCols}
                          rows={option.gridRows}
                          isSelected={selectedLayout === option.type}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Sync In Layout Section - Always show, like TradingView */}
          <Separator />
          <div className="p-4 pt-3">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
              Sync In Layout
            </h3>
            <div className="space-y-0">
              <SyncOption
                id="sync-symbol"
                label="Symbol"
                tooltip="When enabled, changing the symbol in one panel will update all panels"
                checked={syncSettings.syncSymbol}
                onCheckedChange={(checked) =>
                  onSyncSettingsChange({ ...syncSettings, syncSymbol: checked })
                }
              />
              <SyncOption
                id="sync-interval"
                label="Interval"
                tooltip="When enabled, changing the timeframe in one panel will update all panels"
                checked={syncSettings.syncInterval}
                onCheckedChange={(checked) =>
                  onSyncSettingsChange({ ...syncSettings, syncInterval: checked })
                }
              />
              <SyncOption
                id="sync-crosshair"
                label="Crosshair"
                tooltip="When enabled, crosshair position is synchronized across all panels"
                checked={syncSettings.syncCrosshair}
                onCheckedChange={(checked) =>
                  onSyncSettingsChange({ ...syncSettings, syncCrosshair: checked })
                }
              />
              <SyncOption
                id="sync-time"
                label="Time"
                tooltip="When a chart is scrolled, all charts within the layout display the same point of time"
                checked={syncSettings.syncTime}
                onCheckedChange={(checked) =>
                  onSyncSettingsChange({ ...syncSettings, syncTime: checked })
                }
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {/* Exit multi-panel button */}
      {isMultiPanelActive && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onExitMultiPanel}
          className="h-6 md:h-7 lg:h-8 w-6 md:w-7 lg:w-8 glass border border-border/30 hover:border-destructive/50 hover:bg-destructive/10"
          title="Exit multi-panel view"
        >
          <X className="h-3 w-3 md:h-3.5 md:w-3.5" />
        </Button>
      )}
    </div>
  );
};
interface UnifiedLayoutButtonProps {
  selectedLayout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  syncSettings: SyncSettings;
  onSyncSettingsChange: (settings: SyncSettings) => void;
  isMultiPanelActive: boolean;
  onExitMultiPanel: () => void;
  // Save layout props
  symbol: string;
  timeframe: string;
  drawings: Drawing[];
  indicators: IndicatorConfig;
  onLoadLayout: (layout: ChartLayout) => void;
  onOpenSaveDialog: () => void;
  className?: string;
  /** Hide the X exit button (for mobile view) */
  hideExitButton?: boolean;
  // Optional layout system props: when provided, uses these instead of
  // its own useChartLayouts hook, keeping a single source of truth.
  layoutsList?: { id: string; name: string; timeframe?: string }[];
  /** @deprecated no longer used; "Create New Chart Layout" now opens the Save As dialog */
  onSaveLayoutQuick?: (name: string) => Promise<boolean>;
  onDeleteLayoutById?: (id: string) => Promise<boolean>;
  onSwitchLayoutById?: (id: string) => void;
  // When provided, "Settings" tab items open the chart settings dialog at specific tabs.
  onOpenSettings?: (tab?: string) => void;
  activeLayoutName?: string | null;
}
export const UnifiedLayoutButton = ({
  selectedLayout,
  onLayoutChange,
  syncSettings,
  onSyncSettingsChange,
  isMultiPanelActive,
  onExitMultiPanel,
  symbol,
  timeframe,
  drawings,
  indicators,
  onLoadLayout,
  onOpenSaveDialog,
  className,
  hideExitButton = false,
  layoutsList,
  onDeleteLayoutById,
  onSwitchLayoutById,
  onOpenSettings,
  activeLayoutName,
}: UnifiedLayoutButtonProps) => {
  // Treat null/undefined activeLayoutName as "Untitled" (the default unmodified layout)
  const effectiveActiveLayoutName = activeLayoutName || 'Untitled';
  const [activeTab, setActiveTab] = useState<'layouts' | 'settings'>('layouts');
  const [settingsView, setSettingsView] = useState<'menu' | 'appearance' | 'chart-settings' | 'alerts' | 'events'>('menu');
  const [isOpen, setIsOpen] = useState(false);
  // Use layout system props if provided, otherwise fall back to own hook
  // (backward compat for tablet/mobile views that don't pass these props yet)
  const ownHook = useChartLayouts();
  const layouts = layoutsList || ownHook.layouts.map(l => ({ id: l.id || l.name, name: l.name, timeframe: l.timeframe }));
  const navigate = useNavigate();
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) setSettingsView('menu');
    if (open && !layoutsList) ownHook.refreshLayouts();
  };
  const handleLayoutSelect = (layout: LayoutType) => {
    onLayoutChange(layout);
  };
  const handleLoadLayout = (layout: { id: string; name: string }) => {
    if (onSwitchLayoutById) {
      onSwitchLayoutById(layout.id);
      toast.success(`Loaded "${layout.name}"`);
    } else {
      // Legacy fallback
      const full = ownHook.layouts.find(l => l.name === layout.name);
      if (full) {
        onLoadLayout(full);
        const symbolWithoutSlash = full.symbol.replace('/', '');
        navigate(`/chart/${symbolWithoutSlash}`);
        toast.success(`Loaded "${layout.name}"`);
      }
    }
  };
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDeleteLayoutById) {
      await onDeleteLayoutById(id);
    } else {
      await ownHook.deleteLayout(id);
    }
  };
  return (
    <div className="flex items-center gap-1">
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            className={`h-9 flex items-center gap-1.5 px-2.5 rounded-md border transition-colors
              ${className || `${isMultiPanelActive
                ? 'border-foreground/50 bg-foreground/10 text-foreground'
                : 'border-border/40 hover:border-foreground/40 text-foreground hover:bg-black/5 dark:hover:bg-white/5'
              }`}`}
          >
            {/* Phone and tablet show just the folder icon. The phone sidebar */}
            {/* slot is 40x40 and the tablet header slot is 32x32 (h-8 w-8 p-0); */}
            {/* the "Chart Layout" text overflows both, visibly colliding with */}
            {/* the next button (Indicators) on iPad. Only desktop (>= lg) has */}
            {/* room for the text + chevron. */}
            <FolderOpen className="h-5 w-5 lg:hidden" />
            <span className="text-[13px] font-medium whitespace-nowrap hidden lg:inline">Chart Layout</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60 hidden lg:inline" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={`${settingsView !== 'menu' ? 'w-80' : 'w-72'} bg-popover border border-border shadow-xl p-0 z-[100]`}
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={16}
        >
          {/* Tabs: Layouts | Settings */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab('layouts')}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === 'layouts'
                ? 'text-foreground border-b-2 border-foreground'
                : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FolderOpen className="h-3.5 w-3.5 inline mr-1.5" />
              Layouts
            </button>
            {onOpenSettings && (
              <button
                onClick={() => setActiveTab('settings')}
                className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === 'settings'
                  ? 'text-foreground border-b-2 border-foreground'
                  : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 inline mr-1.5" />
                Settings
              </button>
            )}
          </div>

          {activeTab === 'layouts' ? (
            <>
              {/* Saved Layouts List */}
              <ScrollArea className="max-h-[160px]">
                {layouts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <FolderOpen className="h-6 w-6 text-muted-foreground/50 mb-1.5" />
                    <p className="text-sm text-muted-foreground">No saved layouts yet</p>
                  </div>
                ) : (
                  <div className="py-1">
                    {layouts.map((layout) => {
                      const isActive = layout.name === effectiveActiveLayoutName;
                      return (
                        <div
                          key={layout.id}
                          className={`group flex items-center justify-between px-3 py-1.5 cursor-pointer transition-colors ${
                            isActive
                              ? 'bg-foreground/[0.06] dark:bg-foreground/[0.08] border-l-2 border-foreground'
                              : 'hover:bg-black/10 dark:hover:bg-white/10 border-l-2 border-transparent'
                          }`}
                          onClick={() => handleLoadLayout(layout)}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {/* Check icon: visually marks which layout is currently active */}
                            {isActive && <Check className="h-3.5 w-3.5 text-foreground shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm truncate ${isActive ? 'font-semibold text-foreground' : 'font-medium'}`}>{layout.name}</div>
                              {layout.timeframe && (
                                <div className="text-[11px] text-muted-foreground">{layout.timeframe}</div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                              onClick={(e) => handleDelete(layout.id, e)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
              {/* Save Actions */}
              <Separator />
              <div className="p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] space-y-1">
                <button
                  onClick={() => { setIsOpen(false); onOpenSaveDialog(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Create New Chart Layout
                </button>
              </div>
            </>
          ) : (
            /* Settings tab: drill-down inline panels */
            settingsView === 'menu' ? (
              <div className="py-1">
                {([
                  { icon: Palette, label: 'Appearance', desc: 'Candle colors, background, grid', view: 'appearance' as const },
                  { icon: SlidersHorizontal, label: 'Chart Settings', desc: 'Crosshair, axis, scroll, timezone', view: 'chart-settings' as const },
                  { icon: Bell, label: 'Alerts', desc: 'Alert lines, volume, notifications', view: 'alerts' as const },
                  { icon: CalendarDays, label: 'Events', desc: 'Economic events, news, sessions', view: 'events' as const },
                ]).map(({ icon: Icon, label, desc, view }) => (
                  <button
                    key={view}
                    onClick={() => setSettingsView(view)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                  >
                    <Icon className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : settingsView === 'appearance' ? (
              <AppearancePanel onBack={() => setSettingsView('menu')} />
            ) : settingsView === 'chart-settings' ? (
              <ChartSettingsPanel onBack={() => setSettingsView('menu')} />
            ) : settingsView === 'alerts' ? (
              <AlertsPanel onBack={() => setSettingsView('menu')} />
            ) : (
              <EventsPanel onBack={() => setSettingsView('menu')} />
            )
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
};
export default MultiTimeframeLayoutSelector;
export type { SyncSettings };
export { layoutOptions };

// ─── Grid Layout Button ──────────────────────────────────────────────────────
// Compact grid-icon button in the header. Opens a popover with the layout
// grid picker and Sync In Layout toggles. The Chart Layout button handles
// saved layouts and appearance settings separately.

interface GridLayoutButtonProps {
  selectedLayout: LayoutType;
  onLayoutChange: (l: LayoutType) => void;
  syncSettings: SyncSettings;
  onSyncSettingsChange: (s: SyncSettings) => void;
  isMultiPanelActive: boolean;
  onExitMultiPanel: () => void;
}

export function GridLayoutButton({
  selectedLayout, onLayoutChange, syncSettings, onSyncSettingsChange,
  isMultiPanelActive, onExitMultiPanel,
}: GridLayoutButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={`h-9 w-9 flex items-center justify-center rounded-md transition-colors
              ${isMultiPanelActive
                ? 'bg-foreground/10 ring-1 ring-foreground/40 text-foreground'
                : 'text-foreground hover:bg-black/10 dark:hover:bg-white/10'
              }`}
            title="Chart layout"
          >
            <Grid2X2 className="h-[18px] w-[18px]" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 bg-popover border border-border shadow-xl p-0 z-[100]"
          align="start"
          side="bottom"
          sideOffset={8}
          collisionPadding={16}
        >
          {/* Grid options */}
          <div className="p-3 pb-2">
            <h3 className="text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Grid</h3>
            <div className="space-y-1">
              {layoutGroups.map((group) => (
                <div key={group.count} className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{group.count}</span>
                  <div className="flex items-center gap-1">
                    {group.layouts.map((option) => (
                      <button
                        key={option.type}
                        onClick={() => { onLayoutChange(option.type); setOpen(false); }}
                        className={`p-1.5 rounded transition-all ${selectedLayout === option.type
                          ? 'bg-foreground/10 ring-1 ring-foreground/60'
                          : 'hover:bg-muted'
                        }`}
                        title={option.label}
                      >
                        <LayoutPreview cols={option.gridCols} rows={option.gridRows} isSelected={selectedLayout === option.type} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Separator />
          {/* Sync settings */}
          <div className="px-3 py-2">
            <h3 className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Sync In Layout</h3>
            <div className="space-y-0">
              {([
                { id: 'gs-symbol', label: 'Symbol', key: 'syncSymbol' as const, tip: 'Changing symbol updates all panels' },
                { id: 'gs-interval', label: 'Interval', key: 'syncInterval' as const, tip: 'Changing timeframe updates all panels' },
                { id: 'gs-crosshair', label: 'Crosshair', key: 'syncCrosshair' as const, tip: 'Crosshair position synced across panels' },
                { id: 'gs-time', label: 'Time', key: 'syncTime' as const, tip: 'All panels scroll to same time' },
              ]).map(({ id, label, key, tip }) => (
                <SyncOption
                  key={id} id={id} label={label} tooltip={tip}
                  checked={syncSettings[key]}
                  onCheckedChange={(v) => onSyncSettingsChange({ ...syncSettings, [key]: v })}
                />
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
