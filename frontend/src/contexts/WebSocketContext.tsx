// ============================================================================
// WebSocketContext.tsx - terminal stub for the website's live-feed context.
//
// Upstream, BTCandlestickChart subscribes to the site's central tick feed via
// useLiveTick so the right edge of a live chart moves between candle closes.
// The terminal is a local app with no live feed, and in manual backtesting the
// chart is always mounted with a replay startDate, which is exactly the
// condition under which the upstream chart disables its live-tick subscription
// (enabled = !startDate && !externalRawCandles). This stub keeps the import
// contract identical while always reporting "no tick, not connected", so the
// ported chart takes its historical-only code path.
// ============================================================================

export interface TickData {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  // Epoch seconds, matching the central feed convention the chart expects.
  ts: number;
}

export const useLiveTick = (
  _symbol: string | null,
  _enabled: boolean = true
): { tick: TickData | null; isConnected: boolean } => {
  return { tick: null, isConnected: false };
};
