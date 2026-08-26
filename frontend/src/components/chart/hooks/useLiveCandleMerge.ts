/**
 * useLiveCandleMerge.ts - Live tick merging documentation and re-exports
 *
 * Live tick-to-candle merging is already handled by the existing hook:
 *   src/hooks/useLiveCandleFromTicks.ts
 *
 * That hook manages:
 * - Forming the current (live) candle from incoming WebSocket tick data
 * - Detecting when a new candle period starts (bucket boundary crossing)
 * - Finalizing completed candles and tracking them via completedCandlesVersion
 * - Providing mergeLiveCandleWithHistory() to splice live + completed candles
 *   into the historical candle array without duplicates
 *
 * The WebSocket subscription itself lives in ProCandlestickChart via useLiveTick()
 * from WebSocketContext. The tick data flows:
 *
 *   WebSocket -> useLiveTick(symbol) -> wsTick
 *     -> ProCandlestickChart useEffect processes wsTick:
 *       - For tick/second modes: directly appends to candles array
 *       - For standard timeframes: passes to useLiveCandleFromTicks.processTick()
 *     -> liveCandle + completedCandlesVersion update
 *     -> chartCandles useMemo merges via mergeLiveCandleWithHistory()
 *
 * This file re-exports the key pieces so consumers can import from a single
 * location alongside useCandleFetch.
 */

export {
  useLiveCandleFromTicks,
  mergeLiveCandleWithHistory,
  clearTickCandleStorage,
  type LiveCandle,
  type TickData,
} from '@/hooks/useLiveCandleFromTicks';
