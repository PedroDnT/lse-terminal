import { useEffect, useRef, useCallback, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { registerEchartsTheme } from './echartsTheme';
import { useTheme } from '@/hooks/useTheme';
import { IndicatorConfig, MAType } from './IndicatorSettings';
import { calculateRSI, calculateEMA, calculateSMA, calculateSMMA, calculateMACD, calculateBollingerBands, calculateATR, calculateStochastic } from '@/lib/indicators';
import { ChartZoomControls } from './ChartZoomControls';

type Candle = { time: number; open: number; high: number; low: number; close: number };

export type ChartType = 'candlestick' | 'line' | 'area' | 'renko';

type Props = {
  title?: string;
  candles: Candle[];
  liveBar?: Candle | null;
  isCrypto?: boolean;
  timeframe?: string;
  customColors?: {
    upColor: string;
    downColor: string;
    upBorderColor: string;
    downBorderColor: string;
    wickUpColor: string;
    wickDownColor: string;
    backgroundColor: string;
    gridColor: string;
  };
  indicators?: IndicatorConfig;
  chartType?: ChartType;
};

export default function UniversalChart({ candles, liveBar, isCrypto = true, timeframe = '1m', customColors, indicators, chartType = 'candlestick' }: Props) {
  const [theme] = useTheme();
  const isLight = theme === 'light';
  const chartRef = useRef<ReactECharts>(null);
  const hasInitZoomRef = useRef(false);

  // Responsive margins - right margin must be wide enough for full-precision
  // price labels (e.g. "1.17250" = 7 chars) at the Y-axis font size
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const rightMargin = isMobile ? 75 : 80;
  const leftMargin = isMobile ? 10 : 60;

  // Register theme once on mount
  useEffect(() => {
    registerEchartsTheme('light');
    registerEchartsTheme('dark');
  }, []);

  // Detect Mac OS
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // Mac trackpad zoom sensitivity fix - intercept ALL wheel events and handle zoom manually
  useEffect(() => {
    if (!isMac) return; // Only apply fix on Mac

    // Small delay to ensure chart is mounted
    const timer = setTimeout(() => {
      const chartInstance = chartRef.current?.getEchartsInstance();
      if (!chartInstance) return;

      const chartDom = chartInstance.getDom();
      if (!chartDom) return;

      const handleWheel = (e: WheelEvent) => {
        // Always handle wheel events on Mac for zoom control
        e.preventDefault();
        e.stopPropagation();

        // Get current zoom state
        const option = chartInstance.getOption() as any;
        const dataZoom = option.dataZoom?.[0];
        if (!dataZoom) return;

        const currentStart = dataZoom.start ?? 0;
        const currentEnd = dataZoom.end ?? 100;
        const range = currentEnd - currentStart;

        // Very small zoom factor for smooth Mac trackpad - ctrlKey means pinch gesture
        const isPinch = e.ctrlKey;
        const sensitivity = isPinch ? 0.005 : 0.01;
        const delta = e.deltaY * sensitivity;

        // Calculate new range
        const zoomMultiplier = 1 + delta;
        const newRange = Math.min(100, Math.max(1, range * zoomMultiplier));

        // Center the zoom
        const center = (currentStart + currentEnd) / 2;
        let newStart = center - newRange / 2;
        let newEnd = center + newRange / 2;

        // Clamp values
        if (newStart < 0) {
          newStart = 0;
          newEnd = newRange;
        }
        if (newEnd > 100) {
          newEnd = 100;
          newStart = 100 - newRange;
        }

        chartInstance.dispatchAction({
          type: 'dataZoom',
          start: Math.max(0, newStart),
          end: Math.min(100, newEnd),
        });
      };

      chartDom.addEventListener('wheel', handleWheel, { passive: false, capture: true });

      // Store cleanup function
      (chartDom as any)._wheelCleanup = () => {
        chartDom.removeEventListener('wheel', handleWheel, { capture: true } as any);
      };
    }, 100);

    return () => {
      clearTimeout(timer);
      const chartInstance = chartRef.current?.getEchartsInstance();
      if (chartInstance) {
        const chartDom = chartInstance.getDom();
        if (chartDom && (chartDom as any)._wheelCleanup) {
          (chartDom as any)._wheelCleanup();
        }
      }
    };
  }, [candles.length, isMac]);

  // Clear chart when indicators change to force proper re-render
  useEffect(() => {
    if (chartRef.current) {
      const instance = chartRef.current.getEchartsInstance();
      if (instance) {
        instance.clear();
      }
    }
  }, [indicators]);

  // Prepare data
  const { data, categoryData, timestamps } = (() => {
    // Timestamps for all candles (used for x-axis & tooltips)
    const times = candles.map((c) => c.time);

    // Main OHLC data for the candlestick series
    const base = candles.map((c, idx) =>
      isCrypto
        // For crypto we use a time axis, so include the timestamp as first element
        ? ([c.time, c.open, c.close, c.low, c.high] as [
          number,
          number,
          number,
          number,
          number
        ])
        // For non-crypto we use a category axis, so only pass OHLC values
        : ([c.open, c.close, c.low, c.high] as [
          number,
          number,
          number,
          number
        ])
    );

    if (liveBar) {
      const lastIdx = base.length;

      const last = isCrypto
        ? ([
          liveBar.time,
          liveBar.open,
          liveBar.close,
          liveBar.low,
          liveBar.high,
        ] as [number, number, number, number, number])
        : ([
          liveBar.open,
          liveBar.close,
          liveBar.low,
          liveBar.high,
        ] as [number, number, number, number]);

      // For crypto, if the last bar is within 1 minute, merge into it; otherwise append
      if (
        base.length &&
        isCrypto &&
        Math.abs((base[base.length - 1] as number[])[0] - liveBar.time) < 60_000
      ) {
        base[base.length - 1] = last as any;
      } else {
        base.push(last as any);
        times.push(liveBar.time);
      }
    }

    // For non-crypto, pre-format timestamps as category labels
    // Smarter formatting based on timeframe like TradingView
    const categories = isCrypto ? undefined : times.map((time, idx, arr) => {
      const date = new Date(time);
      const prevDate = idx > 0 ? new Date(arr[idx - 1]) : null;

      // For 1D and above, show clean date labels (month + day, new month shows month name)
      if (['1D', '1W', '1M'].includes(timeframe)) {
        // Show month name only when month changes
        if (!prevDate || date.getMonth() !== prevDate.getMonth()) {
          return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
        // Otherwise just show day number
        return date.getDate().toString();
      }

      // For 4H, show date and time but cleaner
      if (timeframe === '4H') {
        if (!prevDate || date.getDate() !== prevDate.getDate()) {
          return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      }

      // For shorter timeframes (1m, 5m, 15m, 30m, 1H), show time and date when day changes
      if (!prevDate || date.getDate() !== prevDate.getDate()) {
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    });

    return {
      data: base,
      categoryData: categories,
      timestamps: times,
    };
  })();

  useEffect(() => {
    if (data.length > 0 && !hasInitZoomRef.current) {
      hasInitZoomRef.current = true;
    }
  }, [data.length]);



  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) {
      const option = instance.getOption() as any;
      const dataZoom = option.dataZoom?.[0];
      if (dataZoom) {
        const range = dataZoom.end - dataZoom.start;
        const newRange = Math.max(range * 0.7, 10); // Zoom in but keep at least 10% visible
        const center = (dataZoom.start + dataZoom.end) / 2;
        instance.dispatchAction({
          type: 'dataZoom',
          start: Math.max(center - newRange / 2, 0),
          end: Math.min(center + newRange / 2, 100)
        });
      }
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) {
      const option = instance.getOption() as any;
      const dataZoom = option.dataZoom?.[0];
      if (dataZoom) {
        const range = dataZoom.end - dataZoom.start;
        const newRange = Math.min(range * 1.3, 100);
        const center = (dataZoom.start + dataZoom.end) / 2;
        instance.dispatchAction({
          type: 'dataZoom',
          start: Math.max(center - newRange / 2, 0),
          end: Math.min(center + newRange / 2, 100)
        });
      }
    }
  }, []);

  const handleZoomReset = useCallback(() => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) {
      const defaultStart = data.length > 50 ? ((data.length - 50) / data.length) * 100 : 0;
      instance.dispatchAction({
        type: 'dataZoom',
        start: defaultStart,
        end: 100
      });
    }
  }, [data.length]);

  const defaultWindowPercent = data.length > 50 ? ((data.length - 50) / data.length) * 100 : 0;
  const dataZoomStart = !hasInitZoomRef.current && data.length > 0 ? defaultWindowPercent : undefined;

  const upColor = customColors?.upColor || '#00ff88';
  const downColor = customColors?.downColor || '#ff0080';
  const bgColor = customColors?.backgroundColor || (isLight ? cssVar('--card') : '#000000');

  // Calculate indicators
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const times = candles.map((c) => c.time);

  const rsiData = indicators?.rsi.enabled ? calculateRSI(closes, indicators.rsi.period) : [];
  const macdData = indicators?.macd.enabled
    ? calculateMACD(closes, indicators.macd.fast, indicators.macd.slow, indicators.macd.signal)
    : null;

  // Calculate moving averages from the new combined config
  const maLines = indicators?.movingAverages.enabled
    ? indicators.movingAverages.lines.map((line) => {
      let data: number[];
      switch (line.type) {
        case 'SMA':
          data = calculateSMA(closes, line.period);
          break;
        case 'SMMA':
          data = calculateSMMA(closes, line.period);
          break;
        case 'EMA':
        default:
          data = calculateEMA(closes, line.period);
          break;
      }
      return { data, color: line.color, name: `${line.type} ${line.period}` };
    })
    : [];

  const bollingerData = indicators?.bollinger.enabled
    ? calculateBollingerBands(closes, indicators.bollinger.period, indicators.bollinger.stdDev)
    : null;

  const atrData = indicators?.atr?.enabled
    ? calculateATR(highs, lows, closes, indicators.atr.period)
    : [];

  const stochasticData = indicators?.stochastic?.enabled
    ? calculateStochastic(highs, lows, closes, indicators.stochastic.kPeriod, indicators.stochastic.dPeriod, indicators.stochastic.smooth)
    : null;

  // Determine grid layout based on active indicators
  const hasRSI = !!indicators?.rsi.enabled;
  const hasMACD = !!indicators?.macd.enabled;
  const hasATR = !!indicators?.atr?.enabled;
  const hasStochastic = !!indicators?.stochastic?.enabled;
  const subplotCount = [hasRSI, hasMACD, hasATR, hasStochastic].filter(Boolean).length;
  const showSubplots = subplotCount > 0;

  const grids: any[] = [];
  const xAxes: any[] = [];
  const yAxes: any[] = [];

  // Main candlestick grid occupies top portion of chart
  const mainGridIndex = 0;
  const mainXAxisIndex = 0;
  const mainYAxisIndex = 0;

  if (showSubplots) {
    // Leave room at the bottom for RSI / MACD
    grids.push({ left: leftMargin, right: rightMargin, top: '5%', height: '55%' });
  } else {
    // Full-height candlestick chart when no subplots
    grids.push({ left: leftMargin, right: rightMargin, top: '5%', bottom: 60 });
  }

  // Main X axis
  xAxes.push(
    isCrypto
      ? {
        type: 'time',
        gridIndex: mainGridIndex,
        axisLabel: {
          show: true,
          color: cssVar('--text-secondary'),
          fontFamily: 'SF Mono, monospace',
          fontSize: 11,
          formatter: (value: number) => {
            const date = new Date(value);
            return date.toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
          },
        },
        axisLine: { lineStyle: { color: cssVar('--border') } },
        axisTick: { show: false },
        splitLine: { show: false },
      }
      : {
        type: 'category',
        data: categoryData,
        gridIndex: mainGridIndex,
        axisLabel: {
          show: true,
          color: cssVar('--text-secondary'),
          fontFamily: 'SF Mono, monospace',
          fontSize: 11,
        },
        axisLine: { lineStyle: { color: cssVar('--border') } },
        axisTick: { show: false },
        splitLine: { show: false },
      },
  );

  // Main Y axis (right-side price scale)
  yAxes.push({
    scale: true,
    position: 'right',
    gridIndex: mainGridIndex,
    axisLabel: {
      color: cssVar('--foreground'),
      fontFamily: 'SF Mono, monospace',
      fontSize: 12,
      formatter: (v: number) => v.toLocaleString(),
    },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: {
      lineStyle: {
        // Light mode needs dark gridlines, dark mode needs light ones
        color: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.05)',
        type: 'dashed',
      },
    },
  });

  let nextGridIndex = 1;
  let nextXAxisIndex = 1;
  let nextYAxisIndex = 1;

  let rsiXAxisIndex: number | undefined;
  let rsiYAxisIndex: number | undefined;
  let macdXAxisIndex: number | undefined;
  let macdYAxisIndex: number | undefined;
  let atrXAxisIndex: number | undefined;
  let atrYAxisIndex: number | undefined;
  let stochXAxisIndex: number | undefined;
  let stochYAxisIndex: number | undefined;

  // Calculate subplot positions dynamically
  const subplotHeight = subplotCount > 0 ? Math.floor(35 / subplotCount) : 0;
  let currentTop = 63;

  // Helper to add subplot grid/axes
  const addSubplot = (gridIdx: number, isLast: boolean) => {
    const height = `${subplotHeight}%`;
    const top = `${currentTop}%`;
    currentTop += subplotHeight + 2;

    grids.push({ left: leftMargin, right: rightMargin, top, height });

    const xAxisIdx = nextXAxisIndex++;
    xAxes.push(
      isCrypto
        ? {
          type: 'time',
          gridIndex: gridIdx,
          axisLabel: isLast ? {
            color: cssVar('--text-secondary'),
            fontFamily: 'SF Mono, monospace',
            fontSize: 11,
          } : { show: false },
          axisLine: isLast ? { lineStyle: { color: cssVar('--border') } } : { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        }
        : {
          type: 'category',
          data: categoryData,
          gridIndex: gridIdx,
          axisLabel: isLast ? {
            color: cssVar('--text-secondary'),
            fontFamily: 'SF Mono, monospace',
            fontSize: 11,
          } : { show: false },
          axisLine: isLast ? { lineStyle: { color: cssVar('--border') } } : { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
        },
    );

    return xAxisIdx;
  };

  const addYAxis = (gridIdx: number, min?: number, max?: number) => {
    const yAxisIdx = nextYAxisIndex++;
    yAxes.push({
      scale: true,
      position: 'right',
      gridIndex: gridIdx,
      min,
      max,
      splitNumber: 2,
      axisLabel: {
        color: cssVar('--text-secondary'),
        fontSize: 10,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        lineStyle: {
          color: 'rgba(255, 255, 255, 0.05)',
        },
      },
    });
    return yAxisIdx;
  };

  const activeSubplots = [hasRSI, hasMACD, hasATR, hasStochastic];
  const lastActiveIdx = activeSubplots.lastIndexOf(true);
  let subplotIdx = 0;

  if (hasRSI) {
    const gridIdx = nextGridIndex++;
    const isLast = subplotIdx === lastActiveIdx;
    rsiXAxisIndex = addSubplot(gridIdx, isLast);
    rsiYAxisIndex = addYAxis(gridIdx, 0, 100);
    subplotIdx++;
  }

  if (hasMACD) {
    const gridIdx = nextGridIndex++;
    const isLast = subplotIdx === lastActiveIdx;
    macdXAxisIndex = addSubplot(gridIdx, isLast);
    macdYAxisIndex = addYAxis(gridIdx);
    subplotIdx++;
  }

  if (hasATR) {
    const gridIdx = nextGridIndex++;
    const isLast = subplotIdx === lastActiveIdx;
    atrXAxisIndex = addSubplot(gridIdx, isLast);
    atrYAxisIndex = addYAxis(gridIdx);
    subplotIdx++;
  }

  if (hasStochastic) {
    const gridIdx = nextGridIndex++;
    const isLast = subplotIdx === lastActiveIdx;
    stochXAxisIndex = addSubplot(gridIdx, isLast);
    stochYAxisIndex = addYAxis(gridIdx, 0, 100);
    subplotIdx++;
  }

  // Build array of all xAxis indices for dataZoom synchronization
  const allXAxisIndices = [mainXAxisIndex];
  if (rsiXAxisIndex !== undefined) allXAxisIndices.push(rsiXAxisIndex);
  if (macdXAxisIndex !== undefined) allXAxisIndices.push(macdXAxisIndex);
  if (atrXAxisIndex !== undefined) allXAxisIndices.push(atrXAxisIndex);
  if (stochXAxisIndex !== undefined) allXAxisIndices.push(stochXAxisIndex);


  const option: echarts.EChartsOption = {
    animation: false,
    backgroundColor: bgColor,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: {
        type: 'cross',
        lineStyle: {
          color: cssVar('--electric-blue'),
          width: 1,
          opacity: 0.8
        }
      },
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      borderColor: cssVar('--electric-blue'),
      borderWidth: 1,
      padding: [6, 10],
      textStyle: {
        color: '#ffffff',
        fontFamily: 'SF Mono, monospace',
        fontSize: 11
      },
      formatter: (params: any[]) => {
        if (!params || params.length === 0) return '';

        // Prefer candlestick series for tooltip price/time
        const candle = params.find((p) => p.seriesType === 'candlestick') ?? params[0];
        const pData = candle.data;

        if (!pData) return '';

        let close: number | undefined;
        let time: number | undefined;

        if (isCrypto) {
          // Crypto candlestick: [time, open, close, low, high]
          if (Array.isArray(pData) && pData.length >= 3) {
            const [t, , c] = pData as [number, number, number, number?, number?];
            time = t;
            close = c;
          }
        } else {
          // Non-crypto: use timestamps array with index
          if (Array.isArray(pData) && pData.length >= 2) {
            const [, c] = pData as [number, number, number?, number?];
            const idx = candle.dataIndex as number;
            time = timestamps[idx] ?? Date.now();
            close = c;
          }
        }

        if (close == null || time == null || isNaN(close) || !isFinite(close)) {
          return '';
        }

        const timeStr = new Date(time).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        });

        return `<span style="color: ${cssVar('--electric-blue')}; font-weight: 700;">${close.toFixed(5)}</span> <span style="color: #666; font-size: 10px;">${timeStr}</span>`;
      }
    } as any,
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: allXAxisIndices,
        ...(dataZoomStart !== undefined ? { start: dataZoomStart, end: 100 } : {}),
        // On Mac we handle wheel events manually for trackpad sensitivity
        // On Windows/Linux: vertical scroll zooms chart (matches Mac trackpad behavior)
        zoomOnMouseWheel: isMac ? false : true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        throttle: 100,
        minSpan: 1,
        maxSpan: 100,
      }
    ],
    series: [
      // Main price series - varies by chart type
      ...(chartType === 'candlestick' ? [{
        type: 'candlestick' as const,
        name: 'Price',
        data: data,
        xAxisIndex: mainXAxisIndex,
        yAxisIndex: mainYAxisIndex,
        large: false,
        barWidth: '60%',
        barMinWidth: 4,
        barMaxWidth: 30,
        itemStyle: {
          color: '#22c55e',
          color0: '#ef4444',
          borderColor: '#22c55e',
          borderColor0: '#ef4444',
          borderWidth: 1,
        }
      }] : chartType === 'line' ? [{
        type: 'line' as const,
        name: 'Price',
        data: isCrypto
          ? candles.map(c => [c.time, c.close])
          : candles.map(c => c.close),
        xAxisIndex: mainXAxisIndex,
        yAxisIndex: mainYAxisIndex,
        smooth: false,
        lineStyle: { width: 2, color: cssVar('--primary') },
        showSymbol: false,
      }] : chartType === 'area' ? [{
        type: 'line' as const,
        name: 'Price',
        data: isCrypto
          ? candles.map(c => [c.time, c.close])
          : candles.map(c => c.close),
        xAxisIndex: mainXAxisIndex,
        yAxisIndex: mainYAxisIndex,
        smooth: true,
        lineStyle: { width: 2, color: cssVar('--primary') },
        showSymbol: false,
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(34, 197, 94, 0.4)' },
            { offset: 1, color: 'rgba(34, 197, 94, 0.02)' }
          ])
        }
      }] : chartType === 'renko' ? (() => {
        // Calculate Renko bricks from candle data
        const renkoSize = Math.max(
          ...candles.map(c => c.high - c.low)
        ) * 0.1; // 10% of max range as brick size
        const renkoBricks: Array<{ time: number; open: number; close: number; high: number; low: number }> = [];
        let lastBrickClose = candles[0]?.close || 0;

        candles.forEach((candle) => {
          const diff = candle.close - lastBrickClose;
          const bricksToAdd = Math.floor(Math.abs(diff) / renkoSize);

          for (let i = 0; i < bricksToAdd; i++) {
            const isUp = diff > 0;
            const brickOpen = lastBrickClose;
            const brickClose = isUp ? lastBrickClose + renkoSize : lastBrickClose - renkoSize;

            renkoBricks.push({
              time: candle.time,
              open: brickOpen,
              close: brickClose,
              high: Math.max(brickOpen, brickClose),
              low: Math.min(brickOpen, brickClose),
            });

            lastBrickClose = brickClose;
          }
        });

        const renkoData = isCrypto
          ? renkoBricks.map(b => [b.time, b.open, b.close, b.low, b.high])
          : renkoBricks.map(b => [b.open, b.close, b.low, b.high]);

        return [{
          type: 'candlestick' as const,
          name: 'Renko',
          data: renkoData,
          xAxisIndex: mainXAxisIndex,
          yAxisIndex: mainYAxisIndex,
          large: false,
          barWidth: '80%',
          barMinWidth: 6,
          barMaxWidth: 40,
          itemStyle: {
            color: '#22c55e',
            color0: '#ef4444',
            borderColor: '#22c55e',
            borderColor0: '#ef4444',
            borderWidth: 1,
          }
        }];
      })() : []),
      // Moving Averages series (overlaid on main chart)
      ...maLines.map((ma) => ({
        type: 'line' as const,
        name: ma.name,
        data: isCrypto
          ? ma.data.map((val, i) => [times[i], isNaN(val) ? null : val])
          : ma.data.map((val) => (isNaN(val) ? null : val)),
        xAxisIndex: mainXAxisIndex,
        yAxisIndex: mainYAxisIndex,
        smooth: true,
        lineStyle: { width: 1.5, color: ma.color },
        showSymbol: false,
      })),
      // Bollinger Bands (overlaid on main chart)
      ...(bollingerData
        ? [
          {
            type: 'line' as const,
            name: 'BB Upper',
            data: isCrypto
              ? bollingerData.upper.map((val, i) => [times[i], isNaN(val) ? null : val])
              : bollingerData.upper.map((val) => (isNaN(val) ? null : val)),
            xAxisIndex: mainXAxisIndex,
            yAxisIndex: mainYAxisIndex,
            lineStyle: { width: 1, color: '#9B59B6', type: 'dashed' as const },
            showSymbol: false,
          },
          {
            type: 'line' as const,
            name: 'BB Middle',
            data: isCrypto
              ? bollingerData.middle.map((val, i) => [times[i], isNaN(val) ? null : val])
              : bollingerData.middle.map((val) => (isNaN(val) ? null : val)),
            xAxisIndex: mainXAxisIndex,
            yAxisIndex: mainYAxisIndex,
            lineStyle: { width: 1, color: '#9B59B6' },
            showSymbol: false,
          },
          {
            type: 'line' as const,
            name: 'BB Lower',
            data: isCrypto
              ? bollingerData.lower.map((val, i) => [times[i], isNaN(val) ? null : val])
              : bollingerData.lower.map((val) => (isNaN(val) ? null : val)),
            xAxisIndex: mainXAxisIndex,
            yAxisIndex: mainYAxisIndex,
            lineStyle: { width: 1, color: '#9B59B6', type: 'dashed' as const },
            showSymbol: false,
          },
        ]
        : []),
      // RSI series (own subplot)
      ...(hasRSI && rsiXAxisIndex !== undefined && rsiYAxisIndex !== undefined
        ? [
          {
            type: 'line' as const,
            name: 'RSI',
            data: isCrypto
              ? rsiData.map((val, i) => [times[i], isNaN(val) ? null : val])
              : rsiData.map((val) => (isNaN(val) ? null : val)),
            xAxisIndex: rsiXAxisIndex,
            yAxisIndex: rsiYAxisIndex,
            lineStyle: { width: 1.5, color: '#E74C3C' },
            showSymbol: false,
          },
          {
            type: 'line' as const,
            name: 'RSI Overbought',
            data: isCrypto
              ? times.map((t) => [t, indicators?.rsi.overbought])
              : Array(closes.length).fill(indicators?.rsi.overbought),
            xAxisIndex: rsiXAxisIndex,
            yAxisIndex: rsiYAxisIndex,
            lineStyle: { width: 1, color: 'rgba(255,255,255,0.2)', type: 'dashed' as const },
            showSymbol: false,
          },
          {
            type: 'line' as const,
            name: 'RSI Oversold',
            data: isCrypto
              ? times.map((t) => [t, indicators?.rsi.oversold])
              : Array(closes.length).fill(indicators?.rsi.oversold),
            xAxisIndex: rsiXAxisIndex,
            yAxisIndex: rsiYAxisIndex,
            lineStyle: { width: 1, color: 'rgba(255,255,255,0.2)', type: 'dashed' as const },
            showSymbol: false,
          },
        ]
        : []),
      // MACD series (own subplot)
      ...(hasMACD && macdData && macdXAxisIndex !== undefined && macdYAxisIndex !== undefined
        ? [
          {
            type: 'line' as const,
            name: 'MACD',
            data: isCrypto
              ? macdData.macd.map((val, i) => [times[i], isNaN(val) ? null : val])
              : macdData.macd.map((val) => (isNaN(val) ? null : val)),
            xAxisIndex: macdXAxisIndex,
            yAxisIndex: macdYAxisIndex,
            lineStyle: { width: 1.5, color: '#3498DB' },
            showSymbol: false,
          },
          {
            type: 'line' as const,
            name: 'Signal',
            data: isCrypto
              ? macdData.signal.map((val, i) => [times[i], isNaN(val) ? null : val])
              : macdData.signal.map((val) => (isNaN(val) ? null : val)),
            xAxisIndex: macdXAxisIndex,
            yAxisIndex: macdYAxisIndex,
            lineStyle: { width: 1.5, color: '#E67E22' },
            showSymbol: false,
          },
          {
            type: 'bar' as const,
            name: 'Histogram',
            data: isCrypto
              ? macdData.histogram.map((val, i) => [times[i], isNaN(val) ? null : val])
              : macdData.histogram.map((val) => (isNaN(val) ? null : val)),
            xAxisIndex: macdXAxisIndex,
            yAxisIndex: macdYAxisIndex,
            itemStyle: {
              color: (params: any) => {
                const val = isCrypto ? params.data[1] : params.data;
                return val >= 0 ? '#00ff88' : '#ff0080';
              },
            },
          },
        ]
        : []),
      // ATR series (own subplot)
      ...(hasATR && atrData.length > 0 && atrXAxisIndex !== undefined && atrYAxisIndex !== undefined
        ? [
          {
            type: 'line' as const,
            name: 'ATR',
            data: isCrypto
              ? atrData.map((val, i) => [times[i], isNaN(val) ? null : val])
              : atrData.map((val) => (isNaN(val) ? null : val)),
            xAxisIndex: atrXAxisIndex,
            yAxisIndex: atrYAxisIndex,
            lineStyle: { width: 1.5, color: '#17a2b8' },
            showSymbol: false,
            areaStyle: {
              color: 'rgba(23, 162, 184, 0.1)',
            },
          },
        ]
        : []),
      // Stochastic series (own subplot)
      ...(hasStochastic && stochasticData && stochXAxisIndex !== undefined && stochYAxisIndex !== undefined
        ? [
          {
            type: 'line' as const,
            name: '%K',
            data: isCrypto
              ? stochasticData.k.map((val, i) => [times[i], isNaN(val) ? null : val])
              : stochasticData.k.map((val) => (isNaN(val) ? null : val)),
            xAxisIndex: stochXAxisIndex,
            yAxisIndex: stochYAxisIndex,
            lineStyle: { width: 1.5, color: '#3498DB' },
            showSymbol: false,
          },
          {
            type: 'line' as const,
            name: '%D',
            data: isCrypto
              ? stochasticData.d.map((val, i) => [times[i], isNaN(val) ? null : val])
              : stochasticData.d.map((val) => (isNaN(val) ? null : val)),
            xAxisIndex: stochXAxisIndex,
            yAxisIndex: stochYAxisIndex,
            lineStyle: { width: 1.5, color: '#E67E22' },
            showSymbol: false,
          },
          {
            type: 'line' as const,
            name: 'Stoch Overbought',
            data: isCrypto
              ? times.map((t) => [t, indicators?.stochastic?.overbought ?? 80])
              : Array(closes.length).fill(indicators?.stochastic?.overbought ?? 80),
            xAxisIndex: stochXAxisIndex,
            yAxisIndex: stochYAxisIndex,
            lineStyle: { width: 1, color: 'rgba(255,255,255,0.2)', type: 'dashed' as const },
            showSymbol: false,
          },
          {
            type: 'line' as const,
            name: 'Stoch Oversold',
            data: isCrypto
              ? times.map((t) => [t, indicators?.stochastic?.oversold ?? 20])
              : Array(closes.length).fill(indicators?.stochastic?.oversold ?? 20),
            xAxisIndex: stochXAxisIndex,
            yAxisIndex: stochYAxisIndex,
            lineStyle: { width: 1, color: 'rgba(255,255,255,0.2)', type: 'dashed' as const },
            showSymbol: false,
          },
        ]
        : []),
    ],
  };


  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        No chart data available
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <ReactECharts
        ref={chartRef}
        option={option}
        theme="tcm"
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas', locale: 'EN' }}
        notMerge={false}
        lazyUpdate={false}
      />


      <ChartZoomControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleZoomReset}
      />
    </div>
  );
}

function cssVar(name: string) {
  if (typeof window === 'undefined') return '#ffffff';
  const el = document.createElement('span');
  el.style.color = `var(${name})`;
  document.body.appendChild(el);
  const color = getComputedStyle(el).color;
  el.remove();
  return color;
}
