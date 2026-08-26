// ============================================================================
// renderers/heatmapRenderer.ts
// Extracted from ProChart.tsx drawChart() to reduce the monolithic callback.
// Contains three self-contained heatmap visualizations:
// 1. Options Probability Heatmap (SVI-derived or Gaussian fallback)
// 2. Order Book Liquidity Heatmap (Bookmap-style from snapshot data)
// 3. L2 Depth Overlay (horizontal bid/ask bars from live depth data)
//
// All functions are PURE: no React state, refs, or hooks. Everything is
// passed via typed parameters.
// ============================================================================

import type { Candle } from '../core/types';

// ── Options PDF prediction data from the synthetic options pricer ──
export interface OptionsPdfData {
  currentPrice: number;
  predictedPrice: number;
  modePrice: number;
  direction: string;
  distancePct: number;
  probAbove: number;
  probBelow: number;
  confidence: number;
  densityCurve: { p: number; d: number }[];
}

// ── L2 depth levels for the bid/ask overlay bars ──
export interface L2DepthData {
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
}

// ── Heatmap snapshot from the order book recorder ──
export interface HeatmapSnapshot {
  timestamp: string;
  bids_prices?: number[];
  bids_sizes?: number[];
  asks_prices?: number[];
  asks_sizes?: number[];
}

// ── Context needed by all three heatmap renderers ──
export interface HeatmapRenderContext {
  ctx: CanvasRenderingContext2D;
  chartWidth: number;
  mainChartHeight: number;
  // All candles (not just visible), needed for timeMsToX binary search
  candles: Candle[];
  visible: { candles: Candle[]; startIndex: number; endIndex: number };
  indexToX: (globalIndex: number, startIndex: number) => number;
  mainPriceToY: (price: number) => number;
  currentCandleWidth: number;
}

// ── Thermal color ramp: black -> blue -> cyan -> green -> yellow -> white ──
// Maps a 0..1 intensity to an RGB triple for heatmap visualization.
function thermalColor(t: number): [number, number, number] {
  t = Math.min(1, Math.max(0, t));
  if (t < 0.2) { const s = t / 0.2; return [Math.round(20 + 10 * s), Math.round(10 + 20 * s), Math.round(60 + 100 * s)]; }
  if (t < 0.4) { const s = (t - 0.2) / 0.2; return [Math.round(30 - 10 * s), Math.round(30 + 140 * s), Math.round(160 + 60 * s)]; }
  if (t < 0.6) { const s = (t - 0.4) / 0.2; return [Math.round(20 + 100 * s), Math.round(170 + 30 * s), Math.round(220 - 120 * s)]; }
  if (t < 0.8) { const s = (t - 0.6) / 0.2; return [Math.round(120 + 80 * s), Math.round(200 + 40 * s), Math.round(100 - 80 * s)]; }
  const s = (t - 0.8) / 0.2; return [Math.round(200 + 55 * s), Math.round(240 + 10 * s), Math.round(20 + 30 * s)];
}

// ── Bookmap-style color ramp for order book heatmap ──
function bookmapThermalColor(intensity: number): [number, number, number] {
  intensity = Math.min(1, Math.max(0, intensity));
  if (intensity < 0.2) return [0, 0, Math.floor(255 * (intensity / 0.2))];
  if (intensity < 0.4) return [0, Math.floor(255 * ((intensity - 0.2) / 0.2)), 255];
  if (intensity < 0.6) return [Math.floor(255 * ((intensity - 0.4) / 0.2)), 255, 255 - Math.floor(255 * ((intensity - 0.4) / 0.2))];
  if (intensity < 0.8) return [255, 255 - Math.floor(128 * ((intensity - 0.6) / 0.2)), 0];
  return [255, 127 - Math.floor(127 * ((intensity - 0.8) / 0.2)), Math.floor(255 * ((intensity - 0.8) / 0.2))];
}

// ═══════════════════════════════════════════════════════════════════════════
// renderOptionsPdfHeatmap: draws the probability density cloud to the right
// of the last visible candle. Uses SVI-derived density curves if available,
// otherwise falls back to a Gaussian approximation.
// ═══════════════════════════════════════════════════════════════════════════
export function renderOptionsPdfHeatmap(
  hx: HeatmapRenderContext,
  pdfData: OptionsPdfData
): void {
  const { ctx, chartWidth, visible, mainPriceToY } = hx;
  if (visible.candles.length === 0) return;

  const pred = pdfData;
  const cp = pred.currentPrice;
  const pp = pred.predictedPrice;
  const lastX = hx.indexToX(visible.candles.length - 1, 0);
  const coneStartX = lastX;
  const coneEndX = chartWidth;
  const coneWidth = coneEndX - coneStartX;

  if (coneWidth <= 20) return;

  const dc = pred.densityCurve || [];
  const numCols = Math.min(Math.floor(coneWidth / 3), 100);

  if (dc.length >= 5) {
    // === REAL DENSITY: actual SVI-derived per-strike probabilities ===
    const maxD = Math.max(...dc.map(pt => pt.d));
    if (maxD <= 0) return;

    for (let col = 0; col < numCols; col++) {
      const tFrac = (col + 0.5) / numCols;
      const x = coneStartX + (col / numCols) * coneWidth;
      const colW = Math.max(3, coneWidth / numCols);
      const timeExp = 0.12 + tFrac * 0.88;
      const center = cp + (pp - cp) * tFrac;
      const densityNorm = 0.12 / timeExp;

      for (let i = 0; i < dc.length; i++) {
        const pt = dc[i];
        const price = center + (pt.p - cp) * timeExp;
        const rawD = (pt.d / maxD) * densityNorm;
        if (rawD < 0.02) continue;
        const d = Math.min(1, rawD);

        const nextP = i < dc.length - 1 ? dc[i + 1].p : pt.p + (pt.p - dc[Math.max(0, i - 1)].p);
        const prevP = i > 0 ? dc[i - 1].p : pt.p - (dc[Math.min(dc.length - 1, i + 1)].p - pt.p);
        const halfSpan = ((nextP - prevP) / 2) * timeExp;

        const y1 = mainPriceToY(price + halfSpan);
        const y2 = mainPriceToY(price - halfSpan);
        const h = Math.abs(y2 - y1);
        if (h < 0.3) continue;

        // Fade out near the right edge to avoid a hard cutoff
        const fo = tFrac > 0.92 ? 1 - (tFrac - 0.92) / 0.08 : 1;
        const [r, g, b] = thermalColor(d);
        const alpha = d * 0.55 * fo;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fillRect(x, Math.min(y1, y2), colW + 0.5, h);
      }
    }
  } else {
    // === FALLBACK: Generic Gaussian (no density data from options) ===
    const pAbove = Math.max(0.05, Math.min(0.95, pred.probAbove));
    const pBelow = Math.max(0.05, Math.min(0.95, pred.probBelow));
    const skew = pBelow / pAbove;
    const skewExp = Math.pow(Math.max(skew, 0.1), 1.2);
    const absDist = Math.abs(pred.distancePct || 0);
    const conf = Math.max(0.1, Math.min(1, pred.confidence));
    const dataSpreadPct = Math.max(1.0, Math.min(8.0, absDist * 2.5 + (1 - conf) * 4.0 + 1.0));
    const baseDist = cp * (dataSpreadPct / 100);
    const spreadUp = baseDist / skewExp;
    const spreadDown = baseDist * skewExp;
    const numRows = 50;
    const refSigma = ((spreadUp + spreadDown) / 2) * 0.12;
    const upBoost = pAbove > pBelow ? 1 + (pAbove - 0.5) * 2.5 : 1;
    const downBoost = pBelow > pAbove ? 1 + (pBelow - 0.5) * 2.5 : 1;

    for (let col = 0; col < numCols; col++) {
      const tFrac = (col + 0.5) / numCols;
      const x = coneStartX + (col / numCols) * coneWidth;
      const colW = Math.max(3, coneWidth / numCols);
      const timeExp = 0.12 + tFrac * 0.88;
      const sUp = spreadUp * timeExp;
      const sDown = spreadDown * timeExp;
      const avgSig = (sUp + sDown) / 2;
      const center = cp + (pp - cp) * tFrac;
      const densityNorm = refSigma / avgSig;
      const top = center + sUp * 3.0;
      const bot = center - sDown * 3.0;
      const bh = (top - bot) / numRows;

      for (let row = 0; row < numRows; row++) {
        const price = bot + (row + 0.5) * bh;
        const sig = price >= center ? sUp : sDown;
        const z = (price - center) / sig;
        const dirBoost = price >= center ? upBoost : downBoost;
        const raw = Math.exp(-0.5 * z * z) * densityNorm * dirBoost;
        if (raw < 0.03) continue;
        const d = Math.min(1, raw);
        const y1 = mainPriceToY(price + bh / 2);
        const y2 = mainPriceToY(price - bh / 2);
        const h = Math.abs(y2 - y1);
        if (h < 0.3) continue;
        const fo = tFrac > 0.92 ? 1 - (tFrac - 0.92) / 0.08 : 1;
        const [r, g, b] = thermalColor(d);
        const alpha = d * 0.55 * fo;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fillRect(x, Math.min(y1, y2), colW + 0.5, h);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// renderOrderBookHeatmap: draws the Bookmap-style historical liquidity
// heatmap from recorded order book snapshots. Each snapshot's bid/ask
// levels are drawn as colored rectangles at their price and time position.
// ═══════════════════════════════════════════════════════════════════════════
export function renderOrderBookHeatmap(
  hx: HeatmapRenderContext,
  heatmapData: HeatmapSnapshot[]
): void {
  const { ctx, chartWidth, mainChartHeight, candles, visible, mainPriceToY, currentCandleWidth } = hx;
  if (heatmapData.length === 0 || visible.candles.length === 0) return;

  // Maps an absolute timestamp (ms) to an X pixel by interpolating between candles.
  // Uses binary search for efficiency since heatmap snapshots may not align with candle times.
  const timeMsToX = (timeMs: number): number | null => {
    if (candles.length === 0) return null;
    if (timeMs >= candles[candles.length - 1].time) {
      const dt = candles.length > 1 ? candles[candles.length - 1].time - candles[candles.length - 2].time : 60000;
      const diffMs = timeMs - candles[candles.length - 1].time;
      return hx.indexToX((candles.length - 1) + diffMs / Math.max(1000, dt), visible.startIndex);
    }
    if (timeMs <= candles[0].time) {
      const dt = candles.length > 1 ? candles[1].time - candles[0].time : 60000;
      const diffMs = candles[0].time - timeMs;
      return hx.indexToX(0 - diffMs / Math.max(1000, dt), visible.startIndex);
    }

    let low = 0; let high = candles.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (candles[mid].time === timeMs) return hx.indexToX(mid, visible.startIndex);
      else if (candles[mid].time < timeMs) low = mid + 1;
      else high = mid - 1;
    }

    if (high < 0) return hx.indexToX(0, visible.startIndex);
    if (low >= candles.length) return hx.indexToX(candles.length - 1, visible.startIndex);

    const t1 = candles[high].time;
    const t2 = candles[low].time;
    const ratio = (timeMs - t1) / (t2 - t1);
    return hx.indexToX(high + ratio, visible.startIndex);
  };

  // Find max liquidity across all snapshots to normalize opacity
  let globalMaxSize = 1;
  for (const snap of heatmapData) {
    if (snap.bids_sizes) {
      const maxB = Math.max(...snap.bids_sizes);
      if (maxB > globalMaxSize) globalMaxSize = maxB;
    }
    if (snap.asks_sizes) {
      const maxA = Math.max(...snap.asks_sizes);
      if (maxA > globalMaxSize) globalMaxSize = maxA;
    }
  }

  const rectWidthLocal = Math.max(1, currentCandleWidth * 0.8);

  for (let i = 0; i < heatmapData.length; i++) {
    const snap = heatmapData[i];
    const timeMs = new Date(snap.timestamp).getTime();
    const startX = timeMsToX(timeMs);
    if (startX === null || startX < -rectWidthLocal || startX > chartWidth + rectWidthLocal) continue;

    // Draw bid levels (buyers)
    if (snap.bids_prices && snap.bids_sizes) {
      for (let b = 0; b < snap.bids_prices.length; b++) {
        const price = Number(snap.bids_prices[b]);
        const size = Number(snap.bids_sizes[b]);
        const y = mainPriceToY(price);
        if (y < 0 || y > mainChartHeight) continue;

        const intensity = size / globalMaxSize;
        if (intensity < 0.05) continue;

        // Gamma correction (pow 0.6) makes mid-range liquidity more visible
        const [r, g, bColor] = bookmapThermalColor(Math.pow(intensity, 0.6));
        ctx.fillStyle = `rgba(${r}, ${g}, ${bColor}, ${0.15 + intensity * 0.6})`;
        ctx.fillRect(startX - rectWidthLocal / 2, y - 1, rectWidthLocal, 2);
      }
    }

    // Draw ask levels (sellers)
    if (snap.asks_prices && snap.asks_sizes) {
      for (let a = 0; a < snap.asks_prices.length; a++) {
        const price = Number(snap.asks_prices[a]);
        const size = Number(snap.asks_sizes[a]);
        const y = mainPriceToY(price);
        if (y < 0 || y > mainChartHeight) continue;

        const intensity = size / globalMaxSize;
        if (intensity < 0.05) continue;

        const [r, g, bColor] = bookmapThermalColor(Math.pow(intensity, 0.6));
        ctx.fillStyle = `rgba(${r}, ${g}, ${bColor}, ${0.15 + intensity * 0.6})`;
        ctx.fillRect(startX - rectWidthLocal / 2, y - 1, rectWidthLocal, 2);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// renderL2DepthOverlay: draws horizontal bid/ask bars from the right edge
// of the chart, showing real-time L2 order book depth. Bids are blue bars
// extending left from the right edge; asks are red bars.
// ═══════════════════════════════════════════════════════════════════════════
export function renderL2DepthOverlay(
  hx: HeatmapRenderContext,
  l2Data: L2DepthData
): void {
  const { ctx, chartWidth, mainChartHeight, mainPriceToY } = hx;
  if (l2Data.bids.length === 0 && l2Data.asks.length === 0) return;

  const allLevels = [...l2Data.bids, ...l2Data.asks];
  const maxSize = Math.max(...allLevels.map(l => l.size), 1);
  // Largest bar fills 25% of chart width
  const maxBarWidth = chartWidth * 0.25;

  // Calculate bar height from the price step between adjacent levels
  const bidStep = l2Data.bids.length >= 2
    ? Math.abs(l2Data.bids[0].price - l2Data.bids[1].price)
    : 0;
  const askStep = l2Data.asks.length >= 2
    ? Math.abs(l2Data.asks[1].price - l2Data.asks[0].price)
    : 0;
  const priceStep = bidStep || askStep || 1;

  // Bar height in pixels: at least 2px tall so thin levels are still visible
  const barHeightPx = Math.max(2, Math.abs(mainPriceToY(0) - mainPriceToY(priceStep)) * 0.85);

  // Bid bars (blue, extending left from right edge)
  for (const level of l2Data.bids) {
    const y = mainPriceToY(level.price);
    if (y < -barHeightPx || y > mainChartHeight + barHeightPx) continue;

    const ratio = level.size / maxSize;
    const barW = ratio * maxBarWidth;
    const alpha = 0.12 + ratio * 0.28;
    ctx.fillStyle = `rgba(37, 99, 235, ${alpha})`;
    ctx.fillRect(chartWidth - barW, y - barHeightPx / 2, barW, barHeightPx);

    // Thin left edge line for definition on larger bars
    if (barW > 5) {
      ctx.strokeStyle = `rgba(37, 99, 235, ${alpha + 0.15})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(chartWidth - barW, y - barHeightPx / 2);
      ctx.lineTo(chartWidth - barW, y + barHeightPx / 2);
      ctx.stroke();
    }
  }

  // Ask bars (red, extending left from right edge)
  for (const level of l2Data.asks) {
    const y = mainPriceToY(level.price);
    if (y < -barHeightPx || y > mainChartHeight + barHeightPx) continue;

    const ratio = level.size / maxSize;
    const barW = ratio * maxBarWidth;
    const alpha = 0.12 + ratio * 0.28;
    ctx.fillStyle = `rgba(220, 38, 38, ${alpha})`;
    ctx.fillRect(chartWidth - barW, y - barHeightPx / 2, barW, barHeightPx);

    if (barW > 5) {
      ctx.strokeStyle = `rgba(220, 38, 38, ${alpha + 0.15})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(chartWidth - barW, y - barHeightPx / 2);
      ctx.lineTo(chartWidth - barW, y + barHeightPx / 2);
      ctx.stroke();
    }
  }
}
