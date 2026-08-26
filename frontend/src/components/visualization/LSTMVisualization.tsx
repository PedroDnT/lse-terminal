/**
 * LSTM (Long Short-Term Memory) - Interactive Visualization Dashboard
 *
 * Educational visualization showing how LSTM networks process sequential financial data.
 * All data is generated client-side with seeded PRNG for deterministic outputs.
 *
 * Dashboard layout:
 * - LEFT: Network configuration panel (hidden size, layers, sequence length, etc.)
 * - CENTER: 5 view modes (Cell Architecture, Sequence Flow, Gate Activations, Memory State, Prediction)
 * - RIGHT: Live statistics panel with network metrics
 *
 * Views:
 * - Cell Architecture: Animated LSTM cell diagram with forget/input/output gates and data flow
 * - Sequence Flow: Step-by-step candle processing with hidden state bar updates
 * - Gate Activations: Heatmap of gate values (forget, input, output) across timesteps
 * - Memory State: Line plots of cell state and hidden state evolution over time
 * - Prediction: Final output mapping to trading signals with confidence scores
 *
 * Monochrome palette matching XGBoost visualization for visual consistency.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Settings, ChevronDown, ChevronUp, RotateCcw, Play, Pause, SkipForward, Info
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
// Terminal palette. Hex values (not CSS vars) because these feed SVG
// presentation attributes, which do not resolve var(). Values mirror the
// app-wide chrome: bg #1c1c1c, grid #2e2e2e, up teal, down rose, amber second
// dimension.
// ============================================================================
const COLORS = {
  emerald: '#21b3a4',
  emeraldLight: '#4cc4b8',
  emeraldDark: '#18857a',
  emeraldFaint: 'rgba(33,179,164,0.06)',
  red: '#f0426c',
  redLight: '#f46e8d',
  redFaint: 'rgba(240,66,108,0.06)',
  amber: '#c58435',
  amberLight: '#d19a55',
  blue: '#b0b0b0',
  blueLight: '#c8c8c8',
  purple: '#b0b0b0',
  cyan: '#b0b0b0',
  slate: '#808080',
  slateLight: '#b0b0b0',
  slateDark: '#3a3a3a',
  bg: '#1c1c1c',
  cardBg: '#2a2a2a',
  panelBg: '#1c1c1c',
  gridLine: '#2e2e2e',
  text: '#e8e8e8',
  textDim: '#b0b0b0',
  textMuted: '#808080',
  // Gate colours mapped to terminal roles so the five series stay
  // distinguishable without introducing off-palette hues
  forgetGate: '#f0426c',   // down rose (what to discard)
  inputGate: '#21b3a4',    // up teal (what to store)
  outputGate: '#b0b0b0',   // neutral dim (what to output)
  cellState: '#c58435',    // amber second data dimension (memory)
  hiddenState: '#e8e8e8',  // primary series (output)
};

type ViewMode = 'architecture' | 'sequence' | 'gates' | 'memory' | 'prediction';

const VIEW_MODES: { id: ViewMode; label: string; desc: string }[] = [
  { id: 'architecture', label: 'Cell Architecture', desc: 'LSTM cell with gates and data flow' },
  { id: 'sequence', label: 'Sequence Flow', desc: 'Step-by-step candle processing' },
  { id: 'gates', label: 'Gate Activations', desc: 'Heatmap of gate values over time' },
  { id: 'memory', label: 'Memory State', desc: 'Cell and hidden state evolution' },
  { id: 'prediction', label: 'Prediction', desc: 'Final output and trading signal' },
];

// ============================================================================
// Sigmoid and tanh activation functions used by LSTM gates.
// Sigmoid squashes to [0,1] (gate open/close), tanh squashes to [-1,1] (values).
// ============================================================================
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function tanh(x: number): number {
  return Math.tanh(x);
}

// ============================================================================
// Generate synthetic price candles (OHLC) for demonstration.
// Uses geometric brownian motion style random walk with controllable volatility.
// ============================================================================
function generateCandles(
  seqLen: number, seed: number, volatility: number
): { open: number; high: number; low: number; close: number; volume: number }[] {
  const rng = mulberry32(seed);
  const candles = [];
  let price = 100 + rng() * 50; // Start between 100-150

  for (let i = 0; i < seqLen; i++) {
    const open = price;
    // Random walk with volatility scaling
    const change = (rng() - 0.48) * volatility * price * 0.01;
    const close = open + change;
    // High and low extend beyond open/close range
    const range = Math.abs(change) + rng() * volatility * price * 0.005;
    const high = Math.max(open, close) + rng() * range;
    const low = Math.min(open, close) - rng() * range;
    const volume = 1000 + rng() * 9000;

    candles.push({
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume: Math.round(volume),
    });
    price = close;
  }
  return candles;
}

// ============================================================================
// Simulate LSTM forward pass for visualization purposes.
// Not a real trained model, but produces realistic-looking gate activations
// and state evolution based on input features derived from candle data.
// This lets us visualise what gates/states LOOK like during processing.
// ============================================================================
function simulateLSTM(
  candles: { open: number; high: number; low: number; close: number; volume: number }[],
  hiddenSize: number,
  numLayers: number,
  seed: number,
  learningRate: number,
  dropout: number
) {
  const rng = mulberry32(seed + 42);
  const seqLen = candles.length;

  // Weight magnitude scales with hidden size using Xavier initialisation:
  // larger networks have smaller per-weight magnitude but more weights summed,
  // so the pre-activation values still vary meaningfully.
  const weightScale = 2.0 / Math.sqrt(hiddenSize + 5);

  // Generate 4 weight vectors per hidden unit (forget, input, output, candidate)
  // Each vector has 5 input weights + 1 recurrent weight + 1 bias
  const weights: { wf: number[]; wi: number[]; wo: number[]; wc: number[];
                   rf: number; ri: number; ro: number; rc: number;
                   bf: number; bi: number; bo: number; bc: number }[] = [];
  for (let h = 0; h < hiddenSize; h++) {
    weights.push({
      // Input-to-gate weights (5 features each)
      wf: Array.from({ length: 5 }, () => (rng() - 0.5) * weightScale * 2),
      wi: Array.from({ length: 5 }, () => (rng() - 0.5) * weightScale * 2),
      wo: Array.from({ length: 5 }, () => (rng() - 0.5) * weightScale * 2),
      wc: Array.from({ length: 5 }, () => (rng() - 0.5) * weightScale * 2),
      // Recurrent weights (hidden-to-gate, simplified to scalar per unit)
      rf: (rng() - 0.5) * weightScale * 1.5,
      ri: (rng() - 0.5) * weightScale * 1.5,
      ro: (rng() - 0.5) * weightScale * 1.5,
      rc: (rng() - 0.5) * weightScale * 1.5,
      // Biases: forget gate starts biased positive (common LSTM init trick so it
      // remembers by default early in training), others start near zero
      bf: 1.0 + rng() * 0.5,
      bi: -0.5 + rng() * 1.0,
      bo: 0.0 + rng() * 0.5,
      bc: 0.0,
    });
  }

  // Track all states across timesteps for visualisation
  const forgetGates: number[][] = [];
  const inputGates: number[][] = [];
  const outputGates: number[][] = [];
  const candidateValues: number[][] = [];
  const cellStates: number[][] = [];
  const hiddenStates: number[][] = [];

  // Initialise cell state and hidden state to zeros
  let cellState = new Array(hiddenSize).fill(0);
  let hiddenState = new Array(hiddenSize).fill(0);

  // More layers = more parameter interactions, producing different dynamics.
  // We simulate this by running the signal through numLayers sequential transforms,
  // each with its own weight offset derived from layer index.
  const layerMix = numLayers * 0.3;

  for (let t = 0; t < seqLen; t++) {
    const c = candles[t];
    // Normalise candle features to roughly [-2, 2] range so they drive gates
    // away from sigmoid(0)=0.5 midpoint, producing visible activation differences
    const features = [
      (c.close - c.open) / (c.open * 0.005 + 0.001),  // price change %, amplified
      (c.high - c.low) / (c.open * 0.005 + 0.001),    // range %, amplified
      (c.close - c.low) / (c.high - c.low + 0.001) * 2 - 1,  // close position [-1,1]
      (c.volume - 5000) / 3000,                         // normalised volume, wider range
      Math.sin(t * 0.2) + Math.cos(t * 0.07) * 0.5,   // richer positional encoding
    ];

    const fg: number[] = [];
    const ig: number[] = [];
    const og: number[] = [];
    const cv: number[] = [];
    const newCell: number[] = [];
    const newHidden: number[] = [];

    for (let h = 0; h < hiddenSize; h++) {
      const w = weights[h];
      // Weighted sum of input features for each gate
      let zf = w.bf, zi = w.bi, zo = w.bo, zc = w.bc;
      for (let f = 0; f < 5; f++) {
        zf += w.wf[f] * features[f];
        zi += w.wi[f] * features[f];
        zo += w.wo[f] * features[f];
        zc += w.wc[f] * features[f];
      }

      // Recurrent connection: previous hidden state feeds back into gates.
      // This is what makes the LSTM sequential; without it, each step is independent.
      const hPrev = hiddenState[h];
      zf += w.rf * hPrev * (1 + layerMix);
      zi += w.ri * hPrev * (1 + layerMix);
      zo += w.ro * hPrev * (1 + layerMix);
      zc += w.rc * hPrev * (1 + layerMix);

      // Apply activations: sigmoid for gates (0-1), tanh for candidate (-1 to 1)
      const forgetVal = sigmoid(zf);
      const inputVal = sigmoid(zi);
      const outputVal = sigmoid(zo);
      const candidateVal = tanh(zc);

      // Apply dropout mask during simulation (randomly zero out some activations).
      // Higher dropout = more units zeroed = sparser, noisier hidden state.
      const dropoutMask = rng() > dropout ? 1 : 0;

      // Core LSTM equations:
      // c_t = f_t * c_{t-1} + i_t * candidate_t  (forget old memory + add new info)
      // h_t = o_t * tanh(c_t)                      (output = gated cell state)
      const newCellVal = forgetVal * cellState[h] + inputVal * candidateVal;
      const newHiddenVal = outputVal * tanh(newCellVal) * dropoutMask;

      fg.push(forgetVal);
      ig.push(inputVal);
      og.push(outputVal);
      cv.push(candidateVal);
      newCell.push(newCellVal);
      newHidden.push(newHiddenVal);
    }

    forgetGates.push(fg);
    inputGates.push(ig);
    outputGates.push(og);
    candidateValues.push(cv);
    cellStates.push(newCell);
    hiddenStates.push(newHidden);

    cellState = newCell;
    hiddenState = newHidden;
  }

  return {
    forgetGates,
    inputGates,
    outputGates,
    candidateValues,
    cellStates,
    hiddenStates,
  };
}

// ============================================================================
// VIEW COMPONENTS: Each renders into the center SVG area
// ============================================================================

/**
 * Cell Architecture View
 * Shows the classic LSTM cell diagram with forget gate, input gate,
 * cell state, output gate, and data flow arrows. Animated when playing.
 */
function CellArchitectureView({
  width,
  height,
  animStep,
  isPlaying,
  lstmData,
  currentStep,
  hiddenSize,
}: {
  width: number;
  height: number;
  animStep: number;
  isPlaying: boolean;
  lstmData: ReturnType<typeof simulateLSTM>;
  currentStep: number;
  hiddenSize: number;
}) {
  const cx = width / 2;
  const cy = height / 2;
  // Scale everything relative to available space
  const scale = Math.min(width / 900, height / 600);

  // Get current gate values (average across hidden units for display)
  const fg = lstmData.forgetGates[currentStep];
  const ig = lstmData.inputGates[currentStep];
  const og = lstmData.outputGates[currentStep];
  const cv = lstmData.candidateValues[currentStep];

  const avgForget = fg ? fg.reduce((a, b) => a + b, 0) / fg.length : 0.5;
  const avgInput = ig ? ig.reduce((a, b) => a + b, 0) / ig.length : 0.5;
  const avgOutput = og ? og.reduce((a, b) => a + b, 0) / og.length : 0.5;
  const avgCandidate = cv ? cv.reduce((a, b) => a + b, 0) / cv.length : 0;

  // Animation pulse for data flow arrows
  const pulse = isPlaying ? Math.sin(animStep * 0.1) * 0.3 + 0.7 : 1;

  // Gate box dimensions
  const gateW = 100 * scale;
  const gateH = 50 * scale;
  const cellW = 120 * scale;
  const cellH = 60 * scale;

  // Positions for each component (laid out left to right)
  const forgetX = cx - 220 * scale;
  const inputX = cx - 60 * scale;
  const cellX = cx + 80 * scale;
  const outputX = cx + 240 * scale;
  const gateY = cy + 40 * scale;
  const cellY = cy - 60 * scale;

  /**
   * Renders a gate box with label, activation value, and fill opacity
   * proportional to the gate's current value (brighter = more open).
   */
  const renderGate = (
    x: number, y: number, label: string, value: number, color: string, sublabel: string
  ) => (
    <g key={label}>
      {/* Gate background with opacity reflecting activation level */}
      <rect
        x={x - gateW / 2} y={y - gateH / 2}
        width={gateW} height={gateH}
        rx={6 * scale} ry={6 * scale}
        fill={color}
        fillOpacity={0.15 + value * 0.35}
        stroke={color}
        strokeWidth={1.5}
        strokeOpacity={0.6 + value * 0.4}
      />
      {/* Gate label */}
      <text
        x={x} y={y - 6 * scale}
        textAnchor="middle"
        fill={COLORS.text}
        fontSize={12 * scale}
        fontFamily="monospace"
        fontWeight="600"
      >
        {label}
      </text>
      {/* Activation function indicator */}
      <text
        x={x} y={y + 10 * scale}
        textAnchor="middle"
        fill={COLORS.textDim}
        fontSize={9 * scale}
        fontFamily="monospace"
      >
        {sublabel}
      </text>
      {/* Numeric value badge */}
      <text
        x={x} y={y + gateH / 2 + 14 * scale}
        textAnchor="middle"
        fill={color}
        fontSize={11 * scale}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {value.toFixed(3)}
      </text>
    </g>
  );

  /**
   * Renders a flow arrow between two points.
   * Opacity pulses when animation is playing to show data movement.
   */
  const renderArrow = (
    x1: number, y1: number, x2: number, y2: number, color: string, dashed?: boolean
  ) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len;
    const uy = dy / len;
    // Shorten arrow to leave room for arrowhead
    const headLen = 8 * scale;
    const endX = x2 - ux * headLen;
    const endY = y2 - uy * headLen;

    return (
      <g opacity={pulse}>
        <line
          x1={x1} y1={y1} x2={endX} y2={endY}
          stroke={color} strokeWidth={1.5 * scale}
          strokeDasharray={dashed ? `${4 * scale} ${3 * scale}` : undefined}
          opacity={0.6}
        />
        {/* Arrowhead */}
        <polygon
          points={`${x2},${y2} ${endX - uy * 4 * scale},${endY + ux * 4 * scale} ${endX + uy * 4 * scale},${endY - ux * 4 * scale}`}
          fill={color}
          opacity={0.6}
        />
      </g>
    );
  };

  return (
    <g>
      {/* Title */}
      <text x={cx} y={30 * scale} textAnchor="middle" fill={COLORS.text} fontSize={14 * scale} fontFamily="monospace" fontWeight="bold">
        LSTM Cell (Timestep {currentStep + 1})
      </text>

      {/* Cell State bar (top horizontal line representing memory flowing through) */}
      <line
        x1={cx - 300 * scale} y1={cellY}
        x2={cx + 300 * scale} y2={cellY}
        stroke={COLORS.cellState} strokeWidth={3 * scale} opacity={0.4}
      />
      <text x={cx - 300 * scale} y={cellY - 12 * scale} fill={COLORS.cellState} fontSize={10 * scale} fontFamily="monospace">
        Cell State (c_t)
      </text>

      {/* Hidden State bar (bottom horizontal line representing output flowing through) */}
      <line
        x1={cx - 300 * scale} y1={gateY + 80 * scale}
        x2={cx + 300 * scale} y2={gateY + 80 * scale}
        stroke={COLORS.hiddenState} strokeWidth={2.5 * scale} opacity={0.35}
      />
      <text x={cx - 300 * scale} y={gateY + 72 * scale} fill={COLORS.hiddenState} fontSize={10 * scale} fontFamily="monospace">
        Hidden State (h_t)
      </text>

      {/* Forget Gate: decides what to remove from cell state */}
      {renderGate(forgetX, gateY, 'Forget', avgForget, COLORS.forgetGate, 'sigma()')}
      {/* Arrow from forget gate up to cell state line (multiplicative) */}
      {renderArrow(forgetX, gateY - gateH / 2, forgetX, cellY + 6 * scale, COLORS.forgetGate)}
      {/* Multiply symbol on cell state at forget gate position */}
      <circle cx={forgetX} cy={cellY} r={10 * scale} fill="none" stroke={COLORS.forgetGate} strokeWidth={1.5} opacity={0.6} />
      <text x={forgetX} y={cellY + 4 * scale} textAnchor="middle" fill={COLORS.forgetGate} fontSize={14 * scale} fontFamily="monospace">x</text>

      {/* Input Gate: decides what new information to store */}
      {renderGate(inputX, gateY, 'Input', avgInput, COLORS.inputGate, 'sigma()')}
      {/* Candidate values (tanh) shown slightly to the right of input gate */}
      {renderGate(inputX + gateW * 1.1, gateY, 'Candidate', Math.abs(avgCandidate), COLORS.amber, 'tanh()')}
      {/* Arrow from input gate up to cell state (additive) */}
      {renderArrow(inputX + gateW * 0.55, gateY - gateH / 2, inputX + gateW * 0.55, cellY + 6 * scale, COLORS.inputGate)}
      {/* Plus symbol on cell state at input position */}
      <circle cx={inputX + gateW * 0.55} cy={cellY} r={10 * scale} fill="none" stroke={COLORS.inputGate} strokeWidth={1.5} opacity={0.6} />
      <text x={inputX + gateW * 0.55} y={cellY + 4 * scale} textAnchor="middle" fill={COLORS.inputGate} fontSize={14 * scale} fontFamily="monospace">+</text>

      {/* Output Gate: decides what to output from cell state */}
      {renderGate(outputX, gateY, 'Output', avgOutput, COLORS.outputGate, 'sigma()')}
      {/* Arrow from cell state down through tanh then gated by output */}
      {renderArrow(outputX, cellY + 6 * scale, outputX, gateY - gateH / 2, COLORS.outputGate, true)}
      {/* Arrow from output gate down to hidden state line */}
      {renderArrow(outputX, gateY + gateH / 2, outputX, gateY + 74 * scale, COLORS.hiddenState)}

      {/* Input label (x_t) on far left */}
      <text x={cx - 340 * scale} y={gateY + 4 * scale} fill={COLORS.text} fontSize={11 * scale} fontFamily="monospace" textAnchor="end">
        x_t (candle)
      </text>
      {renderArrow(cx - 330 * scale, gateY, cx - 280 * scale, gateY, COLORS.textDim)}

      {/* Previous hidden state label */}
      <text x={cx - 340 * scale} y={gateY + 84 * scale} fill={COLORS.hiddenState} fontSize={10 * scale} fontFamily="monospace" textAnchor="end">
        {'h_{t-1}'}
      </text>

      {/* Output labels on far right */}
      <text x={cx + 340 * scale} y={cellY + 4 * scale} fill={COLORS.cellState} fontSize={10 * scale} fontFamily="monospace">
        c_t (memory)
      </text>
      <text x={cx + 340 * scale} y={gateY + 84 * scale} fill={COLORS.hiddenState} fontSize={10 * scale} fontFamily="monospace">
        h_t (output)
      </text>

      {/* Legend showing what each gate does in plain language */}
      <g transform={`translate(${cx - 280 * scale}, ${cy + 160 * scale})`}>
        <text fill={COLORS.textDim} fontSize={9 * scale} fontFamily="monospace" y={0}>
          Forget Gate: "Should I keep or discard old memory?"
        </text>
        <text fill={COLORS.textDim} fontSize={9 * scale} fontFamily="monospace" y={16 * scale}>
          Input Gate: "Is this new candle worth remembering?"
        </text>
        <text fill={COLORS.textDim} fontSize={9 * scale} fontFamily="monospace" y={32 * scale}>
          Output Gate: "What should I output from my memory right now?"
        </text>
        <text fill={COLORS.textDim} fontSize={9 * scale} fontFamily="monospace" y={48 * scale}>
          Cell State: Long-term memory flowing through (the conveyor belt)
        </text>
      </g>
    </g>
  );
}

/**
 * Sequence Flow View
 * Shows candles being processed one by one with hidden state bars updating.
 * Each candle enters from the left, the LSTM processes it, and the bars on
 * the right show the current hidden state values.
 */
function SequenceFlowView({
  width,
  height,
  candles,
  lstmData,
  currentStep,
  hiddenSize,
}: {
  width: number;
  height: number;
  candles: ReturnType<typeof generateCandles>;
  lstmData: ReturnType<typeof simulateLSTM>;
  currentStep: number;
  hiddenSize: number;
}) {
  const margin = { top: 50, right: 200, bottom: 40, left: 60 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const seqLen = candles.length;

  // Price range for y-axis scaling
  const allPrices = candles.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const priceRange = maxP - minP || 1;

  // X and Y mapping functions
  const xScale = (i: number) => margin.left + (i / (seqLen - 1)) * chartW;
  const yScale = (p: number) => margin.top + (1 - (p - minP) / priceRange) * chartH;

  // Hidden state bar chart on the right side
  const barAreaX = width - margin.right + 20;
  const barAreaW = margin.right - 40;
  const barH = Math.min(8, (chartH - 20) / hiddenSize);
  const currentHidden = lstmData.hiddenStates[currentStep] || new Array(hiddenSize).fill(0);

  // Find max absolute value for bar scaling
  const maxAbs = Math.max(0.01, ...currentHidden.map(Math.abs));

  return (
    <g>
      {/* Title */}
      <text x={width / 2} y={20} textAnchor="middle" fill={COLORS.text} fontSize={13} fontFamily="monospace" fontWeight="bold">
        Sequence Processing (Step {currentStep + 1} / {seqLen})
      </text>

      {/* Y-axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const price = minP + frac * priceRange;
        const y = yScale(price);
        return (
          <g key={frac}>
            <line x1={margin.left} y1={y} x2={margin.left + chartW} y2={y} stroke={COLORS.gridLine} strokeWidth={1} />
            <text x={margin.left - 8} y={y + 4} textAnchor="end" fill={COLORS.textDim} fontSize={11} fontFamily="monospace">
              {price.toFixed(1)}
            </text>
          </g>
        );
      })}

      {/* Candlesticks */}
      {candles.map((c, i) => {
        const x = xScale(i);
        const candleW = Math.max(2, chartW / seqLen * 0.6);
        const isGreen = c.close >= c.open;
        // Candles up to currentStep are fully visible; future candles are dimmed
        const opacity = i <= currentStep ? 1 : 0.15;
        // Highlight the current candle being processed
        const isCurrent = i === currentStep;
        const bodyColor = isGreen ? '#21b3a4' : '#f0426c';

        return (
          <g key={i} opacity={opacity}>
            {/* Highlight box around current candle */}
            {isCurrent && (
              <rect
                x={x - candleW - 2} y={margin.top - 5}
                width={candleW * 2 + 4} height={chartH + 10}
                fill={COLORS.emerald} fillOpacity={0.08}
                stroke={COLORS.emerald} strokeWidth={1} strokeOpacity={0.3}
                rx={2}
              />
            )}
            {/* Wick (high to low) */}
            <line
              x1={x} y1={yScale(c.high)} x2={x} y2={yScale(c.low)}
              stroke={bodyColor} strokeWidth={1}
            />
            {/* Body (open to close) */}
            <rect
              x={x - candleW / 2}
              y={yScale(Math.max(c.open, c.close))}
              width={candleW}
              height={Math.max(1, Math.abs(yScale(c.open) - yScale(c.close)))}
              fill={isGreen ? bodyColor : bodyColor}
              stroke={bodyColor}
              strokeWidth={0.5}
            />
          </g>
        );
      })}

      {/* Processing arrow from current candle to hidden state panel */}
      {currentStep < seqLen && (
        <line
          x1={xScale(currentStep) + 10} y1={margin.top + chartH / 2}
          x2={barAreaX - 5} y2={margin.top + chartH / 2}
          stroke={COLORS.emerald} strokeWidth={1} strokeDasharray="4 3" opacity={0.4}
        />
      )}

      {/* Hidden State bar chart */}
      <text x={barAreaX + barAreaW / 2} y={margin.top - 8} textAnchor="middle" fill={COLORS.text} fontSize={10} fontFamily="monospace">
        Hidden State
      </text>
      {currentHidden.slice(0, Math.min(hiddenSize, 40)).map((val, i) => {
        const barY = margin.top + i * barH;
        const barWidth = (Math.abs(val) / maxAbs) * (barAreaW / 2);
        const isPositive = val >= 0;
        const barX = barAreaX + barAreaW / 2;

        return (
          <g key={i}>
            {/* Center line */}
            {i === 0 && (
              <line x1={barX} y1={margin.top} x2={barX} y2={margin.top + Math.min(hiddenSize, 40) * barH} stroke={COLORS.gridLine} strokeWidth={1} />
            )}
            {/* Bar extending left (negative) or right (positive) from center */}
            <rect
              x={isPositive ? barX : barX - barWidth}
              y={barY}
              width={barWidth}
              height={Math.max(1, barH - 1)}
              fill={isPositive ? COLORS.emerald : COLORS.red}
              opacity={0.5 + Math.abs(val) / maxAbs * 0.4}
            />
          </g>
        );
      })}
      {hiddenSize > 40 && (
        <text x={barAreaX + barAreaW / 2} y={margin.top + 41 * barH} textAnchor="middle" fill={COLORS.textDim} fontSize={10} fontFamily="monospace">
          ... +{hiddenSize - 40} more
        </text>
      )}

      {/* Y-axis label */}
      <text
        x={margin.left - 45} y={margin.top + chartH / 2}
        textAnchor="middle" fill={COLORS.textDim} fontSize={12} fontFamily="monospace"
        transform={`rotate(-90, ${margin.left - 45}, ${margin.top + chartH / 2})`}
      >
        Price ($)
      </text>
      {/* X-axis label */}
      <text x={margin.left + chartW / 2} y={height - 10} textAnchor="middle" fill={COLORS.textDim} fontSize={12} fontFamily="monospace">
        Candle (timestep)
      </text>
    </g>
  );
}

/**
 * Gate Activations Heatmap View
 * Shows a grid where rows = hidden units, columns = timesteps,
 * coloured by activation value. Three panels: forget, input, output gates.
 */
function GateActivationsView({
  width,
  height,
  lstmData,
  currentStep,
  hiddenSize,
  seqLen,
}: {
  width: number;
  height: number;
  lstmData: ReturnType<typeof simulateLSTM>;
  currentStep: number;
  hiddenSize: number;
  seqLen: number;
}) {
  const margin = { top: 30, right: 20, bottom: 30, left: 80 };
  // Three panels stacked vertically for forget, input, output gates
  const panelH = (height - margin.top - margin.bottom - 40) / 3;
  const chartW = width - margin.left - margin.right;
  // Limit displayed hidden units to keep cells visible
  const displayHidden = Math.min(hiddenSize, 20);
  const cellW = Math.min(20, chartW / seqLen);
  const cellH = Math.min(12, panelH / displayHidden);

  const gates = [
    { data: lstmData.forgetGates, label: 'Forget Gate (what to discard)', color: COLORS.forgetGate },
    { data: lstmData.inputGates, label: 'Input Gate (what to store)', color: COLORS.inputGate },
    { data: lstmData.outputGates, label: 'Output Gate (what to output)', color: COLORS.outputGate },
  ];

  return (
    <g>
      <text x={width / 2} y={18} textAnchor="middle" fill={COLORS.text} fontSize={13} fontFamily="monospace" fontWeight="bold">
        Gate Activations Heatmap
      </text>

      {gates.map((gate, gi) => {
        const panelY = margin.top + gi * (panelH + 15);

        return (
          <g key={gi}>
            {/* Panel label */}
            <text x={margin.left - 8} y={panelY + 10} textAnchor="end" fill={gate.color} fontSize={11} fontFamily="monospace" fontWeight="600">
              {gate.label}
            </text>

            {/* Heatmap cells */}
            {Array.from({ length: Math.min(seqLen, currentStep + 1) }).map((_, t) => (
              <g key={t}>
                {Array.from({ length: displayHidden }).map((_, h) => {
                  const val = gate.data[t]?.[h] ?? 0;
                  return (
                    <rect
                      key={h}
                      x={margin.left + t * cellW}
                      y={panelY + 16 + h * cellH}
                      width={cellW - 0.5}
                      height={cellH - 0.5}
                      fill={gate.color}
                      fillOpacity={val * 0.8 + 0.05}
                      rx={1}
                    />
                  );
                })}
              </g>
            ))}

            {/* Current step indicator line */}
            <line
              x1={margin.left + currentStep * cellW + cellW / 2}
              y1={panelY + 14}
              x2={margin.left + currentStep * cellW + cellW / 2}
              y2={panelY + 16 + displayHidden * cellH + 2}
              stroke={COLORS.text}
              strokeWidth={1}
              opacity={0.5}
              strokeDasharray="2 2"
            />

            {/* Y-axis: hidden unit indices */}
            {[0, Math.floor(displayHidden / 2), displayHidden - 1].map(h => (
              <text key={h} x={margin.left - 4} y={panelY + 16 + h * cellH + cellH / 2 + 3} textAnchor="end" fill={COLORS.textMuted} fontSize={10} fontFamily="monospace">
                h{h}
              </text>
            ))}
          </g>
        );
      })}

      {/* X-axis: timestep labels */}
      <text x={margin.left} y={height - 8} fill={COLORS.textDim} fontSize={10} fontFamily="monospace">
        Timestep 1
      </text>
      <text x={margin.left + Math.min(seqLen, currentStep + 1) * cellW} y={height - 8} textAnchor="end" fill={COLORS.textDim} fontSize={10} fontFamily="monospace">
        Step {currentStep + 1}
      </text>

      {/* Colour scale legend */}
      <g transform={`translate(${width - 100}, ${height - 25})`}>
        <text fill={COLORS.textDim} fontSize={10} fontFamily="monospace" y={0}>0.0</text>
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v, i) => (
          <rect key={i} x={18 + i * 10} y={-8} width={10} height={8} fill={COLORS.emerald} fillOpacity={v * 0.8 + 0.05} />
        ))}
        <text fill={COLORS.textDim} fontSize={10} fontFamily="monospace" x={82} y={0}>1.0</text>
      </g>
    </g>
  );
}

/**
 * Memory State View
 * Line charts showing cell state and hidden state values over time.
 * Each hidden unit gets its own line, with the mean highlighted.
 */
function MemoryStateView({
  width,
  height,
  lstmData,
  currentStep,
  hiddenSize,
}: {
  width: number;
  height: number;
  lstmData: ReturnType<typeof simulateLSTM>;
  currentStep: number;
  hiddenSize: number;
}) {
  const margin = { top: 30, right: 30, bottom: 40, left: 60 };
  // Two panels stacked: cell state on top, hidden state on bottom
  const panelH = (height - margin.top - margin.bottom - 30) / 2;
  const chartW = width - margin.left - margin.right;
  const steps = currentStep + 1;

  const panels = [
    { data: lstmData.cellStates, label: 'Cell State (c_t) - Long-term Memory', color: COLORS.cellState },
    { data: lstmData.hiddenStates, label: 'Hidden State (h_t) - Output', color: COLORS.hiddenState },
  ];

  return (
    <g>
      <text x={width / 2} y={18} textAnchor="middle" fill={COLORS.text} fontSize={13} fontFamily="monospace" fontWeight="bold">
        Memory Evolution Over Time
      </text>

      {panels.map((panel, pi) => {
        const panelY = margin.top + pi * (panelH + 20);

        // Find value range across all visible timesteps and hidden units
        const allVals = panel.data.slice(0, steps).flatMap(s => s.slice(0, hiddenSize));
        const minV = allVals.length > 0 ? Math.min(...allVals) : -1;
        const maxV = allVals.length > 0 ? Math.max(...allVals) : 1;
        const range = maxV - minV || 1;

        const xScale = (t: number) => margin.left + (t / Math.max(1, steps - 1)) * chartW;
        const yScale = (v: number) => panelY + panelH - ((v - minV) / range) * panelH;

        // Compute mean across hidden units at each timestep
        const means = panel.data.slice(0, steps).map(
          s => s.slice(0, hiddenSize).reduce((a, b) => a + b, 0) / hiddenSize
        );

        // Show a subset of individual hidden unit lines (up to 8 for readability)
        const displayUnits = Math.min(hiddenSize, 8);

        return (
          <g key={pi}>
            {/* Panel label */}
            <text x={margin.left} y={panelY - 6} fill={panel.color} fontSize={10} fontFamily="monospace" fontWeight="600">
              {panel.label}
            </text>

            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map(frac => {
              const y = panelY + panelH - frac * panelH;
              const val = minV + frac * range;
              return (
                <g key={frac}>
                  <line x1={margin.left} y1={y} x2={margin.left + chartW} y2={y} stroke={COLORS.gridLine} strokeWidth={1} />
                  <text x={margin.left - 8} y={y + 3} textAnchor="end" fill={COLORS.textMuted} fontSize={10} fontFamily="monospace">
                    {val.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {/* Individual hidden unit lines (thin, faint) */}
            {Array.from({ length: displayUnits }).map((_, h_idx: number) => {
              const points = panel.data.slice(0, steps).map(
                (s: number[], t: number) => `${xScale(t)},${yScale(s[h_idx])}`
              ).join(' ');

              return (
                <polyline
                  key={h_idx}
                  points={points}
                  fill="none"
                  stroke={panel.color}
                  strokeWidth={0.8}
                  opacity={0.15}
                />
              );
            })}

            {/* Mean line (bold, prominent) */}
            {means.length > 1 && (
              <polyline
                points={means.map((v, t) => `${xScale(t)},${yScale(v)}`).join(' ')}
                fill="none"
                stroke={panel.color}
                strokeWidth={2}
                opacity={0.8}
              />
            )}

            {/* Current step dot */}
            {means.length > 0 && (
              <circle
                cx={xScale(currentStep)}
                cy={yScale(means[currentStep])}
                r={4}
                fill={panel.color}
                stroke={COLORS.bg}
                strokeWidth={1.5}
              />
            )}

            {/* Zero line if range crosses zero */}
            {minV < 0 && maxV > 0 && (
              <line
                x1={margin.left} y1={yScale(0)} x2={margin.left + chartW} y2={yScale(0)}
                stroke={COLORS.textDim} strokeWidth={1} strokeDasharray="3 3" opacity={0.3}
              />
            )}
          </g>
        );
      })}

      {/* X-axis label */}
      <text x={width / 2} y={height - 8} textAnchor="middle" fill={COLORS.textDim} fontSize={12} fontFamily="monospace">
        Timestep
      </text>
    </g>
  );
}

/**
 * Prediction View
 * Shows the final hidden state being projected to trading signals.
 * Displays confidence scores for Buy/Sell/Hold predictions.
 */
function PredictionView({
  width,
  height,
  lstmData,
  currentStep,
  hiddenSize,
  candles,
  seed,
}: {
  width: number;
  height: number;
  lstmData: ReturnType<typeof simulateLSTM>;
  currentStep: number;
  hiddenSize: number;
  candles: ReturnType<typeof generateCandles>;
  seed: number;
}) {
  const rng = mulberry32(seed + 999);
  const cx = width / 2;
  const margin = { top: 50, bottom: 30 };

  // Get final hidden state and project to 3 outputs (Buy, Sell, Hold)
  // Uses random projection weights (simulating a trained linear layer)
  const hidden = lstmData.hiddenStates[currentStep] || new Array(hiddenSize).fill(0);

  // Generate projection weights once per seed
  const projWeights: number[][] = [[], [], []];
  for (let o = 0; o < 3; o++) {
    for (let h = 0; h < hiddenSize; h++) {
      projWeights[o].push((rng() - 0.5) * 2);
    }
  }

  // Raw logits from linear projection
  const logits = projWeights.map(w =>
    w.reduce((sum, wh, h) => sum + wh * hidden[h], 0)
  );

  // Softmax to get probabilities (standard exp normalization)
  const maxLogit = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - maxLogit));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(e => e / sumExps);

  const signals = [
    { label: 'BUY', prob: probs[0], color: '#21b3a4' },
    { label: 'SELL', prob: probs[1], color: '#f0426c' },
    { label: 'HOLD', prob: probs[2], color: COLORS.slate },
  ];

  // Sort by probability for display
  const sorted = [...signals].sort((a, b) => b.prob - a.prob);
  const prediction = sorted[0];

  // Price context from recent candles
  const recentClose = candles[currentStep]?.close ?? 0;
  const prevClose = currentStep > 0 ? candles[currentStep - 1]?.close ?? recentClose : recentClose;
  const priceChange = ((recentClose - prevClose) / prevClose * 100);

  const barMaxW = 300;
  const barH = 40;

  return (
    <g>
      {/* Title */}
      <text x={cx} y={30} textAnchor="middle" fill={COLORS.text} fontSize={13} fontFamily="monospace" fontWeight="bold">
        LSTM Prediction at Timestep {currentStep + 1}
      </text>

      {/* Current price context */}
      <text x={cx} y={60} textAnchor="middle" fill={COLORS.textDim} fontSize={10} fontFamily="monospace">
        Current: ${recentClose.toFixed(2)} ({priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%)
      </text>

      {/* Hidden state summary */}
      <text x={cx} y={85} textAnchor="middle" fill={COLORS.textDim} fontSize={11} fontFamily="monospace">
        Hidden state ({hiddenSize} units) projected through linear layer + softmax
      </text>

      {/* Signal probability bars */}
      {sorted.map((sig, i) => {
        const y = 120 + i * (barH + 25);
        const barW = sig.prob * barMaxW;
        const isPrimary = i === 0;

        return (
          <g key={sig.label}>
            {/* Label */}
            <text
              x={cx - barMaxW / 2 - 10} y={y + barH / 2 + 5}
              textAnchor="end"
              fill={isPrimary ? COLORS.text : COLORS.textDim}
              fontSize={isPrimary ? 14 : 12}
              fontFamily="monospace"
              fontWeight={isPrimary ? 'bold' : 'normal'}
            >
              {sig.label}
            </text>

            {/* Background bar */}
            <rect
              x={cx - barMaxW / 2} y={y}
              width={barMaxW} height={barH}
              fill={COLORS.gridLine} rx={4}
            />

            {/* Filled bar proportional to probability */}
            <rect
              x={cx - barMaxW / 2} y={y}
              width={barW} height={barH}
              fill={sig.color}
              fillOpacity={isPrimary ? 0.6 : 0.3}
              rx={4}
            />

            {/* Probability percentage */}
            <text
              x={cx - barMaxW / 2 + barW + 10} y={y + barH / 2 + 5}
              fill={isPrimary ? COLORS.text : COLORS.textDim}
              fontSize={12}
              fontFamily="monospace"
              fontWeight={isPrimary ? 'bold' : 'normal'}
            >
              {(sig.prob * 100).toFixed(1)}%
            </text>
          </g>
        );
      })}

      {/* Prediction summary */}
      <rect
        x={cx - 140} y={320}
        width={280} height={50}
        fill={prediction.color} fillOpacity={0.1}
        stroke={prediction.color} strokeWidth={1.5} strokeOpacity={0.4}
        rx={8}
      />
      <text x={cx} y={340} textAnchor="middle" fill={COLORS.textDim} fontSize={10} fontFamily="monospace">
        SIGNAL
      </text>
      <text x={cx} y={360} textAnchor="middle" fill={prediction.color} fontSize={18} fontFamily="monospace" fontWeight="bold">
        {prediction.label} ({(prediction.prob * 100).toFixed(1)}%)
      </text>

      {/* Disclaimer */}
      <text x={cx} y={height - 30} textAnchor="middle" fill={COLORS.textMuted} fontSize={10} fontFamily="monospace">
        Simulated output from random weights. Real predictions require trained model weights.
      </text>
      <text x={cx} y={height - 16} textAnchor="middle" fill={COLORS.textMuted} fontSize={10} fontFamily="monospace">
        This demonstrates the architecture, not actual market prediction capability.
      </text>
    </g>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function LSTMVisualization() {
  // Network configuration
  const [hiddenSize, setHiddenSize] = useState(32);
  const [numLayers, setNumLayers] = useState(2);
  const [seqLen, setSeqLen] = useState(100);
  const [learningRate, setLearningRate] = useState(0.001);
  const [dropout, setDropout] = useState(0.2);
  const [volatility, setVolatility] = useState(2.0);
  const [seed, setSeed] = useState(42);
  // Animation speed: ms per step. Lower = faster.
  const [speed, setSpeed] = useState(100);

  // View and animation state
  const [viewMode, setViewMode] = useState<ViewMode>('architecture');
  const [isPlaying, setIsPlaying] = useState(false);
  // Start at the end so the user sees the full picture immediately.
  const [currentStep, setCurrentStep] = useState(seqLen - 1);
  const [animStep, setAnimStep] = useState(0);
  // Panels collapsed by default so the visualisation dominates the screen.
  // User opens them when they want to tweak config or check stats.
  const [showParams, setShowParams] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Pan/zoom state: transform applied to the inner <g> group so the user
  // can drag to pan and scroll to zoom, matching the XGBoost tree interaction.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // SVG container reference for responsive sizing
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ width: 800, height: 500 });

  // Measure container on mount and resize
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setSvgSize({ width: rect.width, height: rect.height });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Reset pan/zoom when view mode changes so each view starts centered
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [viewMode]);

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
      // Zoom toward the mouse cursor position so the point under the cursor stays fixed
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

  // Double-click to reset view back to default pan/zoom
  const handleDoubleClick = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Generate candle data and LSTM simulation, memoised on config changes
  const candles = useMemo(
    () => generateCandles(seqLen, seed, volatility),
    [seqLen, seed, volatility]
  );

  const lstmData = useMemo(
    () => simulateLSTM(candles, hiddenSize, numLayers, seed, learningRate, dropout),
    [candles, hiddenSize, numLayers, seed, learningRate, dropout]
  );

  // Animation timer: advances currentStep and animStep when playing
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setAnimStep(prev => prev + 1);
      setCurrentStep(prev => {
        if (prev >= seqLen - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, speed);
    return () => clearInterval(interval);
  }, [isPlaying, seqLen, speed]);

  // Reset shows all data (jump to end). Play button handles resetting to 0 before animating.
  const resetAnimation = useCallback(() => {
    setCurrentStep(seqLen - 1);
    setAnimStep(0);
    setIsPlaying(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [seqLen]);

  // Step forward one timestep
  const stepForward = useCallback(() => {
    setCurrentStep(prev => Math.min(prev + 1, seqLen - 1));
    setAnimStep(prev => prev + 1);
  }, [seqLen]);

  // Network statistics computed from config and simulation
  const stats = useMemo(() => {
    // LSTM parameter count: 4 * (hidden * input + hidden * hidden + hidden) per layer
    // 4 gates, each with input weights, recurrent weights, and bias
    const inputSize = 5; // We use 5 features per candle
    const paramsPerLayer = (i: number) => {
      const inSize = i === 0 ? inputSize : hiddenSize;
      return 4 * (inSize * hiddenSize + hiddenSize * hiddenSize + hiddenSize);
    };
    const totalParams = Array.from({ length: numLayers }).reduce(
      (sum: number, _, i) => sum + paramsPerLayer(i), 0
    ) as number;

    // Current state statistics
    const h = lstmData.hiddenStates[currentStep] || [];
    const c = lstmData.cellStates[currentStep] || [];
    const fg = lstmData.forgetGates[currentStep] || [];
    const ig = lstmData.inputGates[currentStep] || [];

    const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const std = (arr: number[]) => {
      if (!arr.length) return 0;
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
    };

    return {
      totalParams,
      hiddenMean: mean(h),
      hiddenStd: std(h),
      cellMean: mean(c),
      cellStd: std(c),
      forgetMean: mean(fg),
      inputMean: mean(ig),
      architecture: `${inputSize} > ${Array(numLayers).fill(hiddenSize).join(' > ')} > 3`,
    };
  }, [hiddenSize, numLayers, lstmData, currentStep]);

  return (
    <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[#1c1c1c] rounded-lg overflow-hidden border border-border">
      {/* Header bar */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none z-10">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-card text-[#e8e8e8] rounded-lg px-4 py-2 border border-border flex items-center gap-2">
            <span className="font-semibold text-[#e8e8e8]">LSTM Network</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-[#b0b0b0] cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="text-sm">Interactive Long Short-Term Memory visualisation. LSTM cells process sequential candle data, maintaining memory of past patterns through gated read/write operations.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <Button
            variant={isPlaying ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              if (!isPlaying) {
                if (currentStep >= seqLen - 1) setCurrentStep(0);
                setIsPlaying(true);
              } else {
                setIsPlaying(false);
              }
            }}
            className={isPlaying ? '' : 'bg-card text-[#e8e8e8]'}
          >
            {isPlaying ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
            {isPlaying ? 'Pause' : 'Play'}
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={stepForward}
            className="bg-card text-[#e8e8e8]"
            disabled={currentStep >= seqLen - 1}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={resetAnimation}
            className="bg-card text-[#e8e8e8]"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Left Panel: Network Configuration */}
      <div className="absolute left-4 top-20 w-64 space-y-2 pointer-events-auto z-10">
        <Collapsible open={showParams} onOpenChange={setShowParams}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[#e8e8e8]">
              <span className="flex items-center gap-2"><Settings className="h-4 w-4" />Network Config</span>
              {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card text-[#e8e8e8] border-border space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Hidden Size</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{hiddenSize}</span>
                </div>
                <Slider value={[hiddenSize]} onValueChange={([v]) => { setHiddenSize(v); resetAnimation(); }} min={4} max={128} step={4} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Layers</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{numLayers}</span>
                </div>
                <Slider value={[numLayers]} onValueChange={([v]) => { setNumLayers(v); resetAnimation(); }} min={1} max={4} step={1} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Sequence Length</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{seqLen}</span>
                </div>
                <Slider value={[seqLen]} onValueChange={([v]) => { setSeqLen(v); resetAnimation(); }} min={10} max={1000} step={10} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Dropout</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{dropout.toFixed(2)}</span>
                </div>
                <Slider value={[dropout]} onValueChange={([v]) => { setDropout(v); resetAnimation(); }} min={0} max={0.5} step={0.05} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Volatility</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{volatility.toFixed(1)}</span>
                </div>
                <Slider value={[volatility]} onValueChange={([v]) => { setVolatility(v); resetAnimation(); }} min={0.5} max={5} step={0.5} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Seed</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{seed}</span>
                </div>
                <Slider value={[seed]} onValueChange={([v]) => { setSeed(v); resetAnimation(); }} min={0} max={999} step={1} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Speed</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{speed <= 30 ? 'Max' : speed <= 80 ? 'Fast' : speed <= 150 ? 'Normal' : 'Slow'}</span>
                </div>
                <Slider value={[speed]} onValueChange={([v]) => setSpeed(v)} min={10} max={500} step={10} />
              </div>

              {/* Timestep scrubber: lets user jump to any step */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Timestep</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{currentStep + 1} / {seqLen}</span>
                </div>
                <Slider
                  value={[currentStep]}
                  onValueChange={([v]) => setCurrentStep(v)}
                  min={0}
                  max={seqLen - 1}
                  step={1}
                />
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Right Panel: Statistics */}
      <div className="absolute right-4 top-20 w-56 pointer-events-auto z-10">
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[#e8e8e8]">
              <span className="flex items-center gap-2"><Info className="h-4 w-4" />Network Stats</span>
              {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-3 bg-card text-[#e8e8e8] border-border space-y-3">
              <div className="flex justify-between">
                <span className="text-xs text-[#b0b0b0]">Parameters</span>
                <span className="text-sm font-medium text-[#e8e8e8]">{stats.totalParams.toLocaleString()}</span>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="text-xs text-[#b0b0b0] mb-1">Architecture</div>
                <div className="text-xs font-mono text-[#e8e8e8]">{stats.architecture}</div>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-[#808080]">Forget gate</span>
                <span className="text-xs font-mono" style={{ color: COLORS.forgetGate }}>{stats.forgetMean.toFixed(3)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-[#808080]">Input gate</span>
                <span className="text-xs font-mono" style={{ color: COLORS.inputGate }}>{stats.inputMean.toFixed(3)}</span>
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Center: SVG Visualisation */}
      <div ref={containerRef} className="absolute inset-0 top-16 bottom-0 left-0 right-0">
        <svg
          ref={svgRef}
          width={svgSize.width}
          height={svgSize.height}
          viewBox={`0 0 ${svgSize.width} ${svgSize.height}`}
          className="w-full h-full"
          style={{
            background: 'var(--bg, #1c1c1c)',
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          {/* Transformed group: all visualisation content lives here, pan/zoom applied.
              Drag to pan, scroll to zoom, double-click to reset. */}
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            <CellArchitectureView
              width={svgSize.width}
              height={svgSize.height}
              animStep={animStep}
              isPlaying={isPlaying}
              lstmData={lstmData}
              currentStep={currentStep}
              hiddenSize={hiddenSize}
            />
          </g>

          {/* HUD overlay: zoom level indicator (not affected by pan/zoom) */}
          {zoom !== 1 && (
            <g transform={`translate(${svgSize.width - 120}, 12)`}>
              <rect width={100} height={22} rx={4} fill="#2a2a2a" stroke="#3a3a3a" />
              <text x={50} y={15} textAnchor="middle" fill={COLORS.textDim} fontSize={10} fontFamily="monospace">
                zoom: {(zoom * 100).toFixed(0)}%
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Bottom info bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto z-10">
        <div className="bg-card text-[#e8e8e8] rounded-lg px-4 py-2 border border-border flex items-center gap-4 text-xs text-[#b0b0b0]">
          <span>drag: pan</span>
          <span className="text-border">|</span>
          <span>scroll: zoom</span>
          <span className="text-border">|</span>
          <span>dbl-click: reset</span>
          <span className="text-border">|</span>
          <span>Play to animate sequence</span>
        </div>
      </div>
    </div>
  );
}
