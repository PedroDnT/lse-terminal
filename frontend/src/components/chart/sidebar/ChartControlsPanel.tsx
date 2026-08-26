// ============================================================================
// ChartControlsPanel.tsx - Chart type selector, layout, alerts, settings buttons
// Contains the mobile-specific chart type dropdown, multi-timeframe layout button,
// alerts button, settings button, and keyboard shortcuts button.
// These are the "control" icons in the sidebar between the panel icons and drawing tools.
// Extracted from ChartLeftSidebar for clarity.
// ============================================================================

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Bell, Settings, Keyboard, CandlestickChart, LineChart, AreaChart } from "lucide-react";
import { UnifiedLayoutButton } from "@/components/chart/MultiTimeframeLayoutSelector";
import type { ChartType } from "@/components/chart/ChartTypeSelector";
import type { LayoutType } from "@/components/chart/MultiTimeframeLayoutSelector";

interface ChartControlsPanelProps {
  // Keyboard shortcuts
  onOpenShortcutsDialog: () => void;
  // Alerts
  onShowAlertDialog?: () => void;
  alertCount?: number;
  // Chart type (mobile only)
  chartType?: ChartType;
  onChartTypeChange?: (type: ChartType) => void;
  // Layout (mobile only)
  multiTimeframeLayout?: LayoutType;
  onLayoutChange?: (layout: string) => void;
  syncSettings?: any;
  onSyncSettingsChange?: (s: any) => void;
  layoutSymbol?: string;
  layoutTimeframe?: string;
  layoutDrawings?: any[];
  layoutIndicators?: any;
  layoutsList?: any[];
  onLoadLayout?: (layout: any) => void;
  onOpenSaveDialog?: () => void;
  // Settings
  onOpenSettings: () => void;
}

export default function ChartControlsPanel({
  onOpenShortcutsDialog,
  onShowAlertDialog,
  alertCount = 0,
  chartType,
  onChartTypeChange,
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
  onOpenSettings,
}: ChartControlsPanelProps) {
  return (
    <>
      {/* Keyboard shortcuts button moved to DrawingToolsPanel (above trash icon) */}

      {/* Alerts: tablet only here. Phone moves the bell down to sit between */}
      {/* the folder (layout) and settings icons inside DrawingToolsPanel. */}
      {onShowAlertDialog && (
        <div className="hidden md:block">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all text-foreground/80 hover:bg-muted/50 hover:text-foreground" onClick={onShowAlertDialog}>
                  <Bell className="h-5 w-5 lg:h-[22px] lg:w-[22px]" />
                  {alertCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-3 min-w-[12px] px-0.5 text-[8px] bg-electric-blue text-white rounded-full flex items-center justify-center">{alertCount}</span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs lg:text-sm">Alerts</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Chart Type (mobile/tablet only) */}
      {onChartTypeChange && (
        <div className="lg:hidden">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-none transition-all text-foreground/80 hover:bg-muted/50 hover:text-foreground">
                      {chartType === 'line' ? <LineChart className="h-5 w-5" /> : chartType === 'area' ? <AreaChart className="h-5 w-5" /> : <CandlestickChart className="h-5 w-5" />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right" className="bg-card border-border min-w-[140px]">
                    <DropdownMenuItem onClick={() => onChartTypeChange('candlestick')} className={`flex items-center gap-2 cursor-pointer ${chartType === 'candlestick' ? 'bg-foreground/10 text-foreground font-medium' : ''}`}><CandlestickChart className="h-4 w-4" /> Candles</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onChartTypeChange('line')} className={`flex items-center gap-2 cursor-pointer ${chartType === 'line' ? 'bg-foreground/10 text-foreground font-medium' : ''}`}><LineChart className="h-4 w-4" /> Line</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onChartTypeChange('area')} className={`flex items-center gap-2 cursor-pointer ${chartType === 'area' ? 'bg-foreground/10 text-foreground font-medium' : ''}`}><AreaChart className="h-4 w-4" /> Area</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs lg:text-sm">Chart Type</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Layout (tablet only). Phone moves this to the bottom of the */}
      {/* sidebar (rendered inside DrawingToolsPanel above the trash icon). */}
      {onLayoutChange && multiTimeframeLayout && (
        <div className="hidden md:block lg:hidden">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
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
                  className="h-10 w-10 rounded-none transition-all text-foreground/80 hover:bg-muted/50 hover:text-foreground p-0 border-0 bg-transparent shadow-none"
                />
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs lg:text-sm">Layout</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Settings (tablet only here; phone shows it in the bottom utility */}
      {/* group inside DrawingToolsPanel, just above the trash icon). */}
      <div className="hidden md:block">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 lg:h-12 lg:w-12 rounded-none transition-all text-foreground/80 hover:bg-muted/50 hover:text-foreground" onClick={onOpenSettings}>
                <Settings className="h-5 w-5 lg:h-[38px] lg:w-[38px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs lg:text-sm">Settings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>
  );
}
