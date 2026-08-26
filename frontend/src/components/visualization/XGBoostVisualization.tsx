/**
 * XGBoost Gradient Boosted Trees - Full Dashboard Visualization
 *
 * Comprehensive ML model dashboard designed for video walkthroughs and deep exploration.
 * All data is generated client-side with seeded PRNG that responds to hyperparameters.
 *
 * Dashboard layout:
 * - LEFT: Hyperparameters panel with full XGBoost config
 * - CENTER: 5 view modes (Feature Importance, Decision Tree, Learning Curves, SHAP, Predictions)
 * - RIGHT: Live statistics panel with model metrics, training diagnostics, feature analysis
 *
 * Each view is enriched with:
 * - Feature Importance: cumulative importance line, top-N annotation, rank badges
 * - Decision Tree: sample flow thickness, gain heatmap coloring, depth indicators
 * - Learning Curves: overfitting zone shading, best round marker, loss gradient bars
 * - SHAP: mean |SHAP| sidebar bars, interaction indicators, correlation arrows
 * - Predictions: residual histogram, error distribution, confidence bands
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Settings, ChevronDown, ChevronUp, RotateCcw
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ============================================================================
// Seeded PRNG (mulberry32) for deterministic outputs across re-renders.
// Same seed always produces identical "random" data, preventing visual jitter.
// ============================================================================
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Trading-relevant feature names: realistic indicators a quant would feed
// into an XGBoost model for financial time series prediction
// ============================================================================
// Features a real quant/prop desk would actually feed into an XGBoost model.
// Mix of price action, volume, volatility, correlation, flow, and macro.
// Nothing purely theoretical; everything here is computable from market data.
const FEATURE_NAMES = [
  // Price action and volatility
  'ATR(14)', 'Implied Vol', 'Realised Vol(5d)', 'Historical Vol(20d)', 'Intraday Range',
  'Close-Open %', 'High-Low %', 'Gap %', 'IV Percentile', 'IV Rank',
  // Momentum and trend strength
  'ROC(12)', 'Rate of Change(5)', 'Momentum(10)', 'ADX', 'DI+ / DI- Spread',
  'Aroon Oscillator', 'TRIX(15)', 'Coppock Curve', 'MACD Histogram', 'MACD Divergence',
  // Moving averages and crossovers
  'SMA(50) Distance', 'EMA(21) Distance', 'SMA 50/200 Cross', 'EMA 9/21 Cross', 'DEMA(14)',
  'TEMA(14)', 'Hull MA(9)', 'KAMA(10)', 'ZLEMA(14)', 'MA Ribbon Width',
  // Oscillators and mean-reversion
  'RSI(14)', 'Stochastic %K', 'Stochastic %D', 'CCI(20)', 'Williams %R',
  'MFI(14)', 'Bollinger %B', 'Bollinger Width', 'Keltner %K', 'Z-Score(20)',
  // Volume and flow
  'VWAP Deviation', 'Volume Ratio', 'OBV Slope', 'CMF(21)', 'Volume Z-Score',
  'Relative Volume', 'Acc/Dist Slope', 'Volume Weighted RSI', 'VROC(14)', 'Net Volume',
  // Correlation and cross-asset
  'SPX Correlation', 'Sector Correlation', 'FX Correlation', 'Gold Correlation', 'Oil Correlation',
  'VIX Correlation', 'Bond Correlation', 'BTC Correlation', 'Pair Spread Z', 'Cross-Asset Mom',
  // Market regime
  'VIX Level', 'VIX 1m-3m Ratio', 'Put/Call Ratio', 'Gamma Exposure', 'Bid-Ask Spread',
  'Tick Imbalance', 'Dark Pool %', 'Hurst Exponent', 'Drawdown Depth', 'Time Since High',
  // Technical structure
  'Pivot Distance', 'Fib Retracement %', 'Ichimoku Cloud %', 'Elder Ray Bull', 'Donchian %',
  'Parabolic SAR Dist', 'SuperTrend Dir', 'Chandelier Exit', 'Price Channel %', 'Linear Reg Slope',
  // Candlestick and pattern features
  'Candle Body %', 'Upper Wick %', 'Lower Wick %', 'Doji Score', 'Engulfing Score',
  'Inside Bar', 'Pin Bar Score', 'Three Line Strike', 'Hammer Score', 'Shooting Star',
];

// ============================================================================
// Monochrome terminal palette: no neon, no color. Pure black/gray/white.
// Subtle warm/cool gray tints only where absolutely needed for data distinction.
// ============================================================================
const COLORS = {
  // Terminal palette hexes (SVG attrs cannot rely on CSS vars in all paths,
  // so the var(--x) fallback hexes are used directly here)
  emerald: '#e8e8e8',       // primary data series: terminal near-white
  emeraldLight: '#ffffff',  // hover emphasis on the primary series
  emeraldDark: '#b0b0b0',
  emeraldFaint: 'rgba(232,232,232,0.06)',
  red: '#f0426c',           // negative/risk role: terminal var(--down) rose
  redLight: '#f0426c',
  redFaint: 'rgba(240,66,108,0.06)',
  amber: '#c58435',         // secondary series (validation, cumulative): terminal muted amber
  amberLight: '#c58435',
  blue: '#b0b0b0',          // demoted to neutral dim: no blue accents in terminal chrome
  blueLight: '#b0b0b0',
  purple: '#b0b0b0',        // demoted to neutral dim
  cyan: '#b0b0b0',
  slate: '#808080',
  slateLight: 'rgba(176,176,176,0.5)', // crosshair line per terminal spec
  slateDark: '#3a3a3a',     // var(--edge)
  bg: '#1c1c1c',            // var(--bg)
  cardBg: '#2a2a2a',        // var(--panel)
  panelBg: '#1c1c1c',
  gridLine: '#2e2e2e',      // terminal grid line
  text: '#e8e8e8',          // var(--text)
  textDim: '#b0b0b0',       // var(--dim)
  textMuted: '#808080',     // faint
};

type ViewMode = 'importance' | 'tree' | 'learning' | 'shap' | 'scatter';

const VIEW_MODES: { id: ViewMode; label: string; desc: string }[] = [
  { id: 'importance', label: 'Feature Importance', desc: 'Which features drive predictions' },
  { id: 'tree', label: 'Decision Tree', desc: 'Single tree from ensemble' },
  { id: 'learning', label: 'Learning Curves', desc: 'Train vs validation loss' },
  { id: 'shap', label: 'SHAP Values', desc: 'Feature impact distribution' },
  { id: 'scatter', label: 'Predictions', desc: 'Actual vs predicted analysis' },
];

type Objective = 'reg:squarederror' | 'reg:logistic' | 'binary:logistic' | 'multi:softmax';

// ============================================================================
// DATA GENERATION FUNCTIONS
// All respond dynamically to hyperparameter changes
// ============================================================================

/** Feature importance with gain, weight, cover, and cumulative tracking.
 * colsampleBytree controls how many features each tree sees; lower values
 * concentrate importance on fewer features because the same top features
 * get selected repeatedly when the pool is small. */
function generateFeatureImportance(
  numFeatures: number, maxDepth: number, regLambda: number, regAlpha: number,
  colsampleBytree: number, seed: number
): { name: string; gain: number; weight: number; cover: number; cumGain: number }[] {
  const rng = mulberry32(seed);
  // Lower colsample_bytree concentrates importance on fewer features
  // because each tree only sees a subset, so the same strong features dominate
  const colEffect = 1 + (1 - colsampleBytree) * 0.5;
  const concentration = (1.5 + regLambda * 0.3 - maxDepth * 0.08) * colEffect;

  const features = FEATURE_NAMES.slice(0, numFeatures).map((name, i) => {
    const baseGain = Math.exp(-i * concentration * 0.15) * (0.7 + rng() * 0.6);
    const alphaEffect = regAlpha > 0 ? Math.max(0, baseGain - regAlpha * 0.02 * rng()) : baseGain;
    const gain = Math.max(0.001, alphaEffect);
    // Weight scales with colsample (fewer cols = fewer splits per feature)
    const weight = Math.floor(gain * 100 * (0.5 + rng() * 1.0) * colsampleBytree);
    const cover = Math.round(gain * 500 * (0.3 + rng() * 1.4));
    return { name, gain, weight, cover, cumGain: 0 };
  });

  const totalGain = features.reduce((s, f) => s + f.gain, 0);
  features.forEach(f => { f.gain /= totalGain; });
  features.sort((a, b) => b.gain - a.gain);

  // Compute cumulative importance (for the overlay line)
  let cumSum = 0;
  features.forEach(f => { cumSum += f.gain; f.cumGain = cumSum; });

  return features;
}

/** Tree node with gain, samples, and depth for visualization */
interface TreeNode {
  id: number;
  feature?: string;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
  leafValue?: number;
  samples: number;
  depth: number;
  gain?: number;
}

/** colsampleBytree limits how many features each tree can use for splits.
 * Lower values mean fewer candidate features per tree, which can produce
 * more diverse trees in the ensemble but shallower individual trees. */
function generateTree(maxDepth: number, numFeatures: number, minChildWeight: number,
  colsampleBytree: number, seed: number): TreeNode {
  const rng = mulberry32(seed + 42);
  let nodeId = 0;
  // colsample limits the feature pool for this tree
  const availableFeatures = Math.max(2, Math.floor(numFeatures * colsampleBytree));

  function buildNode(depth: number, parentSamples: number): TreeNode {
    const id = nodeId++;
    const samples = Math.max(Math.floor(minChildWeight), Math.floor(parentSamples * (0.3 + rng() * 0.4)));

    if (depth >= maxDepth || samples < minChildWeight * 2 || rng() < 0.1) {
      return { id, leafValue: (rng() - 0.5) * 2, samples, depth };
    }

    // Only pick from the subset of features available to this tree
    const featureIdx = Math.floor(rng() * Math.min(availableFeatures, FEATURE_NAMES.length));
    return {
      id, feature: FEATURE_NAMES[featureIdx],
      threshold: Math.round((rng() * 100 - 50) * 100) / 100,
      left: buildNode(depth + 1, samples),
      right: buildNode(depth + 1, parentSamples - samples),
      samples, depth, gain: rng() * 100,
    };
  }
  return buildNode(0, 1000);
}

/** Learning curves with train/val loss, overfitting detection, improvement rate.
 * subsample controls how much data each tree sees; lower values add noise to
 * training loss (more variance per round) but reduce overfitting because each
 * tree is trained on a different random subset. */
function generateLearningCurves(
  nEstimators: number, learningRate: number, maxDepth: number, regLambda: number,
  subsample: number, seed: number
): { round: number; trainLoss: number; valLoss: number; improvement: number }[] {
  const rng = mulberry32(seed + 100);
  const curves: { round: number; trainLoss: number; valLoss: number; improvement: number }[] = [];

  let prevValLoss = 1;
  for (let i = 0; i <= nEstimators; i++) {
    const t = i / nEstimators;
    const decayRate = learningRate * (1 + maxDepth * 0.15);
    // Lower subsample slows convergence (less data per tree = noisier gradients)
    const subsamplePenalty = 1 / (0.5 + subsample * 0.5);
    const trainNoise = rng() * 0.01 * subsamplePenalty;
    const trainLoss = 0.7 * Math.exp(-decayRate * t * 5 * subsample) + 0.02 + trainNoise;
    // Lower subsample REDUCES overfitting (acts as regularization)
    const overfitFactor = Math.max(0, t - 0.3 - regLambda * 0.05 - (1 - subsample) * 0.15) * maxDepth * 0.04;
    const valLoss = trainLoss + overfitFactor + 0.03 + rng() * 0.015;
    const tl = Math.max(0.01, trainLoss);
    const vl = Math.max(0.02, valLoss);
    // Track per-round improvement in validation loss for gradient bars
    const improvement = prevValLoss - vl;
    prevValLoss = vl;
    curves.push({ round: i, trainLoss: tl, valLoss: vl, improvement });
  }
  return curves;
}

/** SHAP values for beeswarm + mean absolute SHAP for sidebar */
function generateShapValues(
  numFeatures: number, numSamples: number, seed: number
): { feature: string; shapValue: number; featureValue: number }[][] {
  const rng = mulberry32(seed + 200);
  return FEATURE_NAMES.slice(0, numFeatures).map((_, fi) => {
    const importance = Math.exp(-fi * 0.25);
    return Array.from({ length: numSamples }, () => {
      const featureValue = rng();
      const shapValue = (featureValue - 0.5) * importance * (0.5 + rng() * 1.0) + (rng() - 0.5) * 0.05;
      return { feature: FEATURE_NAMES[fi], shapValue, featureValue };
    });
  });
}

/** Predictions with actual, predicted, and residual for histogram.
 * subsample reduces overfitting noise, colsampleBytree affects feature
 * utilization which impacts prediction variance. */
function generatePredictions(
  nEstimators: number, learningRate: number, maxDepth: number, regLambda: number,
  subsample: number, colsampleBytree: number, numPoints: number, seed: number
): { actual: number; predicted: number; residual: number }[] {
  const rng = mulberry32(seed + 300);
  // subsample and colsample both act as regularization, reducing overfit
  const regEffect = 1 + regLambda * 0.3 + (1 - subsample) * 0.5 + (1 - colsampleBytree) * 0.3;
  const quality = Math.min(0.95, 0.3 + Math.log(nEstimators + 1) * 0.12 * learningRate);
  const noise = maxDepth * 0.02 / regEffect;

  return Array.from({ length: numPoints }, () => {
    const actual = rng() * 2 - 1;
    const predicted = actual * quality + (rng() - 0.5) * (1 - quality) * 2 + (rng() - 0.5) * noise;
    return { actual, predicted, residual: actual - predicted };
  });
}

// ============================================================================
// FEATURE IMPORTANCE VIEW - Enhanced with cumulative line + rank badges
// ============================================================================
function FeatureImportanceView({
  features, importanceType, width, height
}: {
  features: ReturnType<typeof generateFeatureImportance>;
  importanceType: 'gain' | 'weight' | 'cover';
  width: number; height: number;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const margin = { top: 50, right: 80, bottom: 50, left: 140 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const barHeight = Math.min(26, innerH / features.length - 4);
  const maxVal = Math.max(...features.map(f => f[importanceType]));

  // Find the index where cumulative gain exceeds 80% (for annotation)
  const top80Idx = features.findIndex(f => f.cumGain >= 0.8);

  return (
    <svg width={width} height={height} className="select-none">
      {/* Title and subtitle */}
      <text x={margin.left + innerW / 2} y={20} textAnchor="middle" fill={COLORS.text} fontSize={14} fontWeight={600}>
        Feature Importance Analysis
      </text>
      <text x={margin.left + innerW / 2} y={36} textAnchor="middle" fill={COLORS.textDim} fontSize={10}>
        Sorted by {importanceType === 'gain' ? 'information gain' : importanceType === 'weight' ? 'split frequency' : 'sample coverage'}
        {' | '}{features.length} features
      </text>

      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* Background grid */}
        {[0, 0.25, 0.5, 0.75, 1.0].map(tick => (
          <g key={tick}>
            <line x1={tick * innerW} y1={0} x2={tick * innerW} y2={innerH} stroke={COLORS.gridLine} strokeDasharray="3,3" />
            <text x={tick * innerW} y={innerH + 16} textAnchor="middle" fill={COLORS.textDim} fontSize={9}>
              {(tick * maxVal).toFixed(importanceType === 'gain' ? 3 : 0)}
            </text>
          </g>
        ))}

        {/* Feature bars */}
        {features.map((f, i) => {
          const y = i * (innerH / features.length) + (innerH / features.length - barHeight) / 2;
          const barW = (f[importanceType] / maxVal) * innerW;
          const isHovered = hoveredIdx === i;
          const opacity = 0.35 + (1 - i / features.length) * 0.65;
          // Top-3 rank badges in terminal neutrals: amber accent for #1, then dim/faint
          const rankColor = i === 0 ? '#c58435' : i === 1 ? '#b0b0b0' : i === 2 ? '#808080' : null;

          return (
            <g key={f.name} onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)} style={{ cursor: 'pointer' }}>
              {/* Rank badge for top 3 */}
              {rankColor && (
                <g transform={`translate(-130, ${y + barHeight / 2})`}>
                  <circle r={8} fill={rankColor} opacity={0.2} />
                  <text textAnchor="middle" dy={3.5} fill={rankColor} fontSize={9} fontWeight={700}>
                    {i + 1}
                  </text>
                </g>
              )}

              {/* Feature name */}
              <text x={-8} y={y + barHeight / 2 + 4} textAnchor="end"
                fill={isHovered ? COLORS.emeraldLight : COLORS.text}
                fontSize={11} fontWeight={isHovered ? 600 : 400}>
                {f.name}
              </text>

              {/* Hover highlight row */}
              <rect x={0} y={y - 2} width={innerW} height={barHeight + 4}
                fill={isHovered ? 'rgba(255,255,255,0.03)' : 'transparent'} rx={3} />

              {/* Main importance bar */}
              <rect x={0} y={y} width={Math.max(2, barW)} height={barHeight}
                fill={COLORS.emerald} opacity={isHovered ? 1 : opacity} rx={3} />

              {/* Percentage label after bar */}
              <text x={Math.max(barW, 2) + 6} y={y + barHeight / 2 + 4}
                fill={COLORS.textDim} fontSize={9}>
                {importanceType === 'gain' ? `${(f.gain * 100).toFixed(1)}%` :
                  importanceType === 'weight' ? f.weight : f.cover}
              </text>

              {/* Value on bar (if wide enough). Bars are near-white, so on-bar text is dark to stay legible */}
              {barW > 50 && (
                <text x={barW - 6} y={y + barHeight / 2 + 4} textAnchor="end" fill="#1c1c1c" fontSize={9} fontWeight={500}>
                  {importanceType === 'gain' ? f.gain.toFixed(4) : importanceType === 'weight' ? f.weight : f.cover}
                </text>
              )}

              {/* Hover tooltip */}
              {isHovered && (
                <g transform={`translate(${Math.min(barW + 30, innerW - 140)}, ${y - 10})`}>
                  <rect x={0} y={0} width={135} height={65} rx={4} fill="#2a2a2a" stroke="#3a3a3a" strokeWidth={0.5} />
                  <text x={8} y={14} fill={COLORS.text} fontSize={9} fontWeight={600}>#{i + 1} {f.name}</text>
                  <text x={8} y={28} fill={COLORS.emerald} fontSize={9}>Gain: {f.gain.toFixed(4)} ({(f.gain * 100).toFixed(1)}%)</text>
                  <text x={8} y={41} fill={COLORS.blue} fontSize={9}>Frequency: {f.weight} splits</text>
                  <text x={8} y={54} fill={COLORS.amber} fontSize={9}>Coverage: {f.cover} samples</text>
                </g>
              )}
            </g>
          );
        })}

        {/* Cumulative importance line (overlaid, right y-axis) */}
        {importanceType === 'gain' && (
          <g>
            {features.map((f, i) => {
              const y = i * (innerH / features.length) + innerH / features.length / 2;
              const x = f.cumGain * innerW;
              const prevY = i > 0 ? (i - 1) * (innerH / features.length) + innerH / features.length / 2 : y;
              const prevX = i > 0 ? features[i - 1].cumGain * innerW : 0;
              return (
                <g key={`cum-${i}`}>
                  {i > 0 && (
                    <line x1={prevX} y1={prevY} x2={x} y2={y}
                      stroke={COLORS.amber} strokeWidth={1.5} strokeDasharray="4,2" opacity={0.7} />
                  )}
                  <circle cx={x} cy={y} r={3} fill={COLORS.amber} opacity={0.9} />
                  {/* Label cumulative % at right */}
                  {(i === features.length - 1 || i === top80Idx) && (
                    <text x={x + 8} y={y + 3} fill={COLORS.amber} fontSize={8}>
                      {(f.cumGain * 100).toFixed(0)}%
                    </text>
                  )}
                </g>
              );
            })}

            {/* 80% threshold annotation */}
            {top80Idx >= 0 && (
              <g>
                <line x1={0} y1={top80Idx * (innerH / features.length) + innerH / features.length / 2}
                  x2={innerW} y2={top80Idx * (innerH / features.length) + innerH / features.length / 2}
                  stroke={COLORS.amber} strokeDasharray="6,3" strokeWidth={0.5} opacity={0.4} />
                <text x={innerW} y={top80Idx * (innerH / features.length) + innerH / features.length / 2 - 5}
                  textAnchor="end" fill={COLORS.amber} fontSize={8} opacity={0.8}>
                  Top {top80Idx + 1} features = 80% importance
                </text>
              </g>
            )}
          </g>
        )}

        {/* Axis label */}
        <text x={innerW / 2} y={innerH + 35} textAnchor="middle" fill={COLORS.textDim} fontSize={10}>
          {importanceType === 'gain' ? 'Information Gain' : importanceType === 'weight' ? 'Number of Splits' : 'Average Sample Coverage'}
        </text>
      </g>

      {/* Right axis label for cumulative line */}
      {importanceType === 'gain' && (
        <text x={width - 10} y={margin.top + innerH / 2} textAnchor="middle" fill={COLORS.amber} fontSize={9}
          transform={`rotate(90, ${width - 10}, ${margin.top + innerH / 2})`}>
          Cumulative %
        </text>
      )}
    </svg>
  );
}

// ============================================================================
// DECISION TREE VIEW - Interactive pan/zoom, professional terminal aesthetic
//
// The tree is laid out in a large virtual canvas (wider than the viewport)
// so deep trees actually spread out properly. The user can:
//   - Scroll wheel to zoom in/out
//   - Click and drag to pan around
//   - Double-click to reset the view
// All colors are muted/monochrome to look like a real ML debugging tool,
// not a marketing demo. Monospace fonts throughout.
// ============================================================================
function DecisionTreeView({ tree, width, height }: { tree: TreeNode; width: number; height: number }) {
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Pan/zoom state: transform applied to the inner <g> group
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Layout the tree in a virtual coordinate space much wider than the viewport.
  // This ensures deep trees (depth 6+) don't overlap; the user pans/zooms to explore.
  const { positions, maxGain, maxSamples, maxDepthVal, treeWidth, treeHeight } = useMemo(() => {
    const pos: Map<number, { x: number; y: number; node: TreeNode }> = new Map();
    let mGain = 0;
    let mSamples = 0;

    function getMaxDepth(n: TreeNode): number {
      if (n.gain && n.gain > mGain) mGain = n.gain;
      if (n.samples > mSamples) mSamples = n.samples;
      if (!n.left && !n.right) return n.depth;
      return Math.max(n.left ? getMaxDepth(n.left) : 0, n.right ? getMaxDepth(n.right) : 0);
    }
    const maxD = getMaxDepth(tree);

    // Vertical spacing per level (tall enough for 62px high nodes plus edge labels)
    const levelH = 130;
    // Horizontal spread: start wide enough that leaf nodes at max depth don't collide.
    // Each level halves the spread, so the initial spread needs to be 2^maxD * nodeWidth.
    // Wide spacing to accommodate 240px wide split nodes
    const leafSpacing = 260;
    const initialSpread = leafSpacing * Math.pow(2, maxD - 1);
    const totalW = initialSpread * 2 + 200;
    const totalH = maxD * levelH + 100;

    function layout(node: TreeNode, x: number, y: number, spread: number) {
      pos.set(node.id, { x, y, node });
      if (node.left) layout(node.left, x - spread, y + levelH, spread * 0.5);
      if (node.right) layout(node.right, x + spread, y + levelH, spread * 0.5);
    }
    layout(tree, totalW / 2, 50, initialSpread / 2);

    return { positions: pos, maxGain: mGain, maxSamples: mSamples, maxDepthVal: maxD, treeWidth: totalW, treeHeight: totalH };
  }, [tree]);

  // Auto-fit: center the tree in the viewport on mount or when tree changes
  useEffect(() => {
    if (treeWidth <= 0 || treeHeight <= 0) return;
    // Fit the full tree into the viewport with some padding
    const scaleX = (width - 40) / treeWidth;
    const scaleY = (height - 40) / treeHeight;
    const fitZoom = Math.min(scaleX, scaleY, 1.2);
    setZoom(fitZoom);
    // Center the tree in the viewport
    setPan({
      x: (width - treeWidth * fitZoom) / 2,
      y: (height - treeHeight * fitZoom) / 2,
    });
  }, [treeWidth, treeHeight, width, height]);

  // Collect edges
  const edges = useMemo(() => {
    const result: { x1: number; y1: number; x2: number; y2: number; isYes: boolean; samples: number }[] = [];
    positions.forEach(({ x, y, node }) => {
      if (node.left) {
        const child = positions.get(node.left.id);
        if (child) result.push({ x1: x, y1: y, x2: child.x, y2: child.y, isYes: true, samples: node.left.samples });
      }
      if (node.right) {
        const child = positions.get(node.right.id);
        if (child) result.push({ x1: x, y1: y, x2: child.x, y2: child.y, isYes: false, samples: node.right.samples });
      }
    });
    return result;
  }, [positions]);

  // Node count stats for the header
  const nodeStats = useMemo(() => {
    let splits = 0, leaves = 0;
    positions.forEach(({ node }) => { if (node.feature) splits++; else leaves++; });
    return { splits, leaves, total: splits + leaves };
  }, [positions]);

  // Wheel zoom: must use a native event listener with { passive: false }
  // because React's synthetic onWheel is passive by default in modern browsers,
  // meaning e.preventDefault() is silently ignored. Without this, the browser
  // scrolls the page AND zooms the tree simultaneously.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();
      const rect = svg!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const currentZoom = zoomRef.current;
      const newZoom = Math.max(0.1, Math.min(5, currentZoom * delta));
      const scale = newZoom / currentZoom;
      setPan(p => ({
        x: mouseX - (mouseX - p.x) * scale,
        y: mouseY - (mouseY - p.y) * scale,
      }));
      setZoom(newZoom);
    }

    // { passive: false } is required to allow preventDefault on wheel events
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Drag-to-pan: attach mousemove/mouseup to window during drag so that
  // releasing the mouse ANYWHERE (even outside the SVG) properly ends the drag.
  // Without this, fast mouse movements can leave the SVG bounds and the drag
  // state gets stuck because mouseup never fires on the SVG element.
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  useEffect(() => {
    if (!isDragging) return;

    function onMove(e: MouseEvent) {
      setPan({
        x: dragStart.current.panX + (e.clientX - dragStart.current.x),
        y: dragStart.current.panY + (e.clientY - dragStart.current.y),
      });
    }
    function onUp() {
      setIsDragging(false);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  // Double-click to reset view
  const handleDoubleClick = useCallback(() => {
    const scaleX = (width - 40) / treeWidth;
    const scaleY = (height - 40) / treeHeight;
    const fitZoom = Math.min(scaleX, scaleY, 1.2);
    setZoom(fitZoom);
    setPan({ x: (width - treeWidth * fitZoom) / 2, y: (height - treeHeight * fitZoom) / 2 });
  }, [width, height, treeWidth, treeHeight]);

  // Terminal palette: panel boxes on the flat chart background, near-white text
  const T = {
    nodeBg: '#2a2a2a',
    nodeBorder: '#3a3a3a',
    nodeBorderHover: '#505050',
    leafBg: '#262626',
    leafBorderPos: '#3a3a3a',
    leafBorderNeg: '#3a3a3a',
    leafTextPos: '#e8e8e8',
    leafTextNeg: '#e8e8e8',
    edgeLine: '#2e2e2e',
    edgeYes: '#b0b0b0',
    edgeNo: '#b0b0b0',
    labelYes: '#e8e8e8',
    labelNo: '#e8e8e8',
    featureText: '#e8e8e8',
    threshText: '#e8e8e8',
    dimText: '#b0b0b0',
    mutedText: '#808080',
    sampleText: '#b0b0b0',
    gainBar: '#444444',
    depthLine: '#2e2e2e',
  };

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="select-none"
      style={{ cursor: isDragging ? 'grabbing' : 'default', background: 'var(--bg, #1c1c1c)' }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Transformed group: all tree content lives here, pan/zoom applied */}
      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

        {/* Depth level horizontal guide lines across the full tree width */}
        {Array.from({ length: maxDepthVal + 1 }, (_, d) => {
          const posArr = Array.from(positions.values()).filter(p => p.node.depth === d);
          if (posArr.length === 0) return null;
          const y = posArr[0].y;
          return (
            <g key={`depth-${d}`}>
              <line x1={0} y1={y} x2={treeWidth} y2={y} stroke="#2e2e2e" strokeWidth={0.5} strokeDasharray="4,8" />
              <text x={12} y={y - 6} fill="#808080" fontSize={9} fontFamily="monospace">
                depth[{d}]
              </text>
            </g>
          );
        })}

        {/* Edges: clean straight lines, subtle color coding */}
        {edges.map((e, i) => {
          const sampleRatio = maxSamples > 0 ? e.samples / maxSamples : 0.5;
          // Higher base opacity so edges are clearly visible on black background
          const opacity = 0.6 + sampleRatio * 0.4;
          return (
            <g key={i}>
              {/* Main edge line */}
              <line
                x1={e.x1} y1={e.y1 + 32}
                x2={e.x2} y2={e.y2 - 30}
                stroke={e.isYes ? T.edgeYes : T.edgeNo}
                strokeWidth={1}
                opacity={opacity}
              />
              {/* Branch label T/F */}
              <text
                x={(e.x1 + e.x2) / 2 + (e.isYes ? -12 : 12)}
                y={(e.y1 + e.y2) / 2}
                textAnchor="middle"
                fill="#e8e8e8"
                fontSize={14}
                fontFamily="monospace"
                fontWeight={700}
              >
                {e.isYes ? 'T' : 'F'}
              </text>
              {/* Sample count on edge */}
              <text
                x={(e.x1 + e.x2) / 2 + (e.isYes ? -12 : 12)}
                y={(e.y1 + e.y2) / 2 + 14}
                textAnchor="middle"
                fill="#e8e8e8"
                fontSize={12}
                fontFamily="monospace"
              >
                {e.samples}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {Array.from(positions.entries()).map(([id, { x, y, node }]) => {
          const isLeaf = node.leafValue !== undefined && !node.feature;
          const isHovered = hoveredNode === id;
          const samplePct = tree.samples > 0 ? (node.samples / tree.samples * 100) : 0;

          if (isLeaf) {
            return (
              <g key={id}
                onMouseEnter={() => setHoveredNode(id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* Leaf node: large box, all text pure white */}
                <rect
                  x={x - 80} y={y - 24}
                  width={160} height={50}
                  rx={3}
                  fill={T.leafBg}
                  stroke={isHovered ? '#505050' : '#3a3a3a'}
                  strokeWidth={isHovered ? 2 : 1}
                />
                <text x={x - 68} y={y - 4} fill="#e8e8e8" fontSize={12} fontFamily="monospace">leaf</text>
                <text x={x + 68} y={y - 4} textAnchor="end"
                  fill="#e8e8e8"
                  fontSize={18} fontFamily="monospace" fontWeight={700}>
                  {node.leafValue! > 0 ? '+' : ''}{node.leafValue!.toFixed(4)}
                </text>
                <text x={x - 68} y={y + 16} fill="#e8e8e8" fontSize={11} fontFamily="monospace">
                  n={node.samples}
                </text>
                <text x={x + 68} y={y + 16} textAnchor="end" fill="#e8e8e8" fontSize={11} fontFamily="monospace">
                  {samplePct.toFixed(1)}%
                </text>

              </g>
            );
          }

          // Internal split node
          const gainPct = maxGain > 0 ? (node.gain || 0) / maxGain : 0;
          // Gain bar width as proportion of node width
          const gainBarW = Math.max(2, gainPct * 106);

          return (
            <g key={id}
              onMouseEnter={() => setHoveredNode(id)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {/* Split node: feature name and threshold on separate lines
                  to prevent text overlap on long names like "Historical Vol(20d)" */}
              <rect
                x={x - 120} y={y - 30}
                width={240} height={62}
                rx={3}
                fill={T.nodeBg}
                stroke={isHovered ? '#505050' : '#3a3a3a'}
                strokeWidth={isHovered ? 2 : 1}
              />
              {/* Gain bar at bottom */}
              <rect
                x={x - 116} y={y + 27}
                width={Math.max(2, gainPct * 230)} height={3}
                rx={1}
                fill="#555555"
              />

              {/* Line 1: feature name (left) + threshold (right) */}
              <text x={x - 108} y={y - 12}
                fill="#e8e8e8" fontSize={14} fontFamily="monospace" fontWeight={600}>
                {node.feature}
              </text>
              <text x={x + 108} y={y - 12}
                textAnchor="end" fill="#e8e8e8" fontSize={14} fontFamily="monospace">
                {'<'} {node.threshold?.toFixed(2)}
              </text>
              {/* Line 2: gain (left) + samples (right) */}
              <text x={x - 108} y={y + 6}
                fill="#e8e8e8" fontSize={11} fontFamily="monospace">
                gain={node.gain?.toFixed(1)}
              </text>
              <text x={x + 108} y={y + 6}
                textAnchor="end" fill="#e8e8e8" fontSize={11} fontFamily="monospace">
                n={node.samples} ({samplePct.toFixed(1)}%)
              </text>

            </g>
          );
        })}

        {/* Tooltip layer: rendered LAST so it always appears on top of all nodes.
            SVG has no z-index; draw order determines stacking. */}
        {hoveredNode !== null && (() => {
          const entry = positions.get(hoveredNode);
          if (!entry) return null;
          const { x, y, node } = entry;
          const isLeaf = node.leafValue !== undefined && !node.feature;
          const samplePct = tree.samples > 0 ? (node.samples / tree.samples * 100) : 0;
          const gainPct = maxGain > 0 ? (node.gain || 0) / maxGain : 0;

          if (isLeaf) {
            return (
              <g transform={`translate(${x + 85}, ${y - 50})`}>
                <rect x={0} y={0} width={300} height={120} rx={3}
                  fill="#2a2a2a" stroke="#3a3a3a" strokeWidth={1} />
                <text x={14} y={24} fill="#e8e8e8" fontSize={16} fontFamily="monospace" fontWeight={700}>LEAF NODE</text>
                <text x={14} y={48} fill="#e8e8e8" fontSize={14} fontFamily="monospace">value:   {node.leafValue!.toFixed(6)}</text>
                <text x={14} y={72} fill="#e8e8e8" fontSize={14} fontFamily="monospace">samples: {node.samples} ({samplePct.toFixed(1)}%)</text>
                <text x={14} y={96} fill="#e8e8e8" fontSize={14} fontFamily="monospace">depth:   {node.depth}</text>
              </g>
            );
          }
          return (
            <g transform={`translate(${x + 125}, ${y - 50})`}>
              <rect x={0} y={0} width={320} height={130} rx={3}
                fill="#2a2a2a" stroke="#3a3a3a" strokeWidth={1} />
              <text x={14} y={24} fill="#e8e8e8" fontSize={16} fontFamily="monospace" fontWeight={700}>SPLIT NODE</text>
              <text x={14} y={48} fill="#e8e8e8" fontSize={14} fontFamily="monospace">feature: {node.feature}</text>
              <text x={14} y={72} fill="#e8e8e8" fontSize={14} fontFamily="monospace">thresh:  {node.threshold?.toFixed(4)}</text>
              <text x={14} y={96} fill="#e8e8e8" fontSize={14} fontFamily="monospace">gain:    {node.gain?.toFixed(4)} ({(gainPct * 100).toFixed(0)}%)</text>
              <text x={14} y={118} fill="#e8e8e8" fontSize={14} fontFamily="monospace">samples: {node.samples} ({samplePct.toFixed(1)}%)</text>
            </g>
          );
        })()}
      </g>

      {/* HUD overlay: fixed position controls and info (not affected by pan/zoom) */}

      {/* Top-left: tree summary */}
      <g transform="translate(12, 12)">
        <rect x={0} y={0} width={260} height={42} rx={3} fill="#2a2a2a" stroke="#3a3a3a" strokeWidth={0.5} />
        <text x={10} y={16} fill="#e8e8e8" fontSize={10} fontFamily="monospace">
          tree[0]  depth={maxDepthVal}  nodes={nodeStats.total}
        </text>
        <text x={10} y={32} fill="#e8e8e8" fontSize={9} fontFamily="monospace">
          splits={nodeStats.splits}  leaves={nodeStats.leaves}  root_n={tree.samples}
        </text>
      </g>

      {/* Top-right: zoom level */}
      <g transform={`translate(${width - 120}, 12)`}>
        <rect x={0} y={0} width={108} height={26} rx={3} fill="#2a2a2a" stroke="#3a3a3a" strokeWidth={0.5} />
        <text x={10} y={17} fill="#e8e8e8" fontSize={9} fontFamily="monospace">
          zoom: {(zoom * 100).toFixed(0)}%
        </text>
      </g>

      {/* Bottom-left: interaction hints */}
      <g transform={`translate(12, ${height - 32})`}>
        <rect x={0} y={0} width={400} height={22} rx={3} fill="#2a2a2a" stroke="#3a3a3a" strokeWidth={0.5} />
        <text x={10} y={14} fill="#e8e8e8" fontSize={9} fontFamily="monospace">
          drag: pan  |  scroll: zoom  |  dbl-click: reset  |  hover: inspect node
        </text>
      </g>
    </svg>
  );
}

// ============================================================================
// LEARNING CURVES VIEW - Enhanced with overfitting zone, gradient bars
// ============================================================================
function LearningCurvesView({
  data, width, height, showEarlyStopping
}: {
  data: ReturnType<typeof generateLearningCurves>;
  width: number; height: number; showEarlyStopping: boolean;
}) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const margin = { top: 50, right: 30, bottom: 55, left: 60 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const maxRound = data[data.length - 1]?.round ?? 1;
  const allLosses = data.flatMap(d => [d.trainLoss, d.valLoss]);
  const minLoss = Math.min(...allLosses) * 0.9;
  const maxLoss = Math.max(...allLosses) * 1.05;

  // Best validation round (early stopping point)
  const bestValIdx = data.reduce((best, d, i) => d.valLoss < data[best].valLoss ? i : best, 0);
  // Final overfit gap
  const finalGap = data[data.length - 1] ? data[data.length - 1].valLoss - data[data.length - 1].trainLoss : 0;

  const scaleX = (r: number) => (r / maxRound) * innerW;
  const scaleY = (l: number) => innerH - ((l - minLoss) / (maxLoss - minLoss)) * innerH;

  const trainPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(d.round)} ${scaleY(d.trainLoss)}`).join(' ');
  const valPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(d.round)} ${scaleY(d.valLoss)}`).join(' ');

  // Overfitting zone: area between train and val curves (filled polygon)
  const overfitArea = data.map(d => `${scaleX(d.round)},${scaleY(d.valLoss)}`).join(' ')
    + ' ' + [...data].reverse().map(d => `${scaleX(d.round)},${scaleY(d.trainLoss)}`).join(' ');

  const hoveredData = useMemo(() => {
    if (hoverX === null) return null;
    const round = Math.round((hoverX / innerW) * maxRound);
    return data.find(d => d.round === round) ?? null;
  }, [hoverX, data, innerW, maxRound]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - margin.left;
    if (x >= 0 && x <= innerW) setHoverX(x);
    else setHoverX(null);
  }, [margin.left, innerW]);

  return (
    <svg ref={svgRef} width={width} height={height} className="select-none"
      onMouseMove={handleMouseMove} onMouseLeave={() => setHoverX(null)}>

      <text x={width / 2} y={18} textAnchor="middle" fill={COLORS.text} fontSize={14} fontWeight={600}>
        Training and Validation Loss Curves
      </text>
      <text x={width / 2} y={34} textAnchor="middle" fill={COLORS.textDim} fontSize={10}>
        {data.length} boosting rounds | Best val loss at round {data[bestValIdx]?.round}
        {' | '}Overfit gap: {(finalGap * 100).toFixed(1)}%
      </text>

      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* Y-axis grid */}
        {Array.from({ length: 6 }, (_, i) => {
          const val = minLoss + (maxLoss - minLoss) * (i / 5);
          const y = scaleY(val);
          return (
            <g key={i}>
              <line x1={0} y1={y} x2={innerW} y2={y} stroke={COLORS.gridLine} strokeDasharray="3,3" />
              <text x={-8} y={y + 4} textAnchor="end" fill={COLORS.textDim} fontSize={9}>{val.toFixed(3)}</text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {Array.from({ length: 6 }, (_, i) => {
          const round = Math.round((i / 5) * maxRound);
          return <text key={i} x={scaleX(round)} y={innerH + 18} textAnchor="middle" fill={COLORS.textDim} fontSize={9}>{round}</text>;
        })}

        {/* Overfitting zone (shaded area between curves) */}
        <polygon points={overfitArea} fill="rgba(255,255,255,0.02)" />

        {/* Training curve (green) */}
        <path d={trainPath} fill="none" stroke={COLORS.emerald} strokeWidth={2} />
        {/* Validation curve (amber) */}
        <path d={valPath} fill="none" stroke={COLORS.amber} strokeWidth={2} />

        {/* Improvement gradient bars at bottom (shows per-round val loss change) */}
        {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 80)) === 0 && i > 0).map((d, i) => {
          const barH = Math.min(15, Math.abs(d.improvement) * 500);
          const isImproving = d.improvement > 0;
          return (
            <rect key={i}
              x={scaleX(d.round) - 1} y={innerH - barH - 1}
              width={2} height={barH}
              fill={isImproving ? '#21b3a4' : COLORS.red} opacity={0.3} />
          );
        })}

        {/* Early stopping line */}
        {showEarlyStopping && (
          <g>
            <line x1={scaleX(data[bestValIdx].round)} y1={0}
              x2={scaleX(data[bestValIdx].round)} y2={innerH}
              stroke={COLORS.red} strokeDasharray="5,3" strokeWidth={1.5} />
            <rect x={scaleX(data[bestValIdx].round) - 55} y={-2}
              width={110} height={18} rx={4} fill="#2a2a2a" stroke="#3a3a3a" strokeWidth={0.5} />
            <text x={scaleX(data[bestValIdx].round)} y={11}
              textAnchor="middle" fill={COLORS.red} fontSize={9} fontWeight={500}>
              Early Stop: {data[bestValIdx].round}
            </text>
            {/* Best loss annotation */}
            <circle cx={scaleX(data[bestValIdx].round)} cy={scaleY(data[bestValIdx].valLoss)}
              r={5} fill="none" stroke={COLORS.red} strokeWidth={1.5} />
            <text x={scaleX(data[bestValIdx].round) + 8} y={scaleY(data[bestValIdx].valLoss) + 3}
              fill={COLORS.red} fontSize={8}>
              {data[bestValIdx].valLoss.toFixed(4)}
            </text>
          </g>
        )}

        {/* Crosshair */}
        {hoveredData && hoverX !== null && (
          <g>
            <line x1={hoverX} y1={0} x2={hoverX} y2={innerH} stroke={COLORS.slateLight} strokeWidth={0.5} strokeDasharray="3,3" />
            <circle cx={hoverX} cy={scaleY(hoveredData.trainLoss)} r={4} fill={COLORS.emerald} />
            <circle cx={hoverX} cy={scaleY(hoveredData.valLoss)} r={4} fill={COLORS.amber} />
            {/* Gap indicator line between the two dots */}
            <line x1={hoverX} y1={scaleY(hoveredData.trainLoss)} x2={hoverX} y2={scaleY(hoveredData.valLoss)}
              stroke={COLORS.red} strokeWidth={1} strokeDasharray="2,2" opacity={0.5} />

            <g transform={`translate(${hoverX > innerW / 2 ? hoverX - 155 : hoverX + 10}, 10)`}>
              <rect x={0} y={0} width={145} height={68} rx={4} fill="#2a2a2a" stroke={COLORS.slateDark} strokeWidth={0.5} />
              <text x={8} y={15} fill={COLORS.textDim} fontSize={9} fontWeight={500}>Round {hoveredData.round}</text>
              <text x={8} y={30} fill={COLORS.emerald} fontSize={9}>Train: {hoveredData.trainLoss.toFixed(5)}</text>
              <text x={8} y={44} fill={COLORS.amber} fontSize={9}>Val: {hoveredData.valLoss.toFixed(5)}</text>
              <text x={8} y={58} fill={COLORS.red} fontSize={9}>
                Gap: {((hoveredData.valLoss - hoveredData.trainLoss) * 100).toFixed(2)}%
              </text>
            </g>
          </g>
        )}

        {/* Axis labels */}
        <text x={innerW / 2} y={innerH + 40} textAnchor="middle" fill={COLORS.textDim} fontSize={10}>
          Boosting Round (n_estimators)
        </text>
        <text x={-42} y={innerH / 2} textAnchor="middle" fill={COLORS.textDim} fontSize={10}
          transform={`rotate(-90, -42, ${innerH / 2})`}>Loss</text>

        {/* Legend */}
        <g transform={`translate(${innerW - 180}, 8)`}>
          <rect x={0} y={0} width={175} height={55} rx={4} fill="#2a2a2a" stroke="#3a3a3a" />
          <line x1={10} y1={14} x2={30} y2={14} stroke={COLORS.emerald} strokeWidth={2} />
          <text x={36} y={18} fill={COLORS.text} fontSize={9}>Training Loss</text>
          <line x1={10} y1={30} x2={30} y2={30} stroke={COLORS.amber} strokeWidth={2} />
          <text x={36} y={34} fill={COLORS.text} fontSize={9}>Validation Loss</text>
          <rect x={10} y={40} width={20} height={6} fill="rgba(255,255,255,0.04)" />
          <text x={36} y={48} fill={COLORS.textDim} fontSize={9}>Overfitting Zone</text>
        </g>
      </g>
    </svg>
  );
}

// ============================================================================
// SHAP BEESWARM VIEW - Enhanced with mean |SHAP| sidebar bars
// ============================================================================
function ShapSummaryView({
  data, width, height
}: {
  data: ReturnType<typeof generateShapValues>;
  width: number; height: number;
}) {
  const margin = { top: 50, right: 90, bottom: 50, left: 140 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const numFeatures = data.length;
  const rowH = innerH / numFeatures;

  const allShap = data.flat().map(d => d.shapValue);
  const maxAbsShap = Math.max(Math.abs(Math.min(...allShap)), Math.abs(Math.max(...allShap))) * 1.1;
  const scaleX = (v: number) => (v / maxAbsShap) * (innerW / 2) + innerW / 2;

  // Compute mean |SHAP| per feature for the sidebar bar chart
  const meanAbsShap = data.map(featureData => {
    const mean = featureData.reduce((s, d) => s + Math.abs(d.shapValue), 0) / featureData.length;
    return mean;
  });
  const maxMeanShap = Math.max(...meanAbsShap);

  // Map feature value to grayscale: dark gray (low) to white (high)
  function shapColor(fv: number): string {
    const v = Math.round(80 + fv * 150);
    return `rgb(${v},${v},${v})`;
  }

  return (
    <svg width={width} height={height} className="select-none">
      <text x={width / 2} y={18} textAnchor="middle" fill={COLORS.text} fontSize={14} fontWeight={600}>
        SHAP Feature Impact Analysis (Beeswarm Plot)
      </text>
      <text x={width / 2} y={34} textAnchor="middle" fill={COLORS.textDim} fontSize={10}>
        Each dot = one prediction | Position = SHAP value | Color = feature value (dark=low, bright=high)
      </text>

      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* Center line at SHAP = 0 */}
        <line x1={innerW / 2} y1={-5} x2={innerW / 2} y2={innerH + 5} stroke={COLORS.slateDark} strokeWidth={1} />
        <text x={innerW / 2} y={-10} textAnchor="middle" fill={COLORS.textMuted} fontSize={8}>SHAP = 0</text>

        {/* Positive/negative zone labels */}
        <text x={innerW * 0.75} y={-10} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize={8}>
          Pushes prediction UP
        </text>
        <text x={innerW * 0.25} y={-10} textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize={8}>
          Pushes prediction DOWN
        </text>

        {/* X-axis ticks */}
        {[-1, -0.5, 0, 0.5, 1].map(tick => {
          const val = tick * maxAbsShap;
          return (
            <g key={tick}>
              <line x1={scaleX(val)} y1={innerH} x2={scaleX(val)} y2={innerH + 5} stroke={COLORS.textDim} />
              <text x={scaleX(val)} y={innerH + 16} textAnchor="middle" fill={COLORS.textDim} fontSize={8}>
                {val.toFixed(2)}
              </text>
            </g>
          );
        })}

        <text x={innerW / 2} y={innerH + 36} textAnchor="middle" fill={COLORS.textDim} fontSize={10}>
          SHAP Value (impact on model output)
        </text>

        {/* Feature rows */}
        {data.map((featureData, fi) => {
          const centerY = fi * rowH + rowH / 2;
          return (
            <g key={fi}>
              {/* Feature name + rank */}
              <text x={-8} y={centerY + 4} textAnchor="end" fill={COLORS.text} fontSize={10}>
                {featureData[0]?.feature ?? FEATURE_NAMES[fi]}
              </text>
              <text x={-8} y={centerY - 6} textAnchor="end" fill={COLORS.textMuted} fontSize={7}>
                #{fi + 1}
              </text>

              {/* Row separator */}
              <line x1={0} y1={centerY + rowH / 2} x2={innerW} y2={centerY + rowH / 2}
                stroke={COLORS.gridLine} strokeWidth={0.5} />

              {/* Beeswarm dots */}
              {featureData.map((d, di) => {
                const jitter = (Math.sin(di * 7.3) * 0.5 + Math.cos(di * 3.7) * 0.5) * (rowH * 0.35);
                return (
                  <circle key={di} cx={scaleX(d.shapValue)} cy={centerY + jitter}
                    r={2.5} fill={shapColor(d.featureValue)} opacity={0.7} />
                );
              })}

              {/* Mean |SHAP| bar on the right side (mini bar chart) */}
              <rect
                x={innerW + 10} y={centerY - 4}
                width={Math.max(1, (meanAbsShap[fi] / maxMeanShap) * 50)} height={8}
                rx={2} fill={COLORS.purple} opacity={0.6} />
              <text x={innerW + 65} y={centerY + 4} fill={COLORS.textDim} fontSize={7}>
                {meanAbsShap[fi].toFixed(3)}
              </text>
            </g>
          );
        })}

        {/* Mean |SHAP| header */}
        <text x={innerW + 35} y={-10} textAnchor="middle" fill={COLORS.purple} fontSize={8}>
          mean |SHAP|
        </text>

        {/* Color legend */}
        <g transform={`translate(${innerW + 10}, ${innerH / 2 - 60})`}>
          <text x={0} y={-12} fill={COLORS.textDim} fontSize={8}>Feature</text>
          <text x={0} y={-2} fill={COLORS.textDim} fontSize={8}>Value</text>
          <defs>
            <linearGradient id="shap-grad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#505050" />
              <stop offset="50%" stopColor="#909090" />
              <stop offset="100%" stopColor="#d0d0d0" />
            </linearGradient>
          </defs>
          <rect x={5} y={8} width={12} height={80} rx={2} fill="url(#shap-grad)" />
          <text x={22} y={18} fill={COLORS.textDim} fontSize={8}>High</text>
          <text x={22} y={90} fill={COLORS.textDim} fontSize={8}>Low</text>
        </g>
      </g>
    </svg>
  );
}

// ============================================================================
// PREDICTION SCATTER VIEW - Enhanced with residual histogram + confidence bands
// ============================================================================
function PredictionScatterView({
  data, width, height
}: {
  data: ReturnType<typeof generatePredictions>;
  width: number; height: number;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Split the height: scatter plot gets 65%, residual histogram gets 35%
  const scatterH = height * 0.62;
  const histH = height * 0.32;
  const gap = height * 0.06;

  const margin = { top: 45, right: 30, bottom: 15, left: 60 };
  const innerW = width - margin.left - margin.right;
  const plotSize = Math.min(innerW, scatterH - margin.top - margin.bottom);

  const allVals = data.flatMap(d => [d.actual, d.predicted]);
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range = maxVal - minVal;
  const scale = (v: number) => ((v - minVal) / range) * plotSize;

  // Model quality metrics
  const meanActual = data.reduce((s, d) => s + d.actual, 0) / data.length;
  const ssRes = data.reduce((s, d) => s + (d.actual - d.predicted) ** 2, 0);
  const ssTot = data.reduce((s, d) => s + (d.actual - meanActual) ** 2, 0);
  const rSquared = Math.max(0, 1 - ssRes / ssTot);
  const rmse = Math.sqrt(ssRes / data.length);
  const mae = data.reduce((s, d) => s + Math.abs(d.residual), 0) / data.length;

  // Residual histogram bins
  const residuals = data.map(d => d.residual);
  const minRes = Math.min(...residuals);
  const maxRes = Math.max(...residuals);
  const numBins = 30;
  const binWidth = (maxRes - minRes) / numBins;
  const bins = Array.from({ length: numBins }, (_, i) => {
    const lo = minRes + i * binWidth;
    const hi = lo + binWidth;
    const count = residuals.filter(r => r >= lo && r < hi).length;
    return { lo, hi, mid: (lo + hi) / 2, count };
  });
  const maxBinCount = Math.max(...bins.map(b => b.count));

  return (
    <svg width={width} height={height} className="select-none">
      {/* Scatter Plot Section */}
      <text x={width / 2} y={18} textAnchor="middle" fill={COLORS.text} fontSize={14} fontWeight={600}>
        Prediction Analysis: Actual vs Predicted
      </text>
      <text x={width / 2} y={34} textAnchor="middle" fill={COLORS.textDim} fontSize={10}>
        {data.length} samples | R² = {rSquared.toFixed(4)} | RMSE = {rmse.toFixed(4)} | MAE = {mae.toFixed(4)}
      </text>

      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* Grid */}
        {Array.from({ length: 6 }, (_, i) => {
          const pos = (i / 5) * plotSize;
          const val = minVal + (i / 5) * range;
          return (
            <g key={i}>
              <line x1={0} y1={pos} x2={plotSize} y2={pos} stroke={COLORS.gridLine} strokeDasharray="3,3" />
              <line x1={pos} y1={0} x2={pos} y2={plotSize} stroke={COLORS.gridLine} strokeDasharray="3,3" />
              <text x={-8} y={plotSize - pos + 4} textAnchor="end" fill={COLORS.textDim} fontSize={8}>{val.toFixed(2)}</text>
              <text x={pos} y={plotSize + 14} textAnchor="middle" fill={COLORS.textDim} fontSize={8}>{val.toFixed(2)}</text>
            </g>
          );
        })}

        {/* Confidence band around diagonal (shows +/- RMSE zone) */}
        <polygon
          points={`0,${plotSize} ${plotSize},0 ${plotSize},${scale(maxVal - rmse) > 0 ? plotSize - scale(maxVal) + scale(maxVal - rmse) : 0} 0,${plotSize - (scale(minVal + rmse) - scale(minVal))}`}
          fill="rgba(255,255,255,0.02)" />

        {/* Perfect prediction diagonal: reference line, terminal dim gray */}
        <line x1={0} y1={plotSize} x2={plotSize} y2={0}
          stroke="#b0b0b0" strokeWidth={1.5} strokeDasharray="6,3" opacity={0.6} />
        <text x={plotSize - 5} y={12} textAnchor="end" fill="#b0b0b0" fontSize={8} opacity={0.6}>
          Perfect fit (y=x)
        </text>

        {/* Scatter dots colored by residual magnitude */}
        {data.map((d, i) => {
          const x = scale(d.predicted);
          const y = plotSize - scale(d.actual);
          const residualMag = Math.abs(d.residual);
          const maxResidual = range * 0.3;
          const errorRatio = Math.min(1, residualMag / maxResidual);
          // Interpolate var(--up) #21b3a4 (low error) to var(--down) #f0426c (high error);
          // computed as rgb because CSS vars cannot be interpolated numerically
          const r = Math.round(33 + errorRatio * 207);
          const g = Math.round(179 - errorRatio * 113);
          const b = Math.round(164 - errorRatio * 56);

          return (
            <circle key={i} cx={x} cy={y} r={hoveredIdx === i ? 5 : 3}
              fill={`rgb(${r},${g},${b})`} opacity={hoveredIdx === i ? 1 : 0.55}
              onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: 'pointer' }} />
          );
        })}

        {/* Axis labels */}
        <text x={plotSize / 2} y={plotSize + 30} textAnchor="middle" fill={COLORS.textDim} fontSize={10}>Predicted</text>
        <text x={-42} y={plotSize / 2} textAnchor="middle" fill={COLORS.textDim} fontSize={10}
          transform={`rotate(-90, -42, ${plotSize / 2})`}>Actual</text>

        {/* Hover tooltip */}
        {hoveredIdx !== null && (
          <g transform={`translate(${scale(data[hoveredIdx].predicted) + 10}, ${plotSize - scale(data[hoveredIdx].actual) - 40})`}>
            <rect x={0} y={0} width={140} height={52} rx={4} fill="#2a2a2a" stroke="#3a3a3a" strokeWidth={0.5} />
            <text x={8} y={14} fill={COLORS.text} fontSize={9}>Actual: {data[hoveredIdx].actual.toFixed(4)}</text>
            <text x={8} y={28} fill={COLORS.text} fontSize={9}>Predicted: {data[hoveredIdx].predicted.toFixed(4)}</text>
            <text x={8} y={42} fill={data[hoveredIdx].residual > 0 ? '#21b3a4' : COLORS.red} fontSize={9}>
              Residual: {data[hoveredIdx].residual > 0 ? '+' : ''}{data[hoveredIdx].residual.toFixed(4)}
            </text>
          </g>
        )}
      </g>

      {/* Residual Histogram Section */}
      <g transform={`translate(${margin.left},${scatterH + gap})`}>
        <text x={innerW / 2} y={-5} textAnchor="middle" fill={COLORS.textDim} fontSize={10} fontWeight={500}>
          Residual Distribution (Actual - Predicted)
        </text>

        {/* Zero line */}
        {(() => {
          const zeroX = ((0 - minRes) / (maxRes - minRes)) * innerW;
          return <line x1={zeroX} y1={0} x2={zeroX} y2={histH - 20} stroke={COLORS.slateDark} strokeWidth={1} strokeDasharray="3,2" />;
        })()}

        {/* Histogram bars */}
        {bins.map((bin, i) => {
          const x = (i / numBins) * innerW;
          const barW = innerW / numBins - 1;
          const barH = (bin.count / maxBinCount) * (histH - 25);
          // Color: centered bins var(--up) teal, tail bins var(--down) rose (error severity)
          const distFromZero = Math.abs(bin.mid) / Math.max(Math.abs(minRes), Math.abs(maxRes));
          const cr = Math.round(33 + distFromZero * 207);
          const cg = Math.round(179 - distFromZero * 113);
          const cb = Math.round(164 - distFromZero * 56);

          return (
            <rect key={i} x={x} y={histH - 20 - barH} width={barW} height={barH}
              fill={`rgb(${cr},${cg},${cb})`} opacity={0.7} rx={1} />
          );
        })}

        {/* X-axis labels for residual range */}
        <text x={0} y={histH - 5} fill={COLORS.textDim} fontSize={8}>{minRes.toFixed(2)}</text>
        <text x={innerW / 2} y={histH - 5} textAnchor="middle" fill={COLORS.textDim} fontSize={8}>0</text>
        <text x={innerW} y={histH - 5} textAnchor="end" fill={COLORS.textDim} fontSize={8}>{maxRes.toFixed(2)}</text>
      </g>
    </svg>
  );
}

// ============================================================================
// RIGHT SIDEBAR STATISTICS PANEL
// Always visible, shows comprehensive model diagnostics
// ============================================================================
function StatsPanel({
  features, learningCurves, predictions, shapData,
  nEstimators, maxDepth, learningRate, regLambda, regAlpha,
  subsample, colsampleBytree, numFeatures, objective, viewMode
}: {
  features: ReturnType<typeof generateFeatureImportance>;
  learningCurves: ReturnType<typeof generateLearningCurves>;
  predictions: ReturnType<typeof generatePredictions>;
  shapData: ReturnType<typeof generateShapValues>;
  nEstimators: number; maxDepth: number; learningRate: number;
  regLambda: number; regAlpha: number; subsample: number;
  colsampleBytree: number; numFeatures: number;
  objective: string; viewMode: ViewMode;
}) {
  // Compute comprehensive model metrics
  const meanActual = predictions.reduce((s, d) => s + d.actual, 0) / predictions.length;
  const ssRes = predictions.reduce((s, d) => s + (d.actual - d.predicted) ** 2, 0);
  const ssTot = predictions.reduce((s, d) => s + (d.actual - meanActual) ** 2, 0);
  const rSquared = Math.max(0, 1 - ssRes / ssTot);
  const rmse = Math.sqrt(ssRes / predictions.length);
  const mae = predictions.reduce((s, d) => s + Math.abs(d.residual), 0) / predictions.length;
  const mape = predictions.reduce((s, d) => s + (d.actual !== 0 ? Math.abs(d.residual / d.actual) : 0), 0) / predictions.length * 100;

  // Learning curve diagnostics
  const bestValIdx = learningCurves.reduce((best, d, i) => d.valLoss < learningCurves[best].valLoss ? i : best, 0);
  const bestValLoss = learningCurves[bestValIdx]?.valLoss ?? 0;
  const finalTrainLoss = learningCurves[learningCurves.length - 1]?.trainLoss ?? 0;
  const finalValLoss = learningCurves[learningCurves.length - 1]?.valLoss ?? 0;
  const overfitGap = finalValLoss - finalTrainLoss;

  // Feature analysis
  const top3Importance = features.slice(0, 3).reduce((s, f) => s + f.gain, 0);
  const top80Count = features.findIndex(f => f.cumGain >= 0.8) + 1;

  // Model complexity estimate
  const totalParams = nEstimators * (Math.pow(2, maxDepth + 1) - 1);

  // Overfitting risk assessment based on hyperparameter choices
  const overfitRisk = (maxDepth > 8 ? 2 : maxDepth > 5 ? 1 : 0) +
    (regLambda < 0.5 ? 1 : 0) + (nEstimators > 500 ? 1 : 0) +
    (learningRate > 0.3 ? 1 : 0);
  const riskLabel = overfitRisk >= 3 ? 'High' : overfitRisk >= 2 ? 'Medium' : 'Low';
  const riskColor = overfitRisk >= 3 ? COLORS.red : overfitRisk >= 2 ? COLORS.amber : '#21b3a4';

  return (
    <div className="w-[220px] min-w-[220px] bg-card border-l border-border overflow-y-auto flex-shrink-0">
      <div className="p-3 space-y-3">

        {/* Model Performance: no icons, plain text headers */}
        <div>
          <span className="text-[10px] font-medium text-[#808080] uppercase tracking-widest">Performance</span>
          <div className="space-y-1.5 mt-2">
            <StatRow label="R² Score" value={rSquared.toFixed(4)} color="#e8e8e8" bar={rSquared} />
            <StatRow label="RMSE" value={rmse.toFixed(4)} color="#e8e8e8" />
            <StatRow label="MAE" value={mae.toFixed(4)} color="#e8e8e8" />
            <StatRow label="MAPE" value={`${mape.toFixed(1)}%`} color="#e8e8e8" />
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Training Diagnostics */}
        <div>
          <span className="text-[10px] font-medium text-[#808080] uppercase tracking-widest">Training</span>
          <div className="space-y-1.5 mt-2">
            <StatRow label="Best Val Loss" value={bestValLoss.toFixed(5)} color="#e8e8e8" />
            <StatRow label="Best Round" value={`${learningCurves[bestValIdx]?.round ?? 0}`} color="#e8e8e8" />
            <StatRow label="Final Train" value={finalTrainLoss.toFixed(5)} color="#e8e8e8" />
            <StatRow label="Final Val" value={finalValLoss.toFixed(5)} color="#e8e8e8" />
            <StatRow label="Overfit Gap" value={`${(overfitGap * 100).toFixed(2)}%`} color="#e8e8e8" />
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Feature Analysis */}
        <div>
          <span className="text-[10px] font-medium text-[#808080] uppercase tracking-widest">Features</span>
          <div className="space-y-1.5 mt-2">
            <StatRow label="Top Feature" value={features[0]?.name ?? '-'} color="#e8e8e8" small />
            <StatRow label="Top 3 Share" value={`${(top3Importance * 100).toFixed(1)}%`} color="#e8e8e8" bar={top3Importance} />
            <StatRow label="80% Coverage" value={`${top80Count} features`} color="#e8e8e8" />
            <StatRow label="Total Features" value={`${numFeatures}`} color="#808080" />
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Model Complexity */}
        <div>
          <span className="text-[10px] font-medium text-[#808080] uppercase tracking-widest">Complexity</span>
          <div className="space-y-1.5 mt-2">
            <StatRow label="Est. Nodes" value={totalParams.toLocaleString()} color="#e8e8e8" />
            <StatRow label="Objective" value={objective.split(':')[1]} color="#e8e8e8" small />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#808080]">Overfit Risk</span>
              <span className="text-[10px] font-mono text-[#808080]">{riskLabel}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Config */}
        <div>
          <span className="text-[10px] font-medium text-[#808080] uppercase tracking-widest">Config</span>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px]">
            <span className="text-[#808080]">Trees</span>
            <span className="text-[#e8e8e8] text-right font-mono">{nEstimators}</span>
            <span className="text-[#808080]">Depth</span>
            <span className="text-[#e8e8e8] text-right font-mono">{maxDepth}</span>
            <span className="text-[#808080]">LR</span>
            <span className="text-[#e8e8e8] text-right font-mono">{learningRate.toFixed(2)}</span>
            <span className="text-[#808080]">L2 (lambda)</span>
            <span className="text-[#e8e8e8] text-right font-mono">{regLambda.toFixed(1)}</span>
            <span className="text-[#808080]">L1 (alpha)</span>
            <span className="text-[#e8e8e8] text-right font-mono">{regAlpha.toFixed(1)}</span>
            <span className="text-[#808080]">Subsample</span>
            <span className="text-[#e8e8e8] text-right font-mono">{subsample.toFixed(2)}</span>
            <span className="text-[#808080]">Col Sample</span>
            <span className="text-[#e8e8e8] text-right font-mono">{colsampleBytree.toFixed(2)}</span>
          </div>
        </div>

        {/* View-specific context tips for video narration */}
        <div className="border-t border-border pt-2">
          <div className="bg-[#262626] rounded p-2 border border-border">
            <span className="text-[9px] text-[#808080]">
              {viewMode === 'importance'
                ? 'Gain = information per split. Weight = split frequency. Coverage = samples through splits. Cumulative line shows importance concentration.'
                : viewMode === 'tree'
                  ? 'Nodes split on feature thresholds. Line thickness = sample flow. Brighter nodes = higher gain. Leaf values = tree contribution to ensemble.'
                  : viewMode === 'learning'
                    ? 'Gap between curves = overfitting. Shaded zone visualizes divergence. Early stopping halts at best validation round.'
                    : viewMode === 'shap'
                      ? 'SHAP decomposes predictions into per-feature contributions. Bright dots on right = high feature values pushing predictions up.'
                      : 'Diagonal = perfect fit. Band = RMSE confidence. Histogram shows residual distribution symmetry.'}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}

/** Single stat row used in the right panel */
function StatRow({ label, value, color, bar, small }: {
  label: string; value: string; color: string; bar?: number; small?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[#808080]">{label}</span>
        <span className={`${small ? 'text-[9px]' : 'text-[10px]'} font-mono`} style={{ color }}>{value}</span>
      </div>
      {bar !== undefined && (
        <div className="mt-0.5 h-1 bg-[#3a3a3a] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, bar * 100)}%`, backgroundColor: color }} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function XGBoostVisualization() {
  // Default to Decision Tree view since it's the most visual and engaging
  const [viewMode, setViewMode] = useState<ViewMode>('tree');

  // --- XGBoost Hyperparameters ---
  const [nEstimators, setNEstimators] = useState(200);
  const [maxDepth, setMaxDepth] = useState(6);
  const [learningRate, setLearningRate] = useState(0.1);
  const [minChildWeight, setMinChildWeight] = useState(5);
  const [regLambda, setRegLambda] = useState(1.0);
  const [regAlpha, setRegAlpha] = useState(0.0);
  const [subsample, setSubsample] = useState(0.8);
  const [colsampleBytree, setColsampleBytree] = useState(0.8);
  const [numFeatures, setNumFeatures] = useState(12);
  const [objective, setObjective] = useState<Objective>('reg:squarederror');
  const [seed, setSeed] = useState(42);

  // --- View options ---
  const [importanceType, setImportanceType] = useState<'gain' | 'weight' | 'cover'>('gain');
  const [showEarlyStopping, setShowEarlyStopping] = useState(true);
  const [shapSamples, setShapSamples] = useState(80);

  // --- UI ---
  const [showParams, setShowParams] = useState(true);
  const [showViewOptions, setShowViewOptions] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.max(400, width), height: Math.max(400, height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // --- Data generation (memoized) ---
  const featureImportance = useMemo(
    () => generateFeatureImportance(numFeatures, maxDepth, regLambda, regAlpha, colsampleBytree, seed),
    [numFeatures, maxDepth, regLambda, regAlpha, colsampleBytree, seed]
  );
  const tree = useMemo(
    // Cap at 6 for SVG performance; deeper trees have 2^N nodes but pan/zoom
    // makes them explorable. Above 6 the layout gets too wide for usability.
    () => generateTree(Math.min(maxDepth, 6), numFeatures, minChildWeight, colsampleBytree, seed),
    [maxDepth, numFeatures, minChildWeight, colsampleBytree, seed]
  );
  const learningCurves = useMemo(
    () => generateLearningCurves(nEstimators, learningRate, maxDepth, regLambda, subsample, seed),
    [nEstimators, learningRate, maxDepth, regLambda, subsample, seed]
  );
  const shapValues = useMemo(
    () => generateShapValues(numFeatures, shapSamples, seed),
    [numFeatures, shapSamples, seed]
  );
  const predictions = useMemo(
    () => generatePredictions(nEstimators, learningRate, maxDepth, regLambda, subsample, colsampleBytree, 250, seed),
    [nEstimators, learningRate, maxDepth, regLambda, subsample, colsampleBytree, seed]
  );

  const resetParams = useCallback(() => {
    setNEstimators(200); setMaxDepth(6); setLearningRate(0.1);
    setMinChildWeight(5); setRegLambda(1.0); setRegAlpha(0.0);
    setSubsample(0.8); setColsampleBytree(0.8); setNumFeatures(12);
    setObjective('reg:squarederror'); setSeed(42);
  }, []);

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 160px)', minHeight: 500 }}>
      <div className="flex h-full gap-0">
        {/* ================================================================
            LEFT SIDEBAR: Hyperparameters
            ================================================================ */}
        <div className="w-[220px] min-w-[220px] bg-card border-r border-border overflow-y-auto flex-shrink-0">
          <div className="p-3 space-y-3">

            {/* Header: plain text, no color, no badges */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#b0b0b0] uppercase tracking-wide">XGBoost</span>
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={resetParams}>
                      <RotateCcw className="w-3.5 h-3.5 text-[#808080]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right"><p className="text-xs">Reset all parameters</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Objective */}
            <div className="space-y-1">
              <Label className="text-[10px] text-[#808080]">Objective Function</Label>
              <Select value={objective} onValueChange={(v) => setObjective(v as Objective)}>
                <SelectTrigger className="h-7 text-xs bg-[#262626] border-[#3a3a3a]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reg:squarederror">reg:squarederror</SelectItem>
                  <SelectItem value="reg:logistic">reg:logistic</SelectItem>
                  <SelectItem value="binary:logistic">binary:logistic</SelectItem>
                  <SelectItem value="multi:softmax">multi:softmax</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Hyperparameters */}
            <Collapsible open={showParams} onOpenChange={setShowParams}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-1.5 px-2 rounded bg-[#262626] hover:bg-[#343434] transition-colors">
                <div className="flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5 text-[#808080]" />
                  <span className="text-xs font-medium text-[#e8e8e8]">Hyperparameters</span>
                </div>
                {showParams ? <ChevronUp className="w-3.5 h-3.5 text-[#808080]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#808080]" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-2.5">
                <ParamSlider label="n_estimators" value={nEstimators} onChange={setNEstimators} min={10} max={1000} step={10} format={v => `${v}`} />
                <ParamSlider label="max_depth" value={maxDepth} onChange={setMaxDepth} min={1} max={15} step={1} format={v => `${v}`} />
                <ParamSlider label="learning_rate" value={learningRate} onChange={v => setLearningRate(v / 100)} rawValue={learningRate * 100} min={1} max={100} step={1} format={() => learningRate.toFixed(2)} />
                <ParamSlider label="min_child_weight" value={minChildWeight} onChange={setMinChildWeight} min={1} max={50} step={1} format={v => `${v}`} />
                <ParamSlider label="reg_lambda (L2)" value={regLambda} onChange={v => setRegLambda(v / 10)} rawValue={regLambda * 10} min={0} max={100} step={1} format={() => regLambda.toFixed(1)} />
                <ParamSlider label="reg_alpha (L1)" value={regAlpha} onChange={v => setRegAlpha(v / 10)} rawValue={regAlpha * 10} min={0} max={100} step={1} format={() => regAlpha.toFixed(1)} />
                <ParamSlider label="subsample" value={subsample} onChange={v => setSubsample(v / 100)} rawValue={subsample * 100} min={10} max={100} step={5} format={() => subsample.toFixed(2)} />
                <ParamSlider label="colsample_bytree" value={colsampleBytree} onChange={v => setColsampleBytree(v / 100)} rawValue={colsampleBytree * 100} min={10} max={100} step={5} format={() => colsampleBytree.toFixed(2)} />
                <ParamSlider label="Features" value={numFeatures} onChange={setNumFeatures} min={4} max={100} step={1} format={v => `${v}`} />
                <ParamSlider label="Seed" value={seed} onChange={setSeed} min={0} max={999} step={1} format={v => `${v}`} />
              </CollapsibleContent>
            </Collapsible>

            {/* View-specific options */}
            <Collapsible open={showViewOptions} onOpenChange={setShowViewOptions}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-1.5 px-2 rounded bg-[#262626] hover:bg-[#343434] transition-colors">
                <div className="flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5 text-[#808080]" />
                  <span className="text-xs font-medium text-[#e8e8e8]">View Options</span>
                </div>
                {showViewOptions ? <ChevronUp className="w-3.5 h-3.5 text-[#808080]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#808080]" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-2.5">
                {viewMode === 'importance' && (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-[#808080]">Importance Metric</Label>
                    <Select value={importanceType} onValueChange={(v) => setImportanceType(v as typeof importanceType)}>
                      <SelectTrigger className="h-7 text-xs bg-[#262626] border-[#3a3a3a]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gain">Gain (Information)</SelectItem>
                        <SelectItem value="weight">Weight (Frequency)</SelectItem>
                        <SelectItem value="cover">Cover (Samples)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {viewMode === 'learning' && (
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] text-[#808080]">Early Stopping Line</Label>
                    <Switch checked={showEarlyStopping} onCheckedChange={setShowEarlyStopping} />
                  </div>
                )}
                {viewMode === 'shap' && (
                  <ParamSlider label="SHAP Samples" value={shapSamples} onChange={setShapSamples} min={20} max={200} step={10} format={v => `${v}`} />
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        {/* ================================================================
            CENTER: View tabs + Visualization canvas
            ================================================================ */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* View mode tab bar */}
          <div className="flex items-center gap-1 px-3 py-2 bg-card border-b border-border overflow-x-auto">
            {VIEW_MODES.map(mode => {
              const isActive = viewMode === mode.id;
              return (
                <TooltipProvider key={mode.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isActive ? 'default' : 'ghost'} size="sm"
                        className={`h-7 text-xs gap-1.5 whitespace-nowrap rounded-sm ${isActive
                          ? 'bg-[#343434] hover:bg-[#343434] text-[#e8e8e8] border border-[#3a3a3a]'
                          : 'text-[#808080] hover:text-[#b0b0b0] hover:bg-[#262626] border border-transparent'}`}
                        onClick={() => setViewMode(mode.id)}>
                        {mode.label}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom"><p className="text-xs">{mode.desc}</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}
          </div>

          {/* Visualization area */}
          <div ref={containerRef} className="flex-1 overflow-hidden bg-[var(--bg)]">
            {viewMode === 'importance' && (
              <FeatureImportanceView features={featureImportance} importanceType={importanceType}
                width={dimensions.width} height={dimensions.height} />
            )}
            {viewMode === 'tree' && (
              <DecisionTreeView tree={tree} width={dimensions.width} height={dimensions.height} />
            )}
            {viewMode === 'learning' && (
              <LearningCurvesView data={learningCurves} width={dimensions.width}
                height={dimensions.height} showEarlyStopping={showEarlyStopping} />
            )}
            {viewMode === 'shap' && (
              <ShapSummaryView data={shapValues} width={dimensions.width} height={dimensions.height} />
            )}
            {viewMode === 'scatter' && (
              <PredictionScatterView data={predictions} width={dimensions.width} height={dimensions.height} />
            )}
          </div>

          {/* Bottom status bar */}
          <div className="flex items-center justify-between px-4 py-1.5 bg-card border-t border-border text-[10px] text-[#b0b0b0] font-mono">
            <div className="flex items-center gap-3">
              <span>XGBoost Gradient Boosted Trees</span>
              <span>|</span>
              <span>{nEstimators} trees</span>
              <span>depth {maxDepth}</span>
              <span>lr {learningRate.toFixed(2)}</span>
              <span>lambda {regLambda.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span>{numFeatures} features</span>
              <span>|</span>
              <span>{objective}</span>
              <span>|</span>
              <span>Seed: {seed}</span>
            </div>
          </div>
        </div>

        {/* ================================================================
            RIGHT SIDEBAR: Statistics Panel
            ================================================================ */}
        <StatsPanel
          features={featureImportance}
          learningCurves={learningCurves}
          predictions={predictions}
          shapData={shapValues}
          nEstimators={nEstimators}
          maxDepth={maxDepth}
          learningRate={learningRate}
          regLambda={regLambda}
          regAlpha={regAlpha}
          subsample={subsample}
          colsampleBytree={colsampleBytree}
          numFeatures={numFeatures}
          objective={objective}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}

/** Reusable parameter slider component for the left sidebar */
function ParamSlider({ label, value, onChange, min, max, step, format, rawValue }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; format: (v: number) => string;
  rawValue?: number;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between">
        <Label className="text-[10px] text-[#808080]">{label}</Label>
        <span className="text-[10px] text-[#e8e8e8] font-mono">{format(value)}</span>
      </div>
      <Slider value={[rawValue ?? value]} onValueChange={([v]) => onChange(v)}
        min={min} max={max} step={step} className="w-full" />
    </div>
  );
}
