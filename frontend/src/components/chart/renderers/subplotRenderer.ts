// ============================================================================
// renderers/subplotRenderer.ts
// Extracted from ProChart.tsx drawChart() to reduce the monolithic callback.
// Contains: drawSimpleSubplot helper, all generic subplot indicator renderers
// (Aroon, AO, TSI, TRIX, KST, StochRSI, and 50+ drawSimpleSubplot callers),
// Phase 2 overlay line renderers, custom formula indicator rendering,
// and subplot selection dot rendering.
//
// All functions are PURE: they receive canvas context and data via typed
// parameters. No React state, refs, or hooks are accessed directly.
// The mutable refs (indicatorBoundsRef, subplotLabelEndXRef) are passed in
// as part of the context object so the caller can read them after rendering.
// ============================================================================

import type { Candle } from '../core/types';

// ── Visible range descriptor, matching what getVisibleCandles() returns ──
export interface VisibleRange {
  candles: Candle[];
  startIndex: number;
  endIndex: number;
}

// ── Options for the generic single-line subplot helper ──
export interface SimpleSubplotOpts {
  data: number[];
  label: string;
  color: string;
  boundsKey: string;
  fixedMin?: number;
  fixedMax?: number;
  zeroLine?: boolean;
  levelLines?: { value: number; color: string; dash?: number[] }[];
  formatValue?: (v: number) => string;
  // When true, reuse the existing indicatorBounds entry for boundsKey
  // instead of overwriting it. Used for dual-line indicators where the
  // second line shares the same subplot region as the first.
  drawBoundsFromExisting?: boolean;
}

// ── Shared context every subplot renderer needs ──
// These values are computed once per drawChart() frame and passed through
// so renderers do not need access to React state or component-level variables.
export interface SubplotRenderContext {
  ctx: CanvasRenderingContext2D;
  chartWidth: number;
  subplotHeight: number;
  visible: VisibleRange;
  // Maps a global candle index to an X pixel coordinate.
  // Signature matches the indexToX closure inside drawChart().
  indexToX: (globalIndex: number, startIndex: number) => number;
  // Current candle pixel width, used for histogram bar sizing.
  currentCandleWidth: number;
  // Font string for subplot axis labels (responsive to desktop vs mobile).
  subplotLabelFont: string;
  // Index of the candle the user is hovering, or null if not hovering.
  // Used to show the indicator value at the hovered bar in the label area.
  hoveredCandleIndex: number | null;
  // Colors from the chart theme, only textDim is needed for separator lines.
  colors: { textDim: string; grid: string };
  // Indicator config from the parent, used to read user-set colors and periods.
  // Typed as any because the full IndicatorConfig type is enormous and we only
  // read optional color/period fields from specific indicator keys.
  indicators: any;
  // Indicator computed data. Typed as any for the same reason.
  indicatorData: any;
  // Mutable maps that get populated during rendering. The caller reads these
  // after renderGenericSubplots() returns to wire up click detection and
  // label positioning in ProChart.tsx.
  indicatorBounds: Record<string, { top: number; bottom: number }>;
  subplotLabelEndX: Record<string, number>;
  // Maps a price to a Y pixel coordinate on the main chart area.
  // Needed by overlay line renderers and fractals.
  mainPriceToY: (price: number) => number;
  // The main chart area height in pixels (subplots render below this).
  mainChartHeight: number;
  // Whether to skip indicator rendering (used during fast scroll mode).
  skipIndicators: boolean;
  // The key of the currently clicked/selected indicator (for selection dots).
  clickedIndicatorKey: string | null;
}

// ── drawSimpleSubplot: the generic single-line subplot renderer ──────────
// Draws a separator line, the data line, axis labels, and the indicator
// label with its current value. Advances currentSubplotY by subplotHeight.
// Returns the new currentSubplotY value.
function drawSimpleSubplot(
  cx: SubplotRenderContext,
  opts: SimpleSubplotOpts,
  currentSubplotY: number
): number {
  const { ctx, chartWidth, subplotHeight: spH, visible, indexToX, subplotLabelFont, hoveredCandleIndex, colors, indicatorBounds, subplotLabelEndX } = cx;
  const spTop = currentSubplotY;
  const spBottom = spTop + spH;

  // Horizontal separator between this subplot and the one above
  ctx.strokeStyle = colors.textDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, spTop);
  ctx.lineTo(chartWidth, spTop);
  ctx.stroke();

  // Compute visible data range (or use fixed bounds if provided)
  const visVals = visible.candles.map((_, i) => opts.data[visible.startIndex + i]).filter(v => !isNaN(v) && isFinite(v));
  const dataMin = visVals.length > 0 ? Math.min(...visVals) : 0;
  const dataMax = visVals.length > 0 ? Math.max(...visVals) : 1;
  const rangeMin = opts.fixedMin !== undefined ? opts.fixedMin : dataMin - Math.abs(dataMax - dataMin) * 0.05;
  const rangeMax = opts.fixedMax !== undefined ? opts.fixedMax : dataMax + Math.abs(dataMax - dataMin) * 0.05;
  const range = rangeMax - rangeMin || 1;
  const toY = (v: number) => spTop + (1 - (v - rangeMin) / range) * spH;
  const fmt = opts.formatValue || ((v: number) => v.toFixed(2));

  // Optional zero reference line
  if (opts.zeroLine) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(150,150,150,0.5)';
    ctx.beginPath();
    ctx.moveTo(0, toY(0));
    ctx.lineTo(chartWidth, toY(0));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Optional overbought/oversold or custom level lines
  if (opts.levelLines) {
    opts.levelLines.forEach(ll => {
      ctx.setLineDash(ll.dash || [4, 4]);
      ctx.strokeStyle = ll.color;
      ctx.beginPath();
      ctx.moveTo(0, toY(ll.value));
      ctx.lineTo(chartWidth, toY(ll.value));
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  // The actual data line
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  visible.candles.forEach((_, i) => {
    const gi = visible.startIndex + i;
    const v = opts.data[gi];
    if (!isNaN(v) && isFinite(v)) {
      const x = indexToX(gi, visible.startIndex);
      if (!started) { ctx.moveTo(x, toY(v)); started = true; } else { ctx.lineTo(x, toY(v)); }
    }
  });
  ctx.stroke();

  // Price axis labels (min, mid, max) on the right side
  ctx.fillStyle = '#6b7280';
  ctx.font = subplotLabelFont;
  ctx.textAlign = 'left';
  [rangeMin, (rangeMin + rangeMax) / 2, rangeMax].forEach(lv => {
    ctx.fillText(fmt(lv), chartWidth + 5, toY(lv));
  });

  // Top-left label showing indicator name and the value at the hovered (or last) bar
  const hIdx = hoveredCandleIndex !== null ? hoveredCandleIndex : visible.startIndex + visible.candles.length - 1;
  const curVal = opts.data[hIdx];
  const valText = !isNaN(curVal) && isFinite(curVal) ? fmt(curVal) : '--';
  ctx.fillStyle = '#d1d5db';
  ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(opts.label, 5, spTop + 15);
  ctx.fillStyle = opts.color;
  const lw = ctx.measureText(opts.label).width;
  ctx.fillText(valText, 13 + lw, spTop + 15);
  subplotLabelEndX[opts.boundsKey] = 13 + lw + ctx.measureText(valText).width + 8;

  // Store pixel bounds so ProChart can detect clicks on this subplot
  (indicatorBounds as any)[opts.boundsKey] = { top: spTop, bottom: spBottom };
  return spBottom;
}

// ── drawGroupedSubplot: one pane for all columns of an engine indicator ──
// Engine (Python) indicators arrive as one customIndicators entry per column,
// tagged with a shared `group`. They must share a pane and a scale (MACD's
// histogram is meaningless on its own axis), with per-column kind: histogram
// columns draw as zero-anchored bars behind the line columns.
function drawGroupedSubplot(
  cx: SubplotRenderContext,
  group: string,
  members: any[],
  currentSubplotY: number
): number {
  const { ctx, chartWidth, subplotHeight: spH, visible, indexToX, currentCandleWidth, subplotLabelFont, hoveredCandleIndex, colors, indicatorBounds, subplotLabelEndX } = cx;
  const spTop = currentSubplotY;
  const spBottom = spTop + spH;

  ctx.strokeStyle = colors.textDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, spTop);
  ctx.lineTo(chartWidth, spTop);
  ctx.stroke();

  // Shared range over every member's visible values. Histograms anchor at 0,
  // so 0 must be inside the range whenever one is present.
  let dataMin = Infinity, dataMax = -Infinity;
  const hasHistogram = members.some((m) => m.kind === 'histogram');
  for (const m of members) {
    for (let i = 0; i < visible.candles.length; i++) {
      const v = m.data[visible.startIndex + i];
      if (!isNaN(v) && isFinite(v)) {
        if (v < dataMin) dataMin = v;
        if (v > dataMax) dataMax = v;
      }
    }
  }
  if (dataMin === Infinity) { dataMin = 0; dataMax = 1; }
  if (hasHistogram) { dataMin = Math.min(dataMin, 0); dataMax = Math.max(dataMax, 0); }
  const pad = Math.abs(dataMax - dataMin) * 0.05;
  const rangeMin = dataMin - pad;
  const rangeMax = dataMax + pad;
  const range = rangeMax - rangeMin || 1;
  const toY = (v: number) => spTop + (1 - (v - rangeMin) / range) * spH;

  // Histograms first so lines draw on top of the bars.
  const ordered = [...members].sort((a, b) =>
    (a.kind === 'histogram' ? 0 : 1) - (b.kind === 'histogram' ? 0 : 1));
  for (const m of ordered) {
    if (m.kind === 'histogram') {
      const y0 = toY(0);
      const barW = Math.max(1, currentCandleWidth * 0.6);
      for (let i = 0; i < visible.candles.length; i++) {
        const gi = visible.startIndex + i;
        const v = m.data[gi];
        if (isNaN(v) || !isFinite(v)) continue;
        // Sign-colored like every histogram pane on the chart; the entry's own
        // color would hide direction.
        ctx.fillStyle = v >= 0 ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)';
        const y = toY(v);
        ctx.fillRect(indexToX(gi, visible.startIndex) - barW / 2, Math.min(y, y0), barW, Math.abs(y0 - y) || 1);
      }
    } else {
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.lineWidth || 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visible.candles.length; i++) {
        const gi = visible.startIndex + i;
        const v = m.data[gi];
        if (isNaN(v) || !isFinite(v)) continue;
        const x = indexToX(gi, visible.startIndex);
        if (!started) { ctx.moveTo(x, toY(v)); started = true; } else { ctx.lineTo(x, toY(v)); }
      }
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#6b7280';
  ctx.font = subplotLabelFont;
  ctx.textAlign = 'left';
  [rangeMin, (rangeMin + rangeMax) / 2, rangeMax].forEach((lv) => {
    ctx.fillText(lv.toFixed(2), chartWidth + 5, toY(lv));
  });

  // Label: group name once, then each member's hovered/last value in its color.
  const hIdx = hoveredCandleIndex !== null ? hoveredCandleIndex : visible.startIndex + visible.candles.length - 1;
  ctx.fillStyle = '#d1d5db';
  ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(group, 5, spTop + 15);
  let lx = 13 + ctx.measureText(group).width;
  for (const m of members) {
    const v = m.data[hIdx];
    const txt = !isNaN(v) && isFinite(v) ? v.toFixed(2) : '--';
    ctx.fillStyle = m.kind === 'histogram' ? '#9ca3af' : m.color;
    ctx.fillText(txt, lx, spTop + 15);
    lx += ctx.measureText(txt).width + 8;
  }
  subplotLabelEndX[`custom_${members[0].id}`] = lx;

  (indicatorBounds as any)[`custom_${members[0].id}`] = { top: spTop, bottom: spBottom };
  return spBottom;
}

// ── Helper: draw a dual-line subplot with zero line ──────────────────────
// Used by TSI, TRIX, KST, Stochastic RSI, and similar indicators that
// render two lines (main + signal) in one subplot panel.
function drawDualLineSubplot(
  cx: SubplotRenderContext,
  currentSubplotY: number,
  lines: { data: number[]; color: string }[],
  label: string,
  boundsKey: string,
  opts?: {
    fixedRange?: boolean; // If true, Y range is 0-100
    levelLines?: { value: number; color: string }[];
    axisLabels?: number[];
  }
): number {
  const { ctx, chartWidth, subplotHeight: spH, visible, indexToX, subplotLabelFont, colors, indicatorBounds, subplotLabelEndX, hoveredCandleIndex } = cx;
  const spTop = currentSubplotY;
  const spBottom = spTop + spH;

  // Separator
  ctx.strokeStyle = colors.textDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, spTop);
  ctx.lineTo(chartWidth, spTop);
  ctx.stroke();

  let toY: (v: number) => number;
  if (opts?.fixedRange) {
    // Fixed 0-100 range (e.g. Stoch RSI, Aroon)
    toY = (v: number) => spTop + (1 - v / 100) * spH;
  } else {
    // Auto-range based on visible data, centered at zero
    const allVis: number[] = [];
    for (const line of lines) {
      visible.candles.forEach((_, i) => {
        const v = line.data[visible.startIndex + i];
        if (!isNaN(v) && isFinite(v)) allVis.push(v);
      });
    }
    const absMax = allVis.length > 0 ? Math.max(1, Math.max(...allVis.map(Math.abs))) : 1;
    toY = (v: number) => spTop + spH / 2 - (v / absMax) * (spH / 2);
  }

  // Zero line for centered-at-zero subplots
  if (!opts?.fixedRange) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(150,150,150,0.5)';
    ctx.beginPath();
    ctx.moveTo(0, toY(0));
    ctx.lineTo(chartWidth, toY(0));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Optional level lines (overbought/oversold for Stoch RSI, etc.)
  if (opts?.levelLines) {
    ctx.setLineDash([4, 4]);
    opts.levelLines.forEach(ll => {
      ctx.strokeStyle = ll.color;
      ctx.beginPath();
      ctx.moveTo(0, toY(ll.value));
      ctx.lineTo(chartWidth, toY(ll.value));
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  // Draw each data line
  for (const line of lines) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let s = false;
    visible.candles.forEach((_, i) => {
      const gi = visible.startIndex + i;
      const v = line.data[gi];
      if (!isNaN(v) && isFinite(v)) {
        const x = indexToX(gi, visible.startIndex);
        if (!s) { ctx.moveTo(x, toY(v)); s = true; } else { ctx.lineTo(x, toY(v)); }
      }
    });
    ctx.stroke();
  }

  // Right-side axis labels
  if (opts?.axisLabels) {
    ctx.fillStyle = '#6b7280';
    ctx.font = subplotLabelFont;
    opts.axisLabels.forEach(lv => {
      ctx.fillText(lv.toString(), chartWidth + 5, toY(lv));
    });
  }

  // Top-left label: indicator name + current value for each line in its color
  const hIdx = hoveredCandleIndex !== null ? hoveredCandleIndex : visible.startIndex + visible.candles.length - 1;
  ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = '#d1d5db';
  ctx.fillText(label, 5, spTop + 15);
  let valX = 5 + ctx.measureText(label).width + 4;
  for (const line of lines) {
    const v = line.data[hIdx];
    const valText = !isNaN(v) && isFinite(v) ? v.toFixed(2) : '--';
    ctx.fillStyle = line.color;
    ctx.fillText(valText, valX, spTop + 15);
    valX += ctx.measureText(valText).width + 6;
  }
  subplotLabelEndX[boundsKey] = valX + 8;
  (indicatorBounds as any)[boundsKey] = { top: spTop, bottom: spBottom };

  return spBottom;
}

// ═══════════════════════════════════════════════════════════════════════════
// renderGenericSubplots: renders all generic subplots below the core
// indicators (RSI, MACD, ATR, Stochastic, Williams%R, CCI, ADX, ROC).
// Those core indicators are still rendered inline in ProChart.tsx because
// they have custom style settings (backgroundColor, gridColor, etc.) that
// make them harder to extract without changing behavior.
//
// This function renders: Aroon, Momentum, AO, MFI, TSI, TRIX, Ultimate Osc,
// DPO, KST, StochRSI, BB%B, BBWidth, Historical Vol, Chaikin Vol, StdDev,
// OBV, CMF, A/D Line, Force Index, EOM, Correlation, Coppock, and all
// Phase 2 subplots (Vortex through Gator), plus custom formula subplots.
//
// Returns the final currentSubplotY value so the caller can continue
// rendering below these subplots (e.g. economic event markers).
// ═══════════════════════════════════════════════════════════════════════════
export function renderGenericSubplots(cx: SubplotRenderContext, startY: number): number {
  const { ctx, chartWidth, subplotHeight, visible, indexToX, colors, indicators, indicatorData, indicatorBounds, subplotLabelEndX, currentCandleWidth, subplotLabelFont, skipIndicators } = cx;
  let currentSubplotY = startY;

  // ── AROON (dual-line, fixed 0-100 range) ──
  if (!skipIndicators && indicatorData?.aroon) {
    currentSubplotY = drawDualLineSubplot(cx, currentSubplotY,
      [
        { data: indicatorData.aroon.up, color: indicators?.aroon?.upColor || '#22c55e' },
        { data: indicatorData.aroon.down, color: indicators?.aroon?.downColor || '#ef4444' },
      ],
      `Aroon ${indicators?.aroon?.period || 14}`, 'aroon',
      { fixedRange: true, levelLines: [
        { value: 30, color: 'rgba(150,150,150,0.3)' },
        { value: 50, color: 'rgba(150,150,150,0.3)' },
        { value: 70, color: 'rgba(150,150,150,0.3)' },
      ], axisLabels: [0, 50, 100] }
    );
  }

  // ── MOMENTUM ──
  if (!skipIndicators && indicatorData?.momentum) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.momentum, label: `MOM ${indicators?.momentum?.period || 10}`, color: indicators?.momentum?.color || '#AB47BC', boundsKey: 'momentum', zeroLine: true }, currentSubplotY);
  }

  // ── AWESOME OSCILLATOR (histogram, not a line) ──
  if (!skipIndicators && indicatorData?.ao) {
    const spH = subplotHeight;
    const spTop = currentSubplotY;
    const spBottom = spTop + spH;
    ctx.strokeStyle = colors.textDim; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, spTop); ctx.lineTo(chartWidth, spTop); ctx.stroke();
    const visAO = visible.candles.map((_, i) => indicatorData.ao![visible.startIndex + i]).filter((v: number) => !isNaN(v) && isFinite(v));
    const aoMax = visAO.length > 0 ? Math.max(1, Math.max(...visAO.map(Math.abs))) : 1;
    const toY = (v: number) => spTop + spH / 2 - (v / aoMax) * (spH / 2);
    // Zero line
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(150,150,150,0.5)'; ctx.beginPath(); ctx.moveTo(0, toY(0)); ctx.lineTo(chartWidth, toY(0)); ctx.stroke(); ctx.setLineDash([]);
    // Histogram bars colored by whether current bar is higher or lower than previous
    visible.candles.forEach((_: any, i: number) => {
      const gi = visible.startIndex + i;
      const v = indicatorData.ao![gi];
      const prev = gi > 0 ? indicatorData.ao![gi - 1] : 0;
      if (!isNaN(v) && isFinite(v)) {
        ctx.fillStyle = v >= prev ? (indicators?.ao?.bullishColor || '#22c55e') : (indicators?.ao?.bearishColor || '#ef4444');
        const x = indexToX(gi, visible.startIndex);
        const barW = Math.max(1, currentCandleWidth * 0.6);
        const y0 = toY(0); const yv = toY(v);
        ctx.fillRect(x - barW / 2, Math.min(y0, yv), barW, Math.abs(yv - y0));
      }
    });
    ctx.fillStyle = '#d1d5db'; ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.fillText('AO', 5, spTop + 15);
    subplotLabelEndX.ao = 5 + ctx.measureText('AO').width + 8;
    (indicatorBounds as any).ao = { top: spTop, bottom: spBottom };
    currentSubplotY = spBottom;
  }

  // ── MFI ──
  if (!skipIndicators && indicatorData?.mfi) {
    currentSubplotY = drawSimpleSubplot(cx, {
      data: indicatorData.mfi, label: `MFI ${indicators?.mfi?.period || 14}`, color: indicators?.mfi?.color || '#26A69A', boundsKey: 'mfi', fixedMin: 0, fixedMax: 100,
      levelLines: [
        { value: indicators?.mfi?.overbought || 80, color: 'rgba(239,68,68,0.4)', dash: [4, 4] },
        { value: indicators?.mfi?.oversold || 20, color: 'rgba(34,197,94,0.4)', dash: [4, 4] }
      ]
    }, currentSubplotY);
  }

  // ── TSI (dual-line: tsi + signal) ──
  if (!skipIndicators && indicatorData?.tsi) {
    currentSubplotY = drawDualLineSubplot(cx, currentSubplotY,
      [
        { data: indicatorData.tsi.tsi, color: indicators?.tsi?.tsiColor || '#2196F3' },
        { data: indicatorData.tsi.signal, color: indicators?.tsi?.signalColor || '#FF9800' },
      ],
      'TSI', 'tsi'
    );
  }

  // ── TRIX (dual-line: trix + signal) ──
  if (!skipIndicators && indicatorData?.trix) {
    currentSubplotY = drawDualLineSubplot(cx, currentSubplotY,
      [
        { data: indicatorData.trix.trix, color: indicators?.trix?.trixColor || '#7C4DFF' },
        { data: indicatorData.trix.signal, color: indicators?.trix?.signalColor || '#FF9800' },
      ],
      `TRIX ${indicators?.trix?.period || 15}`, 'trix'
    );
  }

  // ── ULTIMATE OSCILLATOR ──
  if (!skipIndicators && indicatorData?.ultimateOsc) {
    currentSubplotY = drawSimpleSubplot(cx, {
      data: indicatorData.ultimateOsc, label: 'UO', color: indicators?.ultimateOsc?.color || '#7E57C2', boundsKey: 'ultimateOsc', fixedMin: 0, fixedMax: 100,
      levelLines: [
        { value: indicators?.ultimateOsc?.overbought || 70, color: 'rgba(239,68,68,0.4)' },
        { value: indicators?.ultimateOsc?.oversold || 30, color: 'rgba(34,197,94,0.4)' }
      ]
    }, currentSubplotY);
  }

  // ── DPO ──
  if (!skipIndicators && indicatorData?.dpo) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.dpo, label: `DPO ${indicators?.dpo?.period || 20}`, color: indicators?.dpo?.color || '#FF7043', boundsKey: 'dpo', zeroLine: true }, currentSubplotY);
  }

  // ── KST (dual-line: kst + signal) ──
  if (!skipIndicators && indicatorData?.kst) {
    currentSubplotY = drawDualLineSubplot(cx, currentSubplotY,
      [
        { data: indicatorData.kst.kst, color: '#00BCD4' },
        { data: indicatorData.kst.signal, color: '#FF9800' },
      ],
      'KST', 'kst'
    );
  }

  // ── STOCH RSI (dual-line: k + d, fixed 0-100) ──
  if (!skipIndicators && indicatorData?.stochRsi) {
    currentSubplotY = drawDualLineSubplot(cx, currentSubplotY,
      [
        { data: indicatorData.stochRsi.k, color: indicators?.stochRsi?.kColor || '#2196F3' },
        { data: indicatorData.stochRsi.d, color: indicators?.stochRsi?.dColor || '#FF9800' },
      ],
      'Stoch RSI', 'stochRsi',
      {
        fixedRange: true,
        levelLines: [
          { value: indicators?.stochRsi?.overbought || 80, color: 'rgba(239,68,68,0.3)' },
          { value: indicators?.stochRsi?.oversold || 20, color: 'rgba(34,197,94,0.3)' },
        ],
        axisLabels: [0, 50, 100],
      }
    );
  }

  // ── BB %B ──
  if (!skipIndicators && indicatorData?.bbPercent) {
    currentSubplotY = drawSimpleSubplot(cx, {
      data: indicatorData.bbPercent, label: `BB%B ${indicators?.bbPercent?.period || 20}`, color: indicators?.bbPercent?.color || '#CE93D8', boundsKey: 'bbPercent',
      levelLines: [
        { value: 1, color: 'rgba(239,68,68,0.3)' },
        { value: 0, color: 'rgba(34,197,94,0.3)' },
        { value: 0.5, color: 'rgba(150,150,150,0.3)' }
      ]
    }, currentSubplotY);
  }

  // ── BB Width ──
  if (!skipIndicators && indicatorData?.bbWidth) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.bbWidth, label: `BBW ${indicators?.bbWidth?.period || 20}`, color: indicators?.bbWidth?.color || '#80DEEA', boundsKey: 'bbWidth' }, currentSubplotY);
  }

  // ── Historical Volatility ──
  if (!skipIndicators && indicatorData?.histVol) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.histVol, label: `HV ${indicators?.histVol?.period || 20}`, color: indicators?.histVol?.color || '#F48FB1', boundsKey: 'histVol', formatValue: (v: number) => (v * 100).toFixed(1) + '%' }, currentSubplotY);
  }

  // ── Chaikin Volatility ──
  if (!skipIndicators && indicatorData?.chaikinVol) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.chaikinVol, label: 'Chaikin Vol', color: indicators?.chaikinVol?.color || '#FFAB91', boundsKey: 'chaikinVol', zeroLine: true, formatValue: (v: number) => v.toFixed(1) + '%' }, currentSubplotY);
  }

  // ── Standard Deviation ──
  if (!skipIndicators && indicatorData?.stdDev) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.stdDev, label: `StdDev ${indicators?.stdDev?.period || 20}`, color: indicators?.stdDev?.color || '#B39DDB', boundsKey: 'stdDev' }, currentSubplotY);
  }

  // ── OBV (large numbers, custom formatter) ──
  if (!skipIndicators && indicatorData?.obv) {
    currentSubplotY = drawSimpleSubplot(cx, {
      data: indicatorData.obv, label: 'OBV', color: indicators?.obv?.color || '#4CAF50', boundsKey: 'obv', zeroLine: true, formatValue: (v: number) => {
        if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
        if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
        return v.toFixed(0);
      }
    }, currentSubplotY);
  }

  // ── CMF ──
  if (!skipIndicators && indicatorData?.cmf) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.cmf, label: `CMF ${indicators?.cmf?.period || 20}`, color: indicators?.cmf?.color || '#66BB6A', boundsKey: 'cmf', fixedMin: -1, fixedMax: 1, zeroLine: true }, currentSubplotY);
  }

  // ── A/D Line ──
  if (!skipIndicators && indicatorData?.adl) {
    currentSubplotY = drawSimpleSubplot(cx, {
      data: indicatorData.adl, label: 'A/D Line', color: indicators?.adl?.color || '#29B6F6', boundsKey: 'adl', formatValue: (v: number) => {
        if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
        if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
        return v.toFixed(0);
      }
    }, currentSubplotY);
  }

  // ── Force Index ──
  if (!skipIndicators && indicatorData?.forceIndex) {
    currentSubplotY = drawSimpleSubplot(cx, {
      data: indicatorData.forceIndex, label: `FI ${indicators?.forceIndex?.period || 13}`, color: indicators?.forceIndex?.color || '#FF7043', boundsKey: 'forceIndex', zeroLine: true, formatValue: (v: number) => {
        if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
        if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
        return v.toFixed(0);
      }
    }, currentSubplotY);
  }

  // ── EOM ──
  if (!skipIndicators && indicatorData?.eom) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.eom, label: `EOM ${indicators?.eom?.period || 14}`, color: indicators?.eom?.color || '#AB47BC', boundsKey: 'eom', zeroLine: true }, currentSubplotY);
  }

  // ── Correlation ──
  if (!skipIndicators && indicatorData?.correlation) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.correlation, label: `Corr ${indicators?.correlation?.period || 20}`, color: indicators?.correlation?.color || '#7986CB', boundsKey: 'correlation', fixedMin: -1, fixedMax: 1, zeroLine: true }, currentSubplotY);
  }

  // ── Coppock Curve ──
  if (!skipIndicators && indicatorData?.coppock) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.coppock, label: `Coppock`, color: indicators?.coppock?.color || '#FF6F00', boundsKey: 'coppock', zeroLine: true }, currentSubplotY);
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 2 Trend Subplots
  // ══════════════════════════════════════════════════════════════════

  if (!skipIndicators && indicatorData?.vortex) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.vortex.viPlus, label: 'Vortex VI+', color: indicators?.vortex?.plusColor || '#22c55e', boundsKey: 'vortex' }, currentSubplotY);
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.vortex.viMinus, label: 'Vortex VI-', color: indicators?.vortex?.minusColor || '#ef4444', boundsKey: 'vortex', drawBoundsFromExisting: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.choppiness) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.choppiness, label: 'CHOP', color: indicators?.choppiness?.color || '#fdcb6e', boundsKey: 'choppiness' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.elderRay) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.elderRay.bullPower, label: 'Bull Power', color: indicators?.elderRay?.bullColor || '#22c55e', boundsKey: 'elderRay', zeroLine: true }, currentSubplotY);
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.elderRay.bearPower, label: 'Bear Power', color: indicators?.elderRay?.bearColor || '#ef4444', boundsKey: 'elderRay', drawBoundsFromExisting: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.massIndex) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.massIndex, label: 'Mass Index', color: indicators?.massIndex?.color || '#e17055', boundsKey: 'massIndex' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.linRegSlope) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.linRegSlope, label: 'LR Slope', color: indicators?.linRegSlope?.color || '#74b9ff', boundsKey: 'linRegSlope', zeroLine: true }, currentSubplotY);
  }

  // Phase 2 Oscillator Subplots
  if (!skipIndicators && indicatorData?.ppo) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.ppo.ppo, label: 'PPO', color: indicators?.ppo?.ppoColor || '#3498DB', boundsKey: 'ppo', zeroLine: true }, currentSubplotY);
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.ppo.signal, label: 'Signal', color: indicators?.ppo?.signalColor || '#E67E22', boundsKey: 'ppo', drawBoundsFromExisting: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.pvo) {
    const pvoData: number[] = Array.isArray(indicatorData.pvo) ? indicatorData.pvo : indicatorData.pvo.pvo;
    currentSubplotY = drawSimpleSubplot(cx, { data: pvoData, label: 'PVO', color: indicators?.pvo?.color || '#e056fd', boundsKey: 'pvo', zeroLine: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.cmo) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.cmo, label: 'CMO', color: indicators?.cmo?.color || '#f9ca24', boundsKey: 'cmo', zeroLine: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.fisher) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.fisher.fisher, label: 'Fisher', color: indicators?.fisher?.fisherColor || '#00b894', boundsKey: 'fisher', zeroLine: true }, currentSubplotY);
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.fisher.trigger, label: 'Trigger', color: indicators?.fisher?.triggerColor || '#d63031', boundsKey: 'fisher', drawBoundsFromExisting: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.stc) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.stc, label: 'STC', color: indicators?.stc?.color || '#e84393', boundsKey: 'stc' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.rviOsc) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.rviOsc.rvi, label: 'RVI', color: indicators?.rviOsc?.rviColor || '#00cec9', boundsKey: 'rviOsc', zeroLine: true }, currentSubplotY);
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.rviOsc.signal, label: 'Signal', color: indicators?.rviOsc?.signalColor || '#fdcb6e', boundsKey: 'rviOsc', drawBoundsFromExisting: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.klinger) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.klinger.klinger, label: 'Klinger', color: indicators?.klinger?.klingerColor || '#6c5ce7', boundsKey: 'klinger', zeroLine: true }, currentSubplotY);
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.klinger.signal, label: 'Signal', color: indicators?.klinger?.signalColor || '#fd79a8', boundsKey: 'klinger', drawBoundsFromExisting: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.connorsRsi) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.connorsRsi, label: 'CRSI', color: indicators?.connorsRsi?.color || '#e17055', boundsKey: 'connorsRsi' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.apo) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.apo, label: 'APO', color: indicators?.apo?.color || '#0984e3', boundsKey: 'apo', zeroLine: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.qstick) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.qstick, label: 'Qstick', color: indicators?.qstick?.color || '#00b894', boundsKey: 'qstick', zeroLine: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.bop) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.bop, label: 'BOP', color: indicators?.bop?.color || '#636e72', boundsKey: 'bop', zeroLine: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.psychLine) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.psychLine, label: 'Psych Line', color: indicators?.psychLine?.color || '#a29bfe', boundsKey: 'psychLine' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.pfe) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.pfe, label: 'PFE', color: indicators?.pfe?.color || '#fab1a0', boundsKey: 'pfe', zeroLine: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.smi) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.smi.smi, label: 'SMI', color: indicators?.smi?.smiColor || '#0984e3', boundsKey: 'smi', zeroLine: true }, currentSubplotY);
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.smi.signal, label: 'Signal', color: indicators?.smi?.signalColor || '#e17055', boundsKey: 'smi', drawBoundsFromExisting: true }, currentSubplotY);
  }

  // Phase 2 Volatility Subplots
  if (!skipIndicators && indicatorData?.ulcerIndex) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.ulcerIndex, label: 'Ulcer', color: indicators?.ulcerIndex?.color || '#d63031', boundsKey: 'ulcerIndex' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.natr) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.natr, label: 'NATR', color: indicators?.natr?.color || '#e84393', boundsKey: 'natr' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.trueRange) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.trueRange, label: 'TR', color: indicators?.trueRange?.color || '#fdcb6e', boundsKey: 'trueRange' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.squeeze) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.squeeze.momentum, label: 'Squeeze', color: indicators?.squeeze?.color || '#00cec9', boundsKey: 'squeeze', zeroLine: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.relVolIndex) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.relVolIndex, label: 'RVol', color: indicators?.relVolIndex?.color || '#6c5ce7', boundsKey: 'relVolIndex' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.vhf) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.vhf, label: 'VHF', color: indicators?.vhf?.color || '#fd79a8', boundsKey: 'vhf' }, currentSubplotY);
  }

  // Phase 2 Volume Subplots
  if (!skipIndicators && indicatorData?.volumeOsc) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.volumeOsc, label: 'Vol Osc', color: indicators?.volumeOsc?.color || '#f9ca24', boundsKey: 'volumeOsc', zeroLine: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.nvi) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.nvi, label: 'NVI', color: indicators?.nvi?.color || '#e17055', boundsKey: 'nvi' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.pvi) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.pvi, label: 'PVI', color: indicators?.pvi?.color || '#00b894', boundsKey: 'pvi' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.pvt) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.pvt, label: 'PVT', color: indicators?.pvt?.color || '#0984e3', boundsKey: 'pvt' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.vroc) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.vroc, label: 'VROC', color: indicators?.vroc?.color || '#6c5ce7', boundsKey: 'vroc', zeroLine: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.netVolume) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.netVolume, label: 'Net Vol', color: indicators?.netVolume?.color || '#a29bfe', boundsKey: 'netVolume', zeroLine: true }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.twiggsMF) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.twiggsMF, label: 'Twiggs MF', color: indicators?.twiggsMF?.color || '#fdcb6e', boundsKey: 'twiggsMF', zeroLine: true }, currentSubplotY);
  }

  // Phase 2 Statistics Subplots
  if (!skipIndicators && indicatorData?.linRegRSquared) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.linRegRSquared, label: 'R\u00B2', color: indicators?.linRegRSquared?.color || '#74b9ff', boundsKey: 'linRegRSquared' }, currentSubplotY);
  }
  if (!skipIndicators && indicatorData?.gator) {
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.gator.upper, label: 'Gator\u2191', color: indicators?.gator?.upperColor || '#22c55e', boundsKey: 'gator', zeroLine: true }, currentSubplotY);
    currentSubplotY = drawSimpleSubplot(cx, { data: indicatorData.gator.lower, label: 'Gator\u2193', color: indicators?.gator?.lowerColor || '#ef4444', boundsKey: 'gator', drawBoundsFromExisting: true }, currentSubplotY);
  }

  // ── CUSTOM FORMULA INDICATORS (subplot + overlay) ──────────────────
  if (!skipIndicators && indicatorData?.customIndicators) {
    // Engine (Python) indicators tag their columns with a shared `group` so a
    // multi-line indicator draws in ONE pane with one scale. Entries without a
    // group (Brue plots, formula indicators) keep the one-pane-per-entry path.
    const drawnGroups = new Set<string>();
    for (const ci of indicatorData.customIndicators) {
      if (ci.display === 'subplot' && ci.data?.length > 0 && (ci as any).group) {
        const g = (ci as any).group as string;
        if (drawnGroups.has(g)) continue;
        drawnGroups.add(g);
        const members = indicatorData.customIndicators.filter(
          (m: any) => m.display === 'subplot' && m.group === g && m.data?.length > 0);
        currentSubplotY = drawGroupedSubplot(cx, g, members, currentSubplotY);
      } else if (ci.display === 'subplot' && ci.data?.length > 0) {
        currentSubplotY = drawSimpleSubplot(cx, {
          data: ci.data,
          label: ci.name,
          color: ci.color,
          boundsKey: `custom_${ci.id}`,
          zeroLine: ci.zeroLine,
        }, currentSubplotY);
      } else if (ci.display === 'overlay' && ci.data?.length > 0) {
        // Custom overlay line on the main chart area
        ctx.strokeStyle = ci.color;
        ctx.lineWidth = ci.lineWidth || 2;
        ctx.beginPath();
        let overlayStarted = false;
        visible.candles.forEach((_: any, i: number) => {
          const gi = visible.startIndex + i;
          const v = ci.data[gi];
          if (!isNaN(v) && isFinite(v)) {
            const x = indexToX(gi, visible.startIndex);
            const y = cx.mainPriceToY(v);
            if (!overlayStarted) { ctx.moveTo(x, y); overlayStarted = true; } else { ctx.lineTo(x, y); }
          }
        });
        ctx.stroke();
      }
    }
  }

  return currentSubplotY;
}

// ═══════════════════════════════════════════════════════════════════════════
// renderPhase2Overlays: draws overlay lines (ALMA, KAMA, ZLEMA, T3, etc.)
// on the main chart area. These are price-scaled lines drawn on top of
// candles, NOT in subplot panels.
// ═══════════════════════════════════════════════════════════════════════════
export function renderPhase2Overlays(cx: SubplotRenderContext): void {
  const { ctx, visible, indexToX, mainPriceToY, indicators, indicatorData, skipIndicators, chartWidth } = cx;

  // Helper: draw a single overlay line on the main chart
  const drawOverlayLine = (data: number[] | null, color: string, lineWidth: number = 1.5) => {
    if (!data) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    let started = false;
    visible.candles.forEach((_: any, i: number) => {
      const gi = visible.startIndex + i;
      const v = data[gi];
      if (v != null && !isNaN(v) && isFinite(v)) {
        const x = indexToX(gi, visible.startIndex);
        const y = mainPriceToY(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      }
    });
    ctx.stroke();
  };

  // Single-line trend overlays
  if (!skipIndicators && indicatorData?.alma) drawOverlayLine(indicatorData.alma, indicators?.alma?.color || '#ff6b6b', indicators?.alma?.lineWidth || 1.5);
  if (!skipIndicators && indicatorData?.kama) drawOverlayLine(indicatorData.kama, indicators?.kama?.color || '#4ecdc4', indicators?.kama?.lineWidth || 1.5);
  if (!skipIndicators && indicatorData?.zlema) drawOverlayLine(indicatorData.zlema, indicators?.zlema?.color || '#a29bfe', indicators?.zlema?.lineWidth || 1.5);
  if (!skipIndicators && indicatorData?.t3) drawOverlayLine(indicatorData.t3, indicators?.t3?.color || '#fd79a8', indicators?.t3?.lineWidth || 1.5);
  if (!skipIndicators && indicatorData?.lsma) drawOverlayLine(indicatorData.lsma, indicators?.lsma?.color || '#00cec9', indicators?.lsma?.lineWidth || 1.5);
  if (!skipIndicators && indicatorData?.mcginley) drawOverlayLine(indicatorData.mcginley, indicators?.mcginley?.color || '#6c5ce7', indicators?.mcginley?.lineWidth || 1.5);
  if (!skipIndicators && indicatorData?.wma) drawOverlayLine(indicatorData.wma, indicators?.wma?.color || '#ffeaa7', indicators?.wma?.lineWidth || 1.5);
  if (!skipIndicators && indicatorData?.smmaOverlay) drawOverlayLine(indicatorData.smmaOverlay, indicators?.smmaOverlay?.color || '#dfe6e9', indicators?.smmaOverlay?.lineWidth || 1.5);
  if (!skipIndicators && indicatorData?.vwma) drawOverlayLine(indicatorData.vwma, indicators?.vwma?.color || '#e056fd', indicators?.vwma?.lineWidth || 1.5);
  if (!skipIndicators && indicatorData?.medianPrice) drawOverlayLine(indicatorData.medianPrice, indicators?.medianPrice?.color || '#dfe6e9', indicators?.medianPrice?.lineWidth || 1);
  if (!skipIndicators && indicatorData?.typicalPrice) drawOverlayLine(indicatorData.typicalPrice, indicators?.typicalPrice?.color || '#b2bec3', indicators?.typicalPrice?.lineWidth || 1);
  if (!skipIndicators && indicatorData?.weightedClose) drawOverlayLine(indicatorData.weightedClose, indicators?.weightedClose?.color || '#636e72', indicators?.weightedClose?.lineWidth || 1);
  if (!skipIndicators && indicatorData?.zigzag) drawOverlayLine(indicatorData.zigzag, indicators?.zigzag?.color || '#e84393', indicators?.zigzag?.lineWidth || 2);

  // Alligator (3 overlay lines: jaw, teeth, lips)
  if (!skipIndicators && indicatorData?.alligator) {
    drawOverlayLine(indicatorData.alligator.jaw, indicators?.alligator?.jawColor || '#0984e3', indicators?.alligator?.lineWidth || 1.5);
    drawOverlayLine(indicatorData.alligator.teeth, indicators?.alligator?.teethColor || '#e17055', indicators?.alligator?.lineWidth || 1.5);
    drawOverlayLine(indicatorData.alligator.lips, indicators?.alligator?.lipsColor || '#00b894', indicators?.alligator?.lineWidth || 1.5);
  }

  // Price Channel (upper, middle, lower)
  if (!skipIndicators && indicatorData?.priceChannel) {
    drawOverlayLine(indicatorData.priceChannel.upper, indicators?.priceChannel?.upperColor || '#0984e3', indicators?.priceChannel?.lineWidth || 1.5);
    drawOverlayLine(indicatorData.priceChannel.middle, indicators?.priceChannel?.middleColor || '#636e72', indicators?.priceChannel?.lineWidth || 1);
    drawOverlayLine(indicatorData.priceChannel.lower, indicators?.priceChannel?.lowerColor || '#0984e3', indicators?.priceChannel?.lineWidth || 1.5);
  }

  // Chande Kroll Stop (long stop, short stop)
  if (!skipIndicators && indicatorData?.chandeKroll) {
    drawOverlayLine(indicatorData.chandeKroll.stopLong, indicators?.chandeKroll?.longColor || '#22c55e', indicators?.chandeKroll?.lineWidth || 1.5);
    drawOverlayLine(indicatorData.chandeKroll.stopShort, indicators?.chandeKroll?.shortColor || '#ef4444', indicators?.chandeKroll?.lineWidth || 1.5);
  }

  // Chandelier Exit (exit long, exit short)
  if (!skipIndicators && indicatorData?.chandelierExit) {
    drawOverlayLine(indicatorData.chandelierExit.exitLong, indicators?.chandelierExit?.longColor || '#22c55e', indicators?.chandelierExit?.lineWidth || 1.5);
    drawOverlayLine(indicatorData.chandelierExit.exitShort, indicators?.chandelierExit?.shortColor || '#ef4444', indicators?.chandelierExit?.lineWidth || 1.5);
  }

  // Acceleration Bands (upper, middle, lower)
  if (!skipIndicators && indicatorData?.accBands) {
    drawOverlayLine(indicatorData.accBands.upper, indicators?.accBands?.upperColor || '#74b9ff', indicators?.accBands?.lineWidth || 1.5);
    drawOverlayLine(indicatorData.accBands.middle, indicators?.accBands?.middleColor || '#636e72', indicators?.accBands?.lineWidth || 1);
    drawOverlayLine(indicatorData.accBands.lower, indicators?.accBands?.lowerColor || '#74b9ff', indicators?.accBands?.lineWidth || 1.5);
  }

  // DeMark Pivots (pivot, R1, S1)
  if (!skipIndicators && indicatorData?.demarkPivots) {
    drawOverlayLine(indicatorData.demarkPivots.pivot, indicators?.demarkPivots?.pivotColor || '#ffeb3b', indicators?.demarkPivots?.lineWidth || 1);
    drawOverlayLine(indicatorData.demarkPivots.r1, indicators?.demarkPivots?.resistanceColor || '#ef4444', indicators?.demarkPivots?.lineWidth || 1);
    drawOverlayLine(indicatorData.demarkPivots.s1, indicators?.demarkPivots?.supportColor || '#22c55e', indicators?.demarkPivots?.lineWidth || 1);
  }

  // Fractals (triangle markers at fractal points, not lines)
  if (!skipIndicators && indicatorData?.fractals) {
    const upColor = indicators?.fractals?.upColor || '#22c55e';
    const downColor = indicators?.fractals?.downColor || '#ef4444';
    visible.candles.forEach((_: any, i: number) => {
      const gi = visible.startIndex + i;
      const x = indexToX(gi, visible.startIndex);
      const upVal = indicatorData.fractals.upFractals[gi];
      const downVal = indicatorData.fractals.downFractals[gi];
      if (!isNaN(upVal)) {
        ctx.fillStyle = upColor;
        ctx.beginPath(); ctx.moveTo(x, mainPriceToY(upVal) - 6); ctx.lineTo(x - 4, mainPriceToY(upVal) - 12); ctx.lineTo(x + 4, mainPriceToY(upVal) - 12); ctx.fill();
      }
      if (!isNaN(downVal)) {
        ctx.fillStyle = downColor;
        ctx.beginPath(); ctx.moveTo(x, mainPriceToY(downVal) + 6); ctx.lineTo(x - 4, mainPriceToY(downVal) + 12); ctx.lineTo(x + 4, mainPriceToY(downVal) + 12); ctx.fill();
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// renderSubplotSelectionDots: draws small filled circles at regular
// intervals along the selected subplot's data line(s). This gives
// TradingView-style visual feedback when the user clicks on a subplot.
// ═══════════════════════════════════════════════════════════════════════════
export function renderSubplotSelectionDots(cx: SubplotRenderContext): void {
  const { ctx, chartWidth, visible, indexToX, indicatorData, indicators, indicatorBounds, clickedIndicatorKey } = cx;

  if (!clickedIndicatorKey?.startsWith('sp-') || !indicatorData) return;

  const spKey = clickedIndicatorKey.replace('sp-', '');
  const pb = (indicatorBounds as any)[spKey];
  if (!pb) return;

  const spH = pb.bottom - pb.top;
  const SP_DOT_INTERVAL = 8;
  const SP_DOT_R = 2.5;

  // Draws selection dots along a data array within a subplot panel
  const drawSpDots = (data: number[], color: string, valToY: (v: number) => number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, pb.top, chartWidth, spH);
    ctx.clip();
    for (let i = 0; i < visible.candles.length; i += SP_DOT_INTERVAL) {
      const gi = visible.startIndex + i;
      if (gi >= data.length) continue;
      const v = data[gi];
      if (isNaN(v) || !isFinite(v)) continue;
      const px = indexToX(gi, visible.startIndex);
      const py = valToY(v);
      // Dark ring for contrast against any subplot background
      ctx.beginPath();
      ctx.arc(px, py, SP_DOT_R + 1, 0, Math.PI * 2);
      ctx.fillStyle = '#131722';
      ctx.fill();
      // Filled circle in indicator color
      ctx.beginPath();
      ctx.arc(px, py, SP_DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  };

  // Fixed-range Y converters for known subplot types
  const spValToY0_100 = (v: number) => pb.top + spH - (v / 100) * spH;
  const spValToYNeg100 = (v: number) => pb.top + spH - ((v + 100) / 100) * spH;

  // Auto-range Y converter: finds visible min/max across multiple data arrays
  const spAutoRange = (dataArrays: (number[] | undefined)[]) => {
    let dMin = Infinity, dMax = -Infinity;
    for (const arr of dataArrays) {
      if (!arr) continue;
      for (let i = visible.startIndex; i < visible.startIndex + visible.candles.length; i++) {
        if (i >= arr.length) continue;
        const v = arr[i];
        if (!isNaN(v) && isFinite(v)) { if (v < dMin) dMin = v; if (v > dMax) dMax = v; }
      }
    }
    if (dMin >= dMax) return null;
    const pad = (dMax - dMin) * 0.1;
    dMin -= pad; dMax += pad;
    const r = dMax - dMin;
    return (v: number) => pb.top + spH - ((v - dMin) / r) * spH;
  };

  // Match the subplot key to its data and draw dots with the appropriate Y converter
  if (spKey === 'rsi' && indicatorData.rsi) {
    drawSpDots(indicatorData.rsi, indicators?.rsi?.color || '#E74C3C', spValToY0_100);
  } else if (spKey === 'stochastic' && indicatorData.stochastic) {
    drawSpDots(indicatorData.stochastic.k, indicators?.stochastic?.kColor || '#2196F3', spValToY0_100);
    drawSpDots(indicatorData.stochastic.d, indicators?.stochastic?.dColor || '#FF9800', spValToY0_100);
  } else if (spKey === 'macd' && indicatorData.macd) {
    const toY = spAutoRange([indicatorData.macd.macd, indicatorData.macd.signal]);
    if (toY) {
      drawSpDots(indicatorData.macd.macd, indicators?.macd?.macdColor || '#3b82f6', toY);
      drawSpDots(indicatorData.macd.signal, indicators?.macd?.signalColor || '#f97316', toY);
    }
  } else if (spKey === 'atr' && indicatorData.atr) {
    const toY = spAutoRange([indicatorData.atr]);
    if (toY) drawSpDots(indicatorData.atr, indicators?.atr?.color || '#9b59b6', toY);
  } else if (spKey === 'williamsR' && indicatorData.williamsR) {
    drawSpDots(indicatorData.williamsR, '#8e44ad', spValToYNeg100);
  } else if (spKey === 'cci' && indicatorData.cci) {
    const toY = spAutoRange([indicatorData.cci]);
    if (toY) drawSpDots(indicatorData.cci, '#e67e22', toY);
  } else if (spKey === 'adx' && indicatorData.adx) {
    drawSpDots(indicatorData.adx.adx, '#3b82f6', spValToY0_100);
    drawSpDots(indicatorData.adx.pdi, '#22c55e', spValToY0_100);
    drawSpDots(indicatorData.adx.ndi, '#ef4444', spValToY0_100);
  } else if (spKey === 'roc' && indicatorData.roc) {
    const toY = spAutoRange([indicatorData.roc]);
    if (toY) drawSpDots(indicatorData.roc, '#06b6d4', toY);
  } else if (spKey === 'aroon' && indicatorData.aroon) {
    drawSpDots(indicatorData.aroon.up, indicators?.aroon?.upColor || '#22c55e', spValToY0_100);
    drawSpDots(indicatorData.aroon.down, indicators?.aroon?.downColor || '#ef4444', spValToY0_100);
  } else if (spKey === 'tsi' && indicatorData.tsi) {
    const toY = spAutoRange([indicatorData.tsi.tsi, indicatorData.tsi.signal]);
    if (toY) {
      drawSpDots(indicatorData.tsi.tsi, indicators?.tsi?.tsiColor || '#2196F3', toY);
      drawSpDots(indicatorData.tsi.signal, indicators?.tsi?.signalColor || '#FF9800', toY);
    }
  } else if (spKey === 'trix' && indicatorData.trix) {
    const toY = spAutoRange([indicatorData.trix.trix, indicatorData.trix.signal]);
    if (toY) {
      drawSpDots(indicatorData.trix.trix, indicators?.trix?.trixColor || '#7C4DFF', toY);
      drawSpDots(indicatorData.trix.signal, indicators?.trix?.signalColor || '#FF9800', toY);
    }
  } else if (spKey === 'kst' && indicatorData.kst) {
    const toY = spAutoRange([indicatorData.kst.kst, indicatorData.kst.signal]);
    if (toY) {
      drawSpDots(indicatorData.kst.kst, '#00BCD4', toY);
      drawSpDots(indicatorData.kst.signal, '#FF9800', toY);
    }
  } else if (spKey === 'stochRsi' && indicatorData.stochRsi) {
    drawSpDots(indicatorData.stochRsi.k, indicators?.stochRsi?.kColor || '#2196F3', spValToY0_100);
    drawSpDots(indicatorData.stochRsi.d, indicators?.stochRsi?.dColor || '#FF9800', spValToY0_100);
  } else {
    // Generic subplot with auto-range (covers all Phase 2 indicators)
    const data = (indicatorData as any)[spKey];
    if (data && Array.isArray(data)) {
      const toY = spAutoRange([data]);
      if (toY) drawSpDots(data, '#3b82f6', toY);
    }
  }
}
