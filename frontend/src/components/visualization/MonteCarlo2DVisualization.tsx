import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Play, Pause, RotateCcw, TrendingUp, Info, DollarSign, Percent, Target, ChevronDown, ChevronUp, Settings, Eye, BarChart3, ZoomIn, ZoomOut, Move, Crosshair, Maximize, Minimize, Shuffle, Focus, Loader2 } from 'lucide-react';
import { SimulationParams, ColorScheme, COLOR_SCHEMES } from './types';
import ColorSchemeSelector from './ColorSchemeSelector';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

function boxMullerRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

type ViewMode = 'price' | 'pnl' | 'return';

interface PathData {
  values: number[];
  finalValue: number;
  color: string;
}

export default function MonteCarlo2DVisualization() {
  // Preview params - controlled by sliders
  const [previewParams, setPreviewParams] = useState<SimulationParams>({
    initialPrice: 100, drift: 0.08, volatility: 0.2, timeHorizon: 252, numSimulations: 100
  });

  // Active params - used for calculation
  const [params, setParams] = useState<SimulationParams>({
    initialPrice: 100, drift: 0.08, volatility: 0.2, timeHorizon: 252, numSimulations: 100
  });

  const [investment, setInvestment] = useState(10000);
  const [targetReturn, setTargetReturn] = useState(20);
  const [viewMode, setViewMode] = useState<ViewMode>('pnl');
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(1);
  const [showFanChart, setShowFanChart] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [pathOpacity, setPathOpacity] = useState(0.15);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(COLOR_SCHEMES[4]); // zinc default matches terminal chrome
  const [showParams, setShowParams] = useState(false);
  const [showVisuals, setShowVisuals] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showTargetLine, setShowTargetLine] = useState(true);
  const [showMedianLine, setShowMedianLine] = useState(true);
  const [showBreakEvenLine, setShowBreakEvenLine] = useState(true);
  const [showDistribution, setShowDistribution] = useState(true);

  // Computing state - show loading when parameters change
  const [isComputing, setIsComputing] = useState(false);

  // Simulation key - incrementing this forces new random paths
  const [simulationKey, setSimulationKey] = useState(0);

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number } | null>(null);
  const [crosshairData, setCrosshairData] = useState<{ time: number; p5: number; p50: number; p95: number; yValue: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Highlighted individual paths (indices)
  const [highlightedPaths, setHighlightedPaths] = useState<number[]>([]);
  const [numHighlightedPaths, setNumHighlightedPaths] = useState(5);
  const [showHighlightedOnly, setShowHighlightedOnly] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const progressRef = useRef(progress);
  const lastPanPos = useRef({ x: 0, y: 0 });

  const shares = useMemo(() => investment / params.initialPrice, [investment, params.initialPrice]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {
        setIsFullscreen(prev => !prev);
      });
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      setIsFullscreen(prev => !prev);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Animation
  const animate = useCallback(() => {
    if (progressRef.current < 1) {
      // Slower animation for engagement (approx 2s)
      progressRef.current = Math.min(progressRef.current + 0.008, 1);
      setProgress(progressRef.current);
      animationRef.current = requestAnimationFrame(animate);
    } else {
      setIsPlaying(false);
    }
  }, []);

  // Handle Run Simulation
  const handleRunSimulation = useCallback(() => {
    // Commit the preview params and start fresh
    setParams({ ...previewParams });
    setSimulationKey(prev => prev + 1); // Force new paths
    progressRef.current = 0;
    setProgress(0);
    setIsPlaying(true);
    // Start animation loop
    animationRef.current = requestAnimationFrame(animate);
  }, [previewParams, animate]);

  // Generate simulation paths
  const { paths, percentiles } = useMemo(() => {
    const result: PathData[] = [];
    const dt = 1 / 252;
    const steps = params.timeHorizon;
    let allValues: number[][] = [];

    // Determine sampling rate for rendering performance
    // If > 2 years (500 steps), sample to keep points manageable
    const sampleRate = steps > 504 ? Math.ceil(steps / 500) : 1;

    for (let sim = 0; sim < params.numSimulations; sim++) {
      const values: number[] = [];
      // We keep full resolution for stats, but could optimise storage if needed
      // For now, let's store full resolution for accurate stats, but we might need to downsample for display
      let price = params.initialPrice;

      for (let t = 0; t <= steps; t++) {
        let yValue = viewMode === 'price' ? price :
          viewMode === 'pnl' ? (price - params.initialPrice) * shares :
            ((price - params.initialPrice) / params.initialPrice) * 100;

        values.push(yValue);

        if (t < steps) {
          const drift = (params.drift - 0.5 * params.volatility ** 2) * dt;
          price = price * Math.exp(drift + params.volatility * Math.sqrt(dt) * boxMullerRandom());
        }
      }

      allValues.push(values);

      // Downsample values for rendering if needed
      const renderValues = values.filter((_, i) => i % sampleRate === 0 || i === values.length - 1);
      result.push({ values: renderValues, finalValue: values[values.length - 1], color: '' });
    }

    // Percentiles - Calculate using FULL data for accuracy
    const pctiles = { p5: [] as number[], p10: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p90: [] as number[], p95: [] as number[] };

    // Optimisation: Calculate percentiles only at sample points + a few key intermediates if needed
    // Actually, for the fan chart to look smooth, we should calculate at sample points
    for (let t = 0; t <= steps; t += sampleRate) {
      // Ensure we don't go out of bounds
      if (t > steps) t = steps;

      const valuesAtT = allValues.map(v => v[t]).sort((a, b) => a - b);
      pctiles.p5.push(valuesAtT[Math.floor(valuesAtT.length * 0.05)]);
      pctiles.p10.push(valuesAtT[Math.floor(valuesAtT.length * 0.10)]);
      pctiles.p25.push(valuesAtT[Math.floor(valuesAtT.length * 0.25)]);
      pctiles.p50.push(valuesAtT[Math.floor(valuesAtT.length * 0.50)]);
      pctiles.p75.push(valuesAtT[Math.floor(valuesAtT.length * 0.75)]);
      pctiles.p90.push(valuesAtT[Math.floor(valuesAtT.length * 0.90)]);
      pctiles.p95.push(valuesAtT[Math.floor(valuesAtT.length * 0.95)]);

      if (t === steps && (t % sampleRate !== 0)) break; // Already handled by loop condition usually
    }

    const finals = result.map(p => p.finalValue);
    const minV = Math.min(...finals), maxV = Math.max(...finals);
    result.forEach(p => { p.color = colorScheme.getColor(p.finalValue, minV, maxV); });

    return { paths: result, percentiles: pctiles };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, colorScheme, viewMode, shares, simulationKey]); // simulationKey forces new random paths

  // Statistics with ranked paths
  const stats = useMemo(() => {
    const finalValues = paths.map(p => p.finalValue);
    const mean = finalValues.reduce((a, b) => a + b, 0) / finalValues.length;
    const sorted = [...finalValues].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)];
    const p50 = sorted[Math.floor(sorted.length * 0.50)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const winRate = finalValues.filter(v => viewMode === 'price' ? v > params.initialPrice : v > 0).length / finalValues.length;
    const targetValue = viewMode === 'price' ? params.initialPrice * (1 + targetReturn / 100) :
      viewMode === 'pnl' ? investment * (targetReturn / 100) : targetReturn;
    const probTarget = finalValues.filter(v => v >= targetValue).length / finalValues.length;
    const expectedPortfolio = viewMode === 'pnl' ? investment + mean :
      viewMode === 'return' ? investment * (1 + mean / 100) : mean * shares;
    const sharpeRatio = params.drift > 0 ? (params.drift - 0.02) / params.volatility : 0;

    // Rank all paths by final value
    const rankedPaths = paths.map((p, i) => ({ index: i, finalValue: p.finalValue, color: p.color }))
      .sort((a, b) => b.finalValue - a.finalValue);

    const bestPath = rankedPaths[0];
    const worstPath = rankedPaths[rankedPaths.length - 1];
    const top5Paths = rankedPaths.slice(0, 5);
    const bottom5Paths = rankedPaths.slice(-5).reverse();
    const medianPath = rankedPaths[Math.floor(rankedPaths.length / 2)];

    // Standard deviation
    const stdDev = Math.sqrt(finalValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / finalValues.length);

    const binCount = 40;
    const minFinal = Math.min(...finalValues), maxFinal = Math.max(...finalValues);
    const binSize = (maxFinal - minFinal) / binCount;
    const histogram = new Array(binCount).fill(0);
    finalValues.forEach(v => {
      const bin = Math.min(Math.floor((v - minFinal) / binSize), binCount - 1);
      histogram[bin]++;
    });

    return {
      mean, p5, p50, p95, winRate, probTarget, expectedPortfolio, sharpeRatio,
      histogram, minFinal, maxFinal,
      bestPath, worstPath, top5Paths, bottom5Paths, medianPath, stdDev, rankedPaths
    };
  }, [paths, params, viewMode, investment, targetReturn, shares]);

  // Chart dimensions - memoized to avoid re-render loops
  const { width, height, marginTop, marginBottom, marginLeft, marginRight, chartWidth, chartHeight } = useMemo(() => {
    const w = 1000;
    const h = 500;
    const mt = 30;
    const mb = 50;
    const ml = 70;
    const mr = showDistribution ? 120 : 60;
    return {
      width: w,
      height: h,
      marginTop: mt,
      marginBottom: mb,
      marginLeft: ml,
      marginRight: mr,
      chartWidth: w - ml - mr,
      chartHeight: h - mt - mb
    };
  }, [showDistribution]);

  // Scales with zoom/pan - zoom works by shrinking the visible data range
  const { xScale, yScale, yMin, yMax, inverseXScale, inverseYScale } = useMemo(() => {
    const allY = paths.flatMap(p => p.values);
    const dataYMin = Math.min(...allY, 0);
    const dataYMax = Math.max(...allY);
    const padding = (dataYMax - dataYMin) * 0.1;

    // Calculate visible range based on zoom (higher zoom = smaller range = more zoomed in)
    const fullXRange = params.timeHorizon;
    const fullYRange = (dataYMax + padding) - (dataYMin - padding);

    const visibleXRange = fullXRange / zoom;
    const visibleYRange = fullYRange / zoom;

    // Center point for zoom + pan offset
    const xCenter = fullXRange / 2 + panX * fullXRange;
    const yCenter = (dataYMin - padding + dataYMax + padding) / 2 + panY * fullYRange;

    const xMin = xCenter - visibleXRange / 2;
    const xMax = xCenter + visibleXRange / 2;
    const yMin = yCenter - visibleYRange / 2;
    const yMax = yCenter + visibleYRange / 2;

    return {
      xScale: (t: number) => marginLeft + ((t - xMin) / (xMax - xMin)) * chartWidth,
      yScale: (v: number) => marginTop + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight,
      inverseXScale: (px: number) => xMin + ((px - marginLeft) / chartWidth) * (xMax - xMin),
      inverseYScale: (py: number) => yMax - ((py - marginTop) / chartHeight) * (yMax - yMin),
      yMin,
      yMax
    };
  }, [paths, params.timeHorizon, chartWidth, chartHeight, marginLeft, marginTop, zoom, panX, panY]);

  // Use effect to attach wheel listener ONLY to chart area (not the whole container)
  useEffect(() => {
    const chartArea = chartAreaRef.current;
    if (!chartArea) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(z => Math.max(0.5, Math.min(5, z * delta)));
    };

    chartArea.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      chartArea.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Generate random highlighted path indices
  const regenerateHighlightedPaths = useCallback(() => {
    const indices: number[] = [];
    const total = params.numSimulations;
    while (indices.length < Math.min(numHighlightedPaths, total)) {
      const idx = Math.floor(Math.random() * total);
      if (!indices.includes(idx)) indices.push(idx);
    }
    setHighlightedPaths(indices);
  }, [params.numSimulations, numHighlightedPaths]);

  // Regenerate when count changes or on mount
  useEffect(() => {
    const indices: number[] = [];
    const total = params.numSimulations;
    while (indices.length < Math.min(numHighlightedPaths, total)) {
      const idx = Math.floor(Math.random() * total);
      if (!indices.includes(idx)) indices.push(idx);
    }
    setHighlightedPaths(indices);
  }, [numHighlightedPaths, params.numSimulations]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Regular click starts panning
    setIsPanning(true);
    lastPanPos.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Handle panning
    if (isPanning) {
      const dx = (e.clientX - lastPanPos.current.x) / (chartWidth * zoom) * 2;
      const dy = (e.clientY - lastPanPos.current.y) / (chartHeight * zoom) * 2;
      setPanX(x => x - dx);
      setPanY(y => y + dy);
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      return; // Don't update crosshair while panning
    }

    // Crosshair - use SVG coordinates properly
    if (svgRef.current && showCrosshair) {
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      const svgX = (e.clientX - rect.left) * scaleX;
      const svgY = (e.clientY - rect.top) * scaleY;

      if (svgX >= marginLeft && svgX <= marginLeft + chartWidth &&
        svgY >= marginTop && svgY <= marginTop + chartHeight) {
        setCrosshairPos({ x: svgX, y: svgY });
        const time = Math.max(0, Math.min(params.timeHorizon, Math.round(inverseXScale(svgX))));
        const yValue = inverseYScale(svgY);
        setCrosshairData({
          time,
          p5: percentiles.p5[time] || 0,
          p50: percentiles.p50[time] || 0,
          p95: percentiles.p95[time] || 0,
          yValue
        });
      } else {
        setCrosshairPos(null);
        setCrosshairData(null);
      }
    }
  }, [isPanning, chartWidth, chartHeight, zoom, width, height, marginLeft, marginTop, showCrosshair, inverseXScale, inverseYScale, params.timeHorizon, percentiles]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
    setCrosshairPos(null);
    setCrosshairData(null);
  }, []);



  const handlePlay = () => {
    // Increment simulation key to generate new random paths (client-side computation)
    setSimulationKey(k => k + 1);
    progressRef.current = 0;
    setProgress(0);
    setIsPlaying(true);
    animationRef.current = requestAnimationFrame(animate);
  };

  const handlePause = () => {
    setIsPlaying(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
  };

  const handleReset = () => { progressRef.current = 0; setProgress(0); handlePlay(); };
  const resetView = () => { setZoom(1); setPanX(0); setPanY(0); };

  const yFormat = (v: number) => viewMode === 'price' ? `$${v.toFixed(0)}` :
    viewMode === 'pnl' ? (v >= 0 ? `+$${v.toFixed(0)}` : `-$${Math.abs(v).toFixed(0)}`) :
      `${v.toFixed(0)}%`;
  const refLineY = viewMode === 'price' ? params.initialPrice : 0;
  const targetLineY = viewMode === 'price' ? params.initialPrice * (1 + targetReturn / 100) :
    viewMode === 'pnl' ? investment * (targetReturn / 100) : targetReturn;

  const visibleSteps = Math.floor(params.timeHorizon * progress);

  const createBandPath = (upper: number[], lower: number[]) => {
    const steps = Math.min(visibleSteps, upper.length - 1);
    let d = `M ${xScale(0)} ${yScale(upper[0])}`;
    for (let t = 1; t <= steps; t++) d += ` L ${xScale(t)} ${yScale(upper[t])}`;
    for (let t = steps; t >= 0; t--) d += ` L ${xScale(t)} ${yScale(lower[t])}`;
    d += ' Z';
    return d;
  };

  const timeLabels = useMemo(() => {
    const labels: { value: number; label: string }[] = [];
    const months = params.timeHorizon / 21;
    const step = months <= 6 ? 1 : months <= 12 ? 2 : months <= 24 ? 3 : 6;
    for (let m = 0; m <= months; m += step) {
      labels.push({ value: m * 21, label: m === 0 ? 'Now' : `${m}M` });
    }
    return labels;
  }, [params.timeHorizon]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-background rounded-lg overflow-hidden border border-border ${isFullscreen ? 'h-screen' : 'h-[calc(100vh-180px)] min-h-[600px]'}`}
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
    >
      {/* Chart Container - NO TILT */}
      <div
        ref={chartAreaRef}
        className="absolute inset-0 flex items-center justify-center bg-background"
        style={{
          touchAction: 'none',
          overscrollBehavior: 'none'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >

        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full max-w-[1400px]"
          preserveAspectRatio="xMidYMid meet"
          style={{ cursor: isPanning ? 'grabbing' : 'crosshair' }}
        >
          <defs>
            <linearGradient id="fanGrad95" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e8e8e8" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#e8e8e8" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="fanGrad75" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e8e8e8" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#e8e8e8" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="fanGrad50" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e8e8e8" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#e8e8e8" stopOpacity="0.2" />
            </linearGradient>
          </defs>

          {/* Grid with visible text */}
          {Array.from({ length: 5 }).map((_, i) => {
            const y = marginTop + (chartHeight / 4) * i;
            const val = yMax - ((yMax - yMin) / 4) * i;
            return (
              <g key={i}>
                <line x1={marginLeft} y1={y} x2={marginLeft + chartWidth} y2={y} stroke="#2e2e2e" strokeWidth={1} />
                <text x={marginLeft - 12} y={y + 4} textAnchor="end" className="fill-muted-foreground" fontSize={12} fontFamily="monospace" fontWeight="500">{yFormat(val)}</text>
              </g>
            );
          })}
          {timeLabels.map(({ value, label }) => (
            <g key={value}>
              <line x1={xScale(value)} y1={marginTop} x2={xScale(value)} y2={marginTop + chartHeight} stroke="#2e2e2e" strokeWidth={1} />
              <text x={xScale(value)} y={height - 18} textAnchor="middle" className="fill-muted-foreground" fontSize={12} fontFamily="monospace" fontWeight="500">{label}</text>
            </g>
          ))}

          {/* Clip path for chart area */}
          <clipPath id="chartClip">
            <rect x={marginLeft} y={marginTop} width={chartWidth} height={chartHeight} />
          </clipPath>

          <g clipPath="url(#chartClip)">
            {/* Fan Chart */}
            {showFanChart && visibleSteps > 0 && (
              <>
                <path d={createBandPath(percentiles.p95, percentiles.p5)} fill="url(#fanGrad95)" />
                <path d={createBandPath(percentiles.p90, percentiles.p10)} fill="url(#fanGrad75)" />
                <path d={createBandPath(percentiles.p75, percentiles.p25)} fill="url(#fanGrad50)" />
              </>
            )}

            {/* Reference Lines */}
            {showBreakEvenLine && (
              <line x1={marginLeft} y1={yScale(refLineY)} x2={marginLeft + chartWidth} y2={yScale(refLineY)} stroke="#b0b0b0" strokeWidth={1.5} strokeDasharray="6,4" />
            )}

            {viewMode !== 'price' && showTargetLine && (
              <line x1={marginLeft} y1={yScale(targetLineY)} x2={marginLeft + chartWidth} y2={yScale(targetLineY)} stroke="#21b3a4" strokeWidth={1.5} strokeDasharray="4,3" />
            )}

            {/* Individual Paths - sample when too many for performance */}
            {showPaths && !showHighlightedOnly && (() => {
              // Sample paths if too many - render max 50 paths for performance
              const maxDisplayPaths = 50;
              const sampleRate = paths.length > maxDisplayPaths ? Math.ceil(paths.length / maxDisplayPaths) : 1;
              return paths.filter((_, i) => i % sampleRate === 0 || highlightedPaths.includes(i)).map((path, idx, arr) => {
                const i = paths.indexOf(path);
                const steps = Math.min(visibleSteps, path.values.length - 1);
                if (steps < 1) return null;
                const isHighlighted = highlightedPaths.includes(i);
                let d = `M ${xScale(0)} ${yScale(path.values[0])}`;
                for (let t = 1; t <= steps; t++) d += ` L ${xScale(t)} ${yScale(path.values[t])}`;
                return <path key={i} d={d} fill="none" stroke={path.color} strokeWidth={isHighlighted ? 2 : 1} opacity={isHighlighted ? 0.9 : pathOpacity} />;
              });
            })()}

            {/* Highlighted Paths (rendered on top) */}
            {highlightedPaths.length > 0 && paths.filter((_, i) => highlightedPaths.includes(i)).map((path, idx) => {
              const i = highlightedPaths[idx];
              const steps = Math.min(visibleSteps, path.values.length - 1);
              if (steps < 1) return null;
              let d = `M ${xScale(0)} ${yScale(path.values[0])}`;
              for (let t = 1; t <= steps; t++) d += ` L ${xScale(t)} ${yScale(path.values[t])}`;
              // Muted categorical set so tracked paths stay distinguishable without neon
              const colors = ['#f0426c', '#21b3a4', '#c58435', '#e8e8e8', '#8f86ad', '#7da0a8', '#b0748f', '#96a86e'];
              return <path key={`hl-${i}`} d={d} fill="none" stroke={colors[idx % colors.length]} strokeWidth={2.5} opacity={0.95} />;
            })}

            {/* Median Line with glow */}
            {showMedianLine && visibleSteps > 0 && (
              <path
                d={`M ${xScale(0)} ${yScale(percentiles.p50[0])} ${percentiles.p50.slice(1, visibleSteps + 1).map((v, t) => `L ${xScale(t + 1)} ${yScale(v)}`).join(' ')}`}
                fill="none" stroke="#e8e8e8" strokeWidth={2.5}
              />
            )}
          </g>

          {/* Crosshair */}
          {showCrosshair && crosshairPos && crosshairData && (
            <g>
              {/* Vertical line at mouse X */}
              <line x1={crosshairPos.x} y1={marginTop} x2={crosshairPos.x} y2={marginTop + chartHeight} stroke="rgba(176,176,176,0.5)" strokeWidth={1} strokeDasharray="4,4" />
              {/* Median data point indicator - small green dot on median line */}
              <circle cx={crosshairPos.x} cy={yScale(crosshairData.p50)} r={4} fill="#e8e8e8" />
              {/* X-axis time label */}
              <g transform={`translate(${crosshairPos.x}, ${marginTop + chartHeight + 5})`}>
                {/* SVG attributes cannot resolve CSS vars, so panel/edge hexes are used directly */}
                <rect x={-22} y={0} width={44} height={20} rx={4} fill="#2a2a2a" stroke="#3a3a3a" strokeWidth={1.5} />
                <text x={0} y={14} textAnchor="middle" className="fill-foreground" fontSize={11} fontFamily="monospace" fontWeight="700">{Math.round(crosshairData.time / 21)}M</text>
              </g>
            </g>
          )}

          {/* Distribution Histogram with Percentages */}
          {showDistribution && progress >= 1 && (
            <g transform={`translate(${marginLeft + chartWidth + 15}, ${marginTop})`}>
              {stats.histogram.map((count, i) => {
                const percentage = (count / params.numSimulations) * 100;
                const barHeight = (count / Math.max(...stats.histogram)) * 60;
                const binValue = stats.minFinal + (i + 0.5) * ((stats.maxFinal - stats.minFinal) / stats.histogram.length);
                const y = ((stats.maxFinal - binValue) / (stats.maxFinal - stats.minFinal)) * chartHeight;
                const color = colorScheme.getColor(binValue, stats.minFinal, stats.maxFinal);
                return (
                  <g key={i}>
                    <rect x={0} y={y - 4} width={barHeight} height={8} fill={color} opacity={0.85} rx={2} />
                    {percentage >= 5 && (
                      <text x={barHeight + 4} y={y + 2} fontSize={9} fontFamily="monospace" className="fill-muted-foreground" fontWeight="500">
                        {percentage.toFixed(0)}%
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Labels */}
          <text x={marginLeft + chartWidth + 8} y={yScale(refLineY) + 4} className="fill-muted-foreground" fontSize={11} fontFamily="monospace" fontWeight="500">{viewMode === 'price' ? 'Entry' : 'B/E'}</text>
          {viewMode !== 'price' && <text x={marginLeft + chartWidth + 8} y={yScale(targetLineY) + 4} fill="#21b3a4" fontSize={11} fontFamily="monospace" fontWeight="500">+{targetReturn}%</text>}
          <text x={marginLeft + chartWidth / 2} y={height - 3} textAnchor="middle" className="fill-muted-foreground" fontSize={12} fontFamily="monospace" fontWeight="500">Time</text>
          <text x={18} y={marginTop + chartHeight / 2} textAnchor="middle" className="fill-muted-foreground" fontSize={12} fontFamily="monospace" fontWeight="500" transform={`rotate(-90, 18, ${marginTop + chartHeight / 2})`}>
            {viewMode === 'price' ? 'Price ($)' : viewMode === 'pnl' ? 'P&L ($)' : 'Return (%)'}
          </text>
        </svg>
      </div>

      {/* Crosshair Data Panel - fixed position with clear text */}
      {showCrosshair && crosshairData && crosshairPos && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <div className="bg-card rounded-lg px-5 py-2.5 border border-border">
            <div className="flex items-center gap-8 text-sm font-mono">
              <span className="text-muted-foreground font-medium">T: <span className="text-foreground font-bold">{Math.round(crosshairData.time / 21)}M</span></span>
              <span className="text-[#f0426c] font-semibold">5%: {yFormat(crosshairData.p5)}</span>
              <span className="text-[#e8e8e8] font-semibold">50%: {yFormat(crosshairData.p50)}</span>
              <span className="text-[#21b3a4] font-semibold">95%: {yFormat(crosshairData.p95)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-2 text-foreground">
            
            <span className="font-semibold font-mono">MONTE CARLO</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground cursor-help" /></TooltipTrigger>
                <TooltipContent className="max-w-sm font-mono"><p className="text-sm">dS = μS dt + σS dW</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className={`px-3 py-1 rounded text-xs font-mono bg-[#262626] border border-border ${stats.sharpeRatio > 1 ? 'text-[#21b3a4]' : stats.sharpeRatio > 0.5 ? 'text-[#c58435]' : 'text-[#f0426c]'}`}>
            SR: {stats.sharpeRatio.toFixed(2)}
          </div>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.min(5, z * 1.2))} className="bg-card h-8 w-8 p-0 text-foreground hover:text-foreground">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.max(0.5, z * 0.8))} className="bg-card h-8 w-8 p-0 text-foreground hover:text-foreground">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={resetView} className="bg-card h-8 w-8 p-0 text-foreground hover:text-foreground">
            <Move className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border" />
          <Button variant="outline" size="sm" onClick={isPlaying ? handlePause : handlePlay} className="bg-card gap-1 text-foreground hover:text-foreground">
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span className="hidden md:inline">{isPlaying ? 'Pause' : 'Run'}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset} className="bg-card h-8 w-8 p-0 text-foreground hover:text-foreground">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border" />
          <Button variant="outline" size="sm" onClick={toggleFullscreen} className="bg-card h-8 w-8 p-0 text-foreground hover:text-foreground">
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Left Panel */}
      <div className="absolute left-4 top-20 w-56 space-y-2 pointer-events-auto max-h-[calc(100%-120px)] overflow-y-auto">
        <Collapsible open={showParams} onOpenChange={setShowParams}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-foreground hover:text-foreground">
              <span className="flex items-center gap-2"><Settings className="h-4 w-4" /> PARAMETERS</span>
              {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-4 text-foreground">
              <div className="space-y-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label className="text-xs text-muted-foreground flex items-center gap-1 font-mono cursor-help">
                        <DollarSign className="h-3 w-3" /> INVESTMENT
                        <Info className="h-3 w-3 ml-1 opacity-50" />
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">Your starting capital. This is the amount you're investing at the beginning.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Input type="number" value={investment} onChange={(e) => setInvestment(Math.max(100, parseInt(e.target.value) || 0))} className="h-8 font-mono" />
              </div>
              <div className="space-y-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label className="text-xs text-muted-foreground flex items-center gap-1 font-mono cursor-help">
                        <Target className="h-3 w-3" /> TARGET RETURN
                        <Info className="h-3 w-3 ml-1 opacity-50" />
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">Your goal return %. The simulation will show probability of hitting this target.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Input type="number" value={targetReturn} onChange={(e) => setTargetReturn(parseFloat(e.target.value) || 0)} className="h-8 font-mono" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground font-mono">VIEW MODE</Label>
                <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                  <SelectTrigger className="h-8 font-mono"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pnl" className="font-mono">P&L ($)</SelectItem>
                    <SelectItem value="return" className="font-mono">Return (%)</SelectItem>
                    <SelectItem value="price" className="font-mono">Price</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground font-mono">TIME HORIZON</Label>
                <Select value={previewParams.timeHorizon.toString()} onValueChange={(v) => setPreviewParams(p => ({ ...p, timeHorizon: parseInt(v) }))}>
                  <SelectTrigger className="h-8 font-mono"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="63" className="font-mono">3 Months</SelectItem>
                    <SelectItem value="126" className="font-mono">6 Months</SelectItem>
                    <SelectItem value="252" className="font-mono">1 Year</SelectItem>
                    <SelectItem value="504" className="font-mono">2 Years</SelectItem>
                    <SelectItem value="1260" className="font-mono">5 Years</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Model Parameters with Tooltips */}
              <div className="pt-2 border-t border-border space-y-4">
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">Model Assumptions</div>

                <div className="space-y-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex justify-between font-mono cursor-help">
                          <Label className="text-xs text-muted-foreground flex items-center gap-1">
                            ENTRY PRICE
                            <Info className="h-3 w-3 opacity-50" />
                          </Label>
                          <span className="text-xs text-foreground">${previewParams.initialPrice}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">Starting asset price. Could be a stock, ETF, crypto, commodity, or any tradeable asset.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Slider value={[previewParams.initialPrice]} onValueChange={([v]) => setPreviewParams(p => ({ ...p, initialPrice: v }))} min={10} max={500} step={10} />
                </div>

                <div className="space-y-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex justify-between font-mono cursor-help">
                          <Label className="text-xs text-muted-foreground flex items-center gap-1">
                            EXPECTED RETURN
                            <Info className="h-3 w-3 opacity-50" />
                          </Label>
                          <span className="text-xs text-foreground">{(previewParams.drift * 100).toFixed(0)}%/yr</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">Annual expected return (μ). Historical S&P500 ~8-10%, Bitcoin ~50-100%, Bonds ~3-5%.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Slider value={[previewParams.drift * 100]} onValueChange={([v]) => setPreviewParams(p => ({ ...p, drift: v / 100 }))} min={-20} max={50} step={1} />
                </div>

                <div className="space-y-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex justify-between font-mono cursor-help">
                          <Label className="text-xs text-muted-foreground flex items-center gap-1">
                            VOLATILITY
                            <Info className="h-3 w-3 opacity-50" />
                          </Label>
                          <span className="text-xs text-foreground">{(previewParams.volatility * 100).toFixed(0)}%</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">Annual volatility (σ). Higher = more risk. S&P500 ~15-20%, crypto ~50-80%, bonds ~5-10%.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Slider value={[previewParams.volatility * 100]} onValueChange={([v]) => setPreviewParams(p => ({ ...p, volatility: v / 100 }))} min={5} max={80} step={5} />
                </div>

                <div className="space-y-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex justify-between font-mono cursor-help">
                          <Label className="text-xs text-muted-foreground flex items-center gap-1">
                            SIMULATIONS
                            <Info className="h-3 w-3 opacity-50" />
                          </Label>
                          <span className="text-xs text-foreground">{previewParams.numSimulations}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">Number of random scenarios to simulate. More = better statistics but slower rendering.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Slider value={[previewParams.numSimulations]} onValueChange={([v]) => setPreviewParams(p => ({ ...p, numSimulations: v }))} min={25} max={200} step={25} />
                </div>

                <Button
                  onClick={handleRunSimulation}
                  disabled={isComputing}
                  className="w-full bg-[#343434] hover:bg-[#3a3a3a] text-foreground font-mono"
                >
                  {isComputing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      COMPUTING...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      RUN SIMULATION
                    </>
                  )}
                </Button>
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={showVisuals} onOpenChange={setShowVisuals}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-foreground hover:text-foreground">
              <span className="flex items-center gap-2"><Eye className="h-4 w-4" /> DISPLAY</span>
              {showVisuals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-4 text-foreground">
              <ColorSchemeSelector value={colorScheme.id} onChange={setColorScheme} />

              {/* Toggle Options with clear labels */}
              <div className="space-y-2">
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">Chart Elements</div>

                <div className="flex items-center justify-between p-1.5 rounded-md hover:bg-muted/50 transition-colors">
                  <Label className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Fan Chart
                  </Label>
                  <Switch checked={showFanChart} onCheckedChange={setShowFanChart} />
                </div>

                <div className="flex items-center justify-between p-1.5 rounded-md hover:bg-muted/50 transition-colors">
                  <Label className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Individual Paths
                  </Label>
                  <Switch checked={showPaths} onCheckedChange={setShowPaths} />
                </div>

                <div className="flex items-center justify-between p-1.5 rounded-md hover:bg-muted/50 transition-colors">
                  <Label className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Histogram
                  </Label>
                  <Switch checked={showDistribution} onCheckedChange={setShowDistribution} />
                </div>

                <div className="flex items-center justify-between p-1.5 rounded-md hover:bg-muted/50 transition-colors">
                  <Label className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                    <Crosshair className="h-3.5 w-3.5" />
                    Crosshair
                  </Label>
                  <Switch checked={showCrosshair} onCheckedChange={setShowCrosshair} />
                </div>

                <div className="flex items-center justify-between p-1.5 rounded-md hover:bg-muted/50 transition-colors">
                  <Label className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                    <Target className="h-3.5 w-3.5" />
                    Target Line
                  </Label>
                  <Switch checked={showTargetLine} onCheckedChange={setShowTargetLine} />
                </div>

                <div className="flex items-center justify-between p-1.5 rounded-md hover:bg-muted/50 transition-colors">
                  <Label className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Median Line
                  </Label>
                  <Switch checked={showMedianLine} onCheckedChange={setShowMedianLine} />
                </div>

                <div className="flex items-center justify-between p-1.5 rounded-md hover:bg-muted/50 transition-colors">
                  <Label className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                    <DollarSign className="h-3.5 w-3.5" />
                    Break-Even Line
                  </Label>
                  <Switch checked={showBreakEvenLine} onCheckedChange={setShowBreakEvenLine} />
                </div>
              </div>

              {showPaths && (
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="flex justify-between font-mono">
                    <Label className="text-xs text-muted-foreground">Path Opacity</Label>
                    <span className="text-xs">{(pathOpacity * 100).toFixed(0)}%</span>
                  </div>
                  <Slider value={[pathOpacity * 100]} onValueChange={([v]) => setPathOpacity(v / 100)} min={5} max={50} step={5} />
                </div>
              )}

              {/* Highlighted Paths Section */}
              <div className="pt-3 border-t border-border space-y-3">
                <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">Path Tracking</div>

                <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label className="text-xs text-muted-foreground font-mono flex items-center gap-2 cursor-help">
                          <Focus className="h-3.5 w-3.5" />
                          Highlight Only
                          <Info className="h-3 w-3 opacity-40" />
                        </Label>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">When enabled, only selected paths are visible. Others are hidden.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Switch checked={showHighlightedOnly} onCheckedChange={setShowHighlightedOnly} />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between font-mono">
                    <Label className="text-xs text-muted-foreground"># of Paths to Track</Label>
                    <span className="text-xs">{numHighlightedPaths}</span>
                  </div>
                  <Slider
                    value={[numHighlightedPaths]}
                    onValueChange={([v]) => setNumHighlightedPaths(v)}
                    min={1}
                    max={20}
                    step={1}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={regenerateHighlightedPaths}
                  className="w-full gap-2 text-xs font-mono"
                >
                  <Shuffle className="h-3 w-3" /> Pick Random Paths
                </Button>
                {highlightedPaths.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {highlightedPaths.map((idx, i) => {
                      // Muted categorical set so tracked paths stay distinguishable without neon
              const colors = ['#f0426c', '#21b3a4', '#c58435', '#e8e8e8', '#8f86ad', '#7da0a8', '#b0748f', '#96a86e'];
                      return (
                        <button
                          key={idx}
                          onClick={() => setHighlightedPaths(prev => prev.filter(x => x !== idx))}
                          className="text-[10px] px-1.5 py-0.5 rounded font-mono hover:opacity-70 transition-opacity cursor-pointer flex items-center gap-1"
                          style={{ backgroundColor: `${colors[i % colors.length]}33`, color: colors[i % colors.length] }}
                          title="Click to remove"
                        >
                          #{idx + 1} ×
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Right Panel - Outcomes */}
      <div className="absolute right-4 top-20 w-52 pointer-events-auto max-h-[calc(100%-120px)] overflow-y-auto">
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-foreground hover:text-foreground">
              <span className="flex items-center gap-2"><Info className="h-4 w-4" /> OUTCOMES</span>
              {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-3 bg-card border-border space-y-3 max-h-[400px] overflow-y-auto text-foreground">
              {/* Probability Stats */}
              <div>
                <div className="flex justify-between mb-1 font-mono"><span className="text-xs text-muted-foreground">P(PROFIT)</span><span className={`text-sm font-bold ${stats.winRate >= 0.5 ? 'text-[#21b3a4]' : 'text-[#f0426c]'}`}>{(stats.winRate * 100).toFixed(0)}%</span></div>
                <div className="w-full bg-muted h-1.5 rounded"><div className={`h-full rounded ${stats.winRate >= 0.5 ? 'bg-[#21b3a4]' : 'bg-[#f0426c]'}`} style={{ width: `${stats.winRate * 100}%` }} /></div>
              </div>
              <div>
                <div className="flex justify-between mb-1 font-mono"><span className="text-xs text-muted-foreground">P(+{targetReturn}%)</span><span className={`text-sm font-bold ${stats.probTarget >= 0.5 ? 'text-[#21b3a4]' : 'text-[#c58435]'}`}>{(stats.probTarget * 100).toFixed(0)}%</span></div>
                <div className="w-full bg-muted h-1.5 rounded"><div className="h-full rounded bg-[#b0b0b0]" style={{ width: `${stats.probTarget * 100}%` }} /></div>
              </div>
              <div className="flex justify-between font-mono"><span className="text-xs text-muted-foreground">E[PORTFOLIO]</span><span className={`text-sm ${stats.expectedPortfolio > investment ? 'text-[#21b3a4]' : 'text-[#f0426c]'}`}>${stats.expectedPortfolio.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>

              {/* Percentile Stats */}
              <div className="pt-2 border-t border-border space-y-2 font-mono">
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">VaR 5%</span><span className="text-sm text-[#f0426c]">{yFormat(stats.p5)}</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">MEDIAN</span><span className="text-sm text-[#e8e8e8]">{yFormat(stats.p50)}</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">95th</span><span className="text-sm text-[#21b3a4]">{yFormat(stats.p95)}</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">STD DEV</span><span className="text-sm text-muted-foreground">{yFormat(stats.stdDev)}</span></div>
              </div>

              {/* Best & Worst Performers */}
              <div className="pt-2 border-t border-border space-y-2">
                <div className="text-xs text-muted-foreground font-mono mb-2">TOP PERFORMERS</div>
                {stats.top5Paths.slice(0, 3).map((p, i) => (
                  <button
                    key={p.index}
                    onClick={() => setHighlightedPaths(prev =>
                      prev.includes(p.index) ? prev.filter(x => x !== p.index) : [...prev, p.index]
                    )}
                    className={`w-full flex items-center justify-between p-1.5 rounded text-xs font-mono transition-all ${highlightedPaths.includes(p.index)
                      ? 'bg-[#262626] border border-border'
                      : 'hover:bg-muted/50'
                      }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="text-muted-foreground">#{p.index + 1}</span>
                      {i === 0 && <span className="text-[9px] px-1 py-0.5 rounded bg-[#262626] border border-border text-[#21b3a4]">BEST</span>}
                    </span>
                    <span className="text-[#21b3a4] font-semibold">{yFormat(p.finalValue)}</span>
                  </button>
                ))}

                <div className="text-xs text-muted-foreground font-mono mt-3 mb-2">WORST PERFORMERS</div>
                {stats.bottom5Paths.slice(0, 3).map((p, i) => (
                  <button
                    key={p.index}
                    onClick={() => setHighlightedPaths(prev =>
                      prev.includes(p.index) ? prev.filter(x => x !== p.index) : [...prev, p.index]
                    )}
                    className={`w-full flex items-center justify-between p-1.5 rounded text-xs font-mono transition-all ${highlightedPaths.includes(p.index)
                      ? 'bg-[#262626] border border-border'
                      : 'hover:bg-muted/50'
                      }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="text-muted-foreground">#{p.index + 1}</span>
                      {i === 0 && <span className="text-[9px] px-1 py-0.5 rounded bg-[#262626] border border-border text-[#f0426c]">WORST</span>}
                    </span>
                    <span className="text-[#f0426c] font-semibold">{yFormat(p.finalValue)}</span>
                  </button>
                ))}

                {/* Median Path */}
                <button
                  onClick={() => setHighlightedPaths(prev =>
                    prev.includes(stats.medianPath.index) ? prev.filter(x => x !== stats.medianPath.index) : [...prev, stats.medianPath.index]
                  )}
                  className={`w-full flex items-center justify-between p-1.5 rounded text-xs font-mono transition-all mt-2 ${highlightedPaths.includes(stats.medianPath.index)
                    ? 'bg-[#262626] border border-border'
                    : 'hover:bg-muted/50'
                    }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: stats.medianPath.color }} />
                    <span className="text-muted-foreground">#{stats.medianPath.index + 1}</span>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-[#262626] border border-border text-[#b0b0b0]">MEDIAN</span>
                  </span>
                  <span className="text-[#e8e8e8] font-semibold">{yFormat(stats.medianPath.finalValue)}</span>
                </button>
              </div>

              {/* Quick Actions */}
              {highlightedPaths.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHighlightedPaths([])}
                    className="w-full text-xs font-mono"
                  >
                    Clear {highlightedPaths.length} Selected
                  </Button>
                </div>
              )}

              {/* Color Scale */}
              <div className="pt-2 border-t border-border">
                <div className="flex h-3 rounded overflow-hidden">{colorScheme.colors.slice(0, 5).map((color, i) => (<div key={i} className="flex-1" style={{ backgroundColor: color }} />))}</div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1 font-mono"><span>LOSS</span><span>GAIN</span></div>
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-4 text-xs text-muted-foreground font-mono text-foreground">
          <span>Scroll: Zoom</span>
          <span className="text-border">•</span>
          <span>Drag: Pan</span>
          <span className="text-border">•</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-[#343434] text-foreground">{(zoom * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}
