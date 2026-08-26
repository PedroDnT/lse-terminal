// ============================================================================
// useWatchlistPrices.ts - terminal stub.
//
// Upstream this hook streams live prices and sparklines for the chart
// sidebar's watchlist panel from the hosted market-data API. The terminal has
// no hosted feed; returning an empty map puts the panel on its normal
// "no price yet" rendering path without touching the consuming component.
// ============================================================================

export function useWatchlistPrices(
  _symbols: string[],
  _options: { enabled?: boolean } = {}
): { prices: Record<string, any>; isLoading: boolean } {
  return { prices: {}, isLoading: false };
}

export default useWatchlistPrices;
