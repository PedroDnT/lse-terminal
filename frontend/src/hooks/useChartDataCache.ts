import { useRef, useCallback } from 'react';

interface CandleData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface CacheEntry {
  data: CandleData[];
  fetchedAt: number;
  timeframe: string;
}

// Simple in-memory cache for chart data
// IMPORTANT: Now clears on navigation to prevent stale tick data conflicts
const globalCache = new Map<string, CacheEntry>();

// Cache TTL: 2 minutes - shorter to prevent stale data conflicts with live ticks
const CACHE_TTL_MS = 2 * 60 * 1000;

// Track which pair was last viewed - clear cache when switching pairs
let lastViewedPair: string | null = null;

// Clear cache for a specific pair or all pairs - exported for external use
export function clearChartCache(pair?: string) {
  if (pair) {
    // Clear all timeframes for this pair
    const lowerPair = pair.toLowerCase();
    for (const key of globalCache.keys()) {
      if (key.startsWith(lowerPair)) {
        globalCache.delete(key);
      }
    }
  } else {
    globalCache.clear();
  }
}

export function useChartDataCache() {
  const cacheRef = useRef(globalCache);
  
  const getCacheKey = useCallback((pair: string, timeframe: string) => {
    return `${pair.toLowerCase()}-${timeframe}`;
  }, []);
  
  const getCachedData = useCallback((pair: string, timeframe: string): CandleData[] | null => {
    const key = getCacheKey(pair, timeframe);
    const entry = cacheRef.current.get(key);

    if (!entry) return null;

    // Check if cache is still valid
    const age = Date.now() - entry.fetchedAt;
    if (age > CACHE_TTL_MS) {
      cacheRef.current.delete(key);
      return null;
    }

    return entry.data;
  }, [getCacheKey]);

  const setCachedData = useCallback((pair: string, timeframe: string, data: CandleData[]) => {
    const key = getCacheKey(pair, timeframe);
    cacheRef.current.set(key, {
      data,
      fetchedAt: Date.now(),
      timeframe,
    });

    // Limit cache size - increased to 50 entries for powerful server
    if (cacheRef.current.size > 50) {
      // Remove oldest entries
      const entries = Array.from(cacheRef.current.entries());
      entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
      for (let i = 0; i < 10; i++) {
        cacheRef.current.delete(entries[i][0]);
      }
    }
  }, [getCacheKey]);
  
  const updateCacheWithNewCandles = useCallback((pair: string, timeframe: string, newCandles: CandleData[]) => {
    const key = getCacheKey(pair, timeframe);
    const entry = cacheRef.current.get(key);
    
    if (!entry) return;
    
    // Merge new candles with existing data
    const existingMap = new Map(entry.data.map(c => [c.timestamp, c]));
    for (const c of newCandles) {
      existingMap.set(c.timestamp, c);
    }
    
    const merged = Array.from(existingMap.values())
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    entry.data = merged;
    entry.fetchedAt = Date.now();
  }, [getCacheKey]);
  
  const clearCache = useCallback((pair?: string, timeframe?: string) => {
    if (pair && timeframe) {
      const key = getCacheKey(pair, timeframe);
      cacheRef.current.delete(key);
    } else if (pair) {
      // Clear all timeframes for this pair
      for (const key of cacheRef.current.keys()) {
        if (key.startsWith(pair.toLowerCase())) {
          cacheRef.current.delete(key);
        }
      }
    } else {
      cacheRef.current.clear();
    }
  }, [getCacheKey]);
  
  // When switching pairs, clear cache for the old pair to prevent stale data
  const handlePairChange = useCallback((newPair: string) => {
    if (lastViewedPair && lastViewedPair !== newPair.toLowerCase()) {
      // Clear old pair's cache completely
      clearChartCache(lastViewedPair);
    }
    lastViewedPair = newPair.toLowerCase();
  }, []);
  
  return {
    getCachedData,
    setCachedData,
    updateCacheWithNewCandles,
    clearCache,
    handlePairChange,
  };
}

// Device-aware candle limits - doubled for powerful server
export function getOptimalCandleLimit(): number {
  if (typeof window === 'undefined') return 10000;
  
  const width = window.innerWidth;
  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1024;
  
  // Mobile: 5000 candles (doubled from 2500)
  // Tablet: 10000 candles (doubled from 5000)
  // Desktop: 10000 candles (doubled from 5000)
  if (isMobile) return 5000;
  if (isTablet) return 10000;
  return 10000;
}

// Progressive loading helper - returns initial fast load count (phase 1).
// Phase 2 (5k) and Phase 3 (10k) load in background after this renders.
export function getInitialLoadCount(): number {
  if (typeof window === 'undefined') return 1000;

  const width = window.innerWidth;
  // Phase 1: 1k candles for instant render on desktop, 600 on mobile.
  // Phase 2 (5k) and Phase 3 (10k) follow automatically in background.
  return width < 768 ? 600 : 1000;
}
