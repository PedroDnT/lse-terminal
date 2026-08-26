// ============================================================================
// ChartLeftSidebar.tsx - Thin shell that composes sidebar sub-panels
// Previously 2,580 lines. Now delegates rendering to focused panel components
// in the sidebar/ directory while keeping all exported types and the component
// interface stable so downstream consumers do not need changes.
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { useWatchlistPrices } from "@/hooks/useWatchlistPrices";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useLandscape } from "@/hooks/useLandscape";
import { Button } from "@/components/ui/button";
import { Star, Newspaper, X, Home, LogIn, LogOut, Sun, Moon, Rocket } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { getEventImpact } from "@/lib/eventImpact";
import { ChartSettingsDialog } from "@/components/chart/ChartSettingsDialog";
import DrawingShortcutsDialog from "@/components/chart/DrawingShortcutsDialog";
import ShortcutsSignupPrompt from "@/components/chart/ShortcutsSignupPrompt";
import { useDrawingShortcuts } from "@/hooks/useDrawingShortcuts";
import type { ChartType } from "@/components/chart/ChartTypeSelector";
import type { LayoutType } from "@/components/chart/MultiTimeframeLayoutSelector";
import { DrawingTool, Drawing } from "@/components/chart/ChartDrawingOverlay";

// Sub-panel components extracted to sidebar/ directory
import SymbolSearchPanel, { DEFAULT_WATCHLIST } from "./sidebar/SymbolSearchPanel";
import DrawingToolsPanel from "./sidebar/DrawingToolsPanel";
import ChartControlsPanel from "./sidebar/ChartControlsPanel";
import CalendarPanel from "./sidebar/CalendarPanel";

// Re-export EconomicEvent so all existing imports from this file continue to work.
// Multiple files import { EconomicEvent } from './ChartLeftSidebar', including
// ProChart.tsx, ProCandlestickChart.tsx, MultiPanelChartGrid.tsx, ChartView.tsx, etc.
export interface EconomicEvent {
  date: string | null;
  time: string | null;
  datetime: string | null;
  region_code: string | null;
  event: string | null;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  consensus: string | null;
}

// Currency to country mapping for filtering calendar events by the active trading pair
const CURRENCY_TO_COUNTRIES: Record<string, string[]> = {
  USD: ["US", "United States"],
  EUR: ["EU", "Germany", "France", "Italy", "Spain", "Netherlands", "Euro Area", "Eurozone", "EA"],
  GBP: ["GB", "UK", "United Kingdom"],
  JPY: ["JP", "Japan"],
  CHF: ["CH", "Switzerland"],
  AUD: ["AU", "Australia"],
  CAD: ["CA", "Canada"],
  NZD: ["NZ", "New Zealand"],
  CNY: ["CN", "China"],
  XAU: ["Global", "US"],
  XAG: ["Global", "US"],
  BTC: ["Global", "US"],
  ETH: ["Global", "US"],
};

interface ChartLeftSidebarProps {
  currentPair?: string;
  onPairSelect?: (pair: string) => void;
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
  showEventsOnChart?: boolean;
  onShowEventsOnChartChange?: (show: boolean) => void;
  onEconomicEventsChange?: (events: EconomicEvent[]) => void;
  chartType?: ChartType;
  onChartTypeChange?: (type: ChartType) => void;
  onShowAlertDialog?: () => void;
  alertCount?: number;
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
  mobileTradingOpen?: boolean;
  onToggleMobileTrading?: () => void;
  bottomPanelHidden?: boolean;
  onToggleBottomPanel?: () => void;
  // Lifted panel state so the RightToolbar can also toggle panels
  activePanel?: ActivePanel;
  onPanelChange?: (panel: ActivePanel) => void;
  // Lifted shortcuts dialog state so the RightToolbar can also open it
  shortcutsDialogOpen?: boolean;
  onShortcutsDialogChange?: (open: boolean) => void;
}

interface NewsArticle {
  id: string;
  title: string;
  url: string;
  image_url: string | null;
  source_name: string;
  source_logo: string | null;
  source_color: string | null;
  published_at: string;
}

// Exported so ChartPage can lift this state and share it with RightToolbar
export type ActivePanel = 'watchlist' | 'news' | 'calendar' | null;

function ChartLeftSidebarInner(props: ChartLeftSidebarProps) {
  const {
    currentPair, onPairSelect, activeTool, onToolSelect,
    drawings = [], onClearAllDrawings, selectedDrawingId, onDeleteSelectedDrawing,
    drawingsLocked = false, onToggleLock, drawingsHidden = false, onToggleHide,
    indicatorCount = 0, onClearIndicators,
    showEventsOnChart = false, onShowEventsOnChartChange, onEconomicEventsChange,
    chartType, onChartTypeChange, onShowAlertDialog, alertCount = 0,
    multiTimeframeLayout, onLayoutChange, syncSettings, onSyncSettingsChange,
    layoutSymbol, layoutTimeframe, layoutDrawings, layoutIndicators,
    layoutsList, onLoadLayout, onOpenSaveDialog,
    mobileTradingOpen, onToggleMobileTrading,
    bottomPanelHidden = false, onToggleBottomPanel,
    activePanel: activePanelProp, onPanelChange,
    shortcutsDialogOpen: shortcutsDialogOpenProp, onShortcutsDialogChange,
  } = props;

  const { isMobileLandscape } = useLandscape();
  // Panel state can be lifted to ChartPage (so RightToolbar can also toggle panels)
  // or managed internally if no prop is provided (backwards compatible)
  const [internalPanel, setInternalPanel] = useState<ActivePanel>(null);
  const activePanel = activePanelProp !== undefined ? activePanelProp : internalPanel;
  const setActivePanel = onPanelChange || setInternalPanel;
  // Watchlist state is owned by useWatchlist. Anonymous users see
  // DEFAULT_WATCHLIST in memory (no persistence). Signed-in users load
  // from the `watchlist` table on mount and edits debounce-UPSERT back to
  // it. localStorage is no longer used for watchlist at all.
  const { watchlist, setWatchlist } = useWatchlist();
  // Only poll while the watchlist panel is actually open. When collapsed,
  // the user can't see prices anyway and polling them at 1Hz was the bulk
  // of the chart page's /x_pricecache traffic (and the source of nginx
  // 503s when many tabs collided on a CDN edge IP's rate bucket).
  const { prices: livePrices } = useWatchlistPrices(watchlist, { enabled: activePanel === 'watchlist' });
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [calendarEvents, setCalendarEvents] = useState<EconomicEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  // Default to high-impact only so the sidebar shows the most relevant upcoming events
  // without being flooded by low/medium noise that crowds out next week's movers
  const [impactFilters, setImpactFilters] = useState<{ high: boolean; medium: boolean; low: boolean }>({ high: true, medium: false, low: false });
  const [showChartSettings, setShowChartSettings] = useState(false);

  // Resizable panel width: persisted in localStorage so it remembers across sessions.
  // Min 240px (compact), max 480px (expanded), default 320px.
  // Default to minimum width (240px) for a compact look.
  // Users can drag wider; their preference is saved in localStorage.
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try { const saved = localStorage.getItem('chart-sidebar-width'); return saved ? Math.max(240, Math.min(480, parseInt(saved))) : 240; }
    catch { return 240; }
  });
  // isDragging as state (not ref) so the component re-renders with transition:none
  // during drag. This eliminates the 300ms CSS animation lag on every pixel of movement.
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  // Drag handler for resizing the slide-out panel.
  // Uses document-level mousemove/mouseup so dragging works even outside the handle.
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = panelWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - dragStartXRef.current;
      const newWidth = Math.max(240, Math.min(480, dragStartWidthRef.current + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Save final width to localStorage
      setPanelWidth(prev => { localStorage.setItem('chart-sidebar-width', String(prev)); return prev; });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    // Prevent text selection while dragging
    document.body.style.userSelect = 'none';
  }, [panelWidth]);
  // Shortcuts dialog state can be lifted to ChartPage (so RightToolbar can also open it)
  const [internalShortcutsDialog, setInternalShortcutsDialog] = useState(false);
  const showShortcutsDialog = shortcutsDialogOpenProp !== undefined ? shortcutsDialogOpenProp : internalShortcutsDialog;
  const setShowShortcutsDialog = onShortcutsDialogChange || setInternalShortcutsDialog;
  const { user, signOut } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const navigate = useNavigate();
  const [hamburgerOpen, setHamburgerOpen] = useState(false);

  // Drawing shortcuts hook manages keyboard binding state
  const {
    shortcuts, setShortcut, removeShortcut, getShortcutForTool,
    clearAllShortcuts, showSignupPrompt, setShowSignupPrompt, requiresAuth
  } = useDrawingShortcuts(onToolSelect);

  const handleOpenShortcutsDialog = () => {
    if (requiresAuth()) return;
    setShowShortcutsDialog(true);
  };

  // Extract currencies from pair for calendar filtering
  const getCurrenciesFromPair = (pairStr: string): string[] => {
    if (!pairStr) return [];
    const cleanPair = pairStr.replace("/", "").toUpperCase();
    const quotes = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD"];
    for (const quote of quotes) {
      if (cleanPair.endsWith(quote)) return [cleanPair.slice(0, -quote.length), quote];
    }
    if (cleanPair.length === 6) return [cleanPair.slice(0, 3), cleanPair.slice(3)];
    return ["USD"];
  };

  const getRelevantCountries = (currencies: string[]): string[] => {
    const countries: string[] = [];
    for (const currency of currencies) {
      const mapped = CURRENCY_TO_COUNTRIES[currency];
      if (mapped) countries.push(...mapped);
    }
    return [...new Set(countries)];
  };

  // Single fetch for both sidebar and chart markers. Only fetches upcoming events
  // (today + 14 days ahead). Past events aren't useful for either the sidebar or chart.
  useEffect(() => {
    if (activePanel !== 'calendar' && !showEventsOnChart) return;
    const fetchCalendarEvents = async () => {
      setCalendarLoading(true);
      try {
        const currencies = getCurrenciesFromPair(currentPair || '');
        const relevantCountries = getRelevantCountries(currencies);
        const regionCodes = relevantCountries.filter(c => c.length <= 3);
        const today = new Date().toISOString().split("T")[0];
        // 7 days ahead covers the full upcoming trading week
        const oneWeekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const data = await api.getEconomicCalendar({
          startDate: today,
          endDate: oneWeekAhead.toISOString().split("T")[0],
          regions: regionCodes.length > 0 ? regionCodes : undefined,
          order: 'asc', limit: 500
        });
        const allEvents = ((data as unknown as EconomicEvent[]) || []).filter(
          (e) => !!(e.region_code && e.event)
        );

        // Sidebar gets all upcoming events (filtered by impact toggles in CalendarPanel)
        setCalendarEvents(allEvents);

        // Chart markers: high-impact only so the x-axis isn't cluttered with flags
        if (showEventsOnChart && onEconomicEventsChange) {
          const chartFiltered = allEvents.filter((e) => {
            const impact = getEventImpact({ event: e.event || "", country: e.region_code || "" });
            return impact === 'high';
          });
          onEconomicEventsChange(chartFiltered.slice(0, 60));
        }
      } catch (err) {
        console.error('Error fetching calendar events:', err);
        setCalendarEvents([]);
      } finally { setCalendarLoading(false); }
    };
    fetchCalendarEvents();
  }, [activePanel, currentPair, showEventsOnChart, impactFilters]);

  // Clear events from chart when toggle is disabled
  useEffect(() => {
    if (!showEventsOnChart && onEconomicEventsChange) onEconomicEventsChange([]);
  }, [showEventsOnChart]);

  // Fetch news articles on mount
  useEffect(() => {
    const fetchNews = async () => {
      try { const data = await api.getNewsArticles({ limit: 10 }); setNewsArticles(data || []); }
      catch (err) { console.error('Error fetching news:', err); }
      finally { setNewsLoading(false); }
    };
    fetchNews();
  }, []);

  // Watchlist persistence is owned by useWatchlist: DB for signed-in
  // users, in-memory only for anonymous. No localStorage involvement here.

  const toggleWatchlist = (symbol: string) => {
    setWatchlist(prev => prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]);
  };
  // Toggle panel: close if already open, open if different.
  // Uses current activePanel value (not prev callback) since state may be lifted to parent.
  const togglePanel = (panel: ActivePanel) => { setActivePanel(activePanel === panel ? null : panel); };

  return (
    <>
      <div className={`h-full flex ${isMobileLandscape ? 'overflow-y-auto touch-auto' : 'chart-no-scroll'}`}>
        {/* Icon Toolbar */}
        <div
          // Phone portrait: touch-pan-y allows internal vertical scroll of the
          // sidebar (content overflows on small screens) while overscroll-contain
          // prevents iOS Safari from chaining the gesture to the page (no
          // rubber-band / page shift). iPad and desktop keep pan-y as before.
          // Mobile landscape branch keeps existing touch-auto.
          // Phone width nudged from w-12 (48px) down to w-11 (44px), ~8.3% narrower
          // total, to claw back horizontal space for the chart on small screens.
          // md/lg breakpoints unchanged.
          className={`flex flex-col items-center w-11 md:w-14 lg:w-[60px] border-r border-border bg-card overflow-y-auto scrollbar-hide ${isMobileLandscape ? 'touch-auto pb-8' : 'h-full touch-pan-y overscroll-contain md:overscroll-auto'}`}
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {/* Home (desktop + phone) / Hamburger popover (iPad only): phone matches desktop's */}
          {/* direct 1-tap Home since TopNav is hidden on phone chart routes. iPad still uses the */}
          {/* popover (theme/sign-in) because its TopNav is hidden by neither App.tsx nor here. */}
          <div className="w-full flex items-center justify-center border-b border-border h-8 md:h-11 lg:h-[46px]">
            <Link to="/" className="flex md:hidden lg:flex items-center justify-center h-8 w-8 rounded-md transition-all text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground" title="Home">
              <Home className="h-[18px] w-[18px]" />
            </Link>
            <div className="hidden md:block lg:hidden">
              <Popover open={hamburgerOpen} onOpenChange={setHamburgerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className={`h-7 w-7 md:h-10 md:w-10 rounded-md transition-all ${hamburgerOpen ? 'text-foreground bg-muted/50' : 'text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground'}`}>
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="15" y2="6" /><line x1="3" y1="12" x2="13" y2="12" /><line x1="3" y1="18" x2="15" y2="18" /><circle cx="19" cy="14" r="4" /><circle cx="19" cy="14" r="1.5" fill="currentColor" /></svg>
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="right" align="start" className="w-56 p-0 bg-card border border-border shadow-xl rounded-lg overflow-hidden z-[100]" sideOffset={4}>
                  <div className="px-4 py-3 border-b border-border/60">
                    <div className="flex items-center gap-2">
                      <svg width="20" height="20" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="text-foreground flex-shrink-0"><line x1="72" y1="48" x2="72" y2="72" stroke="currentColor" strokeWidth="9" strokeLinecap="round" /><line x1="72" y1="128" x2="72" y2="156" stroke="currentColor" strokeWidth="9" strokeLinecap="round" /><rect x="52" y="72" width="40" height="56" rx="7" fill="currentColor" /><line x1="128" y1="38" x2="128" y2="58" className="stroke-[#1B5E20] dark:stroke-[#2E7D32]" strokeWidth="9" strokeLinecap="round" /><line x1="128" y1="122" x2="128" y2="162" className="stroke-[#1B5E20] dark:stroke-[#2E7D32]" strokeWidth="9" strokeLinecap="round" /><rect x="108" y="58" width="40" height="64" rx="7" className="fill-[#1B5E20] dark:fill-[#2E7D32]" /></svg>
                      <div className="min-w-0"><div className="text-sm font-bold leading-tight"><span className="text-foreground">London Strategic </span><span className="text-[#1B5E20] dark:text-[#2E7D32]">Edge</span></div></div>
                    </div>
                  </div>
                  <div className="py-1">
                    <button onClick={() => { navigate('/'); setHamburgerOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/60 transition-colors"><Home className="h-4 w-4 text-muted-foreground" />Home</button>
                    <button onClick={() => { navigate('/get-started'); setHamburgerOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/60 transition-colors"><Rocket className="h-4 w-4 text-muted-foreground" />Get Started</button>
                    <div className="h-px bg-border/60 my-1" />
                    <button onClick={() => { toggleTheme(); }} className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-foreground hover:bg-muted/60 transition-colors">
                      <div className="flex items-center gap-3">{theme === 'dark' ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}{theme === 'dark' ? 'Dark Theme' : 'Light Theme'}</div>
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${theme === 'dark' ? 'bg-[#2E7D32]' : 'bg-muted-foreground/30'}`}><div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${theme === 'dark' ? 'translate-x-4' : 'translate-x-0.5'}`} /></div>
                    </button>
                    <div className="h-px bg-border/60 my-1" />
                    {user ? (
                      <button onClick={async () => { try { await signOut(); } catch {} setHamburgerOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#1B5E20] dark:text-[#2E7D32] hover:bg-muted/60 transition-colors font-medium"><LogOut className="h-4 w-4" />Sign Out</button>
                    ) : (
                      <button onClick={() => { navigate('/auth'); setHamburgerOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#1B5E20] dark:text-[#2E7D32] hover:bg-muted/60 transition-colors font-medium"><LogIn className="h-4 w-4" />Sign In</button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Watchlist button: always visible (all screen sizes, including desktop).
              Lucide Star at 20px (h-5/w-5) so it sits in the same visual rhythm
              as the calendar/bell/settings sibling icons; active state fills the
              star so it visibly latches when the panel is open. shadcn Button
              bakes in `[&_svg]:size-4`, so the `!h-5 !w-5` override is required;
              a plain `h-5 w-5` is silently clobbered by the descendant rule. */}
          <div className="flex flex-col items-center pt-1 md:pt-2">
            <TooltipProvider delayDuration={300}><Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={`relative h-10 w-10 rounded-none transition-all ${activePanel === 'watchlist' ? 'text-foreground before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-foreground before:rounded-r' : 'text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground'}`} onClick={() => togglePanel('watchlist')}>
                <Star className="!h-5 !w-5" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" fill={activePanel === 'watchlist' ? 'currentColor' : 'none'} />
              </Button>
            </TooltipTrigger><TooltipContent side="right" className="text-xs">Watchlist</TooltipContent></Tooltip></TooltipProvider>
          </div>

          {/* Panel toggle icons + controls.
              On desktop (lg+), remaining buttons are shown in the RightToolbar bottom
              instead, keeping the left sidebar clean with only drawing tools.
              On mobile/tablet they remain here since RightToolbar is hidden. */}
          <div className="flex flex-col gap-0 pt-1 md:pt-0 lg:hidden">

            {/* Calendar: tablet only here. Phone moves it down to sit between */}
            {/* the folder (layout) and settings icons inside DrawingToolsPanel. */}
            <div className="hidden md:block">
              <TooltipProvider delayDuration={300}><Tooltip><TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className={`relative h-10 w-10 rounded-none transition-all ${activePanel === 'calendar' ? 'text-foreground before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-foreground before:rounded-r' : 'text-foreground/80 hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground'}`} onClick={() => togglePanel('calendar')}>
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /><circle cx="17.5" cy="17.5" r="4" fill="var(--background, white)" stroke="currentColor" strokeWidth="1.75" /><line x1="17.5" y1="15.5" x2="17.5" y2="17.5" /><line x1="17.5" y1="17.5" x2="19" y2="18.5" /></svg>
                </Button>
              </TooltipTrigger><TooltipContent side="right" className="text-xs">Calendar</TooltipContent></Tooltip></TooltipProvider>
            </div>

            {/* Chart controls: shortcuts, alerts, chart type, layout, settings */}
            <ChartControlsPanel
              onOpenShortcutsDialog={handleOpenShortcutsDialog}
              onShowAlertDialog={onShowAlertDialog}
              alertCount={alertCount}
              chartType={chartType}
              onChartTypeChange={onChartTypeChange}
              multiTimeframeLayout={multiTimeframeLayout}
              onLayoutChange={onLayoutChange}
              syncSettings={syncSettings}
              onSyncSettingsChange={onSyncSettingsChange}
              layoutSymbol={layoutSymbol}
              layoutTimeframe={layoutTimeframe}
              layoutDrawings={layoutDrawings}
              layoutIndicators={layoutIndicators}
              onLoadLayout={onLoadLayout}
              onOpenSaveDialog={onOpenSaveDialog}
              onOpenSettings={() => setShowChartSettings(true)}
            />
          </div>

          {/* Separator between panel icons and drawing tools (mobile/tablet only) */}
          <div className="w-5 h-px bg-border/40 my-1.5 lg:hidden" />

          {/* Drawing tools section */}
          {/* Layout + Settings props flow through here only so DrawingToolsPanel */}
          {/* can render them above the trash on phone. Tablet/desktop ignore */}
          {/* them via md:hidden inside DrawingToolsPanel. */}
          <DrawingToolsPanel
            activeTool={activeTool}
            onToolSelect={onToolSelect}
            drawings={drawings}
            onClearAllDrawings={onClearAllDrawings}
            selectedDrawingId={selectedDrawingId}
            onDeleteSelectedDrawing={onDeleteSelectedDrawing}
            drawingsLocked={drawingsLocked}
            onToggleLock={onToggleLock}
            drawingsHidden={drawingsHidden}
            onToggleHide={onToggleHide}
            indicatorCount={indicatorCount}
            onClearIndicators={onClearIndicators}
            onOpenShortcutsDialog={handleOpenShortcutsDialog}
            mobileTradingOpen={mobileTradingOpen}
            onToggleMobileTrading={onToggleMobileTrading}
            bottomPanelHidden={bottomPanelHidden}
            onToggleBottomPanel={onToggleBottomPanel}
            onOpenSettings={() => setShowChartSettings(true)}
            multiTimeframeLayout={multiTimeframeLayout}
            onLayoutChange={onLayoutChange}
            syncSettings={syncSettings}
            onSyncSettingsChange={onSyncSettingsChange}
            layoutSymbol={layoutSymbol}
            layoutTimeframe={layoutTimeframe}
            layoutDrawings={layoutDrawings}
            layoutIndicators={layoutIndicators}
            onLoadLayout={onLoadLayout}
            onOpenSaveDialog={onOpenSaveDialog}
            onToggleCalendar={() => togglePanel('calendar')}
            calendarPanelActive={activePanel === 'calendar'}
            onShowAlertDialog={onShowAlertDialog}
            alertCount={alertCount}
          />
        </div>

        {/* Slide-out Panel: resizable via drag handle on right edge */}
        <div
          className={`h-full overflow-hidden relative`}
          // No width transition: animating width causes the adjacent chart to
          // resize on every frame via ResizeObserver, distorting candles for the
          // entire 300ms duration. Instant open/close is cleaner; the chart only
          // needs one resize, matching how TradingView handles side panels.
          style={{
            width: activePanel ? `${panelWidth}px` : '0px',
          }}
        >
          {activePanel && (
            <div className="h-full flex flex-col border-r border-border bg-card/95 backdrop-blur-sm" style={{ width: `${panelWidth}px` }}>
              <div className="flex items-center justify-between p-2 md:p-3 border-b border-border">
                <span className="font-semibold text-sm">
                  {activePanel === 'watchlist' ? 'Watchlist' : activePanel === 'news' ? 'News' : 'Economic Events'}
                </span>
                <Button variant="ghost" size="icon" onClick={() => setActivePanel(null)} className="h-6 w-6"><X className="h-4 w-4" /></Button>
              </div>
              {activePanel === 'watchlist' && (
                <SymbolSearchPanel currentPair={currentPair} onPairSelect={onPairSelect} watchlist={watchlist} onToggleWatchlist={toggleWatchlist} livePrices={livePrices as any} newsArticles={newsArticles} />
              )}
              {activePanel === 'news' && (
                <NewsPanel newsArticles={newsArticles} newsLoading={newsLoading} />
              )}
              {activePanel === 'calendar' && (
                <CalendarPanel calendarEvents={calendarEvents} calendarLoading={calendarLoading} impactFilters={impactFilters} onImpactFilterChange={setImpactFilters} showEventsOnChart={showEventsOnChart} onShowEventsOnChartChange={onShowEventsOnChartChange} />
              )}
              {/* Drag handle: thin hit area on the right edge with a physical
                  button-like slider knob centered vertically. The knob has depth
                  (shadow, border, raised look) so users recognize it as draggable. */}
              <div
                className="absolute top-0 right-0 w-4 h-full cursor-col-resize z-20 flex items-center justify-center"
                onMouseDown={handleResizeStart}
              >
                {/* Physical slider knob: raised button with shadow and border for depth */}
                <div className={`w-[6px] h-10 rounded-full border shadow-sm transition-all ${
                  isDragging
                    ? 'bg-foreground/70 border-foreground/50 shadow-md scale-110'
                    : 'bg-foreground/50 border-foreground/40 hover:bg-foreground/70 hover:border-foreground/50 hover:shadow-md hover:scale-110'
                }`} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dialogs rendered at root level to avoid z-index issues */}
      <ChartSettingsDialog open={showChartSettings} onOpenChange={setShowChartSettings} />
      <DrawingShortcutsDialog open={showShortcutsDialog} onOpenChange={setShowShortcutsDialog} shortcuts={shortcuts} onSetShortcut={setShortcut} onRemoveShortcut={removeShortcut} getShortcutForTool={getShortcutForTool} onClearAll={clearAllShortcuts} />
      <ShortcutsSignupPrompt open={showSignupPrompt} onOpenChange={setShowSignupPrompt} />
    </>
  );
}

// Memoize the sidebar. It contains many Radix Tooltips via Slot+useComposedRefs
// which crash under rapid commit-phase re-renders (React error #185). Parent
// ChartPage re-renders on every throttled chart-stat update (~10Hz), and
// without memoization the sidebar re-renders 1:1 with the parent. Memoization
// only bails out when every prop reference is stable, so ChartPage MUST
// useCallback/useMemo every prop passed below; inline arrow functions break it.
const ChartLeftSidebar = React.memo(ChartLeftSidebarInner);
export default ChartLeftSidebar;

// ============================================================================
// NewsPanel - Inline sub-component for the news slide-out panel
// Small enough (~50 lines of JSX) to keep inline rather than a separate file.
// ============================================================================
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Newspaper as NewspaperIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface NewsPanelProps {
  newsArticles: { id: string; title: string; url: string; image_url: string | null; source_name: string; source_logo: string | null; published_at: string }[];
  newsLoading: boolean;
}

function NewsPanel({ newsArticles, newsLoading }: NewsPanelProps) {
  return (
    <ScrollArea className="flex-1 p-3">
      {newsLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => (<div key={i} className="flex gap-2"><Skeleton className="h-12 w-12 rounded-lg flex-shrink-0" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-full" /><Skeleton className="h-2 w-2/3" /></div></div>))}</div>
      ) : newsArticles.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground"><NewspaperIcon className="h-8 w-8 mx-auto mb-2 opacity-20" /><p className="text-xs">No news available</p></div>
      ) : (
        <div className="space-y-2">
          {newsArticles.map((article) => (
            <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="flex gap-2 group hover:bg-black/10 dark:hover:bg-white/10 p-1.5 -mx-1.5 rounded-lg transition-colors">
              {article.image_url ? (
                <div className="h-12 w-12 rounded-lg overflow-hidden flex-shrink-0 bg-muted"><img src={article.image_url} alt={article.title || "News"} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" /></div>
              ) : (
                <div className="h-12 w-12 rounded-lg flex-shrink-0 bg-muted flex items-center justify-center"><NewspaperIcon className="h-4 w-4 text-muted-foreground" /></div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-[11px] font-medium line-clamp-2 leading-tight group-hover:text-foreground transition-colors">{article.title}</h3>
                <div className="flex items-center gap-1.5 mt-1">
                  {article.source_logo && <img src={article.source_logo} alt={article.source_name} className="h-3 w-3 rounded-full" loading="lazy" />}
                  <span className="text-[9px] text-muted-foreground truncate">{article.source_name}</span>
                  <span className="text-[9px] text-muted-foreground flex items-center gap-0.5"><Clock className="h-2 w-2" />{formatDistanceToNow(new Date(article.published_at), { addSuffix: true })}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </ScrollArea>
  );
}
