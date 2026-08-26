/**
 * Synthetic-spread source for the chart's bid/ask lines.
 *
 * Upstream this fetched a spread table from a remote service and fell back to a
 * hardcoded asset-class table whenever the cache had not loaded yet. The
 * terminal has no such service, so only the fallback path remains - byte for
 * byte the same table and the same lookup order, which is exactly what the
 * live chart renders during its own pre-cache window. Charts therefore never
 * render with spread=0, and no network call is made.
 */

const hardcodedFallback = (sym: string): number => {
    const upper = (sym || '').toUpperCase();
    if (upper.includes('XAU') || upper.includes('XAG')) return 0.80;
    if (upper.includes('NAS100') || upper.includes('SPX500') || upper.includes('US30') || upper.includes('US2000')) return 1.5;
    if (upper.includes('BCO') || upper.includes('WTICO')) return 0.05;
    if (upper.includes('BTC')) return 4.0;
    if (upper.includes('ETH')) return 2.0;
    if (upper.includes('JPY')) return 0.001;
    const noSlash = upper.replace('/', '');
    if (noSlash.length === 6 && /EUR|GBP|AUD|NZD|CAD|CHF|USD/.test(noSlash)) return 0.00001;
    return 0.04;
};

/** Kept for call-site compatibility; there is no remote cache to populate. */
export const initSpreadCache = (): Promise<void> => Promise.resolve();

/** Synchronous lookup. */
export const getSpreadForSymbol = (sym: string, _price?: number): number => {
    return hardcodedFallback(sym);
};

/** Maximum-widening multiplier (used for news-driven spread widening sims). */
export const getMaxSpreadMultiplier = (_sym: string): number => 3.0;
