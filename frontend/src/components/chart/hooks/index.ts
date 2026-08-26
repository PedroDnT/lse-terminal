/**
 * Chart hooks barrel export.
 * Provides data fetching utilities and live tick merging from a single import path.
 */
export {
  // Types
  type CandleData,

  // Constants
  BACKTEST_API,
  TF_MINUTES,
  CRYPTO_BASES,
  CRYPTO_QUOTES,
  FIAT_QUOTES,

  // Timeframe parsing
  parseTickCount,
  isTickTimeframe,
  parseSecondCount,
  isSecondTimeframe,
  timeframeToMinutes,

  // Symbol classification
  isStock,
  isCommodity,
  isCrypto,
  isForex,

  // Table/symbol resolution
  formatPairForTable,
  formatPairForSymbol,
  buildSymbolVariants,

  // Candle aggregation
  mapCandleData,
  aggregateCandles,
  aggregateCandlesByMonth,
  aggregateCandlesPartial,
  aggregateTickCandles,
  aggregateTicksByTime,
  mergeCandles,

  // Backtester fetcher
  fetchWindowedCandles,

  // HTF table mapping
  getHTFTableName,
  getDailyTableName,

  // FX/CFD HTF fetcher
  fetchOandaHtf,

  // UI helpers
  isLightBackground,

  // React hook
  useSymbolFormatters,
} from './useCandleFetch';

export {
  useLiveCandleFromTicks,
  mergeLiveCandleWithHistory,
  clearTickCandleStorage,
  type LiveCandle,
  type TickData,
} from './useLiveCandleMerge';
