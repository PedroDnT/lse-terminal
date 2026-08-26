import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ColorButton } from "./ColorButton";
import { PRICE_TAG_NEUTRAL } from "./core/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { CandlestickChart, Bell, Calendar, Settings2, Save, ChevronDown, Trash2, Pencil, Cloud, CloudOff, FolderPlus, Check } from "lucide-react";
import { toast } from "sonner";
import { useChartSettingsTemplates, Template, TemplateSlots } from "@/hooks/useChartSettingsTemplates";
import { useAuth } from "@/contexts/AuthContext";
import { useChartSettings, useReplaceChartSettings } from "@/contexts/ChartSettingsContext";

export interface ChartSettings {
  candles: {
    bodyBullish: string;
    bodyBearish: string;
    bordersBullish: string;
    bordersBearish: string;
    wickBullish: string;
    wickBearish: string;
  };
  chart: {
    backgroundColor: string;
    backgroundOpacity: number; // 0-100
    gridColor: string;
    gridOpacity: number; // 0-100
    gridHorizontalLines: number; // target number of horizontal grid lines (10-60)
    gridVerticalLines: number; // target number of vertical grid lines (6-30)
    scrollSensitivity: number; // 1-10 scale, default 5
    axisLabelColor: string;
    axisLineColor: string;
    priceTickerBullish: string;
    priceTickerBearish: string;
    crosshairColor: string;
    crosshairLabelBg: string;
  };
  data: {
    timezone: string;
  };
  alerts: {
    alertLinesVisible: boolean;
    alertLinesColor: string;
    onlyActiveAlerts: boolean;
    alertVolume: boolean;
    alertVolumeLevel: number;
    autoHideToasts: boolean;
  };
  events: {
    ideas: boolean;
    ideasFilter: string;
    sessionBreaks: boolean;
    sessionBreaksColor: string;
    economicEvents: boolean;
    onlyFutureEvents: boolean;
    eventsBreaks: boolean;
    eventsBreaksColor: string;
    latestNews: boolean;
    newsNotification: boolean;
  };
  trading: {
    slColor: string;
    slOpacity: number; // 0-100
    tpColor: string;
    tpOpacity: number; // 0-100
  };
}

// OS-aware default for scroll sensitivity
const getDefaultScrollSensitivity = (): number => {
  if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)) {
    return 8; // Mac trackpad default
  }
  return 2; // Windows/other default
};

export const getDefaultSettings = (): ChartSettings => {
  return {
    candles: {
      bodyBullish: "#22c55e",
      bodyBearish: "#ef5350",
      bordersBullish: "#000000",  // Black borders by default
      bordersBearish: "#000000",
      wickBullish: "#000000",     // Black wicks by default
      wickBearish: "#000000",
    },
    chart: {
      backgroundColor: "#ffffff",
      backgroundOpacity: 100,
      gridColor: "#9ca3af",
      gridOpacity: 30,
      gridHorizontalLines: 45,
      gridVerticalLines: 16,
      scrollSensitivity: getDefaultScrollSensitivity(),
      axisLabelColor: "#787b86",
      axisLineColor: "#666666",
      // Neutral by default: the last-price tag matches the
      // crosshair label below instead of a green/red box; see PRICE_TAG_NEUTRAL.
      priceTickerBullish: PRICE_TAG_NEUTRAL,
      priceTickerBearish: PRICE_TAG_NEUTRAL,
      crosshairColor: "#6b7280",
      crosshairLabelBg: "#131722",
    },
    data: {
      timezone: "local",  // Default to local time
    },
    alerts: {
      alertLinesVisible: true,
      alertLinesColor: "#ffeb3b",
      onlyActiveAlerts: false,
      alertVolume: true,
      alertVolumeLevel: 50,
      autoHideToasts: true,
    },
    events: {
      ideas: false,
      ideasFilter: "all",
      sessionBreaks: false,
      sessionBreaksColor: "#424242",
      economicEvents: true,
      onlyFutureEvents: true,
      eventsBreaks: false,
      eventsBreaksColor: "#424242",
      latestNews: true,
      newsNotification: false,
    },
    trading: {
      slColor: "#dc2626",
      slOpacity: 70,
      tpColor: "#16a34a",
      tpOpacity: 70,
    },
  };
};

interface ChartSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: string;
}

// Defensive: only these strings select a sidebar entry. If a caller passes
// anything else (e.g. a SyntheticEvent leaked from a bare onClick={onOpenSettings}),
// the right panel would render blank and no sidebar item would highlight.
// Coerce unknown values to "appearance" so the dialog always shows content.
const VALID_TABS = ["appearance", "settings", "alerts", "events"] as const;
const coerceTab = (t: unknown): string =>
  typeof t === "string" && (VALID_TABS as readonly string[]).includes(t) ? t : "appearance";

export function ChartSettingsDialog({ open, onOpenChange, initialTab }: ChartSettingsDialogProps) {
  const { user } = useAuth();
  // The dialog no longer holds its own settings draft or fetches
  // chart_settings on open. Both the dialog and the inline panels read +
  // write through ChartSettingsContext: single source of truth, single
  // debounce, no init-race window where the dialog's late DB fetch could
  // overwrite an inline edit that hadn't drained yet. The autoSave-off
  // "experiment without committing" mode was removed with the draft: it
  // was the only thing the draft enabled and it was the entire source of
  // the dialog-vs-inline divergence.
  const settings = useChartSettings();
  const setSettings = useReplaceChartSettings();
  const [activeTab, setActiveTab] = useState(coerceTab(initialTab));
  // Jump to the requested tab each time the dialog is opened from a specific entry point
  useEffect(() => {
    if (open) setActiveTab(coerceTab(initialTab));
  }, [open, initialTab]);
  const [editingTemplateIndex, setEditingTemplateIndex] = useState<number | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState("");
  // Tracks the name of the currently loaded template so the user can see
  // which preset is active at a glance. Defaults to "Template 1" since
  // the user's saved settings are their primary preset (like "Layout 1"
  // in TradingView). Updated when loading/saving templates.
  const [activeTemplateName, setActiveTemplateName] = useState<string>("Template 1");

  // Use the hook for template management with backend sync
  const {
    templates,
    isLoading: templatesLoading,
    isSynced,
    saveTemplate: saveTemplateToBackend,
    deleteTemplate: deleteTemplateFromBackend,
    updateTemplateName: updateTemplateNameInBackend,
    refreshTemplates
  } = useChartSettingsTemplates();

  // Refresh templates when dialog opens
  useEffect(() => {
    if (open && user) {
      refreshTemplates();
    }
  }, [open, user, refreshTemplates]);

  // Init fetch + autoSave debounce removed. The context owns
  // both. Every onChange below calls setSettings (= replaceChartSettings),
  // which immediately updates context state for live chart preview and
  // schedules the single debounced DB write.

  const handleSave = () => {
    // Settings are already persisted via the context save debounce on each
    // edit. Ok is now just a "close dialog" affordance.
    onOpenChange(false);
  };

  const handleSaveTemplate = async (slotIndex: number) => {
    const existingName = templates[slotIndex]?.name || `Template ${slotIndex + 1}`;
    const template: Template = {
      name: existingName,
      settings: { ...settings }
    };
    await saveTemplateToBackend(slotIndex, template);
    // After saving, mark this as the active template so the button label
    // reflects the current preset (especially useful when creating new templates)
    setActiveTemplateName(existingName);
    toast.success(`Saved to ${existingName}`);
  };

  const handleLoadTemplate = (slotIndex: number) => {
    const template = templates[slotIndex];
    if (template) {
      // Deep-merge with defaults so that templates saved before new settings
      // sections (e.g. 'trading') were added don't cause undefined crashes.
      // Without this, loading an old template would set settings.trading to
      // undefined, crashing at settings.trading.slColor.
      const defaults = getDefaultSettings();
      const merged: ChartSettings = {
        ...defaults,
        ...template.settings,
        candles: { ...defaults.candles, ...template.settings.candles },
        chart: { ...defaults.chart, ...template.settings.chart },
        data: { ...defaults.data, ...template.settings.data },
        alerts: { ...defaults.alerts, ...template.settings.alerts },
        events: { ...defaults.events, ...template.settings.events },
        trading: { ...defaults.trading, ...template.settings.trading },
      };
      setSettings(merged);
      // Mark this template as the active one so the UI can show which
      // preset the user is currently working with
      setActiveTemplateName(template.name);
      toast.success(`Loaded "${template.name}"`);
    }
  };

  const handleDeleteTemplate = async (slotIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const templateName = templates[slotIndex]?.name || `Template ${slotIndex + 1}`;
    await deleteTemplateFromBackend(slotIndex);
    // If the deleted template was the active one, fall back to "Template 1"
    // (the default base preset) since the user's settings are no longer
    // tied to a saved template
    if (activeTemplateName === templateName) {
      setActiveTemplateName("Template 1");
    }
    toast.success(`"${templateName}" deleted`);
  };

  const handleStartEditName = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const template = templates[index];
    if (template) {
      setEditingTemplateIndex(index);
      setEditingTemplateName(template.name);
    }
  };

  const handleSaveTemplateName = async (index: number) => {
    if (!editingTemplateName.trim()) {
      setEditingTemplateIndex(null);
      return;
    }
    const newName = editingTemplateName.trim();
    await updateTemplateNameInBackend(index, newName);
    // If the renamed template is the currently active one, update the
    // button label to reflect the new name immediately
    if (activeTemplateName === templates[index]?.name) {
      setActiveTemplateName(newName);
    }
    toast.success("Template renamed");
    setEditingTemplateIndex(null);
  };

  const handleCancel = () => {
    // Revert to last saved state by re-reading from DB on next open.
    // Dispatch event to revert the chart's live preview back to saved colors.
    // The useChartThemeColors hook will re-read from its DB cache.
    // chartSettingsChanged dispatch removed; context update propagates via React.
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-3xl h-[calc(100vh-2rem)] sm:h-[600px] p-0 gap-0 flex flex-col rounded-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border flex-shrink-0">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/* Mobile: horizontal tab bar at the top */}
        <div className="sm:hidden border-b border-border bg-muted/20 flex-shrink-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex w-full bg-transparent p-1 gap-1">
              <TabsTrigger
                value="appearance"
                className="flex-1 gap-1.5 text-xs data-[state=active]:bg-electric-blue/20 data-[state=active]:text-electric-blue"
              >
                <CandlestickChart className="h-3.5 w-3.5" />
                Appearance
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="flex-1 gap-1.5 text-xs data-[state=active]:bg-electric-blue/20 data-[state=active]:text-electric-blue"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Settings
              </TabsTrigger>
              <TabsTrigger
                value="alerts"
                className="flex-1 gap-1.5 text-xs data-[state=active]:bg-electric-blue/20 data-[state=active]:text-electric-blue"
              >
                <Bell className="h-3.5 w-3.5" />
                Alerts
              </TabsTrigger>
              <TabsTrigger
                value="events"
                className="flex-1 gap-1.5 text-xs data-[state=active]:bg-electric-blue/20 data-[state=active]:text-electric-blue"
              >
                <Calendar className="h-3.5 w-3.5" />
                Events
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Desktop: vertical sidebar */}
          <div className="hidden sm:block w-52 border-r border-border bg-muted/20 flex-shrink-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="h-full">
              <TabsList className="flex flex-col h-full w-full bg-transparent p-2 space-y-1">
                <TabsTrigger
                  value="appearance"
                  className="w-full justify-start gap-2 data-[state=active]:bg-electric-blue/20 data-[state=active]:text-electric-blue"
                >
                  <CandlestickChart className="h-4 w-4" />
                  Chart Appearance
                </TabsTrigger>
                <TabsTrigger
                  value="settings"
                  className="w-full justify-start gap-2 data-[state=active]:bg-electric-blue/20 data-[state=active]:text-electric-blue"
                >
                  <Settings2 className="h-4 w-4" />
                  Chart Settings
                </TabsTrigger>
                <TabsTrigger
                  value="alerts"
                  className="w-full justify-start gap-2 data-[state=active]:bg-electric-blue/20 data-[state=active]:text-electric-blue"
                >
                  <Bell className="h-4 w-4" />
                  Alerts
                </TabsTrigger>
                <TabsTrigger
                  value="events"
                  className="w-full justify-start gap-2 data-[state=active]:bg-electric-blue/20 data-[state=active]:text-electric-blue"
                >
                  <Calendar className="h-4 w-4" />
                  Events
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-hidden min-w-0">
            <ScrollArea className="h-full">
              <div className="p-4 sm:p-6">
<div className="w-full">
                  {/* Chart Appearance Tab - Candle & Chart Colors */}
                  {activeTab === "appearance" && <div className="mt-0 space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        Candle Colors
                      </h3>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary">Body</span>
                        <div className="flex gap-2">
                          <ColorButton
                            color={settings.candles.bodyBullish}
                            onChange={(color) => setSettings({ ...settings, candles: { ...settings.candles, bodyBullish: color } })}
                            label="Bullish body color"
                          />
                          <ColorButton
                            color={settings.candles.bodyBearish}
                            onChange={(color) => setSettings({ ...settings, candles: { ...settings.candles, bodyBearish: color } })}
                            label="Bearish body color"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary">Borders</span>
                        <div className="flex gap-2">
                          <ColorButton
                            color={settings.candles.bordersBullish}
                            onChange={(color) => setSettings({ ...settings, candles: { ...settings.candles, bordersBullish: color } })}
                            label="Bullish border color"
                          />
                          <ColorButton
                            color={settings.candles.bordersBearish}
                            onChange={(color) => setSettings({ ...settings, candles: { ...settings.candles, bordersBearish: color } })}
                            label="Bearish border color"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary">Wick</span>
                        <div className="flex gap-2">
                          <ColorButton
                            color={settings.candles.wickBullish}
                            onChange={(color) => setSettings({ ...settings, candles: { ...settings.candles, wickBullish: color } })}
                            label="Bullish wick color"
                          />
                          <ColorButton
                            color={settings.candles.wickBearish}
                            onChange={(color) => setSettings({ ...settings, candles: { ...settings.candles, wickBearish: color } })}
                            label="Bearish wick color"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-border">
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        Chart Colors
                      </h3>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-primary">Background</span>
                          <ColorButton
                            color={settings.chart.backgroundColor}
                            onChange={(color) => setSettings({ ...settings, chart: { ...settings.chart, backgroundColor: color } })}
                            label="Chart background color"
                          />
                        </div>
                        <div className="flex items-center gap-3 pl-4">
                          <span className="text-xs text-muted-foreground w-14">Opacity</span>
                          <Slider
                            value={[settings.chart.backgroundOpacity]}
                            onValueChange={([value]) =>
                              setSettings({ ...settings, chart: { ...settings.chart, backgroundOpacity: value } })
                            }
                            min={0}
                            max={100}
                            step={1}
                            className="flex-1"
                          />
                          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                            {settings.chart.backgroundOpacity}%
                          </span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-primary">Grid</span>
                          <ColorButton
                            color={settings.chart.gridColor}
                            onChange={(color) => setSettings({ ...settings, chart: { ...settings.chart, gridColor: color } })}
                            label="Chart grid color"
                          />
                        </div>
                        <div className="flex items-center gap-3 pl-4">
                          <span className="text-xs text-muted-foreground w-14">Opacity</span>
                          <Slider
                            value={[settings.chart.gridOpacity]}
                            onValueChange={([value]) =>
                              setSettings({ ...settings, chart: { ...settings.chart, gridOpacity: value } })
                            }
                            min={0}
                            max={100}
                            step={1}
                            className="flex-1"
                          />
                          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                            {settings.chart.gridOpacity}%
                          </span>
                        </div>
                      </div>

                      {/* Grid density controls */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-28">Horizontal Lines</span>
                          <Slider
                            value={[settings.chart.gridHorizontalLines ?? 45]}
                            onValueChange={([value]) =>
                              setSettings({ ...settings, chart: { ...settings.chart, gridHorizontalLines: value } })
                            }
                            min={10}
                            max={60}
                            step={5}
                            className="flex-1"
                          />
                          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                            {settings.chart.gridHorizontalLines ?? 45}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-28">Vertical Lines</span>
                          <Slider
                            value={[settings.chart.gridVerticalLines ?? 16]}
                            onValueChange={([value]) =>
                              setSettings({ ...settings, chart: { ...settings.chart, gridVerticalLines: value } })
                            }
                            min={6}
                            max={30}
                            step={2}
                            className="flex-1"
                          />
                          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                            {settings.chart.gridVerticalLines ?? 16}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary">Axis Labels</span>
                        <ColorButton
                          color={settings.chart.axisLabelColor}
                          onChange={(color) => setSettings({ ...settings, chart: { ...settings.chart, axisLabelColor: color } })}
                          label="Axis label color"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary">Axis Lines</span>
                        <ColorButton
                          color={settings.chart.axisLineColor}
                          onChange={(color) => setSettings({ ...settings, chart: { ...settings.chart, axisLineColor: color } })}
                          label="Axis line color"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary">Crosshair</span>
                        <ColorButton
                          color={settings.chart.crosshairColor}
                          onChange={(color) => setSettings({ ...settings, chart: { ...settings.chart, crosshairColor: color } })}
                          label="Crosshair line color"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary">Crosshair Label</span>
                        <ColorButton
                          color={settings.chart.crosshairLabelBg}
                          onChange={(color) => setSettings({ ...settings, chart: { ...settings.chart, crosshairLabelBg: color } })}
                          label="Crosshair label background color"
                        />
                      </div>
                      </div>

                    <div className="space-y-4 pt-4 border-t border-border">
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        Price Ticker
                      </h3>
                      <p className="text-xs text-muted-foreground -mt-2">
                        The live price badge on the Y-axis
                      </p>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary">Ticker Colors</span>
                        <div className="flex gap-2">
                          <ColorButton
                            color={settings.chart.priceTickerBullish}
                            onChange={(color) => setSettings({ ...settings, chart: { ...settings.chart, priceTickerBullish: color } })}
                            label="Bullish price ticker color"
                          />
                          <ColorButton
                            color={settings.chart.priceTickerBearish}
                            onChange={(color) => setSettings({ ...settings, chart: { ...settings.chart, priceTickerBearish: color } })}
                            label="Bearish price ticker color"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-border">
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        Trading Lines
                      </h3>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-primary">Stop Loss</span>
                          <ColorButton
                            color={settings.trading.slColor}
                            onChange={(color) => setSettings({ ...settings, trading: { ...settings.trading, slColor: color } })}
                            label="Stop Loss line color"
                          />
                        </div>
                        <div className="flex items-center gap-3 pl-4">
                          <span className="text-xs text-muted-foreground w-14">Opacity</span>
                          <Slider
                            value={[settings.trading.slOpacity]}
                            onValueChange={([value]) =>
                              setSettings({ ...settings, trading: { ...settings.trading, slOpacity: value } })
                            }
                            min={10}
                            max={100}
                            step={5}
                            className="flex-1"
                          />
                          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                            {settings.trading.slOpacity}%
                          </span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-primary">Take Profit</span>
                          <ColorButton
                            color={settings.trading.tpColor}
                            onChange={(color) => setSettings({ ...settings, trading: { ...settings.trading, tpColor: color } })}
                            label="Take Profit line color"
                          />
                        </div>
                        <div className="flex items-center gap-3 pl-4">
                          <span className="text-xs text-muted-foreground w-14">Opacity</span>
                          <Slider
                            value={[settings.trading.tpOpacity]}
                            onValueChange={([value]) =>
                              setSettings({ ...settings, trading: { ...settings.trading, tpOpacity: value } })
                            }
                            min={10}
                            max={100}
                            step={5}
                            className="flex-1"
                          />
                          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                            {settings.trading.tpOpacity}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>}

                  {/* Chart Settings Tab - Timezone & Scrolling */}
                  {activeTab === "settings" && <div className="mt-0 space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        Timezone
                      </h3>

                      <div className="space-y-2">
                        <Select
                          value={settings.data.timezone}
                          onValueChange={(value) =>
                            setSettings({ ...settings, data: { ...settings.data, timezone: value } })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="UTC">UTC</SelectItem>
                            <SelectItem value="local">Local Time</SelectItem>
                            <SelectItem value="America/New_York">New York (EST/EDT)</SelectItem>
                            <SelectItem value="America/Chicago">Chicago (CST/CDT)</SelectItem>
                            <SelectItem value="America/Los_Angeles">Los Angeles (PST/PDT)</SelectItem>
                            <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
                            <SelectItem value="Europe/Paris">Paris (CET/CEST)</SelectItem>
                            <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                            <SelectItem value="Asia/Shanghai">Shanghai (CST)</SelectItem>
                            <SelectItem value="Asia/Hong_Kong">Hong Kong (HKT)</SelectItem>
                            <SelectItem value="Asia/Singapore">Singapore (SGT)</SelectItem>
                            <SelectItem value="Australia/Sydney">Sydney (AEST/AEDT)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-border">
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        Scrolling Sensitivity
                      </h3>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-primary">Zoom Speed</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {settings.chart.scrollSensitivity}/10
                          </span>
                        </div>
                        <Slider
                          value={[settings.chart.scrollSensitivity]}
                          onValueChange={([value]) =>
                            setSettings({ ...settings, chart: { ...settings.chart, scrollSensitivity: value } })
                          }
                          min={1}
                          max={10}
                          step={1}
                          className="flex-1"
                        />
                        <p className="text-xs text-muted-foreground">
                          Controls how fast the chart zooms when scrolling. Higher = faster zoom.
                        </p>
                      </div>
                    </div>
                  </div>}

                  {/* Alerts Tab */}
                  {activeTab === "alerts" && <div className="mt-0 space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        Alert Lines
                      </h3>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="alertLines"
                            checked={settings.alerts.alertLinesVisible}
                            onCheckedChange={(checked) =>
                              setSettings({ ...settings, alerts: { ...settings.alerts, alertLinesVisible: !!checked } })
                            }
                          />
                          <label htmlFor="alertLines" className="text-sm text-text-primary cursor-pointer">
                            Show alert lines on chart
                          </label>
                        </div>
                        <ColorButton
                          color={settings.alerts.alertLinesColor}
                          onChange={(color) => setSettings({ ...settings, alerts: { ...settings.alerts, alertLinesColor: color } })}
                          label="Alert lines color"
                        />
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="onlyActiveAlerts"
                          checked={settings.alerts.onlyActiveAlerts}
                          onCheckedChange={(checked) =>
                            setSettings({ ...settings, alerts: { ...settings.alerts, onlyActiveAlerts: !!checked } })
                          }
                        />
                        <label htmlFor="onlyActiveAlerts" className="text-sm text-text-primary cursor-pointer">
                          Only show active alerts
                        </label>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-border">
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        Alert Sound
                      </h3>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="alertVolume"
                          checked={settings.alerts.alertVolume}
                          onCheckedChange={(checked) =>
                            setSettings({ ...settings, alerts: { ...settings.alerts, alertVolume: !!checked } })
                          }
                        />
                        <label htmlFor="alertVolume" className="text-sm text-text-primary cursor-pointer">
                          Play sound on alert trigger
                        </label>
                      </div>

                      {settings.alerts.alertVolume && (
                        <div className="space-y-3 pl-6">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-text-primary">Volume</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {settings.alerts.alertVolumeLevel}%
                            </span>
                          </div>
                          <Slider
                            value={[settings.alerts.alertVolumeLevel]}
                            onValueChange={([value]) =>
                              setSettings({ ...settings, alerts: { ...settings.alerts, alertVolumeLevel: value } })
                            }
                            min={0}
                            max={100}
                            step={5}
                            className="flex-1"
                          />
                        </div>
                      )}
                    </div>

                    <div className="space-y-4 pt-4 border-t border-border">
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        Toast Notifications
                      </h3>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="autoHideToasts"
                          checked={settings.alerts.autoHideToasts}
                          onCheckedChange={(checked) =>
                            setSettings({ ...settings, alerts: { ...settings.alerts, autoHideToasts: !!checked } })
                          }
                        />
                        <label htmlFor="autoHideToasts" className="text-sm text-text-primary cursor-pointer">
                          Auto-hide toast notifications
                        </label>
                      </div>
                    </div>
                  </div>}

                  {/* Events Tab */}
                  {activeTab === "events" && <div className="mt-0 space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                        Chart Events
                      </h3>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="sessionBreaks"
                              checked={settings.events.sessionBreaks}
                              onCheckedChange={(checked) =>
                                setSettings({ ...settings, events: { ...settings.events, sessionBreaks: !!checked } })
                              }
                            />
                            <label htmlFor="sessionBreaks" className="text-sm text-text-primary cursor-pointer">
                              Session breaks
                            </label>
                          </div>
                          <ColorButton
                            color={settings.events.sessionBreaksColor}
                            onChange={(color) => setSettings({ ...settings, events: { ...settings.events, sessionBreaksColor: color } })}
                            label="Session breaks color"
                          />
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="economicEvents"
                            checked={settings.events.economicEvents}
                            onCheckedChange={(checked) =>
                              setSettings({ ...settings, events: { ...settings.events, economicEvents: !!checked } })
                            }
                          />
                          <label htmlFor="economicEvents" className="text-sm text-text-primary cursor-pointer">
                            Economic events
                          </label>
                        </div>

                        <div className="flex items-center space-x-2 pl-6">
                          <Checkbox
                            id="onlyFutureEvents"
                            checked={settings.events.onlyFutureEvents}
                            onCheckedChange={(checked) =>
                              setSettings({ ...settings, events: { ...settings.events, onlyFutureEvents: !!checked } })
                            }
                            disabled={!settings.events.economicEvents}
                          />
                          <label
                            htmlFor="onlyFutureEvents"
                            className={`text-sm cursor-pointer ${settings.events.economicEvents ? 'text-text-primary' : 'text-muted-foreground'}`}
                          >
                            Only show future events
                          </label>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="eventsBreaks"
                              checked={settings.events.eventsBreaks}
                              onCheckedChange={(checked) =>
                                setSettings({ ...settings, events: { ...settings.events, eventsBreaks: !!checked } })
                              }
                            />
                            <label htmlFor="eventsBreaks" className="text-sm text-text-primary cursor-pointer">
                              Events breaks
                            </label>
                          </div>
                          <ColorButton
                            color={settings.events.eventsBreaksColor}
                            onChange={(color) => setSettings({ ...settings, events: { ...settings.events, eventsBreaksColor: color } })}
                            label="Events breaks color"
                          />
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="latestNews"
                            checked={settings.events.latestNews}
                            onCheckedChange={(checked) =>
                              setSettings({ ...settings, events: { ...settings.events, latestNews: !!checked } })
                            }
                          />
                          <label htmlFor="latestNews" className="text-sm text-text-primary cursor-pointer">
                            Latest news
                          </label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="newsNotification"
                            checked={settings.events.newsNotification}
                            onCheckedChange={(checked) =>
                              setSettings({
                                ...settings,
                                events: { ...settings.events, newsNotification: !!checked },
                              })
                            }
                          />
                          <label htmlFor="newsNotification" className="text-sm text-text-primary cursor-pointer">
                            News notification
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>}

                </div>

              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Footer layout:
            Left: Reset
            Right: Templates dropdown | Ok
            Auto-save toggle and explicit Save removed; every
            edit now goes through ChartSettingsContext and is debounce-saved
            automatically. */}
        <DialogFooter className="px-4 sm:px-6 py-3 sm:py-4 border-t border-border flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 sm:gap-0 sm:justify-between flex-shrink-0">
          <div className="flex gap-3 items-center justify-center sm:justify-start">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSettings(getDefaultSettings());
                // Resetting reverts to platform defaults, which is the
                // "Template 1" base state (the user's primary preset)
                setActiveTemplateName("Template 1");
                toast.success("Reset to defaults");
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              Reset
            </Button>
          </div>

          <div className="flex gap-2 justify-center sm:justify-end">
            {/* Templates dropdown: identical pattern to the chart layout selector.
                List of saved templates (click to load), auto-save toggle,
                save current, create new template. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 max-w-[200px]">
                  <Save className="h-4 w-4 flex-shrink-0" />
                  {/* Show which template is active so the user knows their current
                      preset at a glance, similar to "Layout 1" in TradingView. */}
                  <span className="truncate">
                    {activeTemplateName}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-50 flex-shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-card border border-border z-[200] shadow-xl">
                {/* Template list: click to load, hover for delete */}
                {templates.map((template, index) =>
                  template ? (
                    editingTemplateIndex === index ? (
                      <div key={index} className="px-2 py-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editingTemplateName}
                          onChange={(e) => setEditingTemplateName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveTemplateName(index);
                            if (e.key === 'Escape') setEditingTemplateIndex(null);
                          }}
                          onBlur={() => handleSaveTemplateName(index)}
                          className="h-7 text-sm bg-background"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <DropdownMenuItem
                        key={index}
                        onClick={() => handleLoadTemplate(index)}
                        className={`flex items-center justify-between group text-foreground cursor-pointer ${
                          activeTemplateName === template.name ? 'bg-accent' : ''
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {/* Checkmark shown next to the currently loaded template
                              so the user can identify which preset is active */}
                          {activeTemplateName === template.name ? (
                            <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                          ) : (
                            <span className="w-3.5 flex-shrink-0" />
                          )}
                          <span className="truncate text-sm">{template.name}</span>
                        </div>
                        <div className="flex items-center gap-0.5 ml-2">
                          <button
                            className="h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                            onClick={(e) => handleStartEditName(index, e)}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            className="h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition-opacity"
                            onClick={(e) => handleDeleteTemplate(index, e)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </DropdownMenuItem>
                    )
                  ) : null
                )}
                {templates.some(t => t !== null) && <DropdownMenuSeparator />}

                {/* Save: overwrites the most recently loaded template with current settings */}
                <DropdownMenuItem
                  onClick={() => {
                    // Find the first filled slot to overwrite (or slot 0 as fallback)
                    const lastUsed = templates.findIndex(t => t !== null);
                    if (lastUsed >= 0) {
                      handleSaveTemplate(lastUsed);
                    } else {
                      // No templates exist yet, create one in slot 0
                      handleSaveTemplate(0);
                    }
                  }}
                  className="text-foreground cursor-pointer"
                >
                  <Save className="h-4 w-4 mr-2" />
                  <span className="text-sm font-medium">Save</span>
                </DropdownMenuItem>

                {/* Create new template */}
                <DropdownMenuItem
                  onClick={() => {
                    const emptySlot = templates.findIndex(t => t === null);
                    if (emptySlot === -1) {
                      toast.error('All 5 template slots full. Delete one first.');
                      return;
                    }
                    handleSaveTemplate(emptySlot);
                  }}
                  disabled={templates.every(t => t !== null)}
                  className="text-foreground cursor-pointer"
                >
                  <FolderPlus className="h-4 w-4 mr-2" />
                  <span className="text-sm">Create new template</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button size="sm" onClick={handleSave}>Ok</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
