import { useRef, useCallback, useState, useEffect } from 'react';

/**
 * Live candle formation from tick data
 * 
 * This hook manages the formation of the current (live) candle from tick data.
 * When a new candle period starts, the previous live candle is "finalized" and
 * becomes part of the historical data.
 * 
 * IMPORTANT: For 1-minute timeframe, all tick data is used to form each candle's
 * OHLC values. When the candle completes, these values are preserved.
 */

export interface LiveCandle {
  time: number;      // Bucket start timestamp in ms
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TickData {
  price: number;
  ts: number;        // Timestamp (could be seconds or ms, we handle both)
}

interface UseLiveCandleOptions {
  timeframeMinutes: number;
  enabled?: boolean;
  onCandleComplete?: (candle: LiveCandle) => void;
}

/**
 * Get the bucket start time for a given timestamp and timeframe
 */
function getBucketStart(timestampMs: number, timeframeMinutes: number): number {
  const bucketMs = timeframeMinutes * 60 * 1000;
  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

/**
 * Normalize tick timestamp to milliseconds
 * Handles both seconds (WebSocket often sends seconds) and milliseconds
 */
function normalizeTimestamp(ts: number): number {
  // If the timestamp is less than year 2000 in ms, it's likely in seconds
  // Year 2000 in ms = 946684800000, year 2000 in seconds = 946684800
  if (ts < 1e12) {
    return ts * 1000;
  }
  return ts;
}

// Storage key for persisting completed candles across refreshes
function getStorageKey(pair: string, timeframeMinutes: number): string {
  return `lse-tick-candles-${pair}-${timeframeMinutes}`;
}

// Clear all tick candle storage for a pair (call on navigation away)
export function clearTickCandleStorage(pair?: string): void {
  try {
    if (pair) {
      // Clear all timeframes for this pair
      const prefix = `lse-tick-candles-${pair}-`;
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
    } else {
      // Clear ALL tick candle storage
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('lse-tick-candles-')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
    }
  } catch {
    // Ignore storage errors
  }
}

// Load persisted candles from sessionStorage
function loadPersistedCandles(pair: string, timeframeMinutes: number): Map<number, LiveCandle> {
  try {
    const key = getStorageKey(pair, timeframeMinutes);
    const stored = sessionStorage.getItem(key);
    if (!stored) return new Map();

    const parsed = JSON.parse(stored) as Array<[number, LiveCandle]>;
    // Filter out candles older than 5 minutes to prevent stale data accumulation
    // Reduced from 10 minutes to minimize conflict window
    const cutoff = Date.now() - 5 * 60 * 1000;
    const filtered = parsed.filter(([time]) => time > cutoff);
    return new Map(filtered);
  } catch {
    return new Map();
  }
}

// Persist candles to sessionStorage
function persistCandles(pair: string, timeframeMinutes: number, candles: Map<number, LiveCandle>): void {
  try {
    const key = getStorageKey(pair, timeframeMinutes);
    // Only persist last 5 candles to keep storage small and reduce stale data
    const entries = Array.from(candles.entries()).slice(-5);
    sessionStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // Ignore storage errors
  }
}

interface UseLiveCandleOptionsExtended extends UseLiveCandleOptions {
  pair?: string; // For persistence key
}

export function useLiveCandleFromTicks({
  timeframeMinutes,
  enabled = true,
  onCandleComplete,
  pair = 'default'
}: UseLiveCandleOptionsExtended) {
  // Current live candle being formed from ticks
  const [liveCandle, setLiveCandle] = useState<LiveCandle | null>(null);

  // Ref to track the previous candle close for smooth transitions
  const lastCompletedCloseRef = useRef<number | null>(null);

  // Ref to track the current bucket for comparison
  const currentBucketRef = useRef<number | null>(null);

  // Store the full tick-formed candle data to preserve on completion
  const liveCandleDataRef = useRef<LiveCandle | null>(null);

  // CRITICAL: Use a REF for completed candles to avoid React batching issues
  // Initialize from sessionStorage to survive page refreshes
  const completedCandlesRef = useRef<Map<number, LiveCandle>>(loadPersistedCandles(pair, timeframeMinutes));

  // Trigger re-renders when completed candles change
  const [completedCandlesVersion, setCompletedCandlesVersion] = useState(0);

  // Legacy state for backwards compatibility
  const [completedCandles, setCompletedCandles] = useState<LiveCandle[]>([]);

  // THROTTLE: Prevent React from being overwhelmed during high tick volume
  // We process ALL ticks for OHLC calculation, but throttle UI state updates
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCandleUpdateRef = useRef<LiveCandle | null>(null);
  const THROTTLE_MS = 50; // Max 20 UI updates per second

  // Process a new tick - this is the core candle formation logic
  // CRITICAL: Use CURRENT wall-clock time for bucket, not tick timestamp
  const processTick = useCallback((tick: TickData) => {
    if (!enabled) return;

    // Use current wall-clock time for bucket determination
    // This ensures candle switches exactly when the minute changes
    const nowMs = Date.now();
    const currentBucket = getBucketStart(nowMs, timeframeMinutes);
    const price = tick.price;

    // Read the current bucket ref OUTSIDE the setter to avoid stale closure
    const prevBucket = currentBucketRef.current;
    const prevLiveCandle = liveCandleDataRef.current;

    // Helper: Schedule throttled UI update
    const scheduleUIUpdate = (candle: LiveCandle) => {
      pendingCandleUpdateRef.current = candle;

      // If no pending throttle, schedule one
      if (!throttleTimeoutRef.current) {
        throttleTimeoutRef.current = setTimeout(() => {
          throttleTimeoutRef.current = null;
          if (pendingCandleUpdateRef.current) {
            setLiveCandle(pendingCandleUpdateRef.current);
            pendingCandleUpdateRef.current = null;
          }
        }, THROTTLE_MS);
      }
    };

    // Case 1: No existing live candle - create new one
    if (!prevLiveCandle || prevBucket === null) {
      currentBucketRef.current = currentBucket;
      const openPrice = lastCompletedCloseRef.current ?? price;
      const newCandle: LiveCandle = {
        time: currentBucket,
        open: openPrice,
        high: Math.max(openPrice, price),
        low: Math.min(openPrice, price),
        close: price
      };
      liveCandleDataRef.current = newCandle;
      // First candle - update immediately (no throttle)
      setLiveCandle(newCandle);
      return;
    }

    // Case 2: Check if we've moved to a NEW bucket based on wall-clock time
    if (currentBucket > prevBucket) {
      // The previous candle is now complete - preserve its tick-formed OHLC
      const completedCandle = { ...prevLiveCandle };

      // CRITICAL: Store in REF immediately (synchronous, no batching)
      completedCandlesRef.current.set(completedCandle.time, completedCandle);

      // Persist to sessionStorage so it survives page refresh
      persistCandles(pair, timeframeMinutes, completedCandlesRef.current);

      // Also update state for backwards compatibility
      setCompletedCandles(existing => [...existing, completedCandle]);
      setCompletedCandlesVersion(v => v + 1);

      // Store the close for the next candle's open
      lastCompletedCloseRef.current = completedCandle.close;
      currentBucketRef.current = currentBucket;

      // Notify about completed candle (with full tick-formed data)
      if (onCandleComplete) {
        onCandleComplete(completedCandle);
      }

      // Start new candle - open = previous candle's close (smooth transition)
      const openPrice = completedCandle.close;
      const newCandle: LiveCandle = {
        time: currentBucket,
        open: openPrice,
        high: Math.max(openPrice, price),
        low: Math.min(openPrice, price),
        close: price
      };
      liveCandleDataRef.current = newCandle;
      // New candle start - update immediately (no throttle)
      setLiveCandle(newCandle);
      return;
    }

    // Case 3: Same bucket - update existing candle with new tick
    if (currentBucket === prevBucket) {
      const updatedCandle: LiveCandle = {
        ...prevLiveCandle,
        high: Math.max(prevLiveCandle.high, price),
        low: Math.min(prevLiveCandle.low, price),
        close: price
      };
      // CRITICAL: Always update ref immediately for accurate OHLC
      liveCandleDataRef.current = updatedCandle;
      // THROTTLE: Only schedule UI update, don't call setLiveCandle directly
      scheduleUIUpdate(updatedCandle);
      return;
    }

    // Case 4: Old tick (before current bucket) - ignore
  }, [enabled, timeframeMinutes, onCandleComplete, pair]);

  // Initialize from historical data (set the last close for smooth transition)
  // Also prune persisted candles that are now covered by DB data
  const initializeFromHistory = useCallback((lastHistoricalClose: number, lastHistoricalTime?: number) => {
    lastCompletedCloseRef.current = lastHistoricalClose;
    // If we have a historical time, set the bucket to after it
    if (lastHistoricalTime) {
      const histBucket = getBucketStart(lastHistoricalTime, timeframeMinutes);
      // Current bucket should be now, not the historical one
      const nowBucket = getBucketStart(Date.now(), timeframeMinutes);
      currentBucketRef.current = nowBucket > histBucket ? nowBucket : null;

      // Prune persisted candles that DB has now caught up to
      let pruned = false;
      for (const time of completedCandlesRef.current.keys()) {
        if (time <= histBucket) {
          completedCandlesRef.current.delete(time);
          pruned = true;
        }
      }
      if (pruned) {
        persistCandles(pair, timeframeMinutes, completedCandlesRef.current);
        setCompletedCandlesVersion(v => v + 1);
      }
    }
  }, [timeframeMinutes, pair]);

  // Get and clear completed candles (to merge with historical data)
  const consumeCompletedCandles = useCallback((): LiveCandle[] => {
    const candles = [...completedCandles];
    setCompletedCandles([]);
    return candles;
  }, [completedCandles]);

  // Reset when timeframe or pair changes - COMPLETELY clear all state
  const reset = useCallback(() => {
    setLiveCandle(null);
    setCompletedCandles([]);
    // CRITICAL: Clear the refs completely - don't reload from storage
    // This prevents stale tick data from persisting across navigation
    completedCandlesRef.current = new Map();
    setCompletedCandlesVersion(v => v + 1);
    currentBucketRef.current = null;
    liveCandleDataRef.current = null;
    lastCompletedCloseRef.current = null;

    // Clear throttle state
    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current);
      throttleTimeoutRef.current = null;
    }
    pendingCandleUpdateRef.current = null;

    // Clear sessionStorage for this pair/timeframe
    clearTickCandleStorage(pair);
  }, [pair]);

  // Hard reset - clear EVERYTHING including storage (call on unmount)
  const hardReset = useCallback(() => {
    reset();
    // Clear all tick candle storage
    clearTickCandleStorage();
  }, [reset]);

  // Reset when timeframe or pair changes
  useEffect(() => {
    reset();
  }, [timeframeMinutes, pair, reset]);

  // Get completed candles from ref (synchronous access)
  const getCompletedCandlesMap = useCallback(() => {
    return completedCandlesRef.current;
  }, []);

  return {
    liveCandle,
    completedCandles,
    completedCandlesVersion, // For dependency tracking in memos
    getCompletedCandlesMap,  // For synchronous access to tick-formed data
    processTick,
    initializeFromHistory,
    consumeCompletedCandles,
    reset,
    hardReset, // For complete cleanup on unmount
    lastCompletedClose: lastCompletedCloseRef.current
  };
}

/**
 * Merge live candle with historical candles
 * Also merges any completed candles that were formed from ticks
 */
export function mergeLiveCandleWithHistory(
  historicalCandles: Array<{ time: number; open: number; high: number; low: number; close: number }>,
  liveCandle: LiveCandle | null,
  completedCandles: LiveCandle[] = []
): Array<{ time: number; open: number; high: number; low: number; close: number }> {
  if (!liveCandle && completedCandles.length === 0) return historicalCandles;

  const result = [...historicalCandles];

  // First, merge any completed candles (tick-formed 1-min candles)
  for (const completed of completedCandles) {
    const existingIndex = result.findIndex(c => c.time === completed.time);
    if (existingIndex >= 0) {
      // Update existing with tick-formed data (preserves accurate high/low)
      result[existingIndex] = {
        time: completed.time,
        open: result[existingIndex].open, // Keep original open from DB
        high: Math.max(result[existingIndex].high, completed.high),
        low: Math.min(result[existingIndex].low, completed.low),
        close: completed.close
      };
    } else if (result.length === 0 || completed.time > result[result.length - 1].time) {
      // New candle - append it
      result.push(completed);
    }
  }

  // Then merge the current live candle
  if (liveCandle) {
    const lastHistorical = result[result.length - 1];

    if (lastHistorical && lastHistorical.time === liveCandle.time) {
      // Live candle is in the same bucket as last historical - merge
      result[result.length - 1] = {
        time: lastHistorical.time,
        open: lastHistorical.open, // Keep original open
        high: Math.max(lastHistorical.high, liveCandle.high),
        low: Math.min(lastHistorical.low, liveCandle.low),
        close: liveCandle.close // Use live close
      };
    } else if (!lastHistorical || liveCandle.time > lastHistorical.time) {
      // Live candle is a new period - append it
      result.push(liveCandle);
    }
  }

  return result;
}
