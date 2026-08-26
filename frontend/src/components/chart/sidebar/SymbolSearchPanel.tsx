// ============================================================================
// SymbolSearchPanel.tsx - Watchlist + symbol search + detail panel
// Dense, table-style watchlist (column headers, category groups, hairline
// row dividers) instead of chunky rounded cards. Color-only percentages,
// no pill badges. Detail panel below uses flat sections divided by 1px
// rules to match the new aesthetic.
//
// Data source: useMarketData().searchAssets, the instrument catalog (5,500+ symbols).
// Live prices: useWatchlistPrices hook (REST polling + 7-day sparkline cache).
// ============================================================================

import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Search, Star, Plus, X, Clock, Newspaper, ExternalLink, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { useMarketData } from "@/hooks/useMarketData";
import { ThemeLogo } from "@/components/ui/ThemeLogo";

// Simplified pair interface used by watchlist rows. Maps directly from SearchAsset.
interface WatchlistPair {
  symbol: string;
  category: string;
}

// TradingView-style starter list: spans every asset class so first-time users
// see grouped sections (Indices / Stocks / Commodities / Crypto / Forex) right
// away. All symbols verified against the instrument catalog.
// 5 symbols per asset class, all verified against the live price catalog. Order within
// each class is "most recognizable first" so a new user scanning the column
// hits familiar names immediately (Gold before Brent, S&P before DAX, etc.).
export const DEFAULT_WATCHLIST = [
  // Indices
  "SPX500/USD", "NAS100/USD", "US30/USD", "UK100/GBP", "DE30/EUR",
  // Stocks
  "NVDA", "AAPL", "MSFT", "AMZN", "META",
  // Commodities
  "XAU/USD", "XAG/USD", "WTICO/USD", "BCO/USD", "NATGAS/USD",
  // Crypto
  "BTC/USD", "ETH/USD", "SOL/USD", "BNB/USD", "XRP/USD",
  // Forex
  "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD",
];

export type { WatchlistPair };

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

interface SymbolSearchPanelProps {
  currentPair?: string;
  onPairSelect?: (pair: string) => void;
  watchlist: string[];
  onToggleWatchlist: (symbol: string) => void;
  livePrices: Record<string, { price: number; change: number; open?: number; high?: number; low?: number; changeWeekly?: number | null; nickname?: string; image_path_light?: string | null; image_path_dark?: string | null; sparkline?: number[]; marketCap?: number }>;
  newsArticles: NewsArticle[];
}

// Helper: get category color classes for badges and avatar fallbacks.
// Centralised so watchlist rows, search results, and detail panel stay consistent.
const getCategoryColors = (category: string) => {
  switch (category) {
    case 'Crypto': return { bg: 'bg-amber-600/15', text: 'text-amber-500', ring: 'ring-amber-500/20', badge: 'text-amber-500/60' };
    case 'Forex': return { bg: 'bg-sky-600/15', text: 'text-sky-500', ring: 'ring-sky-500/20', badge: 'text-sky-500/60' };
    case 'Stock': return { bg: 'bg-slate-500/15', text: 'text-slate-400', ring: 'ring-slate-400/20', badge: 'text-slate-400/60' };
    case 'ETF': return { bg: 'bg-indigo-500/15', text: 'text-indigo-400', ring: 'ring-indigo-400/20', badge: 'text-indigo-400/60' };
    case 'Commodity': return { bg: 'bg-lime-600/15', text: 'text-lime-500', ring: 'ring-lime-500/20', badge: 'text-lime-500/60' };
    case 'Index': return { bg: 'bg-violet-500/15', text: 'text-violet-400', ring: 'ring-violet-400/20', badge: 'text-violet-400/60' };
    case 'Futures': return { bg: 'bg-rose-500/15', text: 'text-rose-400', ring: 'ring-rose-400/20', badge: 'text-rose-400/60' };
    default: return { bg: 'bg-muted/15', text: 'text-muted-foreground', ring: 'ring-border/20', badge: 'text-muted-foreground/60' };
  }
};

// Group order + display labels for the watchlist section headers. Order is the
// reading order brokers expect (macro instruments first, then equities, then
// crypto/FX which most users put at the bottom).
const CATEGORY_ORDER = ['Index', 'Stock', 'ETF', 'Commodity', 'Futures', 'Crypto', 'Forex', 'Other'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  Index: 'Indices', Stock: 'Stocks', ETF: 'ETFs', Crypto: 'Crypto',
  Forex: 'Forex', Commodity: 'Commodities', Futures: 'Futures', Other: 'Other',
};

// Format a price with appropriate decimal places based on asset type and magnitude.
const formatPrice = (category: string, price: number): string => {
  if (price <= 0) return "--";
  if (category === "Forex") return price.toFixed(price < 10 ? 5 : 3);
  if (category === "Crypto") return price < 1 ? price.toFixed(6) : price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Format market cap into human-readable short form (e.g. 2.4T, 850B, 12.3M).
const formatMarketCap = (cap: number): string => {
  if (cap >= 1e12) return `${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e9) return `${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6) return `${(cap / 1e6).toFixed(1)}M`;
  return cap.toLocaleString();
};

export default function SymbolSearchPanel({
  currentPair,
  onPairSelect,
  watchlist,
  onToggleWatchlist,
  livePrices,
  newsArticles,
}: SymbolSearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { searchAssets } = useMarketData();

  // Convert searchAssets to WatchlistPair format for consistent usage below.
  // Uses canonical symbol (with slash) since watchlist stores "EUR/USD" not "EURUSD".
  const allPairs = useMemo<WatchlistPair[]>(() => {
    return searchAssets.map(a => ({ symbol: a.symbol, category: a.category }));
  }, [searchAssets]);

  // Search covers all symbols in the instrument catalog.
  // Matches against symbol ticker and category name.
  const filteredPairs = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return allPairs.filter(pair =>
      pair.symbol.toLowerCase().includes(query) ||
      pair.category.toLowerCase().includes(query)
    ).slice(0, 10);
  }, [searchQuery, allPairs]);

  // Watchlist pairs: match watchlist symbols against the universal list.
  // Falls back to creating a basic entry for any watchlisted symbol not yet in DB.
  const watchlistPairs = useMemo(() => {
    const pairMap = new Map(allPairs.map(p => [p.symbol, p]));
    return watchlist.map(sym => pairMap.get(sym) || { symbol: sym, category: 'Stock' });
  }, [watchlist, allPairs]);

  // Group watchlist rows by asset class so the panel renders as titled sections,
  // matching how brokers (TV/IB) lay out their watchlists. Categories not in the
  // explicit order list fall into "Other" so nothing silently disappears.
  const groupedWatchlist = useMemo(() => {
    const buckets: Record<string, WatchlistPair[]> = {};
    for (const pair of watchlistPairs) {
      const cat = (CATEGORY_ORDER as readonly string[]).includes(pair.category) ? pair.category : 'Other';
      (buckets[cat] ||= []).push(pair);
    }
    return CATEGORY_ORDER.filter(cat => buckets[cat]?.length).map(cat => [cat, buckets[cat]] as const);
  }, [watchlistPairs]);

  return (
    // Solid bg-card on the root so the parent's bg-card/95 + backdrop-blur
    // doesn't let the chart's grid lines tint the empty scroll area grey.
    // Only the detail panel sibling at the bottom keeps its grey fill.
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* ── Search Bar ── pill-shaped input with a subtle filled surface so it
          reads as a real control instead of floating text */}
      <div className="px-3 pt-2.5 pb-2.5 border-b border-border/40">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50 pointer-events-none" />
          <Input
            placeholder="Search instruments"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 pr-2 text-[11px] bg-background hover:bg-background focus:bg-background border border-border/50 focus-visible:border-border/70 shadow-none rounded-md focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50 transition-colors"
          />
        </div>
      </div>

      {/* ── Search Results ── flat list, hairline-divided */}
      {searchQuery && filteredPairs.length > 0 && (
        <div className="border-b border-border/30 max-h-[40%] overflow-y-auto">
          {filteredPairs.map(pair => {
            const colors = getCategoryColors(pair.category);
            return (
              <div
                key={pair.symbol}
                className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/40 cursor-pointer transition-colors border-b border-border/[0.06] last:border-0"
                onClick={() => {
                  onToggleWatchlist(pair.symbol);
                  setSearchQuery("");
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0 ${colors.bg} ${colors.text}`}>
                    {pair.symbol.charAt(0)}
                  </div>
                  <span className="text-[11px] font-mono font-semibold tracking-tight truncate">{pair.symbol}</span>
                  <span className={`text-[8.5px] uppercase tracking-[0.06em] font-medium flex-shrink-0 ${colors.badge}`}>{pair.category}</span>
                </div>
                {watchlist.includes(pair.symbol) ? (
                  <Star className="h-3 w-3 text-yellow-500/70 fill-yellow-500/70 flex-shrink-0" />
                ) : (
                  <Plus className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Column Headers ── flush on the white panel; structure comes from the
          1px border below, not a tinted fill */}
      {watchlistPairs.length > 0 && (
        <div className="flex items-center px-3 py-1.5 text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground/55 font-semibold border-b border-border/40 select-none">
          <span className="flex-1">Symbol</span>
          <span className="w-[68px] text-right">Last</span>
          <span className="w-[60px] text-right">Chg%</span>
        </div>
      )}

      {/* ── Watchlist Rows ── dense rows grouped by asset class */}
      <ScrollArea className="flex-1 min-h-0">
        {watchlistPairs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground/40">
            <Star className="h-8 w-8 mx-auto mb-2 opacity-15" />
            <p className="text-xs font-medium">No pairs in watchlist</p>
            <p className="text-[10px] mt-1 text-muted-foreground/25">Search above to add instruments</p>
          </div>
        ) : (
          groupedWatchlist.map(([cat, pairs]) => (
            <div key={cat}>
              {/* Section header: white, hairlines top and bottom only */}
              <div className="flex items-center gap-1 px-3 py-1 text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground/65 font-semibold border-y border-border/30 select-none">
                <ChevronDown className="h-2.5 w-2.5 opacity-60" strokeWidth={2.5} />
                <span>{CATEGORY_LABELS[cat] ?? cat}</span>
                <span className="text-muted-foreground/40 font-normal normal-case tracking-normal ml-0.5">{pairs.length}</span>
              </div>

              {pairs.map(pair => {
                const priceData = livePrices[pair.symbol];
                const isPositive = !!priceData && priceData.change >= 0;
                const isActive = currentPair === pair.symbol.replace('/', '');
                const colors = getCategoryColors(pair.category);

                const handlePairClick = (e: React.MouseEvent) => {
                  if (onPairSelect) {
                    e.preventDefault();
                    onPairSelect(pair.symbol.replace('/', ''));
                  }
                };

                return (
                  <Link
                    key={pair.symbol}
                    to={`/chart/${pair.symbol.replace('/', '')}`}
                    onClick={handlePairClick}
                    className={`group relative flex items-center px-3 py-2 transition-colors border-b border-border/15 last:border-0 ${
                      isActive ? 'bg-foreground/[0.07]' : 'hover:bg-muted/40'
                    }`}
                  >
                    {/* Active row accent: 2px left bar, mirrors the toolbar selected state */}
                    {isActive && <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-foreground" aria-hidden />}

                    {/* Logo: small flat circle, no thick ring. Hover-only remove button. */}
                    <div className="flex-shrink-0 w-5 h-5 mr-2 relative">
                      {priceData?.image_path_light ? (
                        <ThemeLogo srcLight={priceData.image_path_light} srcDark={priceData.image_path_dark} alt="" className="w-5 h-5 rounded-full object-cover" />
                      ) : (
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${colors.bg} ${colors.text}`}>
                          {pair.symbol.charAt(0)}
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onToggleWatchlist(pair.symbol);
                        }}
                        className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-card border border-border/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label={`Remove ${pair.symbol}`}
                      >
                        <X className="h-1.5 w-1.5 text-muted-foreground" />
                      </button>
                    </div>

                    {/* Symbol ticker (no nickname row; keeps the table dense and Citadel-flat) */}
                    <span className={`flex-1 min-w-0 truncate text-[11.5px] font-semibold tracking-tight ${isActive ? 'text-foreground' : 'text-foreground/95'}`}>
                      {pair.symbol}
                    </span>

                    {/* Last price: right-aligned, monospace, tabular figures */}
                    <span className="w-[68px] text-right text-[11px] font-mono tabular-nums text-foreground/95 leading-none">
                      {priceData ? formatPrice(pair.category, priceData.price) : '--'}
                    </span>

                    {/* Change %: color-only, no pill, terminal-style */}
                    <span className={`w-[60px] text-right text-[10.5px] font-mono tabular-nums leading-none ${
                      priceData && priceData.price > 0 ? (isPositive ? 'text-up' : 'text-down') : 'text-muted-foreground/40'
                    }`}>
                      {priceData && priceData.price > 0 ? `${isPositive ? '+' : ''}${priceData.change.toFixed(2)}%` : '--'}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))
        )}
      </ScrollArea>

      {/* ── Detail Panel for Active Symbol ── */}
      {/* Shows real data only: price, 24h/7d change, OHLC, market cap, news. */}
      {/* Flat sections divided by 1px rules to match the new watchlist aesthetic. */}
      {(() => {
        const activePair = watchlistPairs.find(p => currentPair === p.symbol.replace('/', ''));
        const d = activePair ? livePrices[activePair.symbol] : null;
        if (!activePair || !d || !d.price) return null;

        const pos = d.change >= 0;
        const absChg = d.open ? d.price - d.open : null;
        const p = d.price;
        const dec = p < 10 ? 5 : p < 100 ? 4 : 2;
        const colors = getCategoryColors(activePair.category);

        // Filter news articles relevant to this symbol.
        const symbolBase = activePair.symbol.split('/')[0]?.toUpperCase() || activePair.symbol.replace('/', '').toUpperCase();
        const relevantNews = newsArticles.filter(article => {
          const titleLower = article.title?.toLowerCase() || '';
          const symbolLower = symbolBase.toLowerCase();
          const nickLower = (d.nickname || '').toLowerCase();
          return titleLower.includes(symbolLower) ||
            (nickLower && nickLower.length > 3 && titleLower.includes(nickLower)) ||
            titleLower.includes(activePair.symbol.toLowerCase());
        }).slice(0, 3);

        return (
          <div className="border-t-2 border-border/50 bg-muted/15 flex-shrink-0 flex flex-col max-h-[55%] overflow-y-auto">
            {/* Header: avatar, symbol, big price, change row. Subtle bg fill so the
                quote block reads as a card, not floating text. */}
            <div className="px-4 pt-3 pb-3 bg-card/60 border-b border-border/40">
              <div className="flex items-center gap-2.5 mb-2">
                {d.image_path_light ? (
                  <ThemeLogo srcLight={d.image_path_light} srcDark={d.image_path_dark} alt="" className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${colors.bg} ${colors.text}`}>
                    {activePair.symbol.charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold leading-none tracking-tight">{activePair.symbol}</div>
                  <div className="text-[10.5px] text-muted-foreground/55 truncate mt-0.5 max-w-[180px]">
                    {d.nickname || activePair.symbol} <span className="opacity-40 mx-1">&bull;</span> <span className="opacity-50">{activePair.category}</span>
                  </div>
                </div>
                {/* Live indicator: small dot, no pulse animation. Subtle Citadel cue. */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-up" />
                  <span className="text-[8.5px] text-muted-foreground/50 uppercase tracking-[0.1em] font-medium">Live</span>
                </div>
              </div>

              {/* Price + change inline. Big tabular price, change as plain colored text. */}
              <div className="flex items-baseline gap-2">
                <span className="text-[24px] font-mono font-bold tracking-tight text-foreground leading-none tabular-nums">
                  {p.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })}
                </span>
                <span className="text-[9.5px] font-mono text-muted-foreground/50 font-semibold leading-none">
                  {activePair.symbol.includes('EUR') || activePair.symbol.includes('GBP') || activePair.symbol.includes('JPY') ? activePair.symbol.slice(-3) : 'USD'}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`text-[12px] font-mono tabular-nums font-medium ${pos ? 'text-up' : 'text-down'}`}>
                  {absChg != null ? `${absChg >= 0 ? '+' : ''}${absChg.toFixed(dec)}` : '--'}
                </span>
                <span className={`text-[11px] font-mono tabular-nums font-semibold ${pos ? 'text-up' : 'text-down'}`}>
                  {pos ? '+' : ''}{d.change.toFixed(2)}%
                </span>
              </div>
            </div>

            {/* Key Stats: 2-column grid sitting in the inset bg. Each cell has a
                light card fill so the stats read as tiles, not naked text. */}
            <div className="px-3 py-3">
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-card/70 border border-border/30 rounded-md px-3 py-2">
                  <div className="text-[8px] text-muted-foreground/55 uppercase tracking-[0.1em] font-semibold mb-0.5">24h Change</div>
                  <div className={`text-[12px] font-mono font-semibold tabular-nums ${pos ? 'text-up' : 'text-down'}`}>
                    {pos ? '+' : ''}{d.change.toFixed(2)}%
                  </div>
                </div>
                <div className="bg-card/70 border border-border/30 rounded-md px-3 py-2">
                  <div className="text-[8px] text-muted-foreground/55 uppercase tracking-[0.1em] font-semibold mb-0.5">7D Change</div>
                  {d.changeWeekly != null ? (
                    <div className={`text-[12px] font-mono font-semibold tabular-nums ${d.changeWeekly >= 0 ? 'text-up' : 'text-down'}`}>
                      {d.changeWeekly >= 0 ? '+' : ''}{d.changeWeekly.toFixed(2)}%
                    </div>
                  ) : (
                    <div className="text-[12px] font-mono text-muted-foreground/35">{'--'}</div>
                  )}
                </div>
                <div className="bg-card/70 border border-border/30 rounded-md px-3 py-2">
                  <div className="text-[8px] text-muted-foreground/55 uppercase tracking-[0.1em] font-semibold mb-0.5">Open</div>
                  <div className="text-[12px] font-mono font-medium tabular-nums text-foreground/90">
                    {d.open ? d.open.toFixed(dec) : '--'}
                  </div>
                </div>
                <div className="bg-card/70 border border-border/30 rounded-md px-3 py-2">
                  <div className="text-[8px] text-muted-foreground/55 uppercase tracking-[0.1em] font-semibold mb-0.5">
                    {d.marketCap ? 'Market Cap' : 'H / L'}
                  </div>
                  <div className="text-[12px] font-mono font-medium tabular-nums text-foreground/90">
                    {d.marketCap
                      ? formatMarketCap(d.marketCap)
                      : (d.high && d.low ? `${d.high.toFixed(dec > 3 ? 2 : dec)} / ${d.low.toFixed(dec > 3 ? 2 : dec)}` : '--')
                    }
                  </div>
                </div>
                {d.marketCap && d.high && d.low && (
                  <>
                    <div className="bg-card/70 border border-border/30 rounded-md px-3 py-2">
                      <div className="text-[8px] text-muted-foreground/55 uppercase tracking-[0.1em] font-semibold mb-0.5">High</div>
                      <div className="text-[12px] font-mono font-medium tabular-nums text-up/90">
                        {d.high.toFixed(dec)}
                      </div>
                    </div>
                    <div className="bg-card/70 border border-border/30 rounded-md px-3 py-2">
                      <div className="text-[8px] text-muted-foreground/55 uppercase tracking-[0.1em] font-semibold mb-0.5">Low</div>
                      <div className="text-[12px] font-mono font-medium tabular-nums text-down/90">
                        {d.low.toFixed(dec)}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Related or Market News */}
            {(relevantNews.length > 0 || newsArticles.length > 0) && (
              <div className="px-4 pt-2.5 pb-3 bg-card/60 border-t border-border/40">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Newspaper className="h-3 w-3 text-muted-foreground/40" />
                  <span className="text-[8.5px] font-semibold text-muted-foreground/55 tracking-[0.1em] uppercase">
                    {relevantNews.length > 0 ? 'Related News' : 'Market News'}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {(relevantNews.length > 0 ? relevantNews : newsArticles.slice(0, 3)).map((article) => (
                    <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="flex gap-2 p-1.5 -mx-1.5 hover:bg-muted/30 transition-colors group/news">
                      {article.image_url ? (
                        <div className="h-9 w-9 overflow-hidden flex-shrink-0 bg-muted">
                          <img src={article.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </div>
                      ) : (
                        <div className="h-9 w-9 flex-shrink-0 bg-muted/30 flex items-center justify-center">
                          <Newspaper className="h-3 w-3 text-muted-foreground/20" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[10px] font-medium line-clamp-2 leading-tight group-hover/news:text-foreground transition-colors">{article.title}</h4>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[8px] text-muted-foreground/40 truncate">{article.source_name}</span>
                          <span className="text-[8px] text-muted-foreground/25">&bull;</span>
                          <span className="text-[8px] text-muted-foreground/25 flex items-center gap-0.5">
                            <Clock className="h-2 w-2" />
                            {formatDistanceToNow(new Date(article.published_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                      <ExternalLink className="h-2.5 w-2.5 text-muted-foreground/15 flex-shrink-0 mt-1 group-hover/news:text-muted-foreground/40" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
