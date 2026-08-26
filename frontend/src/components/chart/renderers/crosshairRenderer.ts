// ============================================================================
// renderers/crosshairRenderer.ts
// Extracted from ProChart.tsx drawCrosshair() to reduce the monolithic callback.
// Contains: crosshair lines, axis labels, OHLC legend, indicator value labels,
// volume hover highlight, volume profile hover highlight, economic event
// tooltip cards, and synced crosshair rendering.
//
// All functions are PURE: no React state, refs, or hooks. The current values
// of interactive refs (crosshair position, scroll state, hovered events) are
// read once at call time and passed in via CrosshairContext.
// ============================================================================

import { type Candle, CANDLE_GAP_RATIO } from '../core/types';

// Relative-luminance based contrast picker: given a hex bg color, returns
// '#000000' or '#ffffff' so label text stays legible over any user choice.
// sRGB coefficients per WCAG 2.x; no gamma-linearization (good enough for
// two-way choice at small text sizes).
function getContrastText(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#000000' : '#ffffff';
}

// ── Visible candles result from getVisibleCandles() ──
export interface VisibleCandlesResult {
  candles: Candle[];
  startIndex: number;
  endIndex: number;
  visibleCount: number;
  totalWithFuture: number;
  candleWidth: number;
}

// ── Price range result from getPriceRange() ──
export interface PriceRange {
  min: number;
  max: number;
  range: number;
}

// ── Hovered economic event data ──
export interface HoveredEventData {
  event: any;
  impact: string;
  x: number;
  y: number;
  ts: number;
  groupEvents?: Array<{ event: any; impact: string; ts: number }>;
}

// ── Callbacks for updating React state from the renderer ──
// These replace the direct state setter calls that existed in the original
// inline useCallback. The parent component passes the setters through here
// so the renderer stays pure (no React imports).
export interface CrosshairCallbacks {
  setOhlcTextWidth: (width: number) => void;
  setBbTextEndX: (x: number) => void;
  setMaTextEndX: (x: number) => void;
  setVwapTextEndX: (x: number) => void;
  setVpTextEndX: (x: number) => void;
  setVolTextEndX: (x: number) => void;
  setOverlayLabelEndX: (endX: Record<string, number>) => void;
  setSubplotLabelEndX: (endX: Record<string, number>) => void;
  onCrosshairMove?: (price: number | null, time: number | null) => void;
}

// ── Full context needed to render the crosshair overlay ──
export interface CrosshairContext {
  ctx: CanvasRenderingContext2D;
  dimensions: { width: number; height: number };
  dpr: number;
  candles: Candle[];
  colors: any;
  viewState: {
    startIndex: number;
    candleWidth: number;
    autoFollowLatest: boolean;
    futureSpace: number;
  };
  indicatorData: any;
  indicators: any;
  indicatorHeightRatio: number;
  showOHLC: boolean;
  isDesktop: boolean;

  // Pre-computed layout constants (derived from isDesktop/isMobile in ProChart)
  PRICE_AXIS_WIDTH: number;
  TIME_AXIS_HEIGHT: number;
  PRICE_LABEL_FONT: string;
  TIME_LABEL_FONT: string;

  // Current ref values (read once, not refs themselves)
  crosshair: { x: number; y: number } | null;
  isScrolling: boolean;
  scrollState: { startIndex: number; candleWidth: number };
  isDraggingHandle: boolean;
  isHoveredSLTP: boolean;
  sessionControlHovered: boolean;
  isSyncedUpdate: boolean;
  syncedCrosshairTime: number | undefined;
  hoveredEvent: HoveredEventData | null;

  // Previous state values for change detection
  currentOhlcTextWidth: number;
  currentBbTextEndX: number;
  currentMaTextEndX: number;
  currentVwapTextEndX: number;
  currentVpTextEndX: number;
  currentVolTextEndX: number;
  overlayLabelEndXPrev: Record<string, number>;
  subplotLabelEndXPrev: Record<string, number>;

  // Helper functions (from useCallback hooks in ProChart)
  getVisibleCandles: () => VisibleCandlesResult;
  getPriceRange: (visibleCandles: Candle[], includeCurrentPrice: boolean) => PriceRange;
  yToPrice: (y: number, priceRange: PriceRange) => number;
  xToIndex: (x: number, startIndex: number) => number;
  indexToX: (index: number, startIndex: number) => number;
  formatPrice: (price: number) => string;
  formatTime: (timestamp: number) => string;
  formatDate: (timestamp: number, includeYear?: boolean) => string;

  // Callbacks for state updates
  callbacks: CrosshairCallbacks;
}

// ── Main crosshair rendering function ──
// Draws everything on the overlay canvas: crosshair lines, price/time axis
// labels, OHLC legend, indicator value labels, volume hover highlights,
// volume profile hover highlights, economic event tooltip cards, and
// synced crosshair from linked panels.
export function renderCrosshair(cx: CrosshairContext): void {
  const {
    ctx,
    dimensions,
    dpr,
    candles,
    viewState,
    indicatorData,
    indicators,
    indicatorHeightRatio,
    showOHLC,
    crosshair,
    isScrolling,
    scrollState,
    isDraggingHandle,
    isHoveredSLTP,
    isSyncedUpdate,
    hoveredEvent,
    getVisibleCandles,
    getPriceRange,
    yToPrice,
    xToIndex,
    callbacks,
    PRICE_AXIS_WIDTH,
    TIME_AXIS_HEIGHT,
  } = cx;

  const { width, height } = dimensions;
  const chartWidth = width - PRICE_AXIS_WIDTH;

  // Reset transform and scale for HiDPI
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Calculate main chart height (accounting for indicators) - use dynamic ratio.
  // IMPORTANT: Use Boolean() to match drawChart calculation - !== null returns
  // true for undefined, so Boolean() is needed for correct falsy checks.
  const numSubplots = countSubplots(indicatorData);
  const availableHeight = height - TIME_AXIS_HEIGHT;
  const totalIndicatorHeight = numSubplots > 0
    ? Math.max(60 * numSubplots, availableHeight * indicatorHeightRatio)
    : 0;
  const mainChartHeight = availableHeight - totalIndicatorHeight;

  ctx.clearRect(0, 0, width, height);

  const visible = getVisibleCandles();
  const priceRange = getPriceRange(visible.candles, viewState.autoFollowLatest);

  // Draw synced crosshair from another panel FIRST (before checking local crosshair).
  // This ensures it shows even when the user is not hovering on this panel.
  renderSyncedCrosshair(ctx, cx, chartWidth, mainChartHeight, height, visible, priceRange);

  // Determine which candle to show info for: hovered candle or latest
  let activeCandleIndex = candles.length - 1;

  // Check if crosshair is active and within the main chart area
  const isHovering = crosshair && crosshair.x <= chartWidth && crosshair.y <= mainChartHeight;

  if (isHovering && crosshair) {
    // Find the candle under the cursor, accounting for fractional scroll offset
    const rawStartIndex = isScrolling ? scrollState.startIndex : viewState.startIndex;
    const candleSpacing = viewState.candleWidth * (1 + CANDLE_GAP_RATIO);
    const fractionalOffset = (rawStartIndex - visible.startIndex) * candleSpacing;
    const adjustedX = crosshair.x + fractionalOffset;
    const hoveredIndex = xToIndex(adjustedX, visible.startIndex);

    if (hoveredIndex >= 0 && hoveredIndex < candles.length) {
      activeCandleIndex = hoveredIndex;
    }
  }

  const candle = candles[activeCandleIndex];

  // Crosshair lines and axis labels only appear when hovering in the main chart area.
  // Indicator sub-panels show a pointer cursor instead (handled in ProChart mousemove).
  if (isHovering && crosshair && !isDraggingHandle && !isHoveredSLTP) {
    renderCrosshairLines(ctx, cx, crosshair, chartWidth, mainChartHeight, height, visible, priceRange, candle, activeCandleIndex);
  }

  // Volume bar hover highlight (bright outline on the bar under cursor)
  const hasVolume = Boolean(indicators?.volume?.enabled);
  if (isHovering && crosshair && hasVolume && indicators?.volume?.enabled && mainChartHeight > 0) {
    renderVolumeHoverHighlight(ctx, cx, crosshair, chartWidth, mainChartHeight, visible);
  }

  // Volume profile hover highlight (right-side bars)
  if (isHovering && crosshair && indicators?.volumeProfile?.enabled && visible.candles.length > 0 && mainChartHeight > 0) {
    renderVolumeProfileHoverHighlight(ctx, cx, crosshair, chartWidth, mainChartHeight, visible, priceRange);
  }

  // OHLC legend and indicator value labels (always visible when showOHLC is true)
  if (candle && showOHLC) {
    renderInfoLegend(ctx, cx, candle, activeCandleIndex, chartWidth, mainChartHeight, visible, priceRange);
  }

  // Notify parent of crosshair position changes (only for user interactions, not synced updates)
  if (callbacks.onCrosshairMove && !isSyncedUpdate) {
    if (isHovering && crosshair) {
      const price = yToPrice(crosshair.y, priceRange);
      const time = activeCandleIndex >= 0 && activeCandleIndex < candles.length ? candles[activeCandleIndex].time : null;
      callbacks.onCrosshairMove(price, time);
    } else {
      callbacks.onCrosshairMove(null, null);
    }
  }

  // Economic event hover card (tooltip drawn on overlay canvas)
  if (hoveredEvent) {
    renderEconomicEventCard(ctx, chartWidth, hoveredEvent);
  }
}

// ── Count the number of active subplot indicators ──
// Must match the exact same list used in drawChart so the main chart height
// calculation is consistent between both rendering passes.
function countSubplots(indicatorData: any): number {
  const flags = [
    Boolean(indicatorData?.rsi),
    Boolean(indicatorData?.macd),
    Boolean(indicatorData?.atr),
    Boolean(indicatorData?.stochastic),
    Boolean(indicatorData?.williamsR),
    Boolean(indicatorData?.cci),
    Boolean(indicatorData?.adx),
    Boolean(indicatorData?.roc),
    Boolean(indicatorData?.aroon),
    Boolean(indicatorData?.momentum),
    Boolean(indicatorData?.ao),
    Boolean(indicatorData?.mfi),
    Boolean(indicatorData?.tsi),
    Boolean(indicatorData?.trix),
    Boolean(indicatorData?.ultimateOsc),
    Boolean(indicatorData?.dpo),
    Boolean(indicatorData?.kst),
    Boolean(indicatorData?.stochRsi),
    Boolean(indicatorData?.bbPercent),
    Boolean(indicatorData?.bbWidth),
    Boolean(indicatorData?.histVol),
    Boolean(indicatorData?.chaikinVol),
    Boolean(indicatorData?.stdDev),
    Boolean(indicatorData?.obv),
    Boolean(indicatorData?.cmf),
    Boolean(indicatorData?.adl),
    Boolean(indicatorData?.forceIndex),
    Boolean(indicatorData?.eom),
    Boolean(indicatorData?.correlation),
    Boolean(indicatorData?.coppock),
    // Phase 2 subplot indicators
    Boolean(indicatorData?.vortex),
    Boolean(indicatorData?.choppiness),
    Boolean(indicatorData?.elderRay),
    Boolean(indicatorData?.massIndex),
    Boolean(indicatorData?.linRegSlope),
    Boolean(indicatorData?.ppo),
    Boolean(indicatorData?.pvo),
    Boolean(indicatorData?.cmo),
    Boolean(indicatorData?.fisher),
    Boolean(indicatorData?.stc),
    Boolean(indicatorData?.rviOsc),
    Boolean(indicatorData?.klinger),
    Boolean(indicatorData?.connorsRsi),
    Boolean(indicatorData?.apo),
    Boolean(indicatorData?.qstick),
    Boolean(indicatorData?.bop),
    Boolean(indicatorData?.psychLine),
    Boolean(indicatorData?.pfe),
    Boolean(indicatorData?.smi),
    Boolean(indicatorData?.ulcerIndex),
    Boolean(indicatorData?.natr),
    Boolean(indicatorData?.trueRange),
    Boolean(indicatorData?.squeeze),
    Boolean(indicatorData?.relVolIndex),
    Boolean(indicatorData?.vhf),
    Boolean(indicatorData?.volumeOsc),
    Boolean(indicatorData?.nvi),
    Boolean(indicatorData?.pvi),
    Boolean(indicatorData?.pvt),
    Boolean(indicatorData?.vroc),
    Boolean(indicatorData?.netVolume),
    Boolean(indicatorData?.twiggsMF),
    Boolean(indicatorData?.linRegRSquared),
    Boolean(indicatorData?.gator),
  ];
  return flags.filter(Boolean).length
    + (indicatorData?.customIndicators?.filter((ci: any) => ci.display === 'subplot').length || 0);
}

// ── Synced crosshair from another panel ──
// When multiple chart panels are linked, this draws a blue dashed crosshair
// at the matching candle position from the other panel.
function renderSyncedCrosshair(
  ctx: CanvasRenderingContext2D,
  cx: CrosshairContext,
  chartWidth: number,
  mainChartHeight: number,
  height: number,
  visible: VisibleCandlesResult,
  priceRange: PriceRange,
): void {
  const { candles, viewState, syncedCrosshairTime, TIME_AXIS_HEIGHT } = cx;
  if (!syncedCrosshairTime || candles.length === 0 || visible.candles.length === 0) return;

  const candleSpacing = viewState.candleWidth * (1 + 0.3);

  // Find the visible candle closest to the synced timestamp
  let visibleMatchIndex = -1;
  let bestMatchDiff = Infinity;

  for (let i = 0; i < visible.candles.length; i++) {
    const diff = Math.abs(visible.candles[i].time - syncedCrosshairTime);
    if (diff < bestMatchDiff) {
      bestMatchDiff = diff;
      visibleMatchIndex = i;
    }
  }

  if (visibleMatchIndex === -1) return;

  // Calculate X from visible index position
  const syncedX = visibleMatchIndex * candleSpacing + candleSpacing / 2;
  if (syncedX < 0 || syncedX > chartWidth) return;

  const syncedCandle = visible.candles[visibleMatchIndex];

  // Y at the midpoint of the candle body (high + low) / 2
  const candleMidPrice = (syncedCandle.high + syncedCandle.low) / 2;
  const ratio = (candleMidPrice - priceRange.min) / priceRange.range;
  const syncedY = mainChartHeight - (ratio * mainChartHeight);

  ctx.strokeStyle = '#3b82f6'; // Blue for synced crosshair
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);

  // Vertical line through the candle, extending through indicator panels
  ctx.beginPath();
  ctx.moveTo(syncedX, 0);
  ctx.lineTo(syncedX, height - TIME_AXIS_HEIGHT);
  ctx.stroke();

  // Horizontal line at candle mid-price
  if (syncedY >= 0 && syncedY <= mainChartHeight) {
    ctx.beginPath();
    ctx.moveTo(0, syncedY);
    ctx.lineTo(chartWidth, syncedY);
    ctx.stroke();
  }

  ctx.setLineDash([]);
}

// ── Crosshair lines + price/time axis labels ──
// Draws the dashed crosshair lines and TradingView-style rounded-rect labels
// on the price axis (right) and time axis (bottom).
// skipPriceLabel: true when hovering over indicator sub-panels (y > mainChartHeight),
// where the price axis scale does not correspond to the indicator's value scale.
function renderCrosshairLines(
  ctx: CanvasRenderingContext2D,
  cx: CrosshairContext,
  crosshair: { x: number; y: number },
  chartWidth: number,
  mainChartHeight: number,
  height: number,
  visible: VisibleCandlesResult,
  priceRange: PriceRange,
  candle: Candle | undefined,
  activeCandleIndex: number,
  skipPriceLabel = false,
): void {
  const {
    isDesktop, isScrolling, scrollState, viewState, candles,
    PRICE_LABEL_FONT, TIME_LABEL_FONT, TIME_AXIS_HEIGHT,
    yToPrice, formatPrice, formatTime, formatDate,
  } = cx;

  const crosshairColor: string = cx.colors?.crosshair || '#6b7280';
  const crosshairStyle: string = cx.colors?.crosshairStyle || 'standard';

  // Resolve crosshair label background once for this render pass and derive
  // a contrast-safe text color via relative luminance (WCAG formula). This
  // keeps text readable regardless of whether the user picks a dark or light
  // label background.
  const labelBg: string = cx.colors?.crosshairLabelBg || '#131722';
  const labelText: string = getContrastText(labelBg);

  // Draw crosshair lines according to the selected style.
  // 'standard' - dashed cross (default, TradingView feel)
  // 'blade'    - solid thin cross, no dash, sharper reading
  // 'scope'    - dashed cross + circle at intersection
  // 'ghost'    - semi-transparent solid cross (great on busy charts)
  // 'h-only'   - horizontal line only, price-axis reading without vertical clutter
  if (crosshairStyle !== 'h-only') {
    // Vertical line
    ctx.strokeStyle = crosshairStyle === 'ghost'
      ? crosshairColor + '40'  // ~25% opacity
      : crosshairColor;
    ctx.lineWidth = crosshairStyle === 'blade' ? 0.75 : 1;
    ctx.setLineDash(crosshairStyle === 'blade' || crosshairStyle === 'ghost' ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(crosshair.x, 0);
    ctx.lineTo(crosshair.x, height - TIME_AXIS_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Horizontal line (all styles)
  ctx.strokeStyle = crosshairStyle === 'ghost'
    ? crosshairColor + '40'
    : crosshairColor;
  ctx.lineWidth = crosshairStyle === 'blade' ? 0.75 : 1;
  ctx.setLineDash(crosshairStyle === 'blade' || crosshairStyle === 'ghost' || crosshairStyle === 'h-only' ? [] : [4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, crosshair.y);
  ctx.lineTo(chartWidth, crosshair.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Scope style: circle at the crosshair intersection
  if (crosshairStyle === 'scope') {
    ctx.strokeStyle = crosshairColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(crosshair.x, crosshair.y, 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Shared corner radius for all axis labels (price + time).
  const radius = 4;

  // TradingView-style price label with rounded rectangle on the price axis.
  // Suppressed when hovering over indicator sub-panels: the price axis scale
  // does not correspond to RSI/MACD/Stochastic values, so showing a price
  // label there would be misleading.
  if (!skipPriceLabel) {
    const price = yToPrice(crosshair.y, priceRange);
    const priceLabelPadding = isDesktop ? 5 : 4;
    const priceLabelHeight = isDesktop ? 20 : 16;
    const priceText = formatPrice(price);
    ctx.font = PRICE_LABEL_FONT;
    const priceLabelWidth = ctx.measureText(priceText).width + priceLabelPadding * 2;

    // Clamp Y so the label stays within the chart area
    const clampedPriceLabelY = Math.max(priceLabelHeight / 2, Math.min(crosshair.y, mainChartHeight - priceLabelHeight / 2));

    const priceLabelX = chartWidth + 4;
    const priceLabelYTop = clampedPriceLabelY - priceLabelHeight / 2;

    ctx.fillStyle = labelBg;
    ctx.beginPath();
    ctx.roundRect(priceLabelX, priceLabelYTop, priceLabelWidth, priceLabelHeight, radius);
    ctx.fill();

    ctx.fillStyle = labelText;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(priceText, priceLabelX + priceLabelPadding, clampedPriceLabelY);
  }

  // Time/date label in X-axis area.
  // For future area (past last candle), extrapolate time from candle interval.
  const rawStartIndex2 = isScrolling ? scrollState.startIndex : viewState.startIndex;
  const candleSpacing2 = viewState.candleWidth * (1 + CANDLE_GAP_RATIO);
  const fractionalOffset2 = (rawStartIndex2 - visible.startIndex) * candleSpacing2;
  const adjustedX2 = crosshair.x + fractionalOffset2;
  const hoveredIdx2 = adjustedX2 / candleSpacing2 + visible.startIndex;
  const isFutureHover = hoveredIdx2 >= candles.length;

  let displayTime: number | null = null;
  if (candle && !isFutureHover) {
    displayTime = candle.time;
  } else if (candles.length > 1 && isFutureHover) {
    // Extrapolate future time based on candle interval spacing
    const candleInterval = Math.abs(candles[candles.length - 1].time - candles[candles.length - 2].time);
    const lastTime = candles[candles.length - 1].time;
    const indexBeyond = hoveredIdx2 - (candles.length - 1);
    displayTime = lastTime + indexBeyond * candleInterval;
  }

  if (displayTime !== null) {
    const timeStr = formatTime(displayTime);
    const dateStr = formatDate(displayTime, true); // Include year for TradingView-style label
    const fullTimeStr = `${dateStr} ${timeStr}`;
    ctx.font = TIME_LABEL_FONT;
    const timeLabelPadding = isDesktop ? 12 : 8;
    const timeLabelWidth = ctx.measureText(fullTimeStr).width + timeLabelPadding * 2;
    const timeLabelHeight = isDesktop ? 24 : 18;

    // Clamp X so the label stays within the chart area
    const clampedTimeLabelX = Math.max(timeLabelWidth / 2, Math.min(crosshair.x, chartWidth - timeLabelWidth / 2));

    // Center vertically within the X-axis area
    const timeLabelYCenter = mainChartHeight + TIME_AXIS_HEIGHT / 2;

    ctx.fillStyle = labelBg;
    ctx.beginPath();
    ctx.roundRect(clampedTimeLabelX - timeLabelWidth / 2, timeLabelYCenter - timeLabelHeight / 2, timeLabelWidth, timeLabelHeight, radius);
    ctx.fill();

    ctx.fillStyle = labelText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fullTimeStr, clampedTimeLabelX, timeLabelYCenter);
  }
}

// ── Volume bar hover highlight ──
// When hovering in the bottom 20% volume overlay area, draw a bright outline
// around the specific volume bar under the cursor for visual feedback.
function renderVolumeHoverHighlight(
  ctx: CanvasRenderingContext2D,
  cx: CrosshairContext,
  crosshair: { x: number; y: number },
  chartWidth: number,
  mainChartHeight: number,
  visible: VisibleCandlesResult,
): void {
  const { viewState, isScrolling, scrollState, xToIndex, indexToX } = cx;

  const volOverlayHeight = mainChartHeight * 0.2;
  const volBottom = mainChartHeight;
  const volTop = volBottom - volOverlayHeight;

  // Only highlight when cursor is within the volume overlay region
  if (crosshair.y < volTop || crosshair.y > volBottom) return;

  const candleSpacing = viewState.candleWidth * (1 + CANDLE_GAP_RATIO);
  const rawStartIndex = isScrolling ? scrollState.startIndex : viewState.startIndex;
  const fractionalOffset = (rawStartIndex - visible.startIndex) * candleSpacing;
  const adjustedX = crosshair.x + fractionalOffset;
  const hoveredIndex = xToIndex(adjustedX, visible.startIndex);
  const localIdx = hoveredIndex - visible.startIndex;

  if (localIdx < 0 || localIdx >= visible.candles.length) return;

  const hoverCandle = visible.candles[localIdx];
  const volume = hoverCandle.volume ?? 0;
  if (volume <= 0) return;

  // Recalculate bar geometry identically to drawChart's volume rendering
  const visibleVolumes = visible.candles.map(c => c.volume ?? 0).filter(v => v > 0);
  const volMax = visibleVolumes.length > 0 ? Math.max(...visibleVolumes) : 1;
  const barWidth = Math.max(2, viewState.candleWidth * 0.7);
  const ratio = volume / volMax;
  const barHeight = ratio * volOverlayHeight * 0.95;
  const barY = volBottom - barHeight;
  const barX = indexToX(hoveredIndex, visible.startIndex) - barWidth / 2;

  // Highlight outline around the hovered bar
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
  ctx.restore();
}

// ── Volume profile hover highlight ──
// When hovering near the right-side volume profile bars, highlight the row
// under the cursor with a bright rectangle outline.
function renderVolumeProfileHoverHighlight(
  ctx: CanvasRenderingContext2D,
  cx: CrosshairContext,
  crosshair: { x: number; y: number },
  chartWidth: number,
  mainChartHeight: number,
  visible: VisibleCandlesResult,
  priceRange: PriceRange,
): void {
  const { indicators } = cx;

  const numRows = indicators.volumeProfile.numberOfRows ?? 48;
  const maxBarWidth = chartWidth * ((indicators.volumeProfile.rowWidth ?? 15) / 100);
  const lookbackBars = indicators.volumeProfile.lookbackBars ?? 0;

  const candlesToUse = lookbackBars > 0
    ? visible.candles.slice(-lookbackBars)
    : visible.candles;

  // Recalculate volume profile bins (same logic as drawChart)
  let profilePriceMin = Infinity;
  let profilePriceMax = -Infinity;
  candlesToUse.forEach(c => {
    profilePriceMin = Math.min(profilePriceMin, c.low);
    profilePriceMax = Math.max(profilePriceMax, c.high);
  });
  const profilePriceRange = profilePriceMax - profilePriceMin || 1;
  const priceStep = profilePriceRange / numRows;

  const volumeBins: Array<{ priceLevel: number; upVolume: number; downVolume: number; totalVolume: number }> = [];
  for (let i = 0; i < numRows; i++) {
    volumeBins.push({ priceLevel: profilePriceMin + (i + 0.5) * priceStep, upVolume: 0, downVolume: 0, totalVolume: 0 });
  }
  candlesToUse.forEach((c) => {
    if (!c.volume || c.volume <= 0) return;
    const isBullish = c.close >= c.open;
    for (let i = 0; i < numRows; i++) {
      const binLow = profilePriceMin + i * priceStep;
      const binHigh = binLow + priceStep;
      if (c.high >= binLow && c.low <= binHigh) {
        const overlapLow = Math.max(c.low, binLow);
        const overlapHigh = Math.min(c.high, binHigh);
        const overlapRatio = (c.high - c.low) > 0 ? (overlapHigh - overlapLow) / (c.high - c.low) : 1;
        const contribution = c.volume * overlapRatio;
        if (isBullish) volumeBins[i].upVolume += contribution;
        else volumeBins[i].downVolume += contribution;
        volumeBins[i].totalVolume += contribution;
      }
    }
  });

  let maxVolume = 0;
  volumeBins.forEach(bin => { if (bin.totalVolume > maxVolume) maxVolume = bin.totalVolume; });

  if (maxVolume <= 0) return;

  const barHeight = (mainChartHeight / numRows) * 0.85;
  // Convert cursor Y to price using the same formula as drawChart
  const cursorPrice = priceRange.min + ((mainChartHeight - crosshair.y) / mainChartHeight) * priceRange.range;

  // Find which bin the cursor price falls into
  const binIndex = Math.floor((cursorPrice - profilePriceMin) / priceStep);
  if (binIndex < 0 || binIndex >= numRows || volumeBins[binIndex].totalVolume <= 0) return;

  const bin = volumeBins[binIndex];
  const totalBarWidth = (bin.totalVolume / maxVolume) * maxBarWidth;
  const barStartX = chartWidth - totalBarWidth;
  const priceLevelY = mainChartHeight - ((bin.priceLevel - priceRange.min) / priceRange.range) * mainChartHeight;
  const rowTop = priceLevelY - barHeight / 2;

  // Only highlight if cursor is near the bar and within its Y range
  if (crosshair.x >= barStartX - 20 && crosshair.y >= rowTop - 1 && crosshair.y <= rowTop + barHeight + 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(barStartX - 1, rowTop - 1, totalBarWidth + 2, barHeight + 2);
    ctx.restore();
  }
}

// ── Info legend (OHLC and indicator values) ──
// Always visible at the top-left of the chart. Shows OHLC data for the active
// candle (hovered or latest) plus indicator values (BB, MA, VWAP, Ichimoku,
// Keltner, Volume Profile label, Volume, and all overlay indicator labels).
function renderInfoLegend(
  ctx: CanvasRenderingContext2D,
  cx: CrosshairContext,
  candle: Candle,
  activeCandleIndex: number,
  chartWidth: number,
  mainChartHeight: number,
  visible: VisibleCandlesResult,
  priceRange: PriceRange,
): void {
  const {
    dimensions, colors, indicatorData, indicators, isDesktop,
    isScrolling, sessionControlHovered,
    currentOhlcTextWidth, currentBbTextEndX, currentMaTextEndX,
    currentVwapTextEndX, currentVpTextEndX, currentVolTextEndX,
    overlayLabelEndXPrev, subplotLabelEndXPrev,
    formatPrice,
    callbacks, PRICE_AXIS_WIDTH,
  } = cx;

  // Compact mode for mobile
  const isMobileScreen = dimensions.width < 500;

  const isBullish = candle.close >= candle.open;
  const changeColor = isBullish ? colors.bullish : colors.bearish;

  // Monospace font for quantitative terminal look
  const ohlcFont = isMobileScreen
    ? '9px "SF Mono", "Cascadia Code", Consolas, monospace'
    : '13px "SF Mono", "Cascadia Code", Consolas, monospace';
  // Smaller indicator labels on mobile so they do not overwhelm the chart
  const indicatorFont = isMobileScreen
    ? '9px "SF Mono", "Cascadia Code", Consolas, monospace'
    : '14px "SF Mono", "Cascadia Code", Consolas, monospace';
  const indicatorFontBold = isMobileScreen
    ? 'bold 9px "SF Mono", "Cascadia Code", Consolas, monospace'
    : 'bold 14px "SF Mono", "Cascadia Code", Consolas, monospace';
  ctx.font = ohlcFont;
  const ohlcY = 12;
  // Adjusted left padding to be in the corner but not overlapping (12px)
  const ohlcX = isMobileScreen ? 8 : 12;

  // Draw OHLC in a single horizontal line at top-left
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // Direction micro-arrow (triangle up/down)
  const dirArrow = isBullish ? '\u25b2' : '\u25bc';

  let currentX = ohlcX;
  // Short labels on mobile (O: H: L: C:), full word labels on desktop (Open: High: Low: Close:)
  const items: { label: string; value: string; color: string }[] = isMobileScreen
    ? [
      { label: 'O:', value: formatPrice(candle.open), color: colors.text },
      { label: 'H:', value: formatPrice(candle.high), color: colors.text },
      { label: 'L:', value: formatPrice(candle.low), color: colors.text },
      { label: 'C:', value: dirArrow + ' ' + formatPrice(candle.close), color: changeColor },
    ]
    : [
      { label: 'Open:', value: formatPrice(candle.open), color: colors.text },
      { label: 'High:', value: formatPrice(candle.high), color: colors.text },
      { label: 'Low:', value: formatPrice(candle.low), color: colors.text },
      { label: 'Close:', value: dirArrow + ' ' + formatPrice(candle.close), color: changeColor },
    ];

  // Always show volume on desktop to keep OHLC text width stable.
  // Previously volume was conditional, causing text to resize and the
  // toggle button to jump when moving between candles with/without volume.
  if (!isMobileScreen) {
    const fmtVol = (v: number) => {
      if (!v || v <= 0) return '-';
      if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
      if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
      if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
      return v.toFixed(0);
    };
    items.push({ label: 'Vol:', value: fmtVol(candle.volume ?? 0), color: colors.text });
  }

  // Mobile: no space between label and value (e.g. "O:66,833.76"),
  // no gap after label, minimal gap between items. Saves ~40px total.
  // Desktop: space after label, generous gap between items for readability.
  const labelSuffix = isMobileScreen ? '' : ' ';
  const labelGap = isMobileScreen ? 0 : 2;
  const valueGap = isMobileScreen ? 3 : 14;

  // Single row on all screen sizes. On mobile, measure first and scale
  // the font down if the OHLC text + chevron would overflow into the price axis.
  const chartW = dimensions.width - PRICE_AXIS_WIDTH;
  // Reserve 22px for the toggle chevron button (16px wide + 6px margin)
  const maxOhlcW = chartW - 22;
  let actualFont = ohlcFont;
  if (isMobileScreen) {
    ctx.font = ohlcFont;
    let totalW = ohlcX;
    items.forEach((item) => {
      totalW += ctx.measureText(item.label + labelSuffix).width + labelGap;
      totalW += ctx.measureText(item.value).width + valueGap;
    });
    if (totalW > maxOhlcW) {
      // Scale font proportionally, minimum 7px for readability
      const scaled = Math.max(7, Math.floor(9 * (maxOhlcW / totalW)));
      actualFont = `${scaled}px "SF Mono", "Cascadia Code", Consolas, monospace`;
    }
  }
  ctx.font = actualFont;
  items.forEach((item) => {
    ctx.fillStyle = colors.text;
    ctx.fillText(item.label + labelSuffix, currentX, ohlcY);
    currentX += ctx.measureText(item.label + labelSuffix).width + labelGap;
    ctx.fillStyle = item.color;
    ctx.fillText(item.value, currentX, ohlcY);
    currentX += ctx.measureText(item.value).width + valueGap;
  });

  // Update OHLC text width state to position the toggle button correctly
  if (!isScrolling && !sessionControlHovered && Math.abs(currentX - currentOhlcTextWidth) > 10) {
    callbacks.setOhlcTextWidth(currentX);
  }

  // OHLC is always a single row; indicators start below it.
  // Tighter gap on mobile (9px font) so indicator labels sit closer to OHLC.
  // Extra gap below OHLC so indicator labels do not sit right on the separator line.
  const ohlcBottomY = isMobileScreen ? 28 : 36;

  // Minimalist separator line between OHLC row and indicator labels below.
  // Very faint so it is barely visible, just enough to visually group indicators
  // separately from the price data (similar to TradingView's clean layout).
  const hasAnyIndicatorLabel = (indicatorData?.bollinger && indicators?.bollinger?.enabled)
    || (indicatorData?.movingAverages && indicators?.movingAverages?.enabled)
    || (indicatorData?.vwap && indicators?.vwap?.enabled)
    || (indicatorData?.ichimoku && indicators?.ichimoku?.enabled);
  if (hasAnyIndicatorLabel) {
    const sepY = ohlcBottomY - 4;
    ctx.strokeStyle = colors.text + '20'; // ~12% opacity, very subtle
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(ohlcX, sepY);
    ctx.lineTo(currentX - 10, sepY);
    ctx.stroke();
  }

  // Helper: skip indicator label when the indicator was auto-registered
  // by an enabled Brue strategy (sourceScriptId is set and the owning
  // script is currently on). Mirrors the MA filter below; keeps the
  // indicator's chart line drawing while suppressing its standalone
  // legend text so it nests under the strategy row.
  const isOwnedByActiveScript = (key: 'bollinger' | 'vwap'): boolean => {
    const owner = (indicators as any)?.[key]?.sourceScriptId;
    if (!owner) return false;
    return !!((indicators as any)?.customBrueScripts?.[owner]?.enabled);
  };

  // Draw Bollinger Bands values below OHLC if enabled
  if (indicatorData?.bollinger && indicators?.bollinger?.enabled && !isOwnedByActiveScript('bollinger')) {
    const bbY = ohlcBottomY;
    const bbIdx = activeCandleIndex;
    if (bbIdx >= 0 && bbIdx < indicatorData.bollinger.upper.length) {
      const bbUpper = indicatorData.bollinger.upper[bbIdx];
      const bbMiddle = indicatorData.bollinger.middle[bbIdx];
      const bbLower = indicatorData.bollinger.lower[bbIdx];

      ctx.font = indicatorFontBold;
      let bbX = ohlcX;

      // BB label
      ctx.fillStyle = '#9ca3af';
      ctx.fillText(`BB(${indicators.bollinger.period},${indicators.bollinger.stdDev}):`, bbX, bbY);
      bbX += ctx.measureText(`BB(${indicators.bollinger.period},${indicators.bollinger.stdDev}):`).width + 4;

      // Upper value
      ctx.fillStyle = indicators.bollinger.upperColor || '#9B59B6';
      const upperText = !isNaN(bbUpper) && isFinite(bbUpper) ? formatPrice(bbUpper) : '--';
      ctx.fillText(upperText, bbX, bbY);
      bbX += ctx.measureText(upperText).width + 12;

      // Middle value
      ctx.fillStyle = indicators.bollinger.middleColor || '#9B59B6';
      const middleText = !isNaN(bbMiddle) && isFinite(bbMiddle) ? formatPrice(bbMiddle) : '--';
      ctx.fillText(middleText, bbX, bbY);
      bbX += ctx.measureText(middleText).width + 12;

      // Lower value
      ctx.fillStyle = indicators.bollinger.lowerColor || '#9B59B6';
      const lowerText = !isNaN(bbLower) && isFinite(bbLower) ? formatPrice(bbLower) : '--';
      ctx.fillText(lowerText, bbX, bbY);
      bbX += ctx.measureText(lowerText).width + 8;

      // Store BB text width for settings button positioning
      if (Math.abs(bbX - currentBbTextEndX) > 10) {
        callbacks.setBbTextEndX(bbX);
      }
    }
  }

  // Draw Moving Averages values below OHLC/BB if enabled.
  // Each MA gets its own line (vertically stacked), matching TradingView's layout.
  let maLineCount = 0;
  if (indicatorData?.movingAverages && indicators?.movingAverages?.enabled) {
    const maLineH = isMobileScreen ? 14 : 19;
    let maY = indicatorData?.bollinger && indicators?.bollinger?.enabled ? ohlcBottomY + maLineH : ohlcBottomY;
    const maIdx = activeCandleIndex;

    if (maIdx >= 0) {
      let maxMaEndX = ohlcX;
      ctx.font = indicatorFont;
      // Detect dark mode once for the MA label loop below
      const _isDarkForMA = document.documentElement.classList.contains('dark');
      // Auto-registered MAs (the ema()/sma()/etc calls inside a Brue
      // strategy that get materialised as real chart indicators) carry
      // sourceScriptId on their MAConfig. When the owning script's row
      // is currently on the legend (customBrueScripts[id].enabled), skip
      // the MA's standalone "EMA 9 close ..." text; the user thinks of
      // them as part of the strategy, not as separate indicators. The
      // line itself still draws on the chart; only its top-level legend
      // text is suppressed. Disabling the script via Eye/Trash flips
      // enabled=false and the standalone text reappears.
      const maLines: { sourceScriptId?: string }[] = (indicators?.movingAverages?.lines as any) ?? [];
      const customBrueScripts: Record<string, { enabled?: boolean }> = (indicators as any)?.customBrueScripts ?? {};
      indicatorData.movingAverages.forEach((ma: { data: number[]; color: string; name: string }, idx: number) => {
        const ownerScript = maLines[idx]?.sourceScriptId;
        if (ownerScript && customBrueScripts[ownerScript]?.enabled) return;
        if (maIdx < ma.data.length) {
          const maValue = ma.data[maIdx];
          const maText = !isNaN(maValue) && isFinite(maValue) ? formatPrice(maValue) : '--';
          // TradingView-style format: "EMA 20 close 66,627.18"
          const fullText = `${ma.name} close ${maText}`;
          // Use the MA line color directly for the crosshair label text.
          // #2962FF (blue) is the default and works on both themes.
          const maLabelColor = ma.color;
          ctx.fillStyle = maLabelColor;
          ctx.fillText(fullText, ohlcX, maY);
          const endX = ohlcX + ctx.measureText(fullText).width + 8;
          if (endX > maxMaEndX) maxMaEndX = endX;
          // Stack vertically: advance Y for each MA line
          maY += maLineH;
          maLineCount++;
        }
      });

      // Store MA text width for settings button positioning
      if (Math.abs(maxMaEndX - currentMaTextEndX) > 10) {
        callbacks.setMaTextEndX(maxMaEndX);
      }
    }
  }

  // Track current Y position for stacking indicators below OHLC rows.
  // Tighter line spacing on mobile to match the smaller 9px indicator font.
  const indicatorLineH = isMobileScreen ? 14 : 19;
  let currentIndicatorY = ohlcBottomY;
  if (indicatorData?.bollinger && indicators?.bollinger?.enabled && !isOwnedByActiveScript('bollinger')) currentIndicatorY += indicatorLineH;
  // Each MA occupies its own line, so advance by the number of MA lines rendered
  if (maLineCount > 0) currentIndicatorY += indicatorLineH * maLineCount;

  // Draw VWAP value below BB/MA if enabled
  if (indicatorData?.vwap && indicators?.vwap?.enabled && !isOwnedByActiveScript('vwap')) {
    const vwapIdx = activeCandleIndex;
    if (vwapIdx >= 0 && vwapIdx < indicatorData.vwap.length) {
      const vwapValue = indicatorData.vwap[vwapIdx];
      const vwapText = !isNaN(vwapValue) && isFinite(vwapValue) ? formatPrice(vwapValue) : '--';
      const vwapColor = indicators.vwap.color || '#2196F3';

      let vwapX = ohlcX;
      ctx.font = indicatorFont;
      ctx.fillStyle = vwapColor;
      ctx.fillText(`VWAP: ${vwapText}`, vwapX, currentIndicatorY);
      vwapX += ctx.measureText(`VWAP: ${vwapText}`).width + 8;

      if (Math.abs(vwapX - currentVwapTextEndX) > 10) {
        callbacks.setVwapTextEndX(vwapX);
      }
      currentIndicatorY += indicatorLineH;
    }
  }

  // Draw Ichimoku values if enabled
  // _ichimokuEndX is captured here and seeded into _olEndX below so the
  // click-target div in ProChart knows the full label width (Tenkan+Kijun+Chikou).
  let _ichimokuEndX = 0;
  if (indicatorData?.ichimoku && indicators?.ichimoku?.enabled) {
    const ichIdx = activeCandleIndex;

    if (ichIdx >= 0 && ichIdx < indicatorData.ichimoku.tenkan.length) {
      let ichX = ohlcX;
      ctx.font = indicatorFont;

      // Tenkan-sen
      const tenkanValue = indicatorData.ichimoku.tenkan[ichIdx];
      const tenkanText = !isNaN(tenkanValue) && isFinite(tenkanValue) ? formatPrice(tenkanValue) : '--';
      ctx.fillStyle = indicators.ichimoku.tenkanColor || '#0496ff';
      ctx.fillText(`Tenkan: ${tenkanText}`, ichX, currentIndicatorY);
      ichX += ctx.measureText(`Tenkan: ${tenkanText}`).width + 10;

      // Kijun-sen
      const kijunValue = indicatorData.ichimoku.kijun[ichIdx];
      const kijunText = !isNaN(kijunValue) && isFinite(kijunValue) ? formatPrice(kijunValue) : '--';
      ctx.fillStyle = indicators.ichimoku.kijunColor || '#991515';
      ctx.fillText(`Kijun: ${kijunText}`, ichX, currentIndicatorY);
      ichX += ctx.measureText(`Kijun: ${kijunText}`).width + 10;

      // Chikou Span
      const chikouValue = indicatorData.ichimoku.chikou[ichIdx];
      const chikouText = !isNaN(chikouValue) && isFinite(chikouValue) ? formatPrice(chikouValue) : '--';
      ctx.fillStyle = indicators.ichimoku.chikouColor || '#76b041';
      ctx.fillText(`Chikou: ${chikouText}`, ichX, currentIndicatorY);
      _ichimokuEndX = ichX + ctx.measureText(`Chikou: ${chikouText}`).width + 6;

      currentIndicatorY += indicatorLineH;
    }
  }

  // Draw Keltner Channel values if enabled
  if (indicatorData?.keltner && indicators?.keltner?.enabled) {
    const keltIdx = activeCandleIndex;
    if (keltIdx >= 0 && keltIdx < indicatorData.keltner.upper.length) {
      let keltX = ohlcX;
      ctx.font = indicatorFont;

      const upperValue = indicatorData.keltner.upper[keltIdx];
      const upperText = !isNaN(upperValue) && isFinite(upperValue) ? formatPrice(upperValue) : '--';
      ctx.fillStyle = indicators.keltner.upperColor || '#FF9800';
      ctx.fillText(`Kelt U: ${upperText}`, keltX, currentIndicatorY);
      keltX += ctx.measureText(`Kelt U: ${upperText}`).width + 10;

      const middleValue = indicatorData.keltner.middle[keltIdx];
      const middleText = !isNaN(middleValue) && isFinite(middleValue) ? formatPrice(middleValue) : '--';
      ctx.fillStyle = indicators.keltner.middleColor || '#FF9800';
      ctx.fillText(`Mid: ${middleText}`, keltX, currentIndicatorY);
      keltX += ctx.measureText(`Mid: ${middleText}`).width + 10;

      const lowerValue = indicatorData.keltner.lower[keltIdx];
      const lowerText = !isNaN(lowerValue) && isFinite(lowerValue) ? formatPrice(lowerValue) : '--';
      ctx.fillStyle = indicators.keltner.lowerColor || '#FF9800';
      ctx.fillText(`Kelt L: ${lowerText}`, keltX, currentIndicatorY);
      currentIndicatorY += indicatorLineH;
    }
  }

  // Draw Volume Profile label if enabled
  if (indicators?.volumeProfile?.enabled) {
    ctx.font = indicatorFont;
    const numRows = indicators.volumeProfile.numberOfRows ?? 48;
    ctx.fillStyle = '#D97706'; // Amber color matching bullish bars
    const vpText = `Vol Profile (${numRows} rows)`;
    ctx.fillText(vpText, ohlcX, currentIndicatorY);
    const vpX = ohlcX + ctx.measureText(vpText).width + 8;

    if (Math.abs(vpX - currentVpTextEndX) > 10) {
      callbacks.setVpTextEndX(vpX);
    }
    currentIndicatorY += indicatorLineH;
  }

  // Draw Volume label + value if enabled
  const hasVolume = Boolean(indicators?.volume?.enabled);
  if (hasVolume) {
    const formatVolume = (vol: number) => {
      if (vol >= 1e9) return (vol / 1e9).toFixed(2) + 'B';
      if (vol >= 1e6) return (vol / 1e6).toFixed(2) + 'M';
      if (vol >= 1e3) return (vol / 1e3).toFixed(2) + 'K';
      return vol.toFixed(0);
    };
    const volCandleIdx = activeCandleIndex;
    const volCandle = cx.candles[volCandleIdx] ?? cx.candles[cx.candles.length - 1];
    if (volCandle) {
      const volValue = volCandle.volume ?? 0;
      const isBullVol = volCandle.close >= volCandle.open;
      const volLabel = indicators?.volume?.style?.customLabel || 'Vol';
      const volUpCol = indicators?.volume?.upColor || '#26a69a';
      const volDownCol = indicators?.volume?.downColor || '#ef5350';

      ctx.font = indicatorFont;
      ctx.fillStyle = '#9ca3af';
      const volStartX = isMobileScreen ? 8 : 12;
      ctx.fillText(volLabel + ' ', volStartX, currentIndicatorY);
      const volLabelW = ctx.measureText(volLabel + ' ').width;
      ctx.fillStyle = isBullVol ? volUpCol : volDownCol;
      ctx.fillText(formatVolume(volValue), volStartX + volLabelW, currentIndicatorY);
      const volEndX = volStartX + volLabelW + ctx.measureText(formatVolume(volValue)).width + 8;

      if (Math.abs(volEndX - currentVolTextEndX) > 10) {
        callbacks.setVolTextEndX(volEndX);
      }
      currentIndicatorY += indicatorLineH;
    }
  }

  // ── UNIFIED OVERLAY INDICATOR LABEL RENDERER ──────────────────────
  // To add a new overlay indicator label, just add an entry here.
  // Each entry defines: key, enabled check, and segments function.
  // Segments are drawn left-to-right with { text, color } pairs.
  const globalIndicatorIdx = activeCandleIndex;
  const iIdx = globalIndicatorIdx >= 0 ? globalIndicatorIdx : visible.startIndex + visible.candles.length - 1;
  const _fmtP = (v: number) => !isNaN(v) && isFinite(v) ? formatPrice(v) : '--';
  const _fmtVol = (v: number) => { if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K'; return v.toFixed(0); };

  const overlayLabelConfigs: { key: string; enabled: boolean; segments: () => { text: string; color: string; gap?: number }[] }[] = [
    {
      key: 'supertrend', enabled: !!(indicatorData?.supertrend && indicators?.supertrend?.enabled), segments: () => {
        const v = indicatorData!.supertrend!.supertrend[iIdx]; const bull = indicatorData!.supertrend!.direction[iIdx] === 1;
        return [{ text: `Supertrend: ${_fmtP(v)}`, color: bull ? '#22c55e' : '#ef4444' }];
      }
    },
    {
      key: 'donchian', enabled: !!(indicatorData?.donchian && indicators?.donchian?.enabled), segments: () => {
        const d = indicatorData!.donchian!;
        return [{ text: `DC U: ${_fmtP(d.upper[iIdx])}`, color: '#00BCD4' }, { text: `M: ${_fmtP(d.middle[iIdx])}`, color: '#00BCD4' }, { text: `L: ${_fmtP(d.lower[iIdx])}`, color: '#00BCD4' }];
      }
    },
    {
      key: 'envelopes', enabled: !!(indicatorData?.envelopes && indicators?.envelopes?.enabled), segments: () => {
        const e = indicatorData!.envelopes!;
        return [{ text: `Env U: ${_fmtP(e.upper[iIdx])}`, color: '#FF9800' }, { text: `M: ${_fmtP(e.middle[iIdx])}`, color: '#FF9800' }, { text: `L: ${_fmtP(e.lower[iIdx])}`, color: '#FF9800' }];
      }
    },
    {
      key: 'dema', enabled: !!(indicatorData?.dema && indicators?.dema?.enabled), segments: () =>
        [{ text: `DEMA ${indicators!.dema!.period}: ${_fmtP(indicatorData!.dema![iIdx])}`, color: '#E040FB' }]
    },
    {
      key: 'tema', enabled: !!(indicatorData?.tema && indicators?.tema?.enabled), segments: () =>
        [{ text: `TEMA ${indicators!.tema!.period}: ${_fmtP(indicatorData!.tema![iIdx])}`, color: '#00E5FF' }]
    },
    {
      key: 'hma', enabled: !!(indicatorData?.hma && indicators?.hma?.enabled), segments: () =>
        [{ text: `HMA ${indicators!.hma!.period}: ${_fmtP(indicatorData!.hma![iIdx])}`, color: '#FF6D00' }]
    },
    {
      key: 'linearReg', enabled: !!(indicatorData?.linearReg && indicators?.linearReg?.enabled), segments: () => {
        const lr = indicatorData!.linearReg!;
        return [{ text: `LinReg U: ${_fmtP(lr.upper[iIdx])}`, color: '#7C4DFF' }, { text: `M: ${_fmtP(lr.middle[iIdx])}`, color: '#7C4DFF' }, { text: `L: ${_fmtP(lr.lower[iIdx])}`, color: '#7C4DFF' }];
      }
    },
    {
      key: 'parabolicSAR', enabled: !!(indicatorData?.parabolicSAR && indicators?.parabolicSAR?.enabled), segments: () => {
        const v = indicatorData!.parabolicSAR!.sar[iIdx]; const bull = indicatorData!.parabolicSAR!.direction[iIdx] === 1;
        return [{ text: `PSAR: ${_fmtP(v)}`, color: bull ? (indicators!.parabolicSAR!.bullishColor || '#22c55e') : (indicators!.parabolicSAR!.bearishColor || '#ef4444') }];
      }
    },
    {
      key: 'pivotPoints', enabled: !!(indicatorData?.pivotPoints && indicators?.pivotPoints?.enabled), segments: () => {
        const pp = indicatorData!.pivotPoints!;
        return [
          { text: `PP: ${_fmtP(pp.pivot[iIdx])}`, color: indicators!.pivotPoints?.pivotColor || '#FFEB3B' },
          { text: `R1: ${_fmtP(pp.r1[iIdx])}`, color: indicators!.pivotPoints?.resistanceColor || '#ef4444', gap: 8 },
          { text: `S1: ${_fmtP(pp.s1[iIdx])}`, color: indicators!.pivotPoints?.supportColor || '#22c55e', gap: 8 },
        ];
      }
    },
    {
      key: 'fibRetracement', enabled: !!(indicatorData?.fibRetracement && indicators?.fibRetracement?.enabled), segments: () => {
        const f = indicatorData!.fibRetracement!;
        return [{ text: `Fib H: ${_fmtP(f.high)}`, color: '#FFD700', gap: 8 }, { text: `L: ${_fmtP(f.low)}`, color: '#FFD700', gap: 8 }];
      }
    },
    {
      key: 'camarillaPivots', enabled: !!(indicatorData?.camarillaPivots && indicators?.camarillaPivots?.enabled), segments: () => {
        const c = indicatorData!.camarillaPivots!;
        return [
          { text: `Cam H4: ${_fmtP(c.h4[iIdx])}`, color: '#FF6F00', gap: 8 },
          { text: `H3: ${_fmtP(c.h3[iIdx])}`, color: '#ef4444', gap: 8 },
          { text: `L3: ${_fmtP(c.l3[iIdx])}`, color: '#22c55e', gap: 8 },
        ];
      }
    },
    {
      key: 'woodiePivots', enabled: !!(indicatorData?.woodiePivots && indicators?.woodiePivots?.enabled), segments: () => {
        const w = indicatorData!.woodiePivots!;
        return [
          { text: `Wood P: ${_fmtP(w.pivot[iIdx])}`, color: '#00ACC1', gap: 8 },
          { text: `R1: ${_fmtP(w.r1?.[iIdx] ?? NaN)}`, color: '#ef4444', gap: 8 },
          { text: `S1: ${_fmtP(w.s1?.[iIdx] ?? NaN)}`, color: '#22c55e', gap: 8 },
        ];
      }
    },
    {
      key: 'volumeSma', enabled: !!(indicatorData?.volumeSma && indicators?.volumeSma?.enabled), segments: () =>
        [{ text: `Vol SMA ${indicators!.volumeSma!.period}: ${_fmtP(indicatorData!.volumeSma![iIdx]) !== '--' ? _fmtVol(indicatorData!.volumeSma![iIdx]) : '--'}`, color: '#AB47BC' }]
    },
    // Phase 2 overlay indicators
    {
      key: 'alma', enabled: !!(indicatorData?.alma && indicators?.alma?.enabled), segments: () =>
        [{ text: `ALMA ${indicators!.alma!.period || 9}: ${_fmtP(indicatorData!.alma![iIdx])}`, color: indicators!.alma?.color || '#ff6b6b' }]
    },
    {
      key: 'kama', enabled: !!(indicatorData?.kama && indicators?.kama?.enabled), segments: () =>
        [{ text: `KAMA ${indicators!.kama!.period || 10}: ${_fmtP(indicatorData!.kama![iIdx])}`, color: indicators!.kama?.color || '#4ecdc4' }]
    },
    {
      key: 'zlema', enabled: !!(indicatorData?.zlema && indicators?.zlema?.enabled), segments: () =>
        [{ text: `ZLEMA ${indicators!.zlema!.period || 21}: ${_fmtP(indicatorData!.zlema![iIdx])}`, color: indicators!.zlema?.color || '#a29bfe' }]
    },
    {
      key: 't3', enabled: !!(indicatorData?.t3 && indicators?.t3?.enabled), segments: () =>
        [{ text: `T3 ${indicators!.t3!.period || 5}: ${_fmtP(indicatorData!.t3![iIdx])}`, color: indicators!.t3?.color || '#fd79a8' }]
    },
    {
      key: 'lsma', enabled: !!(indicatorData?.lsma && indicators?.lsma?.enabled), segments: () =>
        [{ text: `LSMA ${indicators!.lsma!.period || 25}: ${_fmtP(indicatorData!.lsma![iIdx])}`, color: indicators!.lsma?.color || '#00cec9' }]
    },
    {
      key: 'mcginley', enabled: !!(indicatorData?.mcginley && indicators?.mcginley?.enabled), segments: () =>
        [{ text: `McGinley ${indicators!.mcginley!.period || 14}: ${_fmtP(indicatorData!.mcginley![iIdx])}`, color: indicators!.mcginley?.color || '#6c5ce7' }]
    },
    {
      key: 'wma', enabled: !!(indicatorData?.wma && indicators?.wma?.enabled), segments: () =>
        [{ text: `WMA ${indicators!.wma!.period || 20}: ${_fmtP(indicatorData!.wma![iIdx])}`, color: indicators!.wma?.color || '#ffeaa7' }]
    },
    {
      key: 'smmaOverlay', enabled: !!(indicatorData?.smmaOverlay && indicators?.smmaOverlay?.enabled), segments: () =>
        [{ text: `SMMA ${indicators!.smmaOverlay!.period || 21}: ${_fmtP(indicatorData!.smmaOverlay![iIdx])}`, color: indicators!.smmaOverlay?.color || '#dfe6e9' }]
    },
    {
      key: 'vwma', enabled: !!(indicatorData?.vwma && indicators?.vwma?.enabled), segments: () =>
        [{ text: `VWMA ${indicators!.vwma!.period || 20}: ${_fmtP(indicatorData!.vwma![iIdx])}`, color: indicators!.vwma?.color || '#e056fd' }]
    },
    {
      key: 'medianPrice', enabled: !!(indicatorData?.medianPrice && indicators?.medianPrice?.enabled), segments: () =>
        [{ text: `Median: ${_fmtP(indicatorData!.medianPrice![iIdx])}`, color: indicators!.medianPrice?.color || '#dfe6e9' }]
    },
    {
      key: 'typicalPrice', enabled: !!(indicatorData?.typicalPrice && indicators?.typicalPrice?.enabled), segments: () =>
        [{ text: `Typical: ${_fmtP(indicatorData!.typicalPrice![iIdx])}`, color: indicators!.typicalPrice?.color || '#b2bec3' }]
    },
    {
      key: 'weightedClose', enabled: !!(indicatorData?.weightedClose && indicators?.weightedClose?.enabled), segments: () =>
        [{ text: `WClose: ${_fmtP(indicatorData!.weightedClose![iIdx])}`, color: indicators!.weightedClose?.color || '#636e72' }]
    },
    {
      key: 'zigzag', enabled: !!(indicatorData?.zigzag && indicators?.zigzag?.enabled), segments: () =>
        [{ text: `ZigZag ${indicators!.zigzag!.deviation || 5}%: ${_fmtP(indicatorData!.zigzag![iIdx])}`, color: indicators!.zigzag?.color || '#e84393' }]
    },
    {
      key: 'alligator', enabled: !!(indicatorData?.alligator && indicators?.alligator?.enabled), segments: () => {
        const a = indicatorData!.alligator!;
        return [
          { text: `Jaw: ${_fmtP(a.jaw[iIdx])}`, color: indicators!.alligator?.jawColor || '#0984e3' },
          { text: `Teeth: ${_fmtP(a.teeth[iIdx])}`, color: indicators!.alligator?.teethColor || '#e17055' },
          { text: `Lips: ${_fmtP(a.lips[iIdx])}`, color: indicators!.alligator?.lipsColor || '#00b894' },
        ];
      }
    },
    {
      key: 'priceChannel', enabled: !!(indicatorData?.priceChannel && indicators?.priceChannel?.enabled), segments: () => {
        const pc = indicatorData!.priceChannel!;
        return [
          { text: `PC U: ${_fmtP(pc.upper[iIdx])}`, color: indicators!.priceChannel?.upperColor || '#0984e3' },
          { text: `M: ${_fmtP(pc.middle[iIdx])}`, color: indicators!.priceChannel?.middleColor || '#636e72' },
          { text: `L: ${_fmtP(pc.lower[iIdx])}`, color: indicators!.priceChannel?.lowerColor || '#0984e3' },
        ];
      }
    },
    {
      key: 'chandeKroll', enabled: !!(indicatorData?.chandeKroll && indicators?.chandeKroll?.enabled), segments: () => {
        const ck = indicatorData!.chandeKroll!;
        return [
          { text: `CK Long: ${_fmtP(ck.stopLong[iIdx])}`, color: indicators!.chandeKroll?.longColor || '#22c55e' },
          { text: `Short: ${_fmtP(ck.stopShort[iIdx])}`, color: indicators!.chandeKroll?.shortColor || '#ef4444' },
        ];
      }
    },
    {
      key: 'chandelierExit', enabled: !!(indicatorData?.chandelierExit && indicators?.chandelierExit?.enabled), segments: () => {
        const ce = indicatorData!.chandelierExit!;
        return [
          { text: `CE Long: ${_fmtP(ce.exitLong[iIdx])}`, color: indicators!.chandelierExit?.longColor || '#22c55e' },
          { text: `Short: ${_fmtP(ce.exitShort[iIdx])}`, color: indicators!.chandelierExit?.shortColor || '#ef4444' },
        ];
      }
    },
    {
      key: 'accBands', enabled: !!(indicatorData?.accBands && indicators?.accBands?.enabled), segments: () => {
        const ab = indicatorData!.accBands!;
        return [
          { text: `AccB U: ${_fmtP(ab.upper[iIdx])}`, color: indicators!.accBands?.upperColor || '#74b9ff' },
          { text: `M: ${_fmtP(ab.middle[iIdx])}`, color: indicators!.accBands?.middleColor || '#636e72' },
          { text: `L: ${_fmtP(ab.lower[iIdx])}`, color: indicators!.accBands?.lowerColor || '#74b9ff' },
        ];
      }
    },
    {
      key: 'demarkPivots', enabled: !!(indicatorData?.demarkPivots && indicators?.demarkPivots?.enabled), segments: () => {
        const dp = indicatorData!.demarkPivots!;
        return [
          { text: `DM P: ${_fmtP(dp.pivot[iIdx])}`, color: indicators!.demarkPivots?.pivotColor || '#ffeb3b' },
          { text: `R1: ${_fmtP(dp.r1[iIdx])}`, color: indicators!.demarkPivots?.resistanceColor || '#ef4444' },
          { text: `S1: ${_fmtP(dp.s1[iIdx])}`, color: indicators!.demarkPivots?.supportColor || '#22c55e' },
        ];
      }
    },
    {
      key: 'fractals', enabled: !!(indicatorData?.fractals && indicators?.fractals?.enabled), segments: () =>
        [{ text: 'Fractals', color: '#22c55e' }]
    },
    // Custom overlay indicators (formula + Brue). Two paths:
    //
    // 1) Brue plots are GROUPED BY SCRIPT. A `strategy("EMA Crossover", ...)`
    //    that emits two plots (Fast EMA + Slow EMA) gets ONE legend row
    //    showing "EMA Crossover" with both values inline. Per-plot rows
    //    were noisy and didn't match the user's mental model; the script
    //    is the indicator, not each individual line. Hit-test and toolbar
    //    use `script-${scriptId}` as the selection key to match.
    //
    // 2) Formula plots stay per-entry (one row per plot); they have no
    //    parent script to group under.
    //
    // safeIdx clamps to data.length-1 because brueRenderData (editor's
    // last-Run output) can lag the live candle stream by a few bars.
    ...(() => {
      // Stricter filter than `data?.length > 0`: a plot with length but
      // every value NaN draws no visible line. Letting it through here
      // produces a legend label with nothing on the chart, which the user
      // perceives as "the writing stays after I close" because the actual
      // plots vanished but the label persisted from a stale all-NaN array.
      // Require at least one finite value so legend visibility tracks
      // line visibility 1:1.
      const hasAnyVisibleValue = (data: any) => {
        if (!Array.isArray(data) || data.length === 0) return false;
        for (let i = 0; i < data.length; i++) {
          const v = data[i];
          if (typeof v === 'number' && !isNaN(v) && isFinite(v)) return true;
        }
        return false;
      };
      const all = (indicatorData?.customIndicators || []).filter((ci: any) => ci.display === 'overlay' && hasAnyVisibleValue(ci.data));
      const brueByScript = new Map<string, any[]>();
      const formula: any[] = [];
      for (const ci of all) {
        const isBrue = typeof ci.expression === 'string' && ci.expression.startsWith('brue:') && ci.scriptId;
        if (isBrue) {
          if (!brueByScript.has(ci.scriptId)) brueByScript.set(ci.scriptId, []);
          brueByScript.get(ci.scriptId)!.push(ci);
        } else {
          formula.push(ci);
        }
      }

      const formulaRows = formula.map((ci: any) => ({
        key: `custom_overlay_${ci.id}`,
        enabled: true,
        segments: () => {
          const safeIdx = Math.min(iIdx, ci.data.length - 1);
          return [{ text: `${ci.name}: ${_fmtP(ci.data[safeIdx] ?? NaN)}`, color: ci.color || '#f59e0b' }];
        }
      }));

      const brueRows = Array.from(brueByScript.entries()).map(([scriptId, plots]) => ({
        key: `script_${scriptId}`,
        enabled: true,
        segments: () => {
          // Script-level title only, no per-plot values. The user wants
          // the legend to read like a clean strategy name (e.g.
          // "EMA Crossover"), not a noisy "name + value1 + value2 + ..."
          // breakdown. Per-plot values are still visible on the chart
          // (the lines themselves) and via the crosshair tooltip.
          const scriptName = (indicators?.customBrueScripts as any)?.[scriptId]?.name || plots[0].name || 'Brue script';
          return [{ text: scriptName, color: plots[0].color || '#f59e0b' }];
        }
      }));

      // Shape-only Brue scripts: a strategy that emits only shape()/label()/
      // bgcolor()/hline()/etc and no plot() never lands in customIndicators,
      // so brueByScript above misses it and the legend has nothing to print.
      // Surface a row from customBrueScripts for any enabled entry not already
      // grouped above so the canvas-painted arrows/labels still get a named,
      // clickable legend entry the user can hide/remove via the toolbar.
      const allBrueScripts: Record<string, any> = (indicators as any)?.customBrueScripts || {};
      const shapeOnlyBrueRows = Object.entries(allBrueScripts)
        .filter(([sid, entry]: any) => entry?.enabled && !brueByScript.has(sid))
        .map(([sid, entry]: any) => ({
          key: `script_${sid}`,
          enabled: true,
          segments: () => {
            const scriptName = entry?.name || 'Brue script';
            // Neutral slate: no plot color to inherit from. Stays on-brand
            // (no neon green) and reads as a label rather than a price line.
            return [{ text: scriptName, color: '#94a3b8' }];
          },
        }));

      return [...formulaRows, ...brueRows, ...shapeOnlyBrueRows];
    })(),
  ];

  // Draw all overlay labels with uniform rendering
  // Seed bespoke-block indicators whose endX was captured above the configs loop.
  const _olEndX: Record<string, number> = { ...(_ichimokuEndX > 0 ? { ichimoku: _ichimokuEndX } : {}) };
  ctx.font = indicatorFont;
  for (const cfg of overlayLabelConfigs) {
    if (!cfg.enabled) continue;
    const segs = cfg.segments();
    let x = ohlcX;
    for (const seg of segs) {
      ctx.fillStyle = seg.color;
      ctx.fillText(seg.text, x, currentIndicatorY);
      x += ctx.measureText(seg.text).width + (seg.gap ?? 10);
    }
    _olEndX[cfg.key] = x - (segs[segs.length - 1]?.gap ?? 10) + 6;
    currentIndicatorY += indicatorLineH;
  }

  // Sync overlay label end positions to state (debounced to avoid re-render storms)
  const prevOlEndX = overlayLabelEndXPrev;
  const changed = Object.keys(_olEndX).some(k => Math.abs((_olEndX[k] || 0) - (prevOlEndX[k] || 0)) > 10);
  if (changed) {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => callbacks.setOverlayLabelEndX({ ..._olEndX }), { timeout: 150 });
    } else {
      setTimeout(() => callbacks.setOverlayLabelEndX({ ..._olEndX }), 150);
    }
  }

  // Sync subplot label end positions to state (debounced).
  // The subplot labels are rendered in drawChart (subplotRenderer), but the
  // state update is deferred to this crosshair pass to batch rendering.
  const _spEndX = { ...subplotLabelEndXPrev };
  const spChanged = Object.keys(_spEndX).some(k => Math.abs((_spEndX[k] || 0) - (subplotLabelEndXPrev[k] || 0)) > 10);
  if (spChanged) {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => callbacks.setSubplotLabelEndX({ ..._spEndX }), { timeout: 150 });
    } else {
      setTimeout(() => callbacks.setSubplotLabelEndX({ ..._spEndX }), 150);
    }
  }

  // Store the final width for the toggle button position using debounced update
  // to avoid re-render storms during rapid crosshair movement
  const finalWidth = currentX - 12 + 6;
  if (!sessionControlHovered && Math.abs(finalWidth - currentOhlcTextWidth) > 20) {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => callbacks.setOhlcTextWidth(finalWidth), { timeout: 100 });
    } else {
      setTimeout(() => callbacks.setOhlcTextWidth(finalWidth), 100);
    }
  }
}

// ── Economic event hover card (tooltip) ──
// Draws a floating card on the overlay canvas when hovering over an economic
// event marker. Shows event name, impact, country flag, and actual/forecast/
// previous values.
function renderEconomicEventCard(
  ctx: CanvasRenderingContext2D,
  chartWidth: number,
  hoveredEvt: HoveredEventData,
): void {
  const isDark = document.documentElement.classList.contains('dark');
  const groupEvents = hoveredEvt.groupEvents || [{ event: hoveredEvt.event, impact: hoveredEvt.impact, ts: hoveredEvt.ts }];

  // Country flag helper (same map as marker rendering in drawChart)
  const regionToFlag: Record<string, string> = {
    US: '\ud83c\uddfa\ud83c\uddf8', EU: '\ud83c\uddea\ud83c\uddfa', EA: '\ud83c\uddea\ud83c\uddfa', GB: '\ud83c\uddec\ud83c\udde7', UK: '\ud83c\uddec\ud83c\udde7', JP: '\ud83c\uddef\ud83c\uddf5', CH: '\ud83c\udde8\ud83c\udded',
    AU: '\ud83c\udde6\ud83c\uddfa', CA: '\ud83c\udde8\ud83c\udde6', NZ: '\ud83c\uddf3\ud83c\uddff', CN: '\ud83c\udde8\ud83c\uddf3', DE: '\ud83c\udde9\ud83c\uddea', FR: '\ud83c\uddeb\ud83c\uddf7', IT: '\ud83c\uddee\ud83c\uddf9',
    ES: '\ud83c\uddea\ud83c\uddf8', KR: '\ud83c\uddf0\ud83c\uddf7', IN: '\ud83c\uddee\ud83c\uddf3', BR: '\ud83c\udde7\ud83c\uddf7', MX: '\ud83c\uddf2\ud83c\uddfd', ZA: '\ud83c\uddff\ud83c\udde6', SG: '\ud83c\uddf8\ud83c\uddec',
    HK: '\ud83c\udded\ud83c\uddf0', SE: '\ud83c\uddf8\ud83c\uddea', NO: '\ud83c\uddf3\ud83c\uddf4', DK: '\ud83c\udde9\ud83c\uddf0', PL: '\ud83c\uddf5\ud83c\uddf1', TR: '\ud83c\uddf9\ud83c\uddf7', RU: '\ud83c\uddf7\ud83c\uddfa',
  };
  const getFlag = (code: string | null): string => {
    if (!code) return '\ud83c\udf10';
    const upper = code.toUpperCase().trim();
    return regionToFlag[upper] || '\ud83c\udf10';
  };

  const cardPad = 12;
  const cardW = 260;
  const eventRowH = 18;
  const headerH = 30;
  const maxEvents = Math.min(groupEvents.length, 8); // cap at 8 for readability
  const hasAnyData = groupEvents.some(ge => ge.event.actual || ge.event.forecast || ge.event.previous);
  const dataRowH = hasAnyData ? 32 : 0;
  const cardH = headerH + maxEvents * eventRowH + dataRowH + cardPad;

  // Position card above the marker
  let cardX = hoveredEvt.x - cardW / 2;
  let cardY = hoveredEvt.y - cardH - 14;
  if (cardX < 6) cardX = 6;
  if (cardX + cardW > chartWidth - 6) cardX = chartWidth - cardW - 6;
  if (cardY < 6) cardY = hoveredEvt.y + 18;

  ctx.save();

  // Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 4;

  // Card background
  const bgColor = isDark ? 'rgba(15, 15, 25, 0.97)' : 'rgba(255, 255, 255, 0.98)';
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 8);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Border
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Header: date/time
  const displayTime = hoveredEvt.ts
    ? new Date(hoveredEvt.ts).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'All Day';
  ctx.font = '10px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
  ctx.fillText(displayTime, cardX + cardPad, cardY + 8);

  // Event count badge (right-aligned in header)
  if (groupEvents.length > 1) {
    const countText = `${groupEvents.length} events`;
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
    const countW = ctx.measureText(countText).width + 10;
    const countX = cardX + cardW - countW - cardPad;
    ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)';
    ctx.beginPath();
    ctx.roundRect(countX, cardY + 6, countW, 16, 4);
    ctx.fill();
    ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
    ctx.fillText(countText, countX + 5, cardY + 9);
  }

  // Separator after header
  const sepY = cardY + headerH - 2;
  ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
  ctx.beginPath();
  ctx.moveTo(cardX + cardPad, sepY);
  ctx.lineTo(cardX + cardW - cardPad, sepY);
  ctx.stroke();

  // Event rows
  for (let ei = 0; ei < maxEvents; ei++) {
    const ge = groupEvents[ei];
    const rowY = cardY + headerH + ei * eventRowH;
    const isHigh = ge.impact === 'high';
    const isMedium = ge.impact === 'medium';
    const impactColor = isHigh ? '#dc2626' : isMedium ? '#d97706' : '#22c55e';
    const flag = getFlag(ge.event.region_code);
    const eventName = (ge.event.event || 'Event').slice(0, 32);

    // Impact dot
    ctx.beginPath();
    ctx.arc(cardX + cardPad + 3, rowY + eventRowH / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = impactColor;
    ctx.fill();

    // Flag + Event name
    ctx.font = '11px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(flag, cardX + cardPad + 12, rowY + eventRowH / 2);

    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
    ctx.fillStyle = isDark ? '#e2e8f0' : '#1e293b';
    ctx.fillText(eventName, cardX + cardPad + 28, rowY + eventRowH / 2);

    // Actual/Previous values (right-aligned, compact)
    if (ge.event.actual) {
      ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#22c55e';
      ctx.fillText(ge.event.actual, cardX + cardW - cardPad, rowY + eventRowH / 2);
    } else if (ge.event.previous) {
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = isDark ? '#475569' : '#94a3b8';
      ctx.fillText(ge.event.previous, cardX + cardW - cardPad, rowY + eventRowH / 2);
    }
  }

  // Bottom data summary (for first event with data)
  if (hasAnyData) {
    const firstWithData = groupEvents.find(ge => ge.event.actual || ge.event.forecast || ge.event.previous);
    if (firstWithData) {
      const dataY = cardY + headerH + maxEvents * eventRowH + 4;

      // Separator
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
      ctx.beginPath();
      ctx.moveTo(cardX + cardPad, dataY - 2);
      ctx.lineTo(cardX + cardW - cardPad, dataY - 2);
      ctx.stroke();

      const colW = (cardW - cardPad * 2) / 3;
      const cols = [
        { label: 'Actual', value: firstWithData.event.actual, color: '#22c55e' },
        { label: 'Forecast', value: firstWithData.event.forecast || firstWithData.event.consensus, color: '#3b82f6' },
        { label: 'Previous', value: firstWithData.event.previous, color: isDark ? '#a1a1aa' : '#71717a' },
      ];

      ctx.textAlign = 'left';
      cols.forEach((col, ci) => {
        const colX = cardX + cardPad + ci * colW;
        ctx.font = '9px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
        ctx.fillStyle = isDark ? '#475569' : '#94a3b8';
        ctx.textBaseline = 'top';
        ctx.fillText(col.label, colX, dataY + 2);
        if (col.value) {
          ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
          ctx.fillStyle = col.color;
          ctx.fillText(col.value, colX, dataY + 14);
        } else {
          ctx.font = '10px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
          ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
          ctx.fillText('\u2014', colX, dataY + 14);
        }
      });
    }
  }

  ctx.restore();
}
