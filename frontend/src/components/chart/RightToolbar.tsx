import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BarChart3, PieChart, Search, User, LogIn, LogOut, Moon, Sun, FlaskConical, BrainCircuit, Bell, LayoutDashboard, GraduationCap, Database, Code2, Keyboard, Settings, BookOpen } from "lucide-react";
import { getEventImpact } from "@/lib/eventImpact";


// Single source of truth for the RightToolbar width (Tailwind w-12 = 48px).
// Import this constant anywhere you need to account for the toolbar overlay
// instead of hardcoding 48. The desktop PRICE_AXIS_WIDTH (110px) includes
// this value: 62px base axis + 48px toolbar overlay = 110px total.
export const RIGHT_TOOLBAR_WIDTH = 48;

interface RightToolbarProps {
    currentSymbol?: string;
    optionsPdfEnabled?: boolean;
    onOptionsPdfToggle?: (enabled: boolean) => void;
    heatmapEnabled?: boolean;
    sessionsEnabled?: boolean;
    onSessionsToggle?: (enabled: boolean) => void;
    onHeatmapToggle?: (enabled: boolean) => void;
    // Brue scripting editor toggle (default chart mode only)
    brueEnabled?: boolean;
    showBrueEditor?: boolean;
    onBrueToggle?: () => void;
    // Bottom utility buttons (moved from left sidebar for cleaner desktop layout)
    activePanel?: 'watchlist' | 'news' | 'calendar' | null;
    onTogglePanel?: (panel: 'watchlist' | 'news' | 'calendar') => void;
    onOpenShortcuts?: () => void;
    onShowAlertDialog?: () => void;
    alertCount?: number;
    onOpenSettings?: (tab?: string) => void;
    // L2 depth panel toggle (moved from header toolbar for cleaner layout)
    l2DepthOpen?: boolean;
    onL2DepthToggle?: () => void;
    showL2Depth?: boolean;
    // OB Profile chart overlay toggle (per-bar L2 depth columns; BTC only today)
    obProfileEnabled?: boolean;
    onObProfileToggle?: () => void;
    showObProfile?: boolean;
    // Options flow overlay toggle (call/put volume bars per strike, anchored
    // to price axis; equity tickers only). Reads the options flow feed + WS.
    optionsFlowEnabled?: boolean;
    onOptionsFlowToggle?: () => void;
    showOptionsFlow?: boolean;
    // Favorites drawing toolbar toggle (TradingView pencil icon pattern).
    // Controls visibility of the floating FavoritesDrawingToolbar at top center.
    showFavoritesToolbar?: boolean;
    onFavoritesToolbarToggle?: () => void;
    // Crosshair style picker
    crosshairStyle?: string;
    onCrosshairStyleChange?: (style: string) => void;
}

// Website pages for search
const WEBSITE_PAGES = [
    { name: "Dashboard", path: "/dashboard", keywords: ["home", "overview", "main"] },
    { name: "Chart", path: "/chart", keywords: ["trading", "candlestick", "analysis"] },
    { name: "Forex", path: "/forex", keywords: ["currency", "fx", "pairs"] },
    { name: "Crypto", path: "/crypto", keywords: ["bitcoin", "ethereum", "coins"] },
    { name: "Commodities", path: "/commodities", keywords: ["gold", "oil", "silver"] },
    { name: "Indices", path: "/indices", keywords: ["stocks", "sp500", "dow"] },
    { name: "Futures", path: "/futures", keywords: ["es", "nq", "dax", "bund", "contracts"] },
    { name: "Stocks", path: "/stocks", keywords: ["equities", "shares", "company"] },
    { name: "Machine Learning Studio", path: "/machine-learning-studio", keywords: ["ai", "ml", "studio", "predictions"] },
    { name: "Stock Screener", path: "/stock-screener", keywords: ["filter", "scanner"] },
    { name: "Correlation Matrix", path: "/correlation-matrix", keywords: ["correlations"] },
    { name: "Economic Calendar", path: "/calendar", keywords: ["events", "news"] },
    { name: "News", path: "/news", keywords: ["articles", "headlines"] },
    { name: "Alerts", path: "/alerts", keywords: ["notifications", "price alerts"] },
];

// ============================================================================
// SEARCH PANEL
// ============================================================================
function SearchPanel() {
    const [query, setQuery] = useState("");

    const filteredPages = WEBSITE_PAGES.filter(page => {
        const q = query.toLowerCase();
        return page.name.toLowerCase().includes(q) ||
            page.keywords.some(k => k.includes(q));
    });

    return (
        <div className="w-64 p-3">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <Search className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Navigate</span>
            </div>
            <Input
                placeholder="Search..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 text-sm mb-2"
                autoFocus
            />
            <ScrollArea className="h-48">
                <div className="space-y-1">
                    {filteredPages.map((page) => (
                        <Link
                            key={page.path}
                            to={page.path}
                            className="block px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                        >
                            {page.name}
                        </Link>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}

// ============================================================================
// COT DATA PANEL
// ============================================================================
function COTPanel({ symbol }: { symbol?: string }) {
    // Convert symbol format: xau_usd or XAUUSD -> XAU/USD
    const formattedSymbol = symbol ? (
        symbol.includes('_')
            ? symbol.replace('_', '/').toUpperCase()
            : symbol.length === 6
                ? `${symbol.slice(0, 3)}/${symbol.slice(3)}`.toUpperCase()
                : symbol.toUpperCase()
    ) : undefined;

    const { data: cotData, isLoading } = useQuery({
        queryKey: ['cot-toolbar', formattedSymbol],
        queryFn: async () => {
            const data = await api.getCotData({ lseSymbol: formattedSymbol, limit: 1 });
            return data[0] || null;
        },
        enabled: !!formattedSymbol,
        staleTime: 1000 * 60 * 60,
    });

    const formatNum = (n: number | null | undefined) => {
        if (n === null || n === undefined || isNaN(n)) return '0';
        if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (Math.abs(n) >= 1000) return (n / 1000).toFixed(0) + 'K';
        return n.toFixed(0);
    };

    const getNetPosition = (long: number | null | undefined, short: number | null | undefined) => {
        const l = long || 0;
        const s = short || 0;
        return l - s;
    };

    const getBarWidth = (long: number | null | undefined, short: number | null | undefined) => {
        const l = long || 0;
        const s = short || 0;
        if (l + s === 0) return 50;
        return (l / (l + s)) * 100;
    };

    return (
        <div className="w-64 p-3">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">COT Positioning</span>
            </div>
            {isLoading ? (
                <div className="text-xs text-muted-foreground font-mono">Loading...</div>
            ) : cotData ? (
                <div className="space-y-3">
                    <div className="text-xs text-muted-foreground mb-2 font-mono">
                        {cotData.name || formattedSymbol} • {new Date(cotData.date).toLocaleDateString()}
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground">Commercial</span>
                            <span className={getNetPosition(cotData.comm_long, cotData.comm_short) > 0 ? "text-emerald-400" : "text-rose-400"}>
                                {formatNum(getNetPosition(cotData.comm_long, cotData.comm_short))}
                            </span>
                        </div>
                        <div className="h-1.5 bg-muted/30 rounded-sm overflow-hidden flex">
                            <div className="bg-emerald-500 h-full" style={{ width: `${getBarWidth(cotData.comm_long, cotData.comm_short)}%` }} />
                            <div className="bg-rose-500 h-full flex-1" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground">Large Specs</span>
                            <span className={getNetPosition(cotData.noncomm_long, cotData.noncomm_short) > 0 ? "text-emerald-400" : "text-rose-400"}>
                                {formatNum(getNetPosition(cotData.noncomm_long, cotData.noncomm_short))}
                            </span>
                        </div>
                        <div className="h-1.5 bg-muted/30 rounded-sm overflow-hidden flex">
                            <div className="bg-emerald-500 h-full" style={{ width: `${getBarWidth(cotData.noncomm_long, cotData.noncomm_short)}%` }} />
                            <div className="bg-rose-500 h-full flex-1" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground">Small Specs</span>
                            <span className={getNetPosition(cotData.nonrept_long, cotData.nonrept_short) > 0 ? "text-emerald-400" : "text-rose-400"}>
                                {formatNum(getNetPosition(cotData.nonrept_long, cotData.nonrept_short))}
                            </span>
                        </div>
                        <div className="h-1.5 bg-muted/30 rounded-sm overflow-hidden flex">
                            <div className="bg-emerald-500 h-full" style={{ width: `${getBarWidth(cotData.nonrept_long, cotData.nonrept_short)}%` }} />
                            <div className="bg-rose-500 h-full flex-1" />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="text-xs text-muted-foreground font-mono">No COT data for {formattedSymbol}</div>
            )}
        </div>
    );
}

// ============================================================================
// SECTOR SENTIMENT PANEL
// ============================================================================
function SectorSentimentPanel() {
    const { data: sectors, isLoading } = useQuery({
        queryKey: ['sector-sentiment-toolbar'],
        queryFn: () => api.getSectorSentiment(),
        staleTime: 1000 * 60 * 5,
    });

    const getScoreColor = (score: number) => {
        if (score >= 70) return "text-neon-green";
        if (score >= 40) return "text-yellow-400";
        return "text-neon-pink";
    };

    const getBgColor = (score: number) => {
        if (score >= 70) return "bg-neon-green";
        if (score >= 40) return "bg-yellow-400";
        return "bg-neon-pink";
    };

    return (
        <div className="w-64 p-3">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <PieChart className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Sector Sentiment</span>
            </div>
            {isLoading ? (
                <div className="text-xs text-muted-foreground">Loading...</div>
            ) : (
                <div className="space-y-2">
                    {sectors?.slice(0, 5).map((sector: any) => (
                        <div key={sector.sector_id} className="space-y-1">
                            <div className="flex justify-between text-xs">
                                <span className="font-mono">{sector.name}</span>
                                <span className={getScoreColor(sector.score)}>{sector.score}/100</span>
                            </div>
                            <div className="h-1 bg-muted rounded-full overflow-hidden">
                                <div className={`h-full ${getBgColor(sector.score)}`} style={{ width: `${sector.score}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ============================================================================
// XG STOCK BIAS PANEL
// ============================================================================
// ============================================================================
// CUSTOM ICONS
// ============================================================================
const SearchIcon = () => (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
        <path d="M11 8v6" />
        <path d="M8 11h6" />
    </svg>
);

const COTIcon = () => (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 21V3" />
        <path d="M3 21h18" />
        <rect x="6" y="12" width="3" height="7" rx="0.5" fill="currentColor" opacity="0.3" stroke="none" />
        <rect x="11" y="6" width="3" height="13" rx="0.5" fill="currentColor" opacity="0.5" stroke="none" />
        <rect x="16" y="9" width="3" height="10" rx="0.5" fill="currentColor" opacity="0.7" stroke="none" />
    </svg>
);

const SectorIcon = () => (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9" strokeDasharray="28.27 56.55" strokeDashoffset="0" />
        <circle cx="12" cy="12" r="9" strokeDasharray="14.14 56.55" strokeDashoffset="-28.27" />
        <circle cx="12" cy="12" r="9" strokeDasharray="14.14 56.55" strokeDashoffset="-42.41" />
        <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.2" stroke="none" />
    </svg>
);

// ============================================================================
// COMPACT ECONOMIC CALENDAR PANEL (for right toolbar popover)
// ============================================================================

// Map country codes to ISO 3166-1 alpha-2 codes for flag images
const getCountryCode = (code: string): string => {
    const codeMap: Record<string, string> = {
        "US": "us", "USD": "us",
        "EU": "eu", "EUR": "eu", "EA": "eu",
        "GB": "gb", "GBP": "gb", "UK": "gb",
        "JP": "jp", "JPY": "jp",
        "DE": "de", "Germany": "de",
        "FR": "fr", "France": "fr",
        "IT": "it", "Italy": "it",
        "CA": "ca", "CAD": "ca", "Canada": "ca",
        "AU": "au", "AUD": "au", "Australia": "au",
        "NZ": "nz", "NZD": "nz",
        "CH": "ch", "CHF": "ch", "Switzerland": "ch",
        "CN": "cn", "CNY": "cn", "China": "cn",
        "SG": "sg", "SGD": "sg",
        "SE": "se", "Sweden": "se",
        "NO": "no", "NOK": "no", "Norway": "no",
        "DK": "dk", "Denmark": "dk",
        "IN": "in", "India": "in",
        "BR": "br", "BRL": "br", "Brazil": "br",
        "MX": "mx", "Mexico": "mx",
        "RU": "ru", "RUB": "ru", "Russia": "ru",
        "KR": "kr", "South Korea": "kr",
        "TR": "tr", "TRY": "tr", "Turkey": "tr",
        "ZA": "za", "South Africa": "za",
        "ES": "es", "Spain": "es",
        "NL": "nl", "Netherlands": "nl",
        "BE": "be", "Belgium": "be",
        "AT": "at", "Austria": "at",
        "PL": "pl", "Poland": "pl",
        "HK": "hk", "Hong Kong": "hk",
        "TW": "tw", "Taiwan": "tw",
        "SA": "sa", "Saudi Arabia": "sa",
        "MK": "mk",
        "G20": "un", "ID": "id", "AR": "ar",
    };
    return codeMap[code?.toUpperCase()] || code?.toLowerCase() || '';
};

const FlagImage = ({ countryCode, className = "" }: { countryCode: string, className?: string }) => {
    const isoCode = getCountryCode(countryCode);
    if (!countryCode || countryCode === "Global" || countryCode === "G20" || !isoCode) {
        return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" className={`inline-block text-muted-foreground ${className}`}>
            <circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18z" />
        </svg>
    );
    }
    return (
        <img
            src={`https://flagcdn.com/16x12/${isoCode}.png`}
            srcSet={`https://flagcdn.com/32x24/${isoCode}.png 2x`}
            width="16"
            height="12"
            alt={countryCode}
            className={`inline-block object-contain ${className}`}
            loading="lazy"
            onError={(e) => {
                e.currentTarget.style.display = 'none';
            }}
        />
    );
};

function EconomicCalendarPanel() {
    const today = new Date().toISOString().split('T')[0];
    const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const [selectedCountry, setSelectedCountry] = useState<string>("All Countries");
    const [showHighOnly, setShowHighOnly] = useState(false);

    const { data: events, isLoading } = useQuery({
        queryKey: ['eco-calendar-toolbar', today],
        queryFn: () => api.getEconomicCalendar({
            startDate: today,
            endDate: weekAhead,
            order: 'asc',
            limit: 200
        }),
        staleTime: 1000 * 60 * 5,
    });

    // Extract unique countries from events
    const availableCountries = useMemo(() => {
        if (!events) return [];
        const countries = new Set<string>();
        events.forEach((evt: any) => {
            if (evt.region_code) countries.add(evt.region_code.toUpperCase());
        });
        return Array.from(countries).sort();
    }, [events]);

    // Filter events
    const filtered = (events || []).filter((evt: any) => {
        if (selectedCountry !== "All Countries" && evt.region_code?.toUpperCase() !== selectedCountry) return false;
        if (showHighOnly) {
            // Only show events that have consensus/forecast data; these are the "major" ones
            return evt.consensus || evt.forecast;
        }
        return true;
    });

    // Group by date
    const grouped = filtered.reduce((acc: Record<string, any[]>, evt: any) => {
        const d = evt.date || 'Unknown';
        if (!acc[d]) acc[d] = [];
        acc[d].push(evt);
        return acc;
    }, {});

    const formatDate = (dateStr: string) => {
        try {
            const d = new Date(dateStr + 'T00:00:00');
            const todayDate = new Date().toISOString().split('T')[0];
            const tomorrowDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
            const isToday = dateStr === todayDate;
            const isTmr = dateStr === tomorrowDate;
            const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            if (isToday) return `Today · ${day}`;
            if (isTmr) return `Tomorrow · ${day}`;
            return day;
        } catch { return dateStr; }
    };

    // Actual beat/miss styling
    const getActualStyle = (actual: string | null, consensus: string | null) => {
        if (!actual) return '';
        if (!consensus) return 'text-foreground font-semibold';
        const aNum = parseFloat(actual.replace(/[^0-9.\-]/g, ''));
        const cNum = parseFloat(consensus.replace(/[^0-9.\-]/g, ''));
        if (isNaN(aNum) || isNaN(cNum)) return 'text-foreground font-semibold';
        if (aNum > cNum) return 'text-emerald-400 font-semibold';
        if (aNum < cNum) return 'text-rose-400 font-semibold';
        return 'text-foreground font-semibold';
    };

    // Impact color mapping
    const getImpactDotStyle = (event: any) => {
        const impact = getEventImpact({ event: event.event || '', country: event.region_code || '' });
        if (impact === 'high') return 'bg-red-500';
        if (impact === 'medium') return 'bg-amber-500';
        return 'bg-emerald-500'; // low
    };

    return (
        <div className="w-[340px]">
            {/* Header */}
            <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></svg>
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Economic Calendar</span>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground/50">
                    {filtered.length} / {events?.length || 0}
                </span>
            </div>

            {/* Filters Row */}
            <div className="px-3 py-2 flex items-center justify-between gap-2">
                <select
                    value={selectedCountry}
                    onChange={(e) => setSelectedCountry(e.target.value)}
                    className="flex-1 bg-transparent border border-border/50 rounded px-2 py-1 text-[11px] font-mono text-muted-foreground focus:outline-none focus:border-foreground/30 focus:text-foreground transition-colors cursor-pointer appearance-none"
                    style={{ WebkitAppearance: 'none', background: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%22%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20fill%3D%22%239CA3AF%22%20d%3D%22M5.516%207.548c0.436-0.446%201.043-0.481%201.576%200l3.908%203.747%203.908-3.747c0.533-0.481%201.141-0.446%201.574%200%200.436%200.445%200.408%201.197%200%201.615-0.406%200.418-4.695%204.502-4.695%204.502-0.217%200.223-0.502%200.335-0.787%200.335s-0.57-0.112-0.789-0.335c0%200-4.287-4.084-4.695-4.502s-0.436-1.17%200-1.615z%22%2F%3E%3C%2Fsvg%3E") no-repeat right 4px top 50%' }}
                >
                    <option value="All Countries">All Countries</option>
                    {availableCountries.map(code => (
                        <option key={code} value={code}>{code}</option>
                    ))}
                </select>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowHighOnly(!showHighOnly)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border transition-all ${
                            showHighOnly
                                ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                                : 'border-border/50 text-muted-foreground hover:border-foreground/20 hover:text-foreground'
                        }`}
                    >
                        <span className={`h-1.5 w-1.5 rounded-full ${showHighOnly ? 'bg-amber-400' : 'bg-muted-foreground/40'}`} />
                        Major Only
                    </button>
                    <span className="text-[9px] font-mono text-muted-foreground/40">7d</span>
                </div>
            </div>

            <div className="border-t border-border/50" />

            {/* Events list */}
            {isLoading ? (
                <div className="flex items-center justify-center py-10">
                    <div className="h-4 w-4 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
                    <span className="text-xs text-muted-foreground font-mono ml-2">Loading events...</span>
                </div>
            ) : filtered.length > 0 ? (
                <ScrollArea className="h-80">
                    <div className="px-1.5 py-1">
                        {Object.entries(grouped).map(([date, dateEvents]) => (
                            <div key={date} className="mb-2">
                                {/* Date header */}
                                <div className="sticky top-0 bg-card/95 backdrop-blur-sm z-10 px-1.5 py-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">
                                            {formatDate(date)}
                                        </span>
                                        <span className="text-[9px] font-mono text-muted-foreground/40">
                                            {(dateEvents as any[]).length}
                                        </span>
                                        <div className="flex-1 border-t border-border/30" />
                                    </div>
                                </div>
                                <div className="space-y-0">
                                    {(dateEvents as any[]).map((evt: any, i: number) => {
                                        const hasForecast = evt.consensus || evt.forecast;
                                        return (
                                            <div key={i} className="group flex items-start gap-1.5 py-2 px-1.5 rounded-md hover:bg-muted/30 transition-colors border-b border-border/20 last:border-0">
                                                {/* Impact dot with event impact color */}
                                                <div className="flex flex-col items-center gap-0.5 pt-0.5 shrink-0">
                                                    <div className={`h-2 w-2 rounded-full ${getImpactDotStyle(evt)}`} />
                                                </div>
                                                {/* Time */}
                                                <span className="text-[10px] font-mono text-muted-foreground w-[50px] shrink-0 pt-0.5">
                                                    {evt.time || 'All Day'}
                                                </span>
                                                {/* Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-start gap-1.5">
                                                        <span className="shrink-0 mt-[3px]" title={evt.region_code}>
                                                            <FlagImage countryCode={evt.region_code || ''} className="h-2.5" />
                                                        </span>
                                                        <span className={`text-[11px] leading-tight ${hasForecast ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                                                            {evt.event}
                                                        </span>
                                                    </div>
                                                    {/* Period + data */}
                                                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                                        {evt.period_hint && (
                                                            <span className="text-[9px] font-mono px-1 py-px rounded bg-muted/60 text-muted-foreground border border-border/40">
                                                                {evt.period_hint}
                                                            </span>
                                                        )}
                                                        {evt.actual && (
                                                            <span className={`text-[10px] font-mono ${getActualStyle(evt.actual, evt.consensus || evt.forecast)}`}>
                                                                A: {evt.actual}
                                                            </span>
                                                        )}
                                                        {(evt.consensus || evt.forecast) && (
                                                            <span className="text-[10px] font-mono text-sky-400/90 font-medium">
                                                                E: {evt.consensus || evt.forecast}
                                                            </span>
                                                        )}
                                                        {evt.previous && (
                                                            <span className="text-[10px] font-mono text-muted-foreground/60">
                                                                P: {evt.previous}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            ) : (
                <div className="flex flex-col items-center py-8 text-muted-foreground">
                    <svg className="h-8 w-8 mb-2 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></svg>
                    <span className="text-xs font-mono">No events match filters</span>
                    <button onClick={() => { setSelectedCountry("All Countries"); setShowHighOnly(false); }} className="mt-1 text-[10px] font-mono text-sky-400 hover:underline">
                        Reset filters
                    </button>
                </div>
            )}

            {/* Footer */}
            <div className="px-3 py-2 border-t border-border/50 bg-muted/20">
                <Link to="/calendar" className="text-[10px] text-muted-foreground hover:text-foreground flex items-center justify-between font-mono uppercase tracking-wider transition-colors">
                    <span>→ Full Calendar</span>
                </Link>
            </div>
        </div>
    );
}

const OptionsPDFIcon = () => (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 12h3" strokeWidth="2" />
        <path d="M3 8h5" strokeWidth="1.5" opacity="0.6" />
        <path d="M3 16h5" strokeWidth="1.5" opacity="0.6" />
        <path d="M3 6h2" strokeWidth="1" opacity="0.3" />
        <path d="M3 18h2" strokeWidth="1" opacity="0.3" />
        <circle cx="15" cy="12" r="5" fill="currentColor" opacity="0.15" />
        <path d="M12 12l6 0" strokeDasharray="1 1" opacity="0.5" />
    </svg>
);

// ============================================================================
// OPTIONS PDF PANEL
// ============================================================================
function OptionsPDFPanel({ symbol }: { symbol?: string }) {
    // Map symbol to options PDF symbol (e.g., XAU/USD -> GLD)
    const getOptionSymbol = (sym?: string): string | null => {
        if (!sym) return null;
        const upper = sym.toUpperCase().replace('_', '').replace('/', '');
        if (upper.includes('XAU') || upper.includes('GOLD')) return 'GLD';
        if (upper.includes('SPY') || upper.includes('SPX')) return 'SPY';
        if (upper.includes('QQQ') || upper.includes('NDX') || upper.includes('NASDAQ')) return 'QQQ';
        return null;
    };

    const optionSymbol = getOptionSymbol(symbol);

    const { data: pdfData, isLoading } = useQuery({
        queryKey: ['options-pdf', optionSymbol],
        queryFn: async () => {
            if (!optionSymbol) return null;
            // Reads the live options_predicted_price table; the old options_pdf_*
            // tables were retired (frozen since Feb, same data lives here).
            const snapshot = await api.getOptionsPredictedPrice(optionSymbol);
            return snapshot;
        },
        enabled: !!optionSymbol,
        staleTime: 1000 * 60, // Refresh every minute
    });

    const formatPrice = (price: number) => {
        if (price >= 1000) return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
        return '$' + price.toFixed(2);
    };

    return (
        <div className="w-64 p-3">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                <OptionsPDFIcon />
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Options PDF</span>
            </div>
            {!optionSymbol ? (
                <div className="text-xs text-muted-foreground font-mono">
                    Options PDF available for Gold, SPY, QQQ
                </div>
            ) : isLoading ? (
                <div className="text-xs text-muted-foreground font-mono">Loading...</div>
            ) : pdfData ? (
                <div className="space-y-3">
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Symbol</span>
                        <span className="font-medium">{pdfData.display_name || optionSymbol}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Current Price</span>
                        <span className="text-emerald-400">{formatPrice(pdfData.current_price)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Most Likely</span>
                        <span className="text-amber-400">{formatPrice(pdfData.mode_price)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Direction</span>
                        <span className={pdfData.direction === 'bullish' ? "text-emerald-400" : "text-rose-400"}>
                            {pdfData.direction?.toUpperCase()}
                        </span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Distance</span>
                        <span className={pdfData.distance_pct >= 0 ? "text-emerald-400" : "text-rose-400"}>
                            {pdfData.distance_pct >= 0 ? '+' : ''}{pdfData.distance_pct?.toFixed(1)}%
                        </span>
                    </div>

                    {/* Probability bar */}
                    <div className="mt-3 pt-2 border-t border-border/50">
                        <div className="flex justify-between text-[10px] mb-1.5">
                            <span className="text-rose-400">↓ {((1 - (pdfData.prob_above || 0.5)) * 100).toFixed(0)}% Below</span>
                            <span className="text-emerald-400">{((pdfData.prob_above || 0.5) * 100).toFixed(0)}% Above ↑</span>
                        </div>
                        <div className="h-2 bg-muted/30 rounded overflow-hidden flex">
                            <div
                                className="bg-gradient-to-r from-rose-700 to-rose-500 h-full"
                                style={{ width: `${(1 - (pdfData.prob_above || 0.5)) * 100}%` }}
                            />
                            <div
                                className="bg-gradient-to-r from-emerald-500 to-emerald-700 h-full flex-1"
                            />
                        </div>
                    </div>

                    <div className="text-[10px] text-muted-foreground font-mono mt-2">
                        Updated: {new Date(pdfData.fetch_timestamp).toLocaleTimeString()}
                    </div>
                </div>
            ) : (
                <div className="text-xs text-muted-foreground font-mono">No PDF data available</div>
            )}
        </div>
    );
}

// ============================================================================
// CROSSHAIR STYLE PICKER
// ============================================================================
const CROSSHAIR_STYLES = [
  {
    id: 'standard',
    label: 'Standard',
    desc: 'Dashed cross',
    icon: (
      <svg viewBox="0 0 28 28" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="14" y1="2" x2="14" y2="26" strokeDasharray="3 2" />
        <line x1="2" y1="14" x2="26" y2="14" strokeDasharray="3 2" />
      </svg>
    ),
  },
  {
    id: 'blade',
    label: 'Blade',
    desc: 'Solid thin cross',
    icon: (
      <svg viewBox="0 0 28 28" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1">
        <line x1="14" y1="2" x2="14" y2="26" />
        <line x1="2" y1="14" x2="26" y2="14" />
      </svg>
    ),
  },
  {
    id: 'scope',
    label: 'Scope',
    desc: 'Dashed cross + reticle',
    icon: (
      <svg viewBox="0 0 28 28" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="14" y1="2" x2="14" y2="9" strokeDasharray="3 2" />
        <line x1="14" y1="19" x2="14" y2="26" strokeDasharray="3 2" />
        <line x1="2" y1="14" x2="9" y2="14" strokeDasharray="3 2" />
        <line x1="19" y1="14" x2="26" y2="14" strokeDasharray="3 2" />
        <circle cx="14" cy="14" r="5" />
      </svg>
    ),
  },
  {
    id: 'ghost',
    label: 'Ghost',
    desc: 'Faint solid cross',
    icon: (
      <svg viewBox="0 0 28 28" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
        <line x1="14" y1="2" x2="14" y2="26" />
        <line x1="2" y1="14" x2="26" y2="14" />
      </svg>
    ),
  },
  {
    id: 'h-only',
    label: 'Price Line',
    desc: 'Horizontal only',
    icon: (
      <svg viewBox="0 0 28 28" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="2" y1="14" x2="26" y2="14" />
        <circle cx="14" cy="14" r="2" fill="currentColor" />
      </svg>
    ),
  },
] as const;

// ============================================================================
// MAIN RIGHT TOOLBAR
// ============================================================================
export default function RightToolbar({ currentSymbol, optionsPdfEnabled, onOptionsPdfToggle, heatmapEnabled, onHeatmapToggle, sessionsEnabled, onSessionsToggle, brueEnabled, showBrueEditor, onBrueToggle, activePanel, onTogglePanel, onOpenShortcuts, onShowAlertDialog, alertCount = 0, onOpenSettings, l2DepthOpen, onL2DepthToggle, showL2Depth, obProfileEnabled, onObProfileToggle, showObProfile, optionsFlowEnabled, onOptionsFlowToggle, showOptionsFlow, showFavoritesToolbar, onFavoritesToolbarToggle, crosshairStyle = 'standard', onCrosshairStyleChange }: RightToolbarProps) {
    const { user, signOut } = useAuth();
    const [theme, toggleTheme] = useTheme();

    // Pre-fetch COT data for the current symbol to hide the button when no data exists.
    // Same query key as COTPanel so React Query deduplicates the request.
    const cotLseSymbol = currentSymbol ? (
        currentSymbol.includes('_')
            ? currentSymbol.replace('_', '/').toUpperCase()
            : currentSymbol.length === 6
                ? `${currentSymbol.slice(0, 3)}/${currentSymbol.slice(3)}`.toUpperCase()
                : currentSymbol.toUpperCase()
    ) : undefined;
    const { data: cotCheck } = useQuery({
        queryKey: ['cot-toolbar', cotLseSymbol],
        queryFn: async () => {
            const data = await api.getCotData({ lseSymbol: cotLseSymbol, limit: 1 });
            return data[0] || null;
        },
        enabled: !!cotLseSymbol,
        staleTime: 1000 * 60 * 60,
    });
    const hasCotData = !!cotCheck;

    const toolbarButtons = [
        { id: 'search', Icon: SearchIcon, label: 'Navigate', panel: <SearchPanel /> },
        ...(hasCotData ? [{ id: 'cot', Icon: COTIcon, label: 'COT Positioning', panel: <COTPanel symbol={currentSymbol} /> }] : []),
        { id: 'sentiment', Icon: SectorIcon, label: 'Sector Sentiment', panel: <SectorSentimentPanel /> },
    ];

    return (
        <div className="hidden lg:flex fixed right-0 top-0 bottom-8 z-40 flex-col justify-between bg-card border-l border-border">
            {/* Profile Avatar - top section */}
            <div className="flex flex-col items-center border-b border-border">
                <Popover>
                    <TooltipProvider delayDuration={200}>
                    <Tooltip>
                    <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                        {/* Blue selected-state (#2962ff) is the toolbar-wide pattern for any
                            button that has an open panel or an active feature. data-state=open
                            is set by Radix Popover on the trigger automatically. */}
                        <button
                            className="w-12 h-[46px] flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10 transition-colors data-[state=open]:text-[#2962ff] data-[state=open]:bg-[#2962ff]/10"
                        >
                            {user?.email ? (
                                <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground border border-border">
                                    {user.email.charAt(0).toUpperCase()}
                                </div>
                            ) : (
                                <User className="h-5 w-5" />
                            )}
                        </button>
                    </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">{user?.email || 'Account'}</TooltipContent>
                    </Tooltip>
                    </TooltipProvider>
                    <PopoverContent
                        side="left"
                        align="start"
                        className="w-56 p-0 bg-card border border-border shadow-xl rounded-lg overflow-hidden z-[100]"
                        sideOffset={4}
                    >
                        {/* Auth section - top */}
                        <div className="px-4 py-3 border-b border-border/60">
                            {user ? (
                                <>
                                    <p className="text-xs font-medium text-foreground truncate">{user.email}</p>
                                    <button
                                        onClick={async () => { try { await signOut(); } catch {} }}
                                        className="mt-2 w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <LogOut className="h-3.5 w-3.5" />
                                        Sign Out
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => { window.location.href = '/auth'; }}
                                    className="w-full flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground transition-colors"
                                >
                                    <LogIn className="h-4 w-4" />
                                    Sign In
                                </button>
                            )}
                        </div>

                        {/* Navigation links */}
                        <div className="py-1">
                            <button
                                onClick={() => { window.location.href = '/dashboard'; }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                            >
                                <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                                Dashboard
                            </button>
                            <button
                                onClick={() => { window.location.href = '/backtest'; }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                            >
                                <FlaskConical className="h-4 w-4 text-muted-foreground" />
                                My Backtests
                            </button>
                            <button
                                onClick={() => { window.location.href = '/machine-learning-studio'; }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                            >
                                <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                                ML Studio
                            </button>
                            <button
                                onClick={() => { window.location.href = '/machine-learning/education'; }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                            >
                                <GraduationCap className="h-4 w-4 text-muted-foreground" />
                                Education
                            </button>
                            <button
                                onClick={() => { window.location.href = '/data'; }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                            >
                                <Database className="h-4 w-4 text-muted-foreground" />
                                Datasets
                            </button>
                            <button
                                onClick={() => { window.location.href = '/alerts'; }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                            >
                                <Bell className="h-4 w-4 text-muted-foreground" />
                                Alerts
                            </button>
                        </div>

                        {/* Chart Settings - opens the ChartSettingsDialog modal so users
                            can customise candle colors, grid, alerts, and events without
                            leaving the chart page */}
                        <div className="border-t border-border/60 py-1">
                            <button
                                onClick={() => { onOpenSettings?.(); }}
                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                            >
                                <Settings className="h-4 w-4 text-muted-foreground" />
                                Chart Settings
                            </button>
                        </div>

                        {/* Theme toggle - bottom */}
                        <div className="border-t border-border/60 py-1">
                            <button
                                onClick={toggleTheme}
                                className="w-full flex items-center justify-between px-4 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    {theme === 'dark' ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
                                    {theme === 'dark' ? 'Dark' : 'Light'}
                                </div>
                                {/* Toggle track: black in light mode for clear visibility, muted in dark mode */}
                                <div className={`relative w-9 h-5 rounded-full transition-colors ${theme === 'dark' ? 'bg-foreground/40' : 'bg-black'}`}>
                                    <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${theme === 'dark' ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                </div>
                            </button>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            {/* Tool buttons: each icon opens a panel via Popover and shows a
                TradingView-style tooltip on hover (side="left" since the toolbar
                is pinned to the right edge of the viewport) */}
            <div className="flex-1 flex flex-col pt-2">
                <TooltipProvider delayDuration={200}>
                {toolbarButtons.map((btn) => (
                    <Popover key={btn.id}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <PopoverTrigger asChild>
                                    <button
                                        className="w-12 h-12 flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10 transition-all data-[state=open]:text-[#2962ff] data-[state=open]:bg-[#2962ff]/10"
                                    >
                                        <btn.Icon />
                                    </button>
                                </PopoverTrigger>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">{btn.label}</TooltipContent>
                        </Tooltip>
                        <PopoverContent side="left" align="start" className="p-0 w-auto">
                            {btn.panel}
                        </PopoverContent>
                    </Popover>
                ))}

                {/* Options Predicted Price Heatmap Toggle */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            className={`w-12 h-12 flex items-center justify-center transition-all ${optionsPdfEnabled
                                ? 'text-[#2962ff] bg-[#2962ff]/10 hover:bg-[#2962ff]/20'
                                : 'text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10'
                                }`}
                            onClick={() => onOptionsPdfToggle?.(!optionsPdfEnabled)}
                        >
                            <OptionsPDFIcon />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                        {optionsPdfEnabled ? 'Hide Predicted Price Overlay' : 'Show Predicted Price Overlay'}
                    </TooltipContent>
                </Tooltip>

                {/* Brue scripting editor toggle: opens a side panel where users can write
                    custom indicators and overlays using the Brue scripting language.
                    Only shown in default chart mode (not broker-demo). */}
                {brueEnabled && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                className={`w-12 h-12 flex items-center justify-center transition-all ${showBrueEditor
                                    ? 'text-[#2962ff] bg-[#2962ff]/10 hover:bg-[#2962ff]/20'
                                    : 'text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10'
                                    }`}
                                onClick={onBrueToggle}
                            >
                                <Code2 className="h-6 w-6" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                            {showBrueEditor ? 'Close Brue Editor' : 'Open Brue Editor'}
                        </TooltipContent>
                    </Tooltip>
                )}

                {/* L2 Depth Panel toggle: shows order book depth for supported symbols
                    (ES, NQ, 6E futures). Moved here from the header toolbar to keep the
                    top bar clean. Only rendered when the current symbol supports L2 data. */}
                {showL2Depth && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                className={`w-12 h-12 flex items-center justify-center transition-all ${l2DepthOpen
                                    ? 'text-[#2962ff] bg-[#2962ff]/10 hover:bg-[#2962ff]/20'
                                    : 'text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10'
                                    }`}
                                onClick={onL2DepthToggle}
                            >
                                <BookOpen className="h-6 w-6" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                            {l2DepthOpen ? 'Hide L2 Depth' : 'Show L2 Depth'}
                        </TooltipContent>
                    </Tooltip>
                )}

                {/* Options flow overlay toggle. Renders call/put volume bars
                    per strike anchored to the price axis (Bookmap-style).
                    Equity tickers only, gated on showOptionsFlow at the
                    page level (any non-crypto pair). */}
                {showOptionsFlow && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                className={`w-12 h-12 flex items-center justify-center transition-all ${optionsFlowEnabled
                                    ? 'text-[#2962ff] bg-[#2962ff]/10 hover:bg-[#2962ff]/20'
                                    : 'text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10'
                                    }`}
                                onClick={onOptionsFlowToggle}
                                aria-label="Toggle options flow overlay"
                            >
                                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    {/* Calls (green): short bars top half, longer toward middle */}
                                    <line x1="14" y1="5"  x2="21" y2="5"  />
                                    <line x1="11" y1="8"  x2="21" y2="8"  />
                                    <line x1="16" y1="11" x2="21" y2="11" />
                                    {/* Strike axis */}
                                    <line x1="3"  y1="12" x2="21" y2="12" strokeDasharray="2 2" />
                                    {/* Puts (red): bars bottom half */}
                                    <line x1="13" y1="14" x2="21" y2="14" />
                                    <line x1="9"  y1="17" x2="21" y2="17" />
                                    <line x1="15" y1="20" x2="21" y2="20" />
                                </svg>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                            {optionsFlowEnabled ? 'Hide Options Flow Panel' : 'Show Options Flow Panel'}
                        </TooltipContent>
                    </Tooltip>
                )}

                {/* OB Profile chart overlay toggle. Renders per-bar L2 depth
                    columns over the candles. Only meaningful on symbols with
                    a populated l2_ob_profile_1m row stream; BTC today. */}
                {showObProfile && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                className={`w-12 h-12 flex items-center justify-center transition-all ${obProfileEnabled
                                    ? 'text-[#2962ff] bg-[#2962ff]/10 hover:bg-[#2962ff]/20'
                                    : 'text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10'
                                    }`}
                                onClick={onObProfileToggle}
                                aria-label="Toggle OB Profile overlay"
                            >
                                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3"  y="6"  width="6" height="2" />
                                    <rect x="3"  y="10" width="9" height="2" />
                                    <rect x="3"  y="14" width="4" height="2" />
                                    <rect x="13" y="8"  width="8" height="2" />
                                    <rect x="13" y="12" width="5" height="2" />
                                    <rect x="13" y="16" width="7" height="2" />
                                </svg>
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                            {obProfileEnabled ? 'Hide OB Profile' : 'Show OB Profile'}
                        </TooltipContent>
                    </Tooltip>
                )}
                </TooltipProvider>
            </div>

            {/* Bottom utility buttons: slight bottom padding so settings icon
                sits just above the v.23 watermark for cleaner alignment */}
            <div className="flex flex-col items-center border-t border-border pb-6">
                <TooltipProvider delayDuration={200}>
                {/* Crosshair style picker, above the pencil */}
                {onCrosshairStyleChange && (
                <Popover>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                                <button
                                    className={`w-12 h-12 flex items-center justify-center transition-all data-[state=open]:text-[#2962ff] data-[state=open]:bg-[#2962ff]/10 ${
                                        crosshairStyle !== 'standard'
                                            ? 'text-[#2962ff] bg-[#2962ff]/10 hover:bg-[#2962ff]/20'
                                            : 'text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10'
                                    }`}
                                    aria-label="Crosshair style"
                                >
                                    {CROSSHAIR_STYLES.find(s => s.id === crosshairStyle)?.icon ?? CROSSHAIR_STYLES[0].icon}
                                </button>
                            </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">Crosshair Style</TooltipContent>
                    </Tooltip>
                    <PopoverContent side="left" align="end" className="p-2 w-44">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2 px-1">Crosshair</div>
                        <div className="space-y-0.5">
                            {CROSSHAIR_STYLES.map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => onCrosshairStyleChange(s.id)}
                                    className={`w-full flex items-center gap-3 px-2 py-2 rounded text-left transition-colors ${
                                        crosshairStyle === s.id
                                            ? 'bg-black/10 dark:bg-white/10 text-foreground'
                                            : 'text-foreground hover:bg-black/10 dark:hover:bg-white/10'
                                    }`}
                                >
                                    <span className="shrink-0">{s.icon}</span>
                                    <span className="flex flex-col min-w-0">
                                        <span className="text-xs font-medium">{s.label}</span>
                                        <span className="text-[10px] text-muted-foreground">{s.desc}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </PopoverContent>
                </Popover>
                )}
                {/* Favorites drawing toolbar toggle: pencil icon that shows/hides the
                    floating FavoritesDrawingToolbar at top center. Matches TradingView's
                    pattern of a pencil icon in the right toolbar to toggle drawing tools. */}
                {onFavoritesToolbarToggle && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            className={`w-12 h-12 flex items-center justify-center transition-all ${
                                showFavoritesToolbar
                                    ? 'text-[#2962ff] bg-[#2962ff]/10 hover:bg-[#2962ff]/20'
                                    : 'text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10'
                            }`}
                            onClick={onFavoritesToolbarToggle}
                        >
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                <path d="m15 5 4 4" />
                            </svg>
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                        {showFavoritesToolbar ? 'Hide Drawing Toolbar' : 'Show Drawing Toolbar'}
                    </TooltipContent>
                </Tooltip>
                )}
                {/* Calendar with compact popover */}
                <Popover>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                                <button
                                    className="w-12 h-12 flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10 transition-all data-[state=open]:text-[#2962ff] data-[state=open]:bg-[#2962ff]/10"
                                >
                                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></svg>
                                </button>
                            </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">Economic Calendar</TooltipContent>
                    </Tooltip>
                    <PopoverContent side="left" align="end" className="p-0 w-auto">
                        <EconomicCalendarPanel />
                    </PopoverContent>
                </Popover>
                {/* Keyboard shortcuts moved to left sidebar (above trash icon) */}
                {/* Settings */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            className="w-12 h-12 flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground transition-all"
                            onClick={() => onOpenSettings?.()}
                        >
                            <Settings className="h-6 w-6" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">Chart Settings</TooltipContent>
                </Tooltip>
                </TooltipProvider>
            </div>

        </div>
    );
}
