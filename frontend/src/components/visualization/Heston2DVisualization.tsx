import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Play, Pause, RotateCcw, Activity, Info, ChevronDown, ChevronUp, Settings, Eye, Layers, ZoomIn, ZoomOut, Move, Crosshair, Maximize, Minimize } from 'lucide-react';
import { HestonParams, ColorScheme, COLOR_SCHEMES } from './types';
import ColorSchemeSelector from './ColorSchemeSelector';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

function correlatedNormals(rho: number): [number, number] {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const z2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
  return [z1, rho * z1 + Math.sqrt(1 - rho * rho) * z2];
}

interface PathData {
  prices: number[];
  vols: number[];
  finalPrice: number;
  finalVol: number;
  color: string;
}

export default function Heston2DVisualization() {
  const [params, setParams] = useState<HestonParams>({
    spotPrice: 100, v0: 0.04, kappa: 2.0, theta: 0.04, sigma: 0.3, rho: -0.7, T: 1, numPaths: 100
  });
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(1);
  const [showVolPaths, setShowVolPaths] = useState(true);
  const [showPricePaths, setShowPricePaths] = useState(true);
  const [showFanChart, setShowFanChart] = useState(true);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(COLOR_SCHEMES[4]);
  const [pathOpacity, setPathOpacity] = useState(0.2);
  const [showParams, setShowParams] = useState(true);
  const [showVisuals, setShowVisuals] = useState(false);
  const [showStats, setShowStats] = useState(true);
  
  // Zoom & Pan
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number } | null>(null);
  const [crosshairData, setCrosshairData] = useState<{ time: number; priceP50: number; volP50: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const progressRef = useRef(progress);
  const lastPanPos = useRef({ x: 0, y: 0 });

  const steps = 252;
  
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

  // Generate simulation paths
  const { paths, pricePercentiles, volPercentiles } = useMemo(() => {
    const result: PathData[] = [];
    const dt = params.T / steps;
    const allPrices: number[][] = [];
    const allVols: number[][] = [];
    
    for (let sim = 0; sim < params.numPaths; sim++) {
      const prices: number[] = [];
      const vols: number[] = [];
      let S = params.spotPrice, v = params.v0;
      
      for (let t = 0; t <= steps; t++) {
        prices.push(S);
        vols.push(Math.sqrt(Math.max(v, 0)) * 100);
        
        if (t < steps) {
          const [dW_S, dW_v] = correlatedNormals(params.rho);
          const vPlus = Math.max(v, 0);
          const sqrtV = Math.sqrt(vPlus);
          S = S * Math.exp(-0.5 * vPlus * dt + sqrtV * Math.sqrt(dt) * dW_S);
          v = v + params.kappa * (params.theta - vPlus) * dt + params.sigma * sqrtV * Math.sqrt(dt) * dW_v;
          v = Math.max(v, 0.0001);
        }
      }
      
      allPrices.push(prices);
      allVols.push(vols);
      result.push({ prices, vols, finalPrice: S, finalVol: Math.sqrt(v) * 100, color: '' });
    }
    
    const pricePctiles = { p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[] };
    const volPctiles = { p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[] };
    
    for (let t = 0; t <= steps; t++) {
      const pricesAtT = allPrices.map(p => p[t]).sort((a, b) => a - b);
      const volsAtT = allVols.map(v => v[t]).sort((a, b) => a - b);
      
      pricePctiles.p5.push(pricesAtT[Math.floor(pricesAtT.length * 0.05)]);
      pricePctiles.p25.push(pricesAtT[Math.floor(pricesAtT.length * 0.25)]);
      pricePctiles.p50.push(pricesAtT[Math.floor(pricesAtT.length * 0.50)]);
      pricePctiles.p75.push(pricesAtT[Math.floor(pricesAtT.length * 0.75)]);
      pricePctiles.p95.push(pricesAtT[Math.floor(pricesAtT.length * 0.95)]);
      
      volPctiles.p5.push(volsAtT[Math.floor(volsAtT.length * 0.05)]);
      volPctiles.p25.push(volsAtT[Math.floor(volsAtT.length * 0.25)]);
      volPctiles.p50.push(volsAtT[Math.floor(volsAtT.length * 0.50)]);
      volPctiles.p75.push(volsAtT[Math.floor(volsAtT.length * 0.75)]);
      volPctiles.p95.push(volsAtT[Math.floor(volsAtT.length * 0.95)]);
    }
    
    const finals = result.map(p => p.finalPrice);
    const minV = Math.min(...finals), maxV = Math.max(...finals);
    result.forEach(p => { p.color = colorScheme.getColor(p.finalPrice, minV, maxV); });
    
    return { paths: result, pricePercentiles: pricePctiles, volPercentiles: volPctiles };
  }, [params, colorScheme, steps]);

  // Statistics
  const stats = useMemo(() => {
    const finalPrices = paths.map(p => p.finalPrice);
    const finalVols = paths.map(p => p.finalVol);
    const meanPrice = finalPrices.reduce((a, b) => a + b, 0) / finalPrices.length;
    const meanVol = finalVols.reduce((a, b) => a + b, 0) / finalVols.length;
    const sortedPrices = [...finalPrices].sort((a, b) => a - b);
    const fellerRatio = (2 * params.kappa * params.theta) / (params.sigma * params.sigma);
    const winRate = finalPrices.filter(p => p > params.spotPrice).length / finalPrices.length;
    
    return { 
      meanPrice, meanVol, 
      var5: sortedPrices[Math.floor(sortedPrices.length * 0.05)], 
      var95: sortedPrices[Math.floor(sortedPrices.length * 0.95)],
      fellerRatio, fellerSatisfied: fellerRatio >= 1,
      winRate
    };
  }, [paths, params]);

  // Chart dimensions
  const width = 1000, height = 550;
  const priceMargin = { top: 30, right: 60, bottom: 30, left: 70 };
  const volMargin = { top: 10, right: 60, bottom: 50, left: 70 };
  const priceHeight = 320, volHeight = 140;
  const chartWidth = width - priceMargin.left - priceMargin.right;

  // Scales with zoom - zoom works by shrinking the visible data range
  const { priceYScale, volYScale, xScale, priceYMin, priceYMax, volYMin, volYMax, inverseXScale } = useMemo(() => {
    const allPrices = paths.flatMap(p => p.prices);
    const allVols = paths.flatMap(p => p.vols);
    
    const dataPMin = Math.min(...allPrices) * 0.95, dataPMax = Math.max(...allPrices) * 1.05;
    const dataVMin = Math.min(...allVols) * 0.9, dataVMax = Math.max(...allVols) * 1.1;
    
    // Calculate visible range based on zoom
    const fullXRange = steps;
    const visibleXRange = fullXRange / zoom;
    const xCenter = fullXRange / 2 + panX * fullXRange;
    const xMin = xCenter - visibleXRange / 2;
    const xMax = xCenter + visibleXRange / 2;
    
    return {
      xScale: (t: number) => priceMargin.left + ((t - xMin) / (xMax - xMin)) * chartWidth,
      inverseXScale: (px: number) => xMin + ((px - priceMargin.left) / chartWidth) * (xMax - xMin),
      priceYScale: (v: number) => priceMargin.top + priceHeight - ((v - dataPMin) / (dataPMax - dataPMin)) * priceHeight,
      volYScale: (v: number) => priceMargin.top + priceHeight + volMargin.top + volHeight - ((v - dataVMin) / (dataVMax - dataVMin)) * volHeight,
      priceYMin: dataPMin, priceYMax: dataPMax, volYMin: dataVMin, volYMax: dataVMax
    };
  }, [paths, steps, chartWidth, zoom, panX, priceMargin, priceHeight, volMargin, volHeight]);

  // Track if mouse is over chart for wheel blocking
  const isMouseOverChart = useRef(false);
  
  // Use effect to properly attach non-passive wheel listener for zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const handleWheel = (e: WheelEvent) => {
      if (!isMouseOverChart.current) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(z => Math.max(0.5, Math.min(5, z * delta)));
    };
    
    const handleMouseEnter = () => { isMouseOverChart.current = true; };
    const handleMouseLeave = () => { isMouseOverChart.current = false; };
    
    // Block wheel at document level when over chart
    document.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('mouseenter', handleMouseEnter);
    container.addEventListener('mouseleave', handleMouseLeave);
    
    return () => {
      document.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mouseenter', handleMouseEnter);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsPanning(true);
    lastPanPos.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      const dx = (e.clientX - lastPanPos.current.x) / (chartWidth * zoom) * 2;
      setPanX(x => x - dx);
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      return; // Don't update crosshair while panning
    }
    
    // Crosshair - properly aligned with SVG coordinates
    if (svgRef.current && showCrosshair) {
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      const svgX = (e.clientX - rect.left) * scaleX;
      const svgY = (e.clientY - rect.top) * scaleY;
      
      if (svgX >= priceMargin.left && svgX <= priceMargin.left + chartWidth) {
        setCrosshairPos({ x: svgX, y: svgY });
        const time = Math.max(0, Math.min(steps, Math.round(inverseXScale(svgX))));
        setCrosshairData({
          time,
          priceP50: pricePercentiles.p50[time] || 0,
          volP50: volPercentiles.p50[time] || 0
        });
      } else {
        setCrosshairPos(null);
        setCrosshairData(null);
      }
    }
  }, [isPanning, chartWidth, zoom, width, height, priceMargin, showCrosshair, inverseXScale, steps, pricePercentiles, volPercentiles]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);
  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
    setCrosshairPos(null);
    setCrosshairData(null);
  }, []);

  // Animation
  const animate = useCallback(() => {
    if (progressRef.current < 1) {
      progressRef.current = Math.min(progressRef.current + 0.015, 1);
      setProgress(progressRef.current);
      animationRef.current = requestAnimationFrame(animate);
    } else {
      setIsPlaying(false);
    }
  }, []);

  const handlePlay = () => {
    if (progress >= 1) { progressRef.current = 0; setProgress(0); }
    setIsPlaying(true);
    animationRef.current = requestAnimationFrame(animate);
  };

  const handlePause = () => {
    setIsPlaying(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
  };

  const handleReset = () => { progressRef.current = 0; setProgress(0); handlePlay(); };
  const resetView = () => { setZoom(1); setPanX(0); setPanY(0); };

  const visibleSteps = Math.floor(steps * progress);

  const createBandPath = (upper: number[], lower: number[], yScale: (v: number) => number) => {
    const steps = Math.min(visibleSteps, upper.length - 1);
    let d = `M ${xScale(0)} ${yScale(upper[0])}`;
    for (let t = 1; t <= steps; t++) d += ` L ${xScale(t)} ${yScale(upper[t])}`;
    for (let t = steps; t >= 0; t--) d += ` L ${xScale(t)} ${yScale(lower[t])}`;
    d += ' Z';
    return d;
  };

  const timeLabels = [0, 0.25, 0.5, 0.75, 1].map(f => ({ value: Math.floor(steps * f), label: `${(f * params.T * 12).toFixed(0)}M` }));

  return (
    <div 
      ref={containerRef}
      className={`relative w-full bg-background rounded-lg overflow-hidden border border-border ${isFullscreen ? 'h-screen' : 'h-[calc(100vh-180px)] min-h-[600px]'}`}
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
    >
      <div 
        ref={chartAreaRef}
        className="absolute inset-0 flex items-center justify-center"
        style={{
          background: 'var(--bg, #1c1c1c)',
          touchAction: 'none',
          overscrollBehavior: 'none'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full h-full max-w-[1400px]" preserveAspectRatio="xMidYMid meet" style={{ cursor: isPanning ? 'grabbing' : 'crosshair' }}>
          <defs>
            <linearGradient id="priceFan95" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e8e8e8" stopOpacity="0.15" /><stop offset="100%" stopColor="#e8e8e8" stopOpacity="0.05" /></linearGradient>
            <linearGradient id="priceFan50" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e8e8e8" stopOpacity="0.3" /><stop offset="100%" stopColor="#e8e8e8" stopOpacity="0.1" /></linearGradient>
            <linearGradient id="volFan95" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c58435" stopOpacity="0.15" /><stop offset="100%" stopColor="#c58435" stopOpacity="0.05" /></linearGradient>
            <linearGradient id="volFan50" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c58435" stopOpacity="0.3" /><stop offset="100%" stopColor="#c58435" stopOpacity="0.1" /></linearGradient>
          </defs>

          {/* Clip paths */}
          <clipPath id="priceClip"><rect x={priceMargin.left} y={priceMargin.top} width={chartWidth} height={priceHeight} /></clipPath>
          <clipPath id="volClip"><rect x={priceMargin.left} y={priceMargin.top + priceHeight + volMargin.top} width={chartWidth} height={volHeight} /></clipPath>

          {/* Price Panel */}
          <g>
            {Array.from({ length: 4 }).map((_, i) => {
              const y = priceMargin.top + (priceHeight / 3) * i;
              const val = priceYMax - ((priceYMax - priceYMin) / 3) * i;
              return (
                <g key={`price-grid-${i}`}>
                  <line x1={priceMargin.left} y1={y} x2={priceMargin.left + chartWidth} y2={y} stroke="#2e2e2e" strokeWidth={1} />
                  <text x={priceMargin.left - 12} y={y + 4} textAnchor="end" fill="var(--dim, #b0b0b0)" fontSize={12} fontFamily="monospace" fontWeight="500">${val.toFixed(0)}</text>
                </g>
              );
            })}
            
            <g clipPath="url(#priceClip)">
              {showFanChart && visibleSteps > 0 && (
                <>
                  <path d={createBandPath(pricePercentiles.p95, pricePercentiles.p5, priceYScale)} fill="url(#priceFan95)" />
                  <path d={createBandPath(pricePercentiles.p75, pricePercentiles.p25, priceYScale)} fill="url(#priceFan50)" />
                </>
              )}

              <line x1={priceMargin.left} y1={priceYScale(params.spotPrice)} x2={priceMargin.left + chartWidth} y2={priceYScale(params.spotPrice)} stroke="var(--dim, #b0b0b0)" strokeWidth={1.5} strokeDasharray="6,4" />

              {showPricePaths && paths.map((path, i) => {
                const steps = Math.min(visibleSteps, path.prices.length - 1);
                if (steps < 1) return null;
                let d = `M ${xScale(0)} ${priceYScale(path.prices[0])}`;
                for (let t = 1; t <= steps; t++) d += ` L ${xScale(t)} ${priceYScale(path.prices[t])}`;
                return <path key={i} d={d} fill="none" stroke={path.color} strokeWidth={1} opacity={pathOpacity} />;
              })}

              {visibleSteps > 0 && (
                <path d={`M ${xScale(0)} ${priceYScale(pricePercentiles.p50[0])} ${pricePercentiles.p50.slice(1, visibleSteps + 1).map((v, t) => `L ${xScale(t + 1)} ${priceYScale(v)}`).join(' ')}`} fill="none" stroke="#e8e8e8" strokeWidth={2.5} />
              )}
            </g>

            <text x={priceMargin.left + chartWidth + 10} y={priceYScale(params.spotPrice) + 4} fill="var(--dim, #b0b0b0)" fontSize={11} fontFamily="monospace" fontWeight="500">S₀</text>
            <text x={18} y={priceMargin.top + priceHeight / 2} textAnchor="middle" fill="var(--dim, #b0b0b0)" fontSize={12} fontFamily="monospace" fontWeight="500" transform={`rotate(-90, 18, ${priceMargin.top + priceHeight / 2})`}>PRICE ($)</text>
          </g>

          {/* Volatility Panel */}
          <g>
            <line x1={priceMargin.left} y1={priceMargin.top + priceHeight + 5} x2={priceMargin.left + chartWidth} y2={priceMargin.top + priceHeight + 5} stroke="#2e2e2e" strokeWidth={1} />

            {Array.from({ length: 3 }).map((_, i) => {
              const y = priceMargin.top + priceHeight + volMargin.top + (volHeight / 2) * i;
              const val = volYMax - ((volYMax - volYMin) / 2) * i;
              return (
                <g key={`vol-grid-${i}`}>
                  <line x1={priceMargin.left} y1={y} x2={priceMargin.left + chartWidth} y2={y} stroke="#2e2e2e" strokeWidth={1} />
                  <text x={priceMargin.left - 12} y={y + 4} textAnchor="end" fill="var(--dim, #b0b0b0)" fontSize={12} fontFamily="monospace" fontWeight="500">{val.toFixed(0)}%</text>
                </g>
              );
            })}

            <g clipPath="url(#volClip)">
              {showFanChart && showVolPaths && visibleSteps > 0 && (
                <>
                  <path d={createBandPath(volPercentiles.p95, volPercentiles.p5, volYScale)} fill="url(#volFan95)" />
                  <path d={createBandPath(volPercentiles.p75, volPercentiles.p25, volYScale)} fill="url(#volFan50)" />
                </>
              )}

              <line x1={priceMargin.left} y1={volYScale(Math.sqrt(params.theta) * 100)} x2={priceMargin.left + chartWidth} y2={volYScale(Math.sqrt(params.theta) * 100)} stroke="#c58435" strokeWidth={1.5} strokeDasharray="6,4" />

              {showVolPaths && paths.map((path, i) => {
                const steps = Math.min(visibleSteps, path.vols.length - 1);
                if (steps < 1) return null;
                let d = `M ${xScale(0)} ${volYScale(path.vols[0])}`;
                for (let t = 1; t <= steps; t++) d += ` L ${xScale(t)} ${volYScale(path.vols[t])}`;
                return <path key={`vol-${i}`} d={d} fill="none" stroke={path.color} strokeWidth={1} opacity={pathOpacity * 0.7} />;
              })}

              {showVolPaths && visibleSteps > 0 && (
                <path d={`M ${xScale(0)} ${volYScale(volPercentiles.p50[0])} ${volPercentiles.p50.slice(1, visibleSteps + 1).map((v, t) => `L ${xScale(t + 1)} ${volYScale(v)}`).join(' ')}`} fill="none" stroke="#c58435" strokeWidth={2.5} />
              )}
            </g>

            <text x={priceMargin.left + chartWidth + 10} y={volYScale(Math.sqrt(params.theta) * 100) + 4} fill="#c58435" fontSize={11} fontFamily="monospace" fontWeight="500">√θ</text>
            <text x={18} y={priceMargin.top + priceHeight + volMargin.top + volHeight / 2} textAnchor="middle" fill="var(--dim, #b0b0b0)" fontSize={12} fontFamily="monospace" fontWeight="500" transform={`rotate(-90, 18, ${priceMargin.top + priceHeight + volMargin.top + volHeight / 2})`}>VOL (%)</text>
          </g>

          {/* Crosshair - cursor follows mouse exactly */}
          {showCrosshair && crosshairPos && crosshairData && (
            <g>
              {/* Vertical line at mouse X */}
              <line x1={crosshairPos.x} y1={priceMargin.top} x2={crosshairPos.x} y2={priceMargin.top + priceHeight + volMargin.top + volHeight} stroke="rgba(176,176,176,0.5)" strokeWidth={1} strokeDasharray="4,4" />
              {/* Horizontal line at mouse Y - only in price panel if cursor is there */}
              {crosshairPos.y >= priceMargin.top && crosshairPos.y <= priceMargin.top + priceHeight && (
                <line x1={priceMargin.left} y1={crosshairPos.y} x2={priceMargin.left + chartWidth} y2={crosshairPos.y} stroke="rgba(176,176,176,0.5)" strokeWidth={1} strokeDasharray="4,4" />
              )}
              {/* Horizontal line at mouse Y - only in vol panel if cursor is there */}
              {crosshairPos.y >= priceMargin.top + priceHeight + volMargin.top && crosshairPos.y <= priceMargin.top + priceHeight + volMargin.top + volHeight && (
                <line x1={priceMargin.left} y1={crosshairPos.y} x2={priceMargin.left + chartWidth} y2={crosshairPos.y} stroke="rgba(176,176,176,0.5)" strokeWidth={1} strokeDasharray="4,4" />
              )}
              {/* Cursor dot - follows mouse exactly */}
              <circle cx={crosshairPos.x} cy={crosshairPos.y} r={4} fill="#e8e8e8" />
              {/* Data point indicators at median values */}
              <circle cx={crosshairPos.x} cy={priceYScale(crosshairData.priceP50)} r={4} fill="#e8e8e8" />
              <circle cx={crosshairPos.x} cy={volYScale(crosshairData.volP50)} r={4} fill="#c58435" />
              {/* X-axis label */}
              <g transform={`translate(${crosshairPos.x}, ${priceMargin.top + priceHeight + volMargin.top + volHeight + 8})`}>
                <rect x={-22} y={0} width={44} height={20} rx={4} fill="var(--panel, #2a2a2a)" stroke="var(--edge, #3a3a3a)" strokeWidth={1.5} />
                <text x={0} y={14} textAnchor="middle" fill="var(--text, #e8e8e8)" fontSize={11} fontFamily="monospace" fontWeight="700">{Math.round(crosshairData.time / 21)}M</text>
              </g>
            </g>
          )}

          {/* X-axis */}
          {timeLabels.map(({ value, label }) => (
            <g key={value}>
              <line x1={xScale(value)} y1={priceMargin.top} x2={xScale(value)} y2={priceMargin.top + priceHeight + volMargin.top + volHeight} stroke="#2e2e2e" strokeWidth={1} />
              <text x={xScale(value)} y={height - 8} textAnchor="middle" fill="var(--dim, #b0b0b0)" fontSize={12} fontFamily="monospace" fontWeight="500">{label}</text>
            </g>
          ))}
          <text x={priceMargin.left + chartWidth / 2} y={height} textAnchor="middle" fill="#808080" fontSize={12} fontFamily="monospace" fontWeight="500">TIME</text>
        </svg>
      </div>

      {/* Crosshair Data Panel */}
      {showCrosshair && crosshairData && crosshairPos && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <div className="bg-card rounded-lg px-5 py-2.5 border border-border">
            <div className="flex items-center gap-8 text-sm font-mono">
              <span className="text-muted-foreground font-medium">T: <span className="text-white font-bold">{Math.round(crosshairData.time / 21)}M</span></span>
              <span className="text-[var(--text)] font-semibold">PRICE: ${crosshairData.priceP50.toFixed(2)}</span>
              <span className="text-[#c58435] font-semibold">VOL: {crosshairData.volP50.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-2 text-white">
            
            <span className="font-semibold font-mono">HESTON SV</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground cursor-help" /></TooltipTrigger>
                <TooltipContent className="max-w-sm font-mono"><p className="text-sm">dS = √v·S·dW₁, dv = κ(θ-v)dt + σ√v·dW₂</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className={`px-3 py-1 rounded text-xs font-mono bg-[var(--bg2)] border border-[var(--edge)] ${stats.fellerSatisfied ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
            FELLER: {stats.fellerRatio.toFixed(2)} {stats.fellerSatisfied ? '✓' : '✗'}
          </div>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.min(5, z * 1.2))} className="bg-card h-8 w-8 p-0 text-white hover:text-white">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.max(0.5, z * 0.8))} className="bg-card h-8 w-8 p-0 text-white hover:text-white">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={resetView} className="bg-card h-8 w-8 p-0 text-white hover:text-white">
            <Move className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border" />
          <Button variant="outline" size="sm" onClick={isPlaying ? handlePause : handlePlay} className="bg-card gap-1 text-white hover:text-white">
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span className="hidden md:inline">{isPlaying ? 'Pause' : 'Run'}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset} className="bg-card h-8 w-8 p-0 text-white hover:text-white">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border" />
          <Button variant="outline" size="sm" onClick={toggleFullscreen} className="bg-card h-8 w-8 p-0 text-white hover:text-white">
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Left Panel */}
      <div className="absolute left-4 top-20 w-72 space-y-2 pointer-events-auto max-h-[calc(100%-120px)] overflow-y-auto">
        <Collapsible open={showParams} onOpenChange={setShowParams}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-white hover:text-white">
              <span className="flex items-center gap-2"><Settings className="h-4 w-4" /> PARAMETERS</span>
              {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-3 text-white">
              <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-muted-foreground">SPOT (S₀)</Label><span className="text-xs">${params.spotPrice}</span></div><Slider value={[params.spotPrice]} onValueChange={([v]) => setParams(p => ({ ...p, spotPrice: v }))} min={50} max={200} step={10} /></div>
              <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-muted-foreground">INIT VOL (√v₀)</Label><span className="text-xs">{(Math.sqrt(params.v0) * 100).toFixed(0)}%</span></div><Slider value={[params.v0 * 100]} onValueChange={([v]) => setParams(p => ({ ...p, v0: v / 100 }))} min={1} max={25} step={0.5} /></div>
              <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-muted-foreground">KAPPA (κ)</Label><span className="text-xs">{params.kappa.toFixed(1)}</span></div><Slider value={[params.kappa * 10]} onValueChange={([v]) => setParams(p => ({ ...p, kappa: v / 10 }))} min={5} max={60} step={1} /></div>
              <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-muted-foreground">THETA (√θ)</Label><span className="text-xs">{(Math.sqrt(params.theta) * 100).toFixed(0)}%</span></div><Slider value={[params.theta * 100]} onValueChange={([v]) => setParams(p => ({ ...p, theta: v / 100 }))} min={1} max={25} step={0.5} /></div>
              <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-muted-foreground">SIGMA (σ)</Label><span className="text-xs">{(params.sigma * 100).toFixed(0)}%</span></div><Slider value={[params.sigma * 100]} onValueChange={([v]) => setParams(p => ({ ...p, sigma: v / 100 }))} min={10} max={120} step={5} /></div>
              <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-muted-foreground">RHO (ρ)</Label><span className="text-xs">{params.rho.toFixed(2)}</span></div><Slider value={[(params.rho + 1) * 50]} onValueChange={([v]) => setParams(p => ({ ...p, rho: v / 50 - 1 }))} min={0} max={100} step={5} /></div>
              <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-muted-foreground">PATHS</Label><span className="text-xs">{params.numPaths}</span></div><Slider value={[params.numPaths]} onValueChange={([v]) => setParams(p => ({ ...p, numPaths: v }))} min={20} max={200} step={10} /></div>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={showVisuals} onOpenChange={setShowVisuals}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-white hover:text-white">
              <span className="flex items-center gap-2"><Eye className="h-4 w-4" /> DISPLAY</span>
              {showVisuals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-4 text-white">
              <ColorSchemeSelector value={colorScheme.id} onChange={setColorScheme} />
              <div className="flex items-center justify-between"><Label className="text-xs text-muted-foreground font-mono"><Layers className="h-3 w-3 inline mr-1" />FAN CHART</Label><Switch checked={showFanChart} onCheckedChange={setShowFanChart} /></div>
              <div className="flex items-center justify-between"><Label className="text-xs text-muted-foreground font-mono">PRICE PATHS</Label><Switch checked={showPricePaths} onCheckedChange={setShowPricePaths} /></div>
              <div className="flex items-center justify-between"><Label className="text-xs text-muted-foreground font-mono">VOL PATHS</Label><Switch checked={showVolPaths} onCheckedChange={setShowVolPaths} /></div>
              <div className="flex items-center justify-between"><Label className="text-xs text-muted-foreground font-mono"><Crosshair className="h-3 w-3 inline mr-1" />CROSSHAIR</Label><Switch checked={showCrosshair} onCheckedChange={setShowCrosshair} /></div>
              <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-muted-foreground">OPACITY</Label><span className="text-xs">{(pathOpacity * 100).toFixed(0)}%</span></div><Slider value={[pathOpacity * 100]} onValueChange={([v]) => setPathOpacity(v / 100)} min={5} max={50} step={5} /></div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Right Panel */}
      <div className="absolute right-4 top-20 w-56 pointer-events-auto">
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-white hover:text-white">
              <span className="flex items-center gap-2"><Info className="h-4 w-4" /> STATISTICS</span>
              {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-3 bg-card border-border space-y-3 text-white">
              <div>
                <div className="flex justify-between mb-1 font-mono"><span className="text-xs text-muted-foreground">WIN RATE</span><span className={`text-sm font-bold ${stats.winRate >= 0.5 ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>{(stats.winRate * 100).toFixed(0)}%</span></div>
                <div className="w-full bg-muted h-1.5 rounded"><div className={`h-full rounded ${stats.winRate >= 0.5 ? 'bg-[var(--up)]' : 'bg-[var(--down)]'}`} style={{ width: `${stats.winRate * 100}%` }} /></div>
              </div>
              <div className="flex justify-between font-mono"><span className="text-xs text-muted-foreground">E[PRICE]</span><span className={`text-sm ${stats.meanPrice > params.spotPrice ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>${stats.meanPrice.toFixed(2)}</span></div>
              <div className="flex justify-between font-mono"><span className="text-xs text-muted-foreground">VaR 5%</span><span className="text-sm text-[var(--down)]">${stats.var5.toFixed(2)}</span></div>
              <div className="flex justify-between font-mono"><span className="text-xs text-muted-foreground">95th</span><span className="text-sm text-[var(--up)]">${stats.var95.toFixed(2)}</span></div>
              <div className="pt-2 border-t border-border space-y-2 font-mono">
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">E[VOL]</span><span className="text-sm">{stats.meanVol.toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">LEVERAGE</span><span className="text-sm">{params.rho < -0.5 ? 'STRONG' : params.rho < 0 ? 'MOD' : 'INV'}</span></div>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="flex h-3 rounded overflow-hidden">{colorScheme.colors.slice(0, 5).map((c, i) => (<div key={i} className="flex-1" style={{ backgroundColor: c }} />))}</div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1 font-mono"><span>LOW</span><span>HIGH</span></div>
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-4 text-xs text-muted-foreground font-mono text-white">
          <span>Scroll: Zoom</span>
          <span className="text-border">•</span>
          <span>Drag: Pan</span>
          <span className="text-border">•</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--text)]">{(zoom * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}
