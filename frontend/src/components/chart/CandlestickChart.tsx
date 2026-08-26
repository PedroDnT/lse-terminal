import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { api } from "@/lib/api";
import UniversalChart from "./UniversalChart";
import { IndicatorConfig } from "./IndicatorSettings";
import { isUSMarketOpen as checkUSMarketOpen, isUSHoliday, isUSEarlyClose, isMarketOpenForPair } from "@/lib/marketHours";
// useSymbolTableMap replaced by useMarketData (single source of truth for all symbol data)
import { useMarketData } from "@/hooks/useMarketData";
import { useLiveTick } from "@/contexts/WebSocketContext";
import { useLiveCandleFromTicks, mergeLiveCandleWithHistory, type LiveCandle } from "@/hooks/useLiveCandleFromTicks";

interface CandleData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface LiveTick {
  symbol: string;
  price: number;
  ts: string;
}

const TF_MINUTES: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1H": 60,
  "4H": 240,
  "1D": 1440,
  "1W": 10080,
  "1M": 43200,
};

function timeframeToMinutes(tf: string) {
  return TF_MINUTES[tf] ?? 1;
}

function aggregateCandles(candles: CandleData[], minutes: number): CandleData[] {
  if (minutes === 1) return candles;
  const bucketMs = minutes * 60_000;
  const buckets = new Map<number, CandleData>();

  for (const c of candles) {
    const t = new Date(c.timestamp).getTime();
    const bucket = Math.floor(t / bucketMs) * bucketMs;
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, {
        timestamp: new Date(bucket).toISOString(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      });
    } else {
      existing.high = Math.max(Number(existing.high), Number(c.high));
      existing.low = Math.min(Number(existing.low), Number(c.low));
      existing.close = Number(c.close);
    }
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([_, v]) => v);
}

interface CandlestickChartProps {
  pair: string;
  timeframe: string;
  customColors?: {
    upColor: string;
    downColor: string;
    upBorderColor: string;
    downBorderColor: string;
    wickUpColor: string;
    wickDownColor: string;
    backgroundColor: string;
    gridColor: string;
  };
  onStats?: (stats: {
    count?: number;
    price?: number | null;
    time?: number | null;
    dayChange?: number;
    countdown?: string;
  }) => void;
  indicators?: IndicatorConfig;
  activeTool?: any;
  drawings?: any[];
  onDrawingsChange?: (drawings: any[]) => void;
}

const CandlestickChart = ({
  pair,
  timeframe,
  customColors,
  onStats,
  indicators,
  activeTool,
  drawings,
  onDrawingsChange,
}: CandlestickChartProps) => {
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState<string>("");
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const onStatsRef = useRef(onStats);

  // Use the symbol table map hook for correct table name resolution
  const { getTableName: getTableNameFromMap, isLoaded: tableMapLoaded } = useMarketData();

  const formatPairForTable = (pairStr: string) => {
    // First try the dynamic map (from x_pricecache)
    const mappedName = getTableNameFromMap(pairStr);
    if (mappedName && !mappedName.startsWith('candles_' + pairStr.toLowerCase().replace(/[\/\.]/g, '_'))) {
      // If we got a different name from the map, use it
      return mappedName;
    }

    // Handle international stocks with dots (SHEL.L, 9988.HK) - replace dots with underscores
    if (pairStr.includes('.')) {
      return `candles_${pairStr.toLowerCase().replace(/\./g, '_')}`;
    }

    // All pairs use underscore format: candles_bnb_usd, candles_eur_usd, etc.
    // USD must come BEFORE USDT/USDC/BUSD to avoid BNBUSD matching as BN+BUSD instead of BNB+USD
    const quoteCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD', 'BTC', 'USDT', 'USDC', 'BUSD', 'NOK', 'SEK', 'DKK', 'SGD', 'HKD', 'CNH', 'ZAR', 'MXN', 'BRL', 'TRY', 'PLN', 'CZK', 'HUF', 'ILS', 'INR', 'THB', 'PHP', 'KRW', 'TWD', 'CLP', 'COP', 'PEN'];
    for (const quote of quoteCurrencies) {
      if (pairStr.toUpperCase().endsWith(quote)) {
        const base = pairStr.slice(0, -quote.length);
        return `candles_${base.toLowerCase()}_${quote.toLowerCase()}`;
      }
    }

    // Fallback: assume simple stock symbol - but also check the map
    const mapResult = getTableNameFromMap(pairStr);
    return mapResult || `candles_${pairStr.toLowerCase()}`;
  };

  const formatPairForSymbol = (pairStr: string) => {
    // Same logic for symbol format - order by length (longest first)
    const quoteCurrencies = ['USDT', 'USDC', 'BUSD', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD', 'BTC', 'NOK', 'SEK', 'DKK', 'SGD', 'HKD', 'CNH', 'ZAR', 'MXN', 'BRL', 'TRY', 'PLN', 'CZK', 'HUF', 'ILS', 'INR', 'THB', 'PHP', 'KRW', 'TWD', 'CLP', 'COP', 'PEN'];

    for (const quote of quoteCurrencies) {
      if (pairStr.toUpperCase().endsWith(quote)) {
        const base = pairStr.slice(0, -quote.length);
        return `${base}/${quote}`;
      }
    }

    // Fallback to old logic if no match
    return `${pairStr.slice(0, 3)}/${pairStr.slice(3)}`;
  };

  // Check if pair is a commodity (markets closed on weekends)
  const isCommodity = (pairStr: string) => {
    const upper = pairStr.toUpperCase();
    return /XAU|XAG|GOLD|SILVER|XAUUSD|XAGUSD/.test(upper);
  };

  // Check if pair is a US stock (no quote currency suffix)
  const isStock = (pairStr: string) => {
    const quotes = ['USDT', 'USDC', 'BUSD', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD', 'BTC', 'NOK', 'SEK', 'DKK', 'SGD', 'HKD', 'CNH', 'ZAR', 'MXN', 'BRL', 'TRY', 'PLN', 'CZK', 'HUF', 'ILS', 'INR', 'THB', 'PHP', 'KRW', 'TWD', 'CLP', 'COP', 'PEN'];
    const upper = pairStr.toUpperCase();
    for (const q of quotes) {
      if (upper.endsWith(q) && upper.length > q.length) return false;
    }
    return true;
  };

  // NOTE: Weekend filtering is now handled server-side

  // Check if timestamp is within US market hours (9:30 AM - 4:00 PM ET)
  // Uses centralized market hours logic with holiday support
  const isUSMarketOpen = (timestamp: string | number) => {
    return checkUSMarketOpen(timestamp);
  };

  // Determine decimal places based on pair type
  const getDecimalPlaces = (pairStr: string) => {
    const upper = pairStr.toUpperCase();

    // Forex pairs (major currencies) - show 5-6 decimals for micro pips
    if (upper.match(/(EUR|GBP|AUD|NZD|USD|CAD|CHF).*(USD|EUR|GBP|JPY|CAD|AUD|CHF|NZD)/)) {
      // JPY pairs typically use 3 decimals
      if (upper.includes("JPY")) return 3;
      // Other forex pairs show 5 decimals (micro pips)
      return 5;
    }

    // Commodities like Gold (XAU), Silver (XAG) - 2 decimals
    if (upper.match(/XAU|XAG|GOLD|SILVER/)) return 2;

    // Crypto - vary by coin
    if (upper.match(/BTC|ETH|XMR/)) return 2;
    if (upper.match(/DOGE|ADA|XRP/)) return 5;

    // Default to 5 decimals
    return 5;
  };

  // WebSocket live tick subscription - pass raw pair, WebSocketContext handles formatting
  const { tick: wsTick } = useLiveTick(pair, true);

  // Get timeframe in minutes for live candle hook
  const tfMinutes = useMemo(() => timeframeToMinutes(timeframe), [timeframe]);

  // Only fetch candle data once the symbol table map is loaded
  useEffect(() => {
    if (!tableMapLoaded) return;

    fetchCandleData();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [pair, timeframe, tableMapLoaded]);

  const aggregated = useMemo(() => {
    return aggregateCandles(candles, timeframeToMinutes(timeframe));
  }, [candles, timeframe]);

  // Use the new clean live candle formation hook
  const {
    liveCandle,
    completedCandlesVersion,
    getCompletedCandlesMap,
    processTick,
    initializeFromHistory,
    reset: resetLiveCandle
  } = useLiveCandleFromTicks({
    timeframeMinutes: tfMinutes,
    enabled: true,
    pair: pair // Pass pair for sessionStorage persistence key
  });

  // Process incoming WebSocket ticks through the new hook
  useEffect(() => {
    if (!wsTick) return;

    // Update live price display
    setLivePrice(wsTick.price);

    // Process tick through the clean candle formation logic
    processTick({
      price: wsTick.price,
      ts: wsTick.ts
    });
  }, [wsTick, processTick]);

  // Initialize live candle formation when historical data loads
  useEffect(() => {
    if (aggregated.length === 0) return;

    const lastCandle = aggregated[aggregated.length - 1];
    const lastTime = new Date(lastCandle.timestamp).getTime();
    initializeFromHistory(Number(lastCandle.close), lastTime);
  }, [aggregated.length, initializeFromHistory]);

  // Reset live candle when pair or timeframe changes
  useEffect(() => {
    resetLiveCandle();
    setLivePrice(null);
  }, [pair, timeframe, resetLiveCandle]);

  // Push stats to parent (count, price, time, daily change)
  useEffect(() => {
    const cb = onStatsRef.current;
    if (!cb) return;
    const last = aggregated.length ? aggregated[aggregated.length - 1] : null;
    const price = livePrice ?? (last ? Number(last.close) : null);
    const time = livePrice ? Date.now() : last ? new Date(last.timestamp).getTime() : null;

    // Calculate daily change: compare current price with the first candle from 24h ago
    let dayChange = 0;
    if (price && aggregated.length > 0) {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const dayAgoCandle = aggregated.find((c) => new Date(c.timestamp).getTime() >= oneDayAgo);
      if (dayAgoCandle) {
        const openPrice = Number(dayAgoCandle.open);
        dayChange = ((price - openPrice) / openPrice) * 100;
      }
    }

    cb({ count: aggregated.length, price, time, dayChange, countdown });
  }, [aggregated, livePrice]);

  // Keep ref in sync without retriggering stats effect
  useEffect(() => {
    onStatsRef.current = onStats;
  }, [onStats]);

  // Update countdown timer based on timeframe (accounts for market hours)
  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      const timeframeMinutes = timeframeToMinutes(timeframe);
      const msPerCandle = timeframeMinutes * 60_000;

      // Check if market is open for this pair
      if (!isMarketOpenForPair(pair)) {
        setCountdown("");
        return;
      }

      // Calculate next candle close time
      const nextCandleClose = Math.ceil(now / msPerCandle) * msPerCandle;
      const diff = nextCandleClose - now;

      // Format as time
      const nextCloseDate = new Date(nextCandleClose);
      const timeStr = nextCloseDate.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;

      if (minutes > 0) {
        setCountdown(`${timeStr} (${minutes}m ${remainingSeconds}s)`);
      } else {
        setCountdown(`${timeStr} (${remainingSeconds}s)`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [timeframe, pair]);

  const fetchCandleData = async () => {
    setLoading(true);
    try {
      const tableName = formatPairForTable(pair);

      // Load enough candles for zooming, but not the entire dataset
      const targetBars = 1000;
      const timeframeMinutes = timeframeToMinutes(timeframe);
      const requiredCandles = targetBars * timeframeMinutes;

      const pageSize = 1000;
      let all: any[] = [];

      // Fetch only what's needed to render ~1000 bars for the selected timeframe
      const maxIterations = Math.ceil(requiredCandles / pageSize);
      for (let i = 0; i < maxIterations; i++) {
        const data = await api.getCandlesRange(tableName, {
          offset: i * pageSize,
          limit: pageSize,
          order: 'desc',
          select: 'timestamp,open,high,low,close'
        });

        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < pageSize) break;

        // Safety limit
        if (all.length >= 50000) break;
      }

      all.reverse();
      setCandles(all as any);
    } catch (err) {
      console.error("Error:", err);
      setCandles([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !tableMapLoaded) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground animate-pulse">Loading chart data...</div>
      </div>
    );
  }

  if (candles.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">No data available for this pair</div>
      </div>
    );
  }

  // Detect if this is a crypto pair (contains BTC, ETH, etc.)
  const isCrypto = /BTC|ETH|SOL|ADA|XRP|DOGE|BNB|XMR/i.test(pair);

  const chartCandles = useMemo(() => {
    const mapped = aggregated.map((c) => ({
      time: new Date(c.timestamp).getTime(),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));

    // CRITICAL: Get tick-formed candles from REF (synchronous, no batching issues)
    const tickFormedMap = getCompletedCandlesMap();
    const tickFormedCandles = Array.from(tickFormedMap.values());

    // Merge tick-formed completed candles AND current live candle
    return mergeLiveCandleWithHistory(mapped, liveCandle, tickFormedCandles);
  }, [aggregated, liveCandle, completedCandlesVersion, getCompletedCandlesMap]);

  // No separate liveBar needed - it's already merged into chartCandles
  const liveBar = null;

  const decimalPlaces = getDecimalPlaces(pair);

  return (
    <div className="relative h-full">
      <UniversalChart
        candles={chartCandles}
        liveBar={liveBar}
        title={formatPairForSymbol(pair)}
        customColors={customColors}
        isCrypto={isCrypto}
        timeframe={timeframe}
        indicators={indicators}
      />
    </div>
  );
};

export default CandlestickChart;
