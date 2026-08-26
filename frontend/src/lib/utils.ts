import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { RIGHT_TOOLBAR_WIDTH } from "@/components/chart/RightToolbar";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a price the same way the chart Y-axis does. This is the single
 * source of truth for price formatting so that axis-width calculations
 * always match what actually gets rendered. ProChart.tsx's formatPrice
 * useCallback delegates to this function.
 */
export function formatPriceForSymbol(price: number, symbol?: string): string {
  // Add thousand separators (e.g. 4656.00 -> 4,656.00)
  const addCommas = (s: string) => {
    const [int, dec] = s.split('.');
    const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return dec !== undefined ? `${withCommas}.${dec}` : withCommas;
  };
  const fmt = (p: number, decimals: number) => addCommas(p.toFixed(decimals));

  // === METALS (XAU, XAG, XPT, XPD, XCU) - always 2 decimal places ===
  const metalPatterns = ['XAU', 'XAG', 'XPT', 'XPD', 'XCU'];
  if (symbol && metalPatterns.some(metal => symbol.includes(metal))) {
    return fmt(price, 2);
  }

  // === INDICES - always 2 decimal places ===
  const indexPatterns = ['SPX500', 'NAS100', 'US30', 'US2000', 'UK100', 'UK250', 'DE30', 'FR40', 'EU50', 'JP225', 'AU200', 'HK33', 'CN50', 'VIX', 'VSTOXX'];
  if (symbol && indexPatterns.some(idx => symbol.includes(idx))) {
    return fmt(price, 2);
  }

  // === COMMODITIES (energy, grains, softs, industrial metals, livestock) ===
  const commodityPatterns = ['WTICO', 'BCO', 'NATGAS', 'CORN', 'WHEAT', 'SOYBN', 'OATS', 'RICE', 'SUGAR', 'COFFEE', 'COCOA', 'COTTON', 'OJ', 'LUMBER', 'CATTLE', 'NICKEL', 'ALUMINIUM', 'LEAD', 'IRON'];
  if (symbol && commodityPatterns.some(comm => symbol.includes(comm))) {
    if (symbol.includes('NATGAS') || symbol.includes('SUGAR')) return fmt(price, 3);
    return fmt(price, 2);
  }

  // === STOCKS & ETFs - always 2 decimal places ===
  const isStock = symbol && /^[A-Z0-9._-]+$/.test(symbol) && !symbol.includes('/');
  if (isStock) {
    return fmt(price, 2);
  }

  // === CRYPTO - 2 decimals for large values, more for small ===
  const cryptoPatterns = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE', 'DOT', 'AVAX', 'LTC', 'LINK', 'UNI', 'ATOM'];
  if (symbol && cryptoPatterns.some(crypto => symbol.includes(crypto))) {
    if (price >= 100) return fmt(price, 2);
    if (price >= 1) return fmt(price, 4);
    return fmt(price, 6);
  }

  // === FOREX PAIRS ===
  const isForexPair = symbol && /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol);
  if (isForexPair) {
    if (symbol.includes('JPY')) return fmt(price, 3);
    return fmt(price, 5);
  }

  // === FALLBACK ===
  if (price >= 100) return fmt(price, 2);
  if (price >= 1) return fmt(price, 4);
  return fmt(price, 6);
}

/**
 * Calculate dynamic Y-axis width based on the symbol's price format.
 * Adaptive on ALL screen sizes: formats a sample price with the real
 * formatting function and measures the string length, so the axis is
 * always tight-fit to the actual rendered labels. Silver "72.57" (5 chars)
 * gets a much narrower axis than BTC "69,161.91" (9 chars).
 */
export function calculatePriceAxisWidth(
  isMobile: boolean,
  symbol?: string,
  samplePrice?: number,
  rightOffset?: number
): number {
  const price = samplePrice || 100;
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;

  // Format the sample price exactly as the chart renders it, then measure
  // the resulting string length. This guarantees the axis width matches the
  // actual label width, no matter the asset type or decimal convention.
  const formatted = formatPriceForSymbol(price, symbol);
  const charCount = formatted.length;

  // TradingView-tight axis sizing: ~6.5px per digit at 12px sans-serif.
  // Right padding has to match the 4px right anchor used in BTChart/ProChart's
  // priceLabelX (= width - rightOffset - 4); anything less and the right edge
  // computation here disagrees with the actual paint position. Left padding
  // is the visible breathing room between the chart canvas right edge and the
  // start of the label text; 8px is the minimum that doesn't look crammed for
  // 7-char FX prices like "1.17400" on desktop.
  const pxPerChar = isDesktop ? 6.5 : 6.2;
  const padding = 12; // 8px left breathing room + 4px right anchor offset
  const baseWidth = Math.ceil(padding + charCount * pxPerChar);

  if (isMobile) {
    return Math.max(34, baseWidth);
  }

  if (isDesktop) {
    // Desktop: tight label width + right-side gap.
    // rightOffset controls how much space to reserve on the right:
    //   undefined = default toolbar overlay (48px)
    //   0         = no gap (toolbar pushed away / collapsed)
    //   12        = small breathing room (multi-panel left columns)
    const toolbarGap = rightOffset !== undefined ? rightOffset : RIGHT_TOOLBAR_WIDTH;
    return Math.max(40, baseWidth) + toolbarGap;
  }

  // Tablet
  return Math.max(36, baseWidth);
}
