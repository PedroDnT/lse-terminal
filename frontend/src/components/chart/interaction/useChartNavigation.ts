/**
 * useChartNavigation.ts
 *
 * Extracted from ProChart.tsx: navigation control handlers (zoom, pan, reset)
 * and Y-axis interaction handlers (mouse down, touch start, wheel).
 *
 * These handlers were chosen for extraction because they have a manageable
 * set of dependencies (~20 params) and well-defined inputs/outputs.
 *
 * The complex mouse/touch/wheel handlers for the main chart canvas remain
 * inline in ProChart.tsx because they access 40+ refs, state variables,
 * indicator data, position line state, and crosshair state, making extraction
 * produce a params interface so large it would hurt readability.
 */

import { useCallback, useRef } from 'react';
import { CANDLE_GAP_RATIO } from '../core/types';
import type { Candle } from '../core/types';

// ─── Shared scroll state shape used by ProChart ────────────────────────
// Matches the ref shape in ProChart (scrollStateRef.current)
interface ScrollState {
  startIndex: number;
  candleWidth: number;
}

// ─── Price range returned by getPriceRange ─────────────────────────────
interface PriceRange {
  min: number;
  max: number;
  range: number;
}

// ─── Visible candles result from getVisibleCandles ─────────────────────
interface VisibleCandlesResult {
  candles: Candle[];
  startIndex: number;
}

// ─── View state shape from ProChart ────────────────────────────────────
interface ViewState {
  startIndex: number;
  candleWidth: number;
  futureSpace: number;
  autoFollowLatest: boolean;
}

// ─── Parameters for the hook ───────────────────────────────────────────
// Grouped by purpose for clarity. All refs are passed in from the parent
// to avoid duplicating state; this hook is purely a behavioral layer.
export interface ChartNavigationParams {
  // ── Constants ──
  /** Minimum allowed candle width (pixels). Used to clamp zoom-out. */
  minCandleWidth: number;
  /** Maximum allowed candle width (pixels). Used to clamp zoom-in. */
  maxCandleWidth: number;
  /** Width of the price axis in pixels (subtracted from total width for chart area). */
  priceAxisWidth: number;
  /** Height of the time axis in pixels (subtracted from total height for price range calc). */
  timeAxisHeight: number;

  // ── Dimensions ──
  dimensions: { width: number; height: number };

  // ── Candle data (read-only) ──
  candlesLength: number;

  // ── Props ──
  /** When true, auto-follow is disabled (replay mode). Affects reset behavior. */
  disableAutoFollow: boolean;
  /** Current live price, used to expand Y-axis bounds when entering free mode. */
  livePrice: number | null;

  // ── Scroll state ref (mutable, shared with ProChart) ──
  scrollStateRef: React.MutableRefObject<ScrollState>;

  // ── Drawing/redraw refs ──
  drawChartRef: React.MutableRefObject<((fastMode?: boolean) => void) | null>;

  // ── Callbacks ──
  notifyScrollSync: () => void;
  getVisibleCandles: (useScrollRef?: boolean) => VisibleCandlesResult;
  getPriceRange: (candles: Candle[], autoFollow: boolean) => PriceRange;

  // ── React state setters ──
  setViewState: React.Dispatch<React.SetStateAction<ViewState>>;
  setPriceScale: React.Dispatch<React.SetStateAction<number>>;
  setPriceOffset: React.Dispatch<React.SetStateAction<number>>;
  setFixedPriceCenter: React.Dispatch<React.SetStateAction<number | null>>;
  setFixedPriceRange: React.Dispatch<React.SetStateAction<number | null>>;
  setIsScalingYAxis: React.Dispatch<React.SetStateAction<boolean>>;

  // ── Current state values (needed in useCallback deps) ──
  fixedPriceCenter: number | null;
  priceScale: number;
  priceOffset: number;
  viewStateAutoFollowLatest: boolean;

  // ── Mutable refs shared with ProChart for Y-axis interaction ──
  yAxisScaleStartRef: React.MutableRefObject<{ y: number; scale: number; offset: number }>;
  priceScaleRef: React.MutableRefObject<number>;
  priceOffsetRef: React.MutableRefObject<number>;
  yAxisDebounceRef: React.MutableRefObject<NodeJS.Timeout | null>;
}

// ─── Return type ───────────────────────────────────────────────────────
export interface ChartNavigationHandlers {
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetView: () => void;
  handleResetYAxis: () => void;
  handleMoveLeft: () => void;
  handleMoveRight: () => void;
  handleYAxisMouseDown: (e: React.MouseEvent) => void;
  handleYAxisTouchStart: (e: React.TouchEvent) => void;
  handleYAxisWheel: (e: React.WheelEvent) => void;
}

/**
 * Custom hook that encapsulates chart navigation controls and Y-axis interaction.
 *
 * Extracted to reduce ProChart.tsx line count while keeping all behavior identical.
 * The handlers returned are drop-in replacements for the inline useCallback
 * versions that previously lived in ProChart.
 */
export function useChartNavigation(params: ChartNavigationParams): ChartNavigationHandlers {
  const {
    minCandleWidth,
    maxCandleWidth,
    priceAxisWidth,
    timeAxisHeight,
    dimensions,
    candlesLength,
    disableAutoFollow,
    livePrice,
    scrollStateRef,
    drawChartRef,
    notifyScrollSync,
    getVisibleCandles,
    getPriceRange,
    setViewState,
    setPriceScale,
    setPriceOffset,
    setFixedPriceCenter,
    setFixedPriceRange,
    setIsScalingYAxis,
    fixedPriceCenter,
    priceScale,
    priceOffset,
    viewStateAutoFollowLatest,
    yAxisScaleStartRef,
    priceScaleRef,
    priceOffsetRef,
    yAxisDebounceRef,
  } = params;

  // ─── Y-axis double-tap detection (touch only) ───────────────────────
  // Tracks last tap timestamp for the Y-axis area so double-tap can
  // reset to auto mode on mobile (mirrors TradingView's mobile behavior).
  const yAxisLastTapRef = useRef(0);

  // ─── Helper: capture current price range on first entry to free mode ──
  // Shared by handleYAxisMouseDown, handleYAxisTouchStart, handleYAxisWheel.
  // When fixedPriceCenter is null, the chart is in auto-scale mode. These
  // handlers need to "lock" the current range before applying manual
  // scale/pan, otherwise the auto-scaler would fight the user's input.
  const captureFreeModeRange = useCallback(() => {
    if (fixedPriceCenter !== null) return; // Already in free mode
    const visible = getVisibleCandles();
    if (visible.candles.length === 0) return;

    let min = Infinity;
    let max = -Infinity;
    for (const c of visible.candles) {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    }
    if (livePrice) {
      if (livePrice < min) min = livePrice;
      if (livePrice > max) max = livePrice;
    }
    const range = max - min;
    const padding = range * 0.05;
    const midpoint = (max + min) / 2;
    const paddedRange = range + padding * 2;

    setFixedPriceCenter(midpoint);
    setFixedPriceRange(paddedRange);
  }, [fixedPriceCenter, getVisibleCandles, livePrice, setFixedPriceCenter, setFixedPriceRange]);

  // ─── Navigation: Zoom In ────────────────────────────────────────────
  const handleZoomIn = useCallback(() => {
    const currentCandleWidth = scrollStateRef.current.candleWidth;
    const newCandleWidth = Math.min(maxCandleWidth, currentCandleWidth * 1.2);

    // Update ref immediately for instant drawing sync
    scrollStateRef.current = { ...scrollStateRef.current, candleWidth: newCandleWidth };

    // Trigger immediate redraw and sync
    if (drawChartRef.current) drawChartRef.current(true);
    notifyScrollSync();

    // Sync to React state
    setViewState(prev => ({ ...prev, candleWidth: newCandleWidth, autoFollowLatest: false }));
  }, [notifyScrollSync, scrollStateRef, drawChartRef, maxCandleWidth, setViewState]);

  // ─── Navigation: Zoom Out ───────────────────────────────────────────
  const handleZoomOut = useCallback(() => {
    const currentCandleWidth = scrollStateRef.current.candleWidth;
    const newCandleWidth = Math.max(minCandleWidth, currentCandleWidth * 0.8);

    // Update ref immediately for instant drawing sync
    scrollStateRef.current = { ...scrollStateRef.current, candleWidth: newCandleWidth };

    // Trigger immediate redraw and sync
    if (drawChartRef.current) drawChartRef.current(true);
    notifyScrollSync();

    // Sync to React state
    setViewState(prev => ({ ...prev, candleWidth: newCandleWidth, autoFollowLatest: false }));
  }, [notifyScrollSync, scrollStateRef, drawChartRef, minCandleWidth, setViewState]);

  // ─── Navigation: Reset View ─────────────────────────────────────────
  // Snaps back to the latest candles with default candle width and auto-follow.
  const handleResetView = useCallback(() => {
    const chartWidth = dimensions.width - priceAxisWidth;
    const candleSpacing = 12 * (1 + CANDLE_GAP_RATIO);
    const visibleCount = Math.floor(chartWidth / candleSpacing);
    const startIndex = Math.max(0, candlesLength - visibleCount + 5);

    setViewState({
      startIndex,
      candleWidth: 12,
      // Backtest/replay: 10 candles of right margin so current price is visible.
      futureSpace: disableAutoFollow ? 10 : 35,
      autoFollowLatest: !disableAutoFollow,
    });
    setPriceScale(1.0);
    setPriceOffset(0);
    setFixedPriceCenter(null);
    setFixedPriceRange(null);
  }, [candlesLength, dimensions.width, disableAutoFollow, priceAxisWidth, setViewState, setPriceScale, setPriceOffset, setFixedPriceCenter, setFixedPriceRange]);

  // ─── Navigation: Reset Y-Axis ───────────────────────────────────────
  // Returns Y-axis to auto-scale mode (clears manual scale/pan/center).
  const handleResetYAxis = useCallback(() => {
    setPriceScale(1.0);
    setPriceOffset(0);
    setFixedPriceCenter(null);
    setFixedPriceRange(null);
  }, [setPriceScale, setPriceOffset, setFixedPriceCenter, setFixedPriceRange]);

  // ─── Navigation: Move Left ──────────────────────────────────────────
  const handleMoveLeft = useCallback(() => {
    const moveAmount = 5;
    setViewState(prev => ({
      ...prev,
      startIndex: Math.max(0, prev.startIndex - moveAmount),
      autoFollowLatest: false,
    }));
  }, [setViewState]);

  // ─── Navigation: Move Right ─────────────────────────────────────────
  const handleMoveRight = useCallback(() => {
    const moveAmount = 5;
    setViewState(prev => ({
      ...prev,
      startIndex: Math.min(candlesLength - 10, prev.startIndex + moveAmount),
      autoFollowLatest: false,
    }));
  }, [candlesLength, setViewState]);

  // ─── Y-Axis: Mouse Down (desktop) ──────────────────────────────────
  // Enters Y-axis scaling mode. First interaction also locks the current
  // price range into free mode so the user can stretch/compress manually.
  const handleYAxisMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    captureFreeModeRange();
    setIsScalingYAxis(true);
    yAxisScaleStartRef.current = { y: e.clientY, scale: priceScale, offset: priceOffset };
  }, [priceScale, priceOffset, captureFreeModeRange, setIsScalingYAxis, yAxisScaleStartRef]);

  // ─── Y-Axis: Touch Start (mobile) ──────────────────────────────────
  // Same as mouse down, plus double-tap detection to reset Y-axis.
  const handleYAxisTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.touches.length !== 1) return;
    const touch = e.touches[0];

    // Double-tap detection: if two taps within 300ms, reset to auto mode
    const now = Date.now();
    if (now - yAxisLastTapRef.current < 300) {
      setPriceScale(1.0);
      setPriceOffset(0);
      priceScaleRef.current = 1.0;
      priceOffsetRef.current = 0;
      setFixedPriceCenter(null);
      setFixedPriceRange(null);
      if (drawChartRef.current) drawChartRef.current(false);
      notifyScrollSync();
      yAxisLastTapRef.current = 0;
      return;
    }
    yAxisLastTapRef.current = now;

    captureFreeModeRange();
    setIsScalingYAxis(true);
    yAxisScaleStartRef.current = { y: touch.clientY, scale: priceScale, offset: priceOffset };
  }, [priceScale, priceOffset, captureFreeModeRange, setIsScalingYAxis, yAxisScaleStartRef,
      setPriceScale, setPriceOffset, priceScaleRef, priceOffsetRef, setFixedPriceCenter,
      setFixedPriceRange, drawChartRef, notifyScrollSync]);

  // ─── Y-Axis: Wheel (scroll to pan price axis up/down) ──────────────
  // Enters free mode on first use, then pans the visible price range
  // vertically based on scroll delta.
  const handleYAxisWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Capture the current price range if entering free mode for the first time
    captureFreeModeRange();

    // Scroll to pan up/down (use ref to avoid re-renders)
    const visible = getVisibleCandles();
    const priceRange = getPriceRange(visible.candles, viewStateAutoFollowLatest);
    const pricePerPixel = priceRange.range / (dimensions.height - timeAxisHeight);
    const panAmount = e.deltaY * pricePerPixel * 0.5;
    priceOffsetRef.current = priceOffsetRef.current + panAmount;

    // Immediate redraw using ref
    if (drawChartRef.current) {
      drawChartRef.current(true);
    }
    // Sync drawings immediately
    notifyScrollSync();

    // Debounce state sync
    if (yAxisDebounceRef.current) {
      clearTimeout(yAxisDebounceRef.current);
    }
    yAxisDebounceRef.current = setTimeout(() => {
      setPriceOffset(priceOffsetRef.current);
    }, 100);
  }, [captureFreeModeRange, getVisibleCandles, getPriceRange, viewStateAutoFollowLatest,
      dimensions.height, timeAxisHeight, priceOffsetRef, drawChartRef, notifyScrollSync,
      yAxisDebounceRef, setPriceOffset]);

  return {
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    handleResetYAxis,
    handleMoveLeft,
    handleMoveRight,
    handleYAxisMouseDown,
    handleYAxisTouchStart,
    handleYAxisWheel,
  };
}
