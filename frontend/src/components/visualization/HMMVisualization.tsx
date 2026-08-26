/**
 * Hidden Markov Model (HMM) - Interactive Regime Detection Visualisation
 *
 * Educational visualisation showing how HMMs detect market regimes (bull/bear/sideways)
 * from price data. All data generated client-side with seeded PRNG.
 *
 * Dashboard layout:
 * - LEFT: Model configuration (states, transition stickiness, regime params, etc.)
 * - CENTER: 5 view modes
 * - RIGHT: Live statistics (current regime, transition counts, log-likelihood)
 *
 * Views:
 * - Regime Chart: Price chart with coloured regime overlays showing detected states
 * - Transition Matrix: Interactive heatmap of state-to-state transition probabilities
 * - State Probabilities: Stacked area chart of posterior state probabilities over time
 * - Emission Distributions: Overlapping bell curves showing return distributions per regime
 * - Viterbi Path: Most likely state sequence with confidence shading
 *
 * Monochrome base palette with regime-specific accent colours for state distinction.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Settings, ChevronDown, ChevronUp, RotateCcw, Play, Pause, SkipForward, Info, Zap, X
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ============================================================================
// Seeded PRNG (mulberry32) for deterministic outputs across re-renders.
// ============================================================================
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform: generates normally distributed random numbers
// from uniform random numbers. Required for generating realistic returns
// from each regime's Gaussian emission distribution.
function normalRandom(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

// ============================================================================
// Monochrome base palette with regime-specific accent colours.
// Regimes need distinct colours to be visually meaningful on charts.
// ============================================================================
const COLORS = {
  bg: '#1c1c1c',
  cardBg: '#2a2a2a',
  gridLine: '#2e2e2e',
  text: '#e8e8e8',
  textDim: '#b0b0b0',
  textMuted: '#808080',
  // Regime colours: muted but distinguishable. Each regime gets a unique hue
  // so the user can instantly see state transitions on the price chart.
  // Institutional regime terminology matching how quant desks label market states.
  regimes: [
  // Terminal palette roles: teal = up/risk-on, rose = down/risk-off, amber = stress
  // warning. Momentum/Recovery get desaturated olive/mauve because six states need
  // six distinguishable hues and the terminal bans blue/neon accents.
    { name: 'Risk On', color: '#21b3a4', colorLight: '#3bc9ba', bg: 'rgba(33,179,164,0.12)' },
    { name: 'Risk Off', color: '#f0426c', colorLight: '#f4688a', bg: 'rgba(240,66,108,0.12)' },
    { name: 'Low Vol', color: '#808080', colorLight: '#b0b0b0', bg: 'rgba(128,128,128,0.12)' },
    { name: 'Stress', color: '#c58435', colorLight: '#d69c55', bg: 'rgba(197,132,53,0.12)' },
    { name: 'Momentum', color: '#8f9a62', colorLight: '#a8b378', bg: 'rgba(143,154,98,0.12)' },
    { name: 'Recovery', color: '#9d7a9d', colorLight: '#b393b3', bg: 'rgba(157,122,157,0.12)' },
  ],
};

type ViewMode = 'regimes' | 'probabilities' | 'emissions' | 'viterbi';

const VIEW_MODES: { id: ViewMode; label: string; desc: string }[] = [
  { id: 'regimes', label: 'Regime Chart', desc: 'Price with detected regime overlays' },
  { id: 'probabilities', label: 'State Probs', desc: 'Posterior state probabilities over time' },
  { id: 'emissions', label: 'Emissions', desc: 'Return distribution per regime' },
  { id: 'viterbi', label: 'Viterbi Path', desc: 'Most likely state sequence' },
];

// ============================================================================
// HMM regime parameters: each state has a mean return and volatility.
// These define the Gaussian emission distribution for each hidden state.
// ============================================================================
interface RegimeParams {
  meanReturn: number;   // daily return in % (e.g., 0.05 = 5 bps/day)
  volatility: number;   // daily volatility in % (e.g., 1.0 = 1%/day)
}

// Default regime params designed to produce dramatic, visually distinct price action.
// Wider parameter spread makes regime transitions obvious on the chart.
const DEFAULT_REGIMES: RegimeParams[] = [
  { meanReturn: 0.15, volatility: 0.6 },    // Bull: steady grind up, low vol
  { meanReturn: -0.25, volatility: 2.0 },   // Bear: sells off hard, high vol
  { meanReturn: 0.0, volatility: 0.3 },     // Sideways: flat, very quiet
  { meanReturn: -0.5, volatility: 3.5 },    // Crisis: crash, extreme vol
  { meanReturn: 0.35, volatility: 1.5 },    // Euphoria: rips higher, elevated vol
  { meanReturn: 0.45, volatility: 2.5 },    // Recovery: strong bounce after crash
];

// ============================================================================
// Generate synthetic price data with true hidden regime states.
// The HMM generates data by: (1) sampling a state from the transition matrix,
// (2) sampling a return from that state's emission distribution,
// (3) applying the return to get the next price.
// ============================================================================
function generateHMMData(
  seqLen: number,
  numStates: number,
  stickiness: number,
  regimes: RegimeParams[],
  seed: number,
) {
  const rng = mulberry32(seed);

  // Build transition matrix with non-uniform off-diagonal entries.
  // Real markets don't transition equally to all states. Bull is more likely
  // to go to Sideways than Crisis. Bear is more likely to go to Crisis than
  // Euphoria. This makes the arrow labels visually distinct instead of all
  // showing the same 1.7%.
  const transMatrix: number[][] = [];
  for (let i = 0; i < numStates; i++) {
    const row: number[] = [];
    const offDiagTotal = 1 - stickiness;
    // Generate random weights for off-diagonal, seeded per state pair
    const offWeights: number[] = [];
    let weightSum = 0;
    for (let j = 0; j < numStates; j++) {
      if (i === j) {
        offWeights.push(0);
      } else {
        // Neighbouring states get higher transition probability (more realistic)
        const dist = Math.abs(i - j);
        const w = (1 / dist) * (0.5 + rng() * 1.0);
        offWeights.push(w);
        weightSum += w;
      }
    }
    for (let j = 0; j < numStates; j++) {
      if (i === j) {
        row.push(stickiness);
      } else {
        row.push((offWeights[j] / weightSum) * offDiagTotal);
      }
    }
    transMatrix.push(row);
  }

  let currentState = 0;

  const trueStates: number[] = [];
  const returns: number[] = [];
  const prices: number[] = [100];

  // Track previous return for momentum/mean-reversion effects.
  // Real markets have autocorrelated returns: bull regimes show momentum
  // (positive returns follow positive), bear regimes show panic cascading,
  // sideways shows mean-reversion (bounces between tight range).
  let prevReturn = 0;

  for (let t = 0; t < seqLen; t++) {
    const roll = rng();
    let cumProb = 0;
    let nextState = currentState;
    for (let s = 0; s < numStates; s++) {
      cumProb += transMatrix[currentState][s];
      if (roll < cumProb) {
        nextState = s;
        break;
      }
    }
    currentState = nextState;
    trueStates.push(currentState);

    const regime = regimes[currentState];
    // Base return from regime emission distribution
    let ret = regime.meanReturn + regime.volatility * normalRandom(rng);

    // Add autocorrelation to make price action look realistic:
    // - Bull/Euphoria: slight momentum (trending behaviour, returns carry over)
    // - Bear/Crisis: strong momentum (panic cascading, sell-offs accelerate)
    // - Sideways: mean-reversion (returns snap back toward zero)
    if (currentState === 0 || currentState === 4) {
      // Bull/Euphoria: 20% momentum carry from previous return
      ret += prevReturn * 0.2;
    } else if (currentState === 1 || currentState === 3) {
      // Bear/Crisis: 30% momentum (panic feeds on itself)
      ret += prevReturn * 0.3;
    } else {
      // Sideways: mean-revert, dampen previous return
      ret -= prevReturn * 0.3;
    }

    returns.push(ret);
    prevReturn = ret;

    const prevPrice = prices[prices.length - 1];
    prices.push(prevPrice * (1 + ret / 100));
  }

  return { trueStates, returns, prices, transMatrix };
}

// ============================================================================
// Forward algorithm: computes posterior state probabilities at each timestep.
// This is the core HMM inference algorithm. For each timestep, it combines:
// (1) the prior from the transition matrix with (2) the emission likelihood
// to get the posterior probability of being in each state.
// ============================================================================
function forwardAlgorithm(
  returns: number[],
  numStates: number,
  transMatrix: number[][],
  regimes: RegimeParams[],
) {
  const T = returns.length;
  // alpha[t][s] = P(state_t = s | observations_1..t)
  const alpha: number[][] = [];

  // Gaussian PDF for emission probability
  const gaussPdf = (x: number, mean: number, std: number) => {
    const z = (x - mean) / std;
    return Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
  };

  // Initialise: uniform prior (no preference for starting state)
  const initAlpha: number[] = [];
  for (let s = 0; s < numStates; s++) {
    initAlpha.push((1 / numStates) * gaussPdf(returns[0], regimes[s].meanReturn, regimes[s].volatility));
  }
  // Normalise so probabilities sum to 1
  const initSum = initAlpha.reduce((a, b) => a + b, 0) || 1;
  alpha.push(initAlpha.map(v => v / initSum));

  // Forward pass: at each step, multiply previous alpha by transition probs,
  // then multiply by emission probability of observed return
  for (let t = 1; t < T; t++) {
    const newAlpha: number[] = [];
    for (let s = 0; s < numStates; s++) {
      let sum = 0;
      for (let prev = 0; prev < numStates; prev++) {
        sum += alpha[t - 1][prev] * transMatrix[prev][s];
      }
      newAlpha.push(sum * gaussPdf(returns[t], regimes[s].meanReturn, regimes[s].volatility));
    }
    const rowSum = newAlpha.reduce((a, b) => a + b, 0) || 1;
    alpha.push(newAlpha.map(v => v / rowSum));
  }

  return alpha;
}

// ============================================================================
// Viterbi algorithm: finds the single most likely state sequence.
// Unlike the forward algorithm (which gives probabilities), Viterbi gives
// a hard assignment: at each timestep, exactly one state is chosen.
// ============================================================================
function viterbiAlgorithm(
  returns: number[],
  numStates: number,
  transMatrix: number[][],
  regimes: RegimeParams[],
) {
  const T = returns.length;

  const gaussLogPdf = (x: number, mean: number, std: number) => {
    const z = (x - mean) / std;
    return -0.5 * z * z - Math.log(std) - 0.5 * Math.log(2 * Math.PI);
  };

  // delta[t][s] = log probability of most likely path ending in state s at time t
  const delta: number[][] = [];
  // psi[t][s] = which previous state led to the best path to state s at time t
  const psi: number[][] = [];

  // Initialise
  const initDelta: number[] = [];
  for (let s = 0; s < numStates; s++) {
    initDelta.push(Math.log(1 / numStates) + gaussLogPdf(returns[0], regimes[s].meanReturn, regimes[s].volatility));
  }
  delta.push(initDelta);
  psi.push(new Array(numStates).fill(0));

  // Forward pass
  for (let t = 1; t < T; t++) {
    const newDelta: number[] = [];
    const newPsi: number[] = [];
    for (let s = 0; s < numStates; s++) {
      let bestVal = -Infinity;
      let bestPrev = 0;
      for (let prev = 0; prev < numStates; prev++) {
        const val = delta[t - 1][prev] + Math.log(transMatrix[prev][s] + 1e-10);
        if (val > bestVal) {
          bestVal = val;
          bestPrev = prev;
        }
      }
      newDelta.push(bestVal + gaussLogPdf(returns[t], regimes[s].meanReturn, regimes[s].volatility));
      newPsi.push(bestPrev);
    }
    delta.push(newDelta);
    psi.push(newPsi);
  }

  // Backtrack to find most likely path
  const path: number[] = new Array(T);
  // Find best final state
  let bestFinal = 0;
  for (let s = 1; s < numStates; s++) {
    if (delta[T - 1][s] > delta[T - 1][bestFinal]) bestFinal = s;
  }
  path[T - 1] = bestFinal;

  // Trace back through psi
  for (let t = T - 2; t >= 0; t--) {
    path[t] = psi[t + 1][path[t + 1]];
  }

  // Confidence at each step: how much better the chosen state is vs second best
  const confidence: number[] = delta.map(row => {
    const sorted = [...row].sort((a, b) => b - a);
    // Difference between best and second best in log space, clamped to [0,1]
    return Math.min(1, Math.max(0, (sorted[0] - sorted[1]) * 0.3));
  });

  return { path, confidence };
}

// ============================================================================
// VIEW COMPONENTS
// ============================================================================

/**
 * State Diagram View (full page, professional)
 *
 * Layout (top to bottom):
 * 1. Title + formula
 * 2. State circles with mini Gaussian curves inside, transition arrows with
 *    probabilities, self-loops, posterior probability bars
 * 3. Emission arrows down to observation timeline
 * 4. Recent observation timeline showing last N returns coloured by detected regime
 * 5. Annotations panel: step counter, current return, transition count, accuracy
 */
function StateDiagramView({
  width, height, viterbiPath, numStates, currentStep, transMatrix, regimes, alpha,
  returns, trueStates, seed, customNames, onStateClick, selectedRegime,
}: {
  width: number; height: number;
  viterbiPath: number[]; numStates: number; currentStep: number;
  transMatrix: number[][]; regimes: RegimeParams[]; alpha: number[][];
  returns: number[]; trueStates: number[]; seed: number;
  customNames: Record<number, string>;
  onStateClick: (idx: number) => void;
  selectedRegime: number | null;
}) {
  const labelFor = (s: number) => (customNames[s] && customNames[s].trim()) || COLORS.regimes[s].name;
  const currentState = viterbiPath[currentStep] ?? 0;
  const currentProbs = alpha[currentStep] || [];
  const cx = width / 2;

  // Adaptive sizing based on number of states and available space
  const stateR = Math.min(75, Math.max(45, (width - 300) / (numStates * 3)));
  const stateSpacing = Math.min(260, (width - 200) / numStates);
  const stateY = height * 0.32;
  const statePositions = Array.from({ length: numStates }, (_, i) => ({
    x: cx + (i - (numStates - 1) / 2) * stateSpacing,
    y: stateY,
  }));

  const renderArrow = makeArrowRenderer(statePositions, stateR, currentState);

  // Count observed transitions for annotation
  let transitionCount = 0;
  let correctCount = 0;
  for (let t = 0; t <= currentStep; t++) {
    if (t > 0 && viterbiPath[t] !== viterbiPath[t - 1]) transitionCount++;
    if (viterbiPath[t] === trueStates[t]) correctCount++;
  }
  const accuracy = currentStep > 0 ? (correctCount / (currentStep + 1) * 100) : 0;
  const currentReturn = returns[currentStep] ?? 0;

  // Recent returns for the observation timeline (last 60 steps)
  const timelineLen = Math.min(60, currentStep + 1);
  const timelineStart = Math.max(0, currentStep + 1 - timelineLen);
  const timelineY = height * 0.72;
  const timelineH = 30;
  const timelineW = Math.min(width - 100, timelineLen * 12);
  const timelineX = cx - timelineW / 2;
  const cellW = timelineW / timelineLen;

  // Find the highest peak density across all regimes so we can normalise
  // all curves to the SAME scale. This makes low-vol regimes tall and narrow
  // (like Sideways) and high-vol regimes short and wide (like Crisis).
  const maxPeakDensity = Math.max(
    ...regimes.slice(0, numStates).map(r => 1 / (r.volatility * Math.sqrt(2 * Math.PI)))
  );

  // Mini Gaussian curve points for rendering inside state circles.
  // All curves share the same y-scale so their relative shapes are visually accurate.
  const gaussPoints = (mean: number, vol: number, cx: number, cy: number, w: number, h: number) => {
    const pts: string[] = [];
    const steps = 30;
    // Use a fixed x-range across all curves so width reflects volatility
    const maxVol = Math.max(...regimes.slice(0, numStates).map(r => r.volatility));
    const xRange = maxVol * 6; // total return range shown
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = cx - w / 2 + t * w;
      const retVal = mean + (t - 0.5) * xRange;
      const z = (retVal - mean) / vol;
      const density = Math.exp(-0.5 * z * z) / (vol * Math.sqrt(2 * Math.PI));
      // Normalise against the global max so curves are comparable
      const y = cy + h / 2 - (density / maxPeakDensity) * h;
      pts.push(`${x},${y}`);
    }
    return pts.join(' ');
  };

  return (
    <g>
      {/* Arrow marker definitions */}
      <defs>
        {Array.from({ length: numStates }).map((_, s) => (
          <marker key={s} id={`arrow-${s}`} markerWidth="8" markerHeight="8"
            refX="4" refY="4" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 Z" fill={COLORS.regimes[s].color} />
          </marker>
        ))}
      </defs>

      {/* ---- HEADER ---- */}
      <text x={cx} y={28} textAnchor="middle" fill={COLORS.text}
        fontSize={20} fontFamily="monospace" fontWeight="bold" letterSpacing="3">
        HIDDEN MARKOV MODEL
      </text>
      <line x1={cx - 130} y1={36} x2={cx + 130} y2={36}
        stroke={COLORS.gridLine} strokeWidth={1} />

      {/* Section label */}
      <text x={cx} y={stateY - stateR - 30} textAnchor="middle"
        fill={COLORS.textMuted} fontSize={11} fontFamily="monospace" letterSpacing="2">
        HIDDEN STATES
      </text>

      {/* ---- TRANSITION ARROWS ---- */}
      {Array.from({ length: numStates }).flatMap((_, i) =>
        Array.from({ length: numStates }).map((_, j) =>
          renderArrow(i, j, transMatrix[i][j])
        )
      )}

      {/* ---- STATE CIRCLES ---- */}
      {statePositions.map((pos, s) => {
        const regime = COLORS.regimes[s];
        const isActive = s === currentState;
        const isSelected = s === selectedRegime;
        const prob = currentProbs[s] || 0;

        return (
          <g
            key={s}
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onStateClick(s); }}
          >
            {/* Outer glow for active state */}
            {isActive && (
              <>
                <circle cx={pos.x} cy={pos.y} r={stateR + 12}
                  fill="none" stroke={regime.color} strokeWidth={1} opacity={0.2} />
                <circle cx={pos.x} cy={pos.y} r={stateR + 7}
                  fill="none" stroke={regime.color} strokeWidth={2} opacity={0.4} />
              </>
            )}

            {/* Selection outline: dashed white ring when the user is editing this regime */}
            {isSelected && (
              <circle cx={pos.x} cy={pos.y} r={stateR + 4}
                fill="none" stroke="#e8e8e8" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.7} />
            )}

            {/* Main circle */}
            <circle cx={pos.x} cy={pos.y} r={stateR}
              fill={regime.color} fillOpacity={isActive ? 0.15 : 0.04}
              stroke={regime.color} strokeWidth={isActive ? 2 : 1}
              strokeOpacity={isActive ? 1 : 0.4}
            />

            {/* State label (custom rename overrides default) */}
            <text x={pos.x} y={pos.y - stateR * 0.45} textAnchor="middle"
              fill={regime.color} fontSize={Math.min(14, stateR * 0.3)} fontFamily="monospace" fontWeight="bold">
              S{s + 1}: {labelFor(s)}
            </text>

            {/* Mini Gaussian emission curve inside the circle */}
            <polyline
              points={gaussPoints(regimes[s].meanReturn, regimes[s].volatility,
                pos.x, pos.y + stateR * 0.05, stateR * 1.2, stateR * 0.5)}
              fill="none" stroke={regime.color} strokeWidth={1.5}
              opacity={isActive ? 0.8 : 0.3}
            />
            {/* Baseline for the curve */}
            <line x1={pos.x - stateR * 0.6} y1={pos.y + stateR * 0.3}
              x2={pos.x + stateR * 0.6} y2={pos.y + stateR * 0.3}
              stroke={regime.color} strokeWidth={0.5} opacity={0.3} />

            {/* Emission params below the curve in plain English */}
            <text x={pos.x} y={pos.y + stateR * 0.5} textAnchor="middle"
              fill={COLORS.textDim} fontSize={Math.min(11, stateR * 0.22)} fontFamily="monospace">
              mean {regimes[s].meanReturn >= 0 ? '+' : ''}{regimes[s].meanReturn.toFixed(2)}%  vol {regimes[s].volatility.toFixed(1)}%
            </text>

            {/* ---- POSTERIOR PROBABILITY BAR below the circle ---- */}
            <g transform={`translate(${pos.x - stateR * 0.7}, ${pos.y + stateR + 8})`}>
              {/* Bar background */}
              <rect width={stateR * 1.4} height={6} rx={3}
                fill={COLORS.gridLine} />
              {/* Filled portion proportional to probability */}
              <rect width={prob * stateR * 1.4} height={6} rx={3}
                fill={regime.color} fillOpacity={0.6} />
              {/* Percentage label */}
              <text x={stateR * 0.7} y={20} textAnchor="middle"
                fill={regime.color} fontSize={12} fontFamily="monospace"
                fontWeight={isActive ? 'bold' : 'normal'} opacity={isActive ? 1 : 0.5}>
                P(S{s + 1}|O) = {(prob * 100).toFixed(1)}%
              </text>
            </g>
          </g>
        );
      })}

      {/* ---- SCROLLING DATA FEED ---- */}
      {/* Simulated XAUUSD 1-min data scrolling through the empty space.
          Shows timestamp, O, H, L, C, volume, return. Rows fade from bright
          (current) to dim (older). Creates the effect of data being processed. */}
      {(() => {
        const feedX = 60;
        const feedTopY = statePositions[0].y + stateR + 55;
        const feedBottomY = timelineY - 55;
        const feedH = feedBottomY - feedTopY;
        if (feedH < 60) return null; // Not enough space

        const rowH = 16;
        const numRows = Math.floor(feedH / rowH);
        const feedRng = mulberry32(seed + currentStep * 7);
        // Generate fake XAUUSD 1-min candle rows
        let fakePrice = 2340 + feedRng() * 50;
        const rows: { time: string; o: number; h: number; l: number; c: number; vol: number; ret: number }[] = [];
        const baseHour = 9 + Math.floor((currentStep * 3) / 60) % 15;
        const baseMin = (currentStep * 3) % 60;

        for (let i = 0; i < numRows; i++) {
          const mins = baseMin + i;
          const hour = baseHour + Math.floor(mins / 60);
          const min = mins % 60;
          const open = fakePrice;
          const change = (feedRng() - 0.48) * 2.5;
          const close = open + change;
          const high = Math.max(open, close) + feedRng() * 1.2;
          const low = Math.min(open, close) - feedRng() * 1.2;
          const vol = Math.floor(50 + feedRng() * 400);
          const ret = ((close - open) / open) * 100;
          rows.push({
            time: `${String(hour % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
            o: Math.round(open * 100) / 100,
            h: Math.round(high * 100) / 100,
            l: Math.round(low * 100) / 100,
            c: Math.round(close * 100) / 100,
            vol,
            ret: Math.round(ret * 1000) / 1000,
          });
          fakePrice = close;
        }

        // Header
        const cols = ['TIME', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'VOL', 'RET%'];
        const colWidths = [55, 70, 70, 70, 70, 45, 55];
        const totalW = colWidths.reduce((a, b) => a + b, 0);
        const startX = cx - totalW / 2;

        return (
          <g>
            {/* Feed label */}
            <text x={startX} y={feedTopY - 6} fill={COLORS.textMuted}
              fontSize={9} fontFamily="monospace">
              XAUUSD 1M
            </text>
            <text x={startX + totalW} y={feedTopY - 6} textAnchor="end" fill={COLORS.textMuted}
              fontSize={9} fontFamily="monospace">
              Processing...
            </text>

            {/* Column headers */}
            {cols.map((col, ci) => {
              let xOff = startX;
              for (let k = 0; k < ci; k++) xOff += colWidths[k];
              return (
                <text key={ci} x={xOff + colWidths[ci] / 2} y={feedTopY + 10}
                  textAnchor="middle" fill={COLORS.textMuted} fontSize={9} fontFamily="monospace">
                  {col}
                </text>
              );
            })}
            {/* Header underline */}
            <line x1={startX} y1={feedTopY + 14} x2={startX + totalW} y2={feedTopY + 14}
              stroke={COLORS.gridLine} strokeWidth={1} />

            {/* Data rows with fade effect: bottom rows are brightest (newest) */}
            {rows.map((row, ri) => {
              const y = feedTopY + 18 + ri * rowH;
              // Fade: bottom = bright, top = dim
              const fade = 0.15 + (ri / numRows) * 0.6;
              const isGreen = row.ret >= 0;
              const retColor = isGreen ? '#21b3a4' : '#f0426c';
              const values = [
                row.time,
                row.o.toFixed(2),
                row.h.toFixed(2),
                row.l.toFixed(2),
                row.c.toFixed(2),
                String(row.vol),
                `${row.ret >= 0 ? '+' : ''}${row.ret.toFixed(3)}`,
              ];

              return (
                <g key={ri} opacity={fade}>
                  {/* Highlight every other row subtly */}
                  {ri % 2 === 0 && (
                    <rect x={startX - 4} y={y - 9} width={totalW + 8} height={rowH}
                      fill="#e8e8e8" fillOpacity={0.01} rx={2} />
                  )}
                  {values.map((val, ci) => {
                    let xOff = startX;
                    for (let k = 0; k < ci; k++) xOff += colWidths[k];
                    // Return column gets colour coding
                    const fill = ci === 6 ? retColor : COLORS.textDim;
                    return (
                      <text key={ci} x={xOff + colWidths[ci] / 2} y={y}
                        textAnchor="middle" fill={fill} fontSize={10} fontFamily="monospace">
                        {val}
                      </text>
                    );
                  })}
                </g>
              );
            })}

            {/* Bottom fade gradient overlay to blend into OBSERVED EMISSIONS */}
            <rect x={startX - 10} y={feedBottomY - 20} width={totalW + 20} height={20}
              fill="url(#feedFade)" />
            <defs>
              <linearGradient id="feedFade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1c1c1c" stopOpacity="0" />
                <stop offset="100%" stopColor="#1c1c1c" stopOpacity="1" />
              </linearGradient>
            </defs>
          </g>
        );
      })()}

      {/* ---- EMISSION ARROWS ---- */}
      <text x={cx} y={timelineY - 45} textAnchor="middle"
        fill={COLORS.textMuted} fontSize={11} fontFamily="monospace" letterSpacing="2">
        OBSERVED EMISSIONS
      </text>
      <line x1={cx - 70} y1={timelineY - 38} x2={cx + 70} y2={timelineY - 38}
        stroke={COLORS.gridLine} strokeWidth={1} />

      {/* Dashed emission arrows from each state down to the observation timeline */}
      {statePositions.map((pos, s) => {
        const isActive = s === currentState;
        return (
          <g key={`emit-${s}`}>
            <line x1={pos.x} y1={pos.y + stateR + 35}
              x2={pos.x} y2={timelineY - 50}
              stroke={COLORS.regimes[s].color} strokeWidth={isActive ? 1.5 : 0.5}
              strokeDasharray="5 4" opacity={isActive ? 0.6 : 0.1} />
            {/* Emission label: b_j(o_t) */}
            {isActive && (
              <text x={pos.x + 12} y={(pos.y + stateR + 35 + timelineY - 50) / 2}
                fill={COLORS.regimes[s].color} fontSize={10} fontFamily="monospace" opacity={0.6}>
                b_{s + 1}(o_t)
              </text>
            )}
          </g>
        );
      })}

      {/* ---- OBSERVATION TIMELINE ---- */}
      {/* Shows last N returns as coloured cells, regime-coloured */}
      <text x={timelineX} y={timelineY - 6} fill={COLORS.textDim}
        fontSize={10} fontFamily="monospace">
        Recent observations (t={timelineStart + 1} to {currentStep + 1})
      </text>
      {Array.from({ length: timelineLen }).map((_, i) => {
        const t = timelineStart + i;
        const state = viterbiPath[t];
        const ret = returns[t] ?? 0;
        const regime = COLORS.regimes[state % COLORS.regimes.length];
        const isCurrent = t === currentStep;
        // Bar height proportional to absolute return, capped
        const barH = Math.min(timelineH, Math.abs(ret) * timelineH * 0.5 + 2);
        const isPositive = ret >= 0;

        return (
          <g key={i}>
            {/* Cell background */}
            <rect x={timelineX + i * cellW} y={timelineY}
              width={cellW - 0.5} height={timelineH}
              fill={regime.color} fillOpacity={isCurrent ? 0.3 : 0.1}
              stroke={isCurrent ? regime.color : 'none'} strokeWidth={isCurrent ? 1.5 : 0}
              rx={1} />
            {/* Return bar (up for positive, down for negative) */}
            <rect
              x={timelineX + i * cellW + 1}
              y={isPositive ? timelineY + timelineH / 2 - barH : timelineY + timelineH / 2}
              width={Math.max(1, cellW - 2.5)} height={barH}
              fill={isPositive ? '#21b3a4' : '#f0426c'}
              fillOpacity={0.5} rx={0.5} />
          </g>
        );
      })}
      {/* Zero line on timeline */}
      <line x1={timelineX} y1={timelineY + timelineH / 2}
        x2={timelineX + timelineW} y2={timelineY + timelineH / 2}
        stroke={COLORS.textMuted} strokeWidth={0.5} />

      {/* ---- ANNOTATIONS PANEL (bottom) ---- */}
      {(() => {
        const panelY = timelineY + timelineH + 25;
        const panelW = Math.min(width - 80, 700);
        const panelX = cx - panelW / 2;
        const items = [
          { label: 'Step', value: `${currentStep + 1}` },
          { label: 'Current State', value: `S${currentState + 1} (${COLORS.regimes[currentState].name})`, color: COLORS.regimes[currentState].color },
          { label: 'Return', value: `${currentReturn >= 0 ? '+' : ''}${currentReturn.toFixed(3)}%` },
          { label: 'Transitions', value: `${transitionCount}` },
          { label: 'Accuracy', value: `${accuracy.toFixed(1)}%` },
        ];
        const itemW = panelW / items.length;

        return (
          <g>
            {/* Panel background */}
            <rect x={panelX} y={panelY} width={panelW} height={40} rx={6}
              fill="#2a2a2a" stroke={COLORS.gridLine} strokeWidth={1} />
            {items.map((item, i) => (
              <g key={i} transform={`translate(${panelX + i * itemW + itemW / 2}, ${panelY})`}>
                <text y={14} textAnchor="middle" fill={COLORS.textMuted}
                  fontSize={9} fontFamily="monospace">
                  {item.label}
                </text>
                <text y={30} textAnchor="middle" fill={item.color || COLORS.text}
                  fontSize={12} fontFamily="monospace" fontWeight="bold">
                  {item.value}
                </text>
                {/* Divider */}
                {i < items.length - 1 && (
                  <line x1={itemW / 2} y1={6} x2={itemW / 2} y2={34}
                    stroke={COLORS.gridLine} strokeWidth={1} />
                )}
              </g>
            ))}
          </g>
        );
      })()}
    </g>
  );
}

/**
 * Shared arrow renderer factory for the state diagram.
 * Returns a function that draws curved arrows between state circles.
 */
function makeArrowRenderer(
  statePositions: { x: number; y: number }[],
  stateR: number,
  currentState: number,
) {
  return (fromIdx: number, toIdx: number, prob: number) => {
    if (prob < 0.005) return null;
    const from = statePositions[fromIdx];
    const to = statePositions[toIdx];
    const isActive = fromIdx === currentState;

    if (fromIdx === toIdx) {
      // Self-loop arc above the circle
      const loopR = stateR * 0.7;
      const loopY = from.y - stateR - loopR * 0.8;
      const regime = COLORS.regimes[fromIdx];
      return (
        <g key={`${fromIdx}-${toIdx}`}>
          <path
            d={`M ${from.x - stateR * 0.5} ${from.y - stateR * 0.85}
                A ${loopR} ${loopR} 0 1 1 ${from.x + stateR * 0.5} ${from.y - stateR * 0.85}`}
            fill="none" stroke={regime.color}
            strokeWidth={Math.max(1, prob * 3)}
            opacity={isActive ? 0.9 : 0.4}
            markerEnd={`url(#arrow-${fromIdx})`}
          />
          <text x={from.x} y={loopY - 4} textAnchor="middle"
            fill={regime.color} fontSize={13} fontFamily="monospace" fontWeight="bold"
            opacity={isActive ? 1 : 0.5}>
            {(prob * 100).toFixed(1)}%
          </text>
        </g>
      );
    }

    // Curved arrow between different states
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / dist;
    const uy = dy / dist;
    const startX = from.x + ux * stateR;
    const startY = from.y + uy * stateR;
    const endX = to.x - ux * (stateR + 6);
    const endY = to.y - uy * (stateR + 6);
    // Arc offset scales with distance between states so non-adjacent arrows
    // curve more and labels don't overlap. Forward arrows (left to right) arc
    // below, backward arrows arc above, keeping them separated.
    const stateDist = Math.abs(fromIdx - toIdx);
    const arcAmount = 25 + stateDist * 15;
    const direction = fromIdx < toIdx ? 1 : -1;
    const perpX = -uy * arcAmount * direction;
    const perpY = ux * arcAmount * direction;
    const midX = (startX + endX) / 2 + perpX;
    const midY = (startY + endY) / 2 + perpY;
    const lineColor = COLORS.regimes[fromIdx].color;

    // Only show label if probability is significant enough to read
    const showLabel = prob >= 0.005;

    return (
      <g key={`${fromIdx}-${toIdx}`}>
        <path
          d={`M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`}
          fill="none" stroke={lineColor}
          strokeWidth={Math.max(0.5, prob * 5)}
          opacity={isActive ? 0.8 : 0.2}
        />
        <polygon
          points={`${to.x - ux * stateR},${to.y - uy * stateR}
                   ${to.x - ux * (stateR + 10) - uy * 4},${to.y - uy * (stateR + 10) + ux * 4}
                   ${to.x - ux * (stateR + 10) + uy * 4},${to.y - uy * (stateR + 10) - ux * 4}`}
          fill={lineColor} opacity={isActive ? 0.8 : 0.2}
        />
        {showLabel && (
          <text x={midX} y={midY - 5} textAnchor="middle"
            fill={lineColor} fontSize={11} fontFamily="monospace"
            opacity={isActive ? 1 : 0.35}>
            {(prob * 100).toFixed(1)}%
          </text>
        )}
      </g>
    );
  };
}

/**
 * Regime Price Chart View (full page)
 * Price line with coloured regime bands and legend.
 */
function RegimeChartView({
  width, height, prices, viterbiPath, numStates, currentStep,
}: {
  width: number; height: number; prices: number[];
  viterbiPath: number[]; numStates: number; currentStep: number;
}) {
  const currentState = viterbiPath[currentStep] ?? 0;
  const margin = { top: 50, right: 30, bottom: 50, left: 70 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const visible = currentStep + 2;
  const visiblePrices = prices.slice(0, visible);
  const minP = Math.min(...visiblePrices);
  const maxP = Math.max(...visiblePrices);
  const pad = (maxP - minP) * 0.08 || 1;
  const yMin = minP - pad;
  const yMax = maxP + pad;

  const xScale = (i: number) => margin.left + (i / Math.max(1, visible - 1)) * chartW;
  const yScale = (p: number) => margin.top + (1 - (p - yMin) / (yMax - yMin)) * chartH;

  // Regime bands
  const bands: { state: number; start: number; end: number }[] = [];
  if (viterbiPath.length > 0) {
    let bs = 0, bst = viterbiPath[0];
    for (let i = 1; i <= currentStep; i++) {
      if (viterbiPath[i] !== bst || i === currentStep) {
        bands.push({ state: bst, start: bs, end: i });
        bs = i; bst = viterbiPath[i];
      }
    }
    if (bs <= currentStep) bands.push({ state: viterbiPath[currentStep], start: bs, end: currentStep + 1 });
  }

  const yTicks = 6;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (i / yTicks) * (yMax - yMin));

  return (
    <g>
      <text x={width / 2} y={20} textAnchor="middle" fill={COLORS.text} fontSize={14} fontFamily="monospace" fontWeight="bold">
        Regime Detection
      </text>

      {/* Legend */}
      <g transform={`translate(${margin.left + 10}, ${margin.top - 12})`}>
        {Array.from({ length: numStates }).map((_, s) => (
          <g key={s} transform={`translate(${s * 100}, 0)`}>
            <rect width={12} height={12} fill={COLORS.regimes[s].color} fillOpacity={0.6} rx={2} />
            <text x={16} y={10} fill={COLORS.regimes[s].color} fontSize={11} fontFamily="monospace">{COLORS.regimes[s].name}</text>
          </g>
        ))}
      </g>

      {/* Y grid */}
      {yTickVals.map((val, i) => (
        <g key={i}>
          <line x1={margin.left} y1={yScale(val)} x2={margin.left + chartW} y2={yScale(val)}
            stroke={COLORS.gridLine} strokeWidth={1} />
          <text x={margin.left - 8} y={yScale(val) + 4} textAnchor="end"
            fill={COLORS.textDim} fontSize={11} fontFamily="monospace">
            {val.toFixed(1)}
          </text>
        </g>
      ))}

      {/* Regime bands */}
      {bands.map((band, i) => {
        const regime = COLORS.regimes[band.state % COLORS.regimes.length];
        const x1 = xScale(band.start);
        const x2 = xScale(Math.min(band.end, visible - 1));
        return (
          <g key={i}>
            <rect x={x1} y={margin.top} width={Math.max(1, x2 - x1)} height={chartH}
              fill={regime.color} fillOpacity={0.1} />
            {(x2 - x1) > 50 && (
              <text x={(x1 + x2) / 2} y={margin.top + 16} textAnchor="middle"
                fill={regime.color} fontSize={11} fontFamily="monospace" fontWeight="600">
                {regime.name}
              </text>
            )}
          </g>
        );
      })}

      {/* Price line */}
      {visible > 1 && (
        <polyline
          points={visiblePrices.map((p, i) => `${xScale(i)},${yScale(p)}`).join(' ')}
          fill="none" stroke={COLORS.text} strokeWidth={1.5} opacity={0.85}
        />
      )}

      {/* Current dot */}
      {visible > 0 && (
        <circle cx={xScale(visible - 1)} cy={yScale(visiblePrices[visible - 1])}
          r={4} fill={COLORS.regimes[currentState].color}
          stroke={COLORS.bg} strokeWidth={1.5} />
      )}

      {/* Axis labels */}
      <text x={margin.left - 50} y={margin.top + chartH / 2}
        textAnchor="middle" fill={COLORS.textDim} fontSize={12} fontFamily="monospace"
        transform={`rotate(-90, ${margin.left - 50}, ${margin.top + chartH / 2})`}>
        Price ($)
      </text>
      <text x={width / 2} y={height - 8} textAnchor="middle" fill={COLORS.textDim} fontSize={12} fontFamily="monospace">
        Time (steps)
      </text>
    </g>
  );
}

/**
 * Transition Matrix View
 * Heatmap showing probability of transitioning from state i to state j.
 * Diagonal values are high (stickiness), off-diagonal shows regime change probability.
 */
/**
 * Transition Matrix View
 * Shows observed transition frequencies as primary (these update live during
 * animation), with model probability as secondary reference. Last transition
 * cell is highlighted so you can see the matrix updating in real time.
 */
function TransitionMatrixView({
  width, height, transMatrix, numStates, viterbiPath, currentStep,
}: {
  width: number; height: number; transMatrix: number[][];
  numStates: number; viterbiPath: number[]; currentStep: number;
}) {
  const cx = width / 2;
  const cy = height / 2;
  const maxCellSize = Math.min(120, (Math.min(width, height) - 200) / numStates);
  const cellSize = maxCellSize;
  const gridW = cellSize * numStates;
  const gridH = cellSize * numStates;
  const startX = cx - gridW / 2;
  const startY = cy - gridH / 2 + 10;

  // Count observed transitions and raw counts up to currentStep
  const observedCounts: number[][] = Array.from({ length: numStates },
    () => new Array(numStates).fill(0));
  let totalTransitions = 0;
  for (let t = 1; t <= currentStep; t++) {
    if (viterbiPath[t - 1] !== undefined && viterbiPath[t] !== undefined) {
      observedCounts[viterbiPath[t - 1]][viterbiPath[t]]++;
      if (viterbiPath[t] !== viterbiPath[t - 1]) totalTransitions++;
    }
  }
  const observedProbs = observedCounts.map(row => {
    const sum = row.reduce((a, b) => a + b, 0) || 1;
    return row.map(v => v / sum);
  });

  const currentState = viterbiPath[currentStep] ?? 0;
  // Track last transition for highlighting
  const prevState = currentStep > 0 ? (viterbiPath[currentStep - 1] ?? 0) : currentState;

  return (
    <g>
      <text x={cx} y={24} textAnchor="middle" fill={COLORS.text} fontSize={15} fontFamily="monospace" fontWeight="bold">
        Transition Matrix
      </text>
      <text x={cx} y={44} textAnchor="middle" fill={COLORS.textDim} fontSize={11} fontFamily="monospace">
        Observed frequencies update live. Model probability shown below.
      </text>

      {/* Column headers */}
      <text x={cx} y={startY - 30} textAnchor="middle" fill={COLORS.textMuted} fontSize={10} fontFamily="monospace" letterSpacing="2">
        TO STATE
      </text>
      {Array.from({ length: numStates }).map((_, j) => (
        <text key={j} x={startX + j * cellSize + cellSize / 2} y={startY - 12}
          textAnchor="middle" fill={COLORS.regimes[j].color} fontSize={11} fontFamily="monospace" fontWeight="600">
          {COLORS.regimes[j].name}
        </text>
      ))}

      {/* FROM STATE label */}
      <text x={startX - 55} y={cy + 10} textAnchor="middle" fill={COLORS.textMuted}
        fontSize={10} fontFamily="monospace" letterSpacing="2"
        transform={`rotate(-90, ${startX - 55}, ${cy + 10})`}>
        FROM STATE
      </text>

      {/* Rows */}
      {Array.from({ length: numStates }).map((_, i) => {
        const fromRegime = COLORS.regimes[i];
        const isCurrentRow = i === currentState;

        return (
          <g key={i}>
            {/* Row label */}
            <text x={startX - 12} y={startY + i * cellSize + cellSize / 2 + 4}
              textAnchor="end" fill={fromRegime.color} fontSize={11} fontFamily="monospace"
              fontWeight={isCurrentRow ? 'bold' : 'normal'}>
              {fromRegime.name}
            </text>

            {/* Current row highlight */}
            {isCurrentRow && (
              <rect x={startX - 3} y={startY + i * cellSize - 3}
                width={gridW + 6} height={cellSize + 6}
                fill="none" stroke={fromRegime.color} strokeWidth={2} strokeOpacity={0.4} rx={6} />
            )}

            {/* Cells */}
            {Array.from({ length: numStates }).map((_, j) => {
              const modelProb = transMatrix[i][j];
              const obsProb = observedProbs[i][j];
              const count = observedCounts[i][j];
              const fillColor = i === j ? fromRegime.color : COLORS.regimes[j].color;
              // Highlight the cell of the last transition (from prevState to currentState)
              const isLastTransition = i === prevState && j === currentState;
              // Cell fill intensity based on observed probability (changes over time)
              const fillOpacity = obsProb * 0.5 + 0.03;

              return (
                <g key={j}>
                  {/* Cell */}
                  <rect
                    x={startX + j * cellSize + 2} y={startY + i * cellSize + 2}
                    width={cellSize - 4} height={cellSize - 4}
                    fill={fillColor} fillOpacity={fillOpacity}
                    stroke={isLastTransition ? COLORS.text : COLORS.gridLine}
                    strokeWidth={isLastTransition ? 2 : 1} rx={4}
                  />
                  {/* Last transition flash */}
                  {isLastTransition && (
                    <rect
                      x={startX + j * cellSize + 2} y={startY + i * cellSize + 2}
                      width={cellSize - 4} height={cellSize - 4}
                      fill="#e8e8e8" fillOpacity={0.08} rx={4}
                    />
                  )}

                  {/* OBSERVED frequency (primary, large) */}
                  <text x={startX + j * cellSize + cellSize / 2}
                    y={startY + i * cellSize + cellSize / 2 - 10}
                    textAnchor="middle" fill={COLORS.text} fontSize={16} fontFamily="monospace" fontWeight="bold">
                    {(obsProb * 100).toFixed(1)}%
                  </text>
                  {/* Raw count */}
                  <text x={startX + j * cellSize + cellSize / 2}
                    y={startY + i * cellSize + cellSize / 2 + 6}
                    textAnchor="middle" fill={COLORS.textDim} fontSize={10} fontFamily="monospace">
                    n={count}
                  </text>
                  {/* Model probability (secondary, small) */}
                  <text x={startX + j * cellSize + cellSize / 2}
                    y={startY + i * cellSize + cellSize / 2 + 20}
                    textAnchor="middle" fill={COLORS.textMuted} fontSize={9} fontFamily="monospace">
                    model: {(modelProb * 100).toFixed(1)}%
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Stats below matrix */}
      <text x={cx} y={startY + gridH + 25} textAnchor="middle" fill={COLORS.regimes[currentState].color}
        fontSize={12} fontFamily="monospace" fontWeight="bold">
        Current: {COLORS.regimes[currentState].name} (step {currentStep + 1})
      </text>
      <text x={cx} y={startY + gridH + 42} textAnchor="middle" fill={COLORS.textDim}
        fontSize={11} fontFamily="monospace">
        {totalTransitions} regime changes observed across {currentStep + 1} steps
      </text>
    </g>
  );
}

/**
 * State Probabilities View
 * Stacked area chart showing posterior probability of each state over time.
 * At each timestep, probabilities sum to 1.0 (full height of the chart).
 */
function StateProbabilitiesView({
  width, height, alpha, numStates, currentStep,
}: {
  width: number; height: number; alpha: number[][];
  numStates: number; currentStep: number;
}) {
  const margin = { top: 40, right: 30, bottom: 50, left: 60 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const visible = currentStep + 1;

  const xScale = (i: number) => margin.left + (i / Math.max(1, visible - 1)) * chartW;
  const yScale = (p: number) => margin.top + (1 - p) * chartH;

  // Build stacked area paths for each state (bottom to top)
  const areaPaths: string[] = [];
  for (let s = 0; s < numStates; s++) {
    // Cumulative probability up to and including state s
    const topPoints: string[] = [];
    const bottomPoints: string[] = [];

    for (let t = 0; t < visible; t++) {
      const a = alpha[t] || [];
      let cumAbove = 0;
      for (let ss = 0; ss < s; ss++) cumAbove += (a[ss] || 0);
      const cumIncl = cumAbove + (a[s] || 0);

      topPoints.push(`${xScale(t)},${yScale(cumIncl)}`);
      bottomPoints.push(`${xScale(t)},${yScale(cumAbove)}`);
    }

    // Close the polygon: top forward, bottom backward
    areaPaths.push(topPoints.join(' ') + ' ' + bottomPoints.reverse().join(' '));
  }

  return (
    <g>
      <text x={width / 2} y={20} textAnchor="middle" fill={COLORS.text} fontSize={13} fontFamily="monospace" fontWeight="bold">
        Posterior State Probabilities
      </text>

      {/* Y-axis grid (0%, 25%, 50%, 75%, 100%) */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => (
        <g key={frac}>
          <line x1={margin.left} y1={yScale(frac)} x2={margin.left + chartW} y2={yScale(frac)}
            stroke={COLORS.gridLine} strokeWidth={1} />
          <text x={margin.left - 8} y={yScale(frac) + 3} textAnchor="end"
            fill={COLORS.textDim} fontSize={10} fontFamily="monospace">
            {(frac * 100).toFixed(0)}%
          </text>
        </g>
      ))}

      {/* Stacked areas */}
      {areaPaths.map((path, s) => (
        <polygon key={s} points={path}
          fill={COLORS.regimes[s].color} fillOpacity={0.35}
          stroke={COLORS.regimes[s].color} strokeWidth={0.5} strokeOpacity={0.5} />
      ))}

      {/* Current step indicator */}
      <line x1={xScale(currentStep)} y1={margin.top} x2={xScale(currentStep)} y2={margin.top + chartH}
        stroke={COLORS.text} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />

      {/* Current probabilities at right edge */}
      {alpha[currentStep] && (
        <g transform={`translate(${margin.left + chartW + 8}, ${margin.top})`}>
          {alpha[currentStep].map((prob, s) => (
            <text key={s} y={s * 16 + 12} fill={COLORS.regimes[s].color}
              fontSize={11} fontFamily="monospace">
              {COLORS.regimes[s].name}: {(prob * 100).toFixed(1)}%
            </text>
          ))}
        </g>
      )}

      {/* Legend */}
      <g transform={`translate(${margin.left}, ${height - 15})`}>
        {Array.from({ length: numStates }).map((_, s) => (
          <g key={s} transform={`translate(${s * 90}, 0)`}>
            <rect width={10} height={10} fill={COLORS.regimes[s].color} fillOpacity={0.5} rx={2} />
            <text x={14} y={9} fill={COLORS.regimes[s].color} fontSize={10} fontFamily="monospace">
              {COLORS.regimes[s].name}
            </text>
          </g>
        ))}
      </g>

      {/* Y-axis label */}
      <text
        x={margin.left - 40} y={margin.top + chartH / 2}
        textAnchor="middle" fill={COLORS.textDim} fontSize={12} fontFamily="monospace"
        transform={`rotate(-90, ${margin.left - 40}, ${margin.top + chartH / 2})`}
      >
        Probability (%)
      </text>

      {/* X-axis label */}
      <text x={width / 2} y={height - 3} textAnchor="middle" fill={COLORS.textDim} fontSize={12} fontFamily="monospace">
        Time (steps)
      </text>
    </g>
  );
}

/**
 * Emission Distributions View
 * Overlapping Gaussian bell curves showing the return distribution for each regime.
 * This is what the HMM "sees": each state has a characteristic return pattern.
 */
function EmissionDistributionsView({
  width, height, regimes, numStates, returns, currentStep, viterbiPath,
}: {
  width: number; height: number; regimes: RegimeParams[];
  numStates: number; returns: number[]; currentStep: number; viterbiPath: number[];
}) {
  const margin = { top: 40, right: 30, bottom: 60, left: 60 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  // X range: cover all distributions generously
  const allMeans = regimes.slice(0, numStates).map(r => r.meanReturn);
  const allVols = regimes.slice(0, numStates).map(r => r.volatility);
  const xMin = Math.min(...allMeans.map((m, i) => m - 3.5 * allVols[i]));
  const xMax = Math.max(...allMeans.map((m, i) => m + 3.5 * allVols[i]));

  const xScale = (v: number) => margin.left + ((v - xMin) / (xMax - xMin)) * chartW;

  // Compute Gaussian PDF for each state
  const numPoints = 200;
  const curves: { state: number; points: string; peakY: number }[] = [];
  let maxDensity = 0;

  for (let s = 0; s < numStates; s++) {
    const mean = regimes[s].meanReturn;
    const std = regimes[s].volatility;
    const pts: [number, number][] = [];

    for (let i = 0; i <= numPoints; i++) {
      const x = xMin + (i / numPoints) * (xMax - xMin);
      const z = (x - mean) / std;
      const density = Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
      pts.push([x, density]);
      if (density > maxDensity) maxDensity = density;
    }
    curves.push({ state: s, points: '', peakY: 0 });
    curves[s].points = pts.map(([x, d]) => `${x},${d}`).join(' ');
  }

  const yScale = (d: number) => margin.top + (1 - d / (maxDensity * 1.1)) * chartH;

  // Current return value for indicator
  const currentReturn = returns[currentStep] ?? 0;
  const currentState = viterbiPath[currentStep] ?? 0;

  return (
    <g>
      <text x={width / 2} y={20} textAnchor="middle" fill={COLORS.text} fontSize={13} fontFamily="monospace" fontWeight="bold">
        Emission Distributions (Return Density per Regime)
      </text>

      {/* X-axis grid */}
      {[-3, -2, -1, 0, 1, 2, 3].map(tick => {
        const x = xScale(tick);
        if (x < margin.left || x > margin.left + chartW) return null;
        return (
          <g key={tick}>
            <line x1={x} y1={margin.top} x2={x} y2={margin.top + chartH}
              stroke={COLORS.gridLine} strokeWidth={1} />
            <text x={x} y={margin.top + chartH + 16} textAnchor="middle"
              fill={COLORS.textDim} fontSize={10} fontFamily="monospace">
              {tick}%
            </text>
          </g>
        );
      })}

      {/* Zero line (more prominent) */}
      <line x1={xScale(0)} y1={margin.top} x2={xScale(0)} y2={margin.top + chartH}
        stroke={COLORS.textDim} strokeWidth={1} strokeDasharray="4 3" opacity={0.3} />

      {/* Gaussian curves for each state */}
      {curves.map((curve, s) => {
        const regime = COLORS.regimes[s];
        const pts = curve.points.split(' ').map(p => {
          const [x, d] = p.split(',').map(Number);
          return `${xScale(x)},${yScale(d)}`;
        });
        // Close the path along the bottom for filled area
        const areaPath = pts.join(' ') +
          ` ${xScale(xMax)},${yScale(0)} ${xScale(xMin)},${yScale(0)}`;

        return (
          <g key={s}>
            {/* Filled area under curve */}
            <polygon points={areaPath} fill={regime.color} fillOpacity={0.12} />
            {/* Curve line */}
            <polyline points={pts.join(' ')} fill="none"
              stroke={regime.color} strokeWidth={2} opacity={0.7} />
            {/* Mean indicator line */}
            <line x1={xScale(regimes[s].meanReturn)} y1={margin.top}
              x2={xScale(regimes[s].meanReturn)} y2={margin.top + chartH}
              stroke={regime.color} strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />
            {/* Label at peak */}
            <text x={xScale(regimes[s].meanReturn)} y={margin.top - 6}
              textAnchor="middle" fill={regime.color} fontSize={11} fontFamily="monospace" fontWeight="600">
              {regime.name}
            </text>
          </g>
        );
      })}

      {/* Current return indicator */}
      <line x1={xScale(currentReturn)} y1={margin.top} x2={xScale(currentReturn)} y2={margin.top + chartH}
        stroke={COLORS.regimes[currentState].color} strokeWidth={2} opacity={0.8} />
      <circle cx={xScale(currentReturn)} cy={margin.top + chartH}
        r={5} fill={COLORS.regimes[currentState].color} stroke={COLORS.bg} strokeWidth={1.5} />
      <text x={xScale(currentReturn)} y={margin.top + chartH + 30} textAnchor="middle"
        fill={COLORS.regimes[currentState].color} fontSize={11} fontFamily="monospace" fontWeight="bold">
        Current: {currentReturn.toFixed(3)}%
      </text>

      {/* Y-axis label */}
      <text
        x={margin.left - 40} y={margin.top + chartH / 2}
        textAnchor="middle" fill={COLORS.textDim} fontSize={12} fontFamily="monospace"
        transform={`rotate(-90, ${margin.left - 40}, ${margin.top + chartH / 2})`}
      >
        Density
      </text>

      {/* X-axis label */}
      <text x={width / 2} y={height - 8} textAnchor="middle" fill={COLORS.textDim} fontSize={12} fontFamily="monospace">
        Daily Return (%)
      </text>

      {/* Parameter legend */}
      <g transform={`translate(${margin.left + chartW - 140}, ${margin.top + 10})`}>
        <rect x={-8} y={-8} width={150} height={numStates * 16 + 20} rx={4}
          fill="#2a2a2a" stroke={COLORS.gridLine} />
        <text y={6} fill={COLORS.textDim} fontSize={10} fontFamily="monospace">mean / vol</text>
        {Array.from({ length: numStates }).map((_, s) => (
          <text key={s} y={22 + s * 16} fill={COLORS.regimes[s].color} fontSize={11} fontFamily="monospace">
            {COLORS.regimes[s].name}: {regimes[s].meanReturn >= 0 ? '+' : ''}{regimes[s].meanReturn.toFixed(2)}% / {regimes[s].volatility.toFixed(1)}%
          </text>
        ))}
      </g>
    </g>
  );
}

/**
 * Viterbi Path View
 * Shows the most likely state sequence as a coloured timeline strip with
 * confidence shading. True states shown above for comparison.
 */
function ViterbiPathView({
  width, height, viterbiPath, trueStates, confidence, prices,
  numStates, currentStep,
}: {
  width: number; height: number; viterbiPath: number[]; trueStates: number[];
  confidence: number[]; prices: number[]; numStates: number; currentStep: number;
}) {
  const margin = { top: 40, right: 30, bottom: 40, left: 70 };
  const chartW = width - margin.left - margin.right;
  const visible = currentStep + 1;

  const xScale = (i: number) => margin.left + (i / Math.max(1, visible - 1)) * chartW;
  const stripH = 40;
  const gapH = 20;

  // Price chart occupies top portion
  const priceTop = margin.top + 40;
  const priceH = height - margin.top - margin.bottom - stripH * 2 - gapH * 3 - 80;
  const visiblePrices = prices.slice(0, visible + 1);
  const minP = Math.min(...visiblePrices);
  const maxP = Math.max(...visiblePrices);
  const pRange = maxP - minP || 1;
  const yPrice = (p: number) => priceTop + (1 - (p - minP) / pRange) * priceH;

  const trueStripY = priceTop + priceH + gapH;
  const viterbiStripY = trueStripY + stripH + gapH;

  // Compute accuracy: how often Viterbi matches true state
  let correct = 0;
  for (let t = 0; t < visible; t++) {
    if (viterbiPath[t] === trueStates[t]) correct++;
  }
  const accuracy = visible > 0 ? (correct / visible * 100) : 0;

  // Cell width based on visible data
  const cellW = Math.max(1, chartW / visible);

  return (
    <g>
      <text x={width / 2} y={20} textAnchor="middle" fill={COLORS.text} fontSize={13} fontFamily="monospace" fontWeight="bold">
        Viterbi Path vs True States (Accuracy: {accuracy.toFixed(1)}%)
      </text>

      {/* Price chart with regime colouring */}
      {visible > 1 && (
        <polyline
          points={visiblePrices.map((p, i) => `${xScale(i)},${yPrice(p)}`).join(' ')}
          fill="none" stroke={COLORS.text} strokeWidth={1.2} opacity={0.6}
        />
      )}
      <text x={margin.left - 8} y={priceTop - 4} textAnchor="end"
        fill={COLORS.textDim} fontSize={10} fontFamily="monospace">Price</text>

      {/* True states strip */}
      <text x={margin.left - 8} y={trueStripY + stripH / 2 + 4} textAnchor="end"
        fill={COLORS.textDim} fontSize={11} fontFamily="monospace">True</text>
      {Array.from({ length: visible }).map((_, t) => {
        const state = trueStates[t];
        const regime = COLORS.regimes[state % COLORS.regimes.length];
        return (
          <rect key={t} x={xScale(t) - cellW / 2} y={trueStripY}
            width={cellW + 0.5} height={stripH}
            fill={regime.color} fillOpacity={0.5} />
        );
      })}

      {/* Viterbi states strip */}
      <text x={margin.left - 8} y={viterbiStripY + stripH / 2 + 4} textAnchor="end"
        fill={COLORS.textDim} fontSize={11} fontFamily="monospace">Viterbi</text>
      {Array.from({ length: visible }).map((_, t) => {
        const state = viterbiPath[t];
        const conf = confidence[t] ?? 0.5;
        const regime = COLORS.regimes[state % COLORS.regimes.length];
        // Incorrect predictions get a red outline
        const isCorrect = viterbiPath[t] === trueStates[t];
        return (
          <g key={t}>
            <rect x={xScale(t) - cellW / 2} y={viterbiStripY}
              width={cellW + 0.5} height={stripH}
              fill={regime.color} fillOpacity={0.3 + conf * 0.4} />
            {!isCorrect && (
              <rect x={xScale(t) - cellW / 2} y={viterbiStripY}
                width={cellW + 0.5} height={stripH}
                fill="none" stroke="#f0426c" strokeWidth={1} strokeOpacity={0.4} />
            )}
          </g>
        );
      })}

      {/* Current step indicator */}
      <line x1={xScale(currentStep)} y1={priceTop} x2={xScale(currentStep)} y2={viterbiStripY + stripH}
        stroke={COLORS.text} strokeWidth={1} strokeDasharray="3 3" opacity={0.3} />

      {/* Accuracy bar */}
      <g transform={`translate(${margin.left}, ${viterbiStripY + stripH + 20})`}>
        <text fill={COLORS.textDim} fontSize={11} fontFamily="monospace" y={0}>
          Detection accuracy: {accuracy.toFixed(1)}% ({correct}/{visible} correct)
        </text>
        <rect x={0} y={6} width={200} height={6} fill={COLORS.gridLine} rx={3} />
        <rect x={0} y={6} width={accuracy * 2} height={6}
          fill={accuracy > 80 ? '#21b3a4' : accuracy > 60 ? '#c58435' : '#f0426c'}
          fillOpacity={0.6} rx={3} />
      </g>

      {/* Legend */}
      <g transform={`translate(${margin.left}, ${height - 15})`}>
        {Array.from({ length: numStates }).map((_, s) => (
          <g key={s} transform={`translate(${s * 90}, 0)`}>
            <rect width={10} height={10} fill={COLORS.regimes[s].color} fillOpacity={0.5} rx={2} />
            <text x={14} y={9} fill={COLORS.regimes[s].color} fontSize={10} fontFamily="monospace">
              {COLORS.regimes[s].name}
            </text>
          </g>
        ))}
        <text x={numStates * 90 + 20} y={9} fill="#f0426c" fontSize={10} fontFamily="monospace" opacity={0.6}>
          Red outline = incorrect
        </text>
      </g>
    </g>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function HMMVisualization() {
  // Model configuration
  const [numStates, setNumStates] = useState(3);
  const [stickiness, setStickiness] = useState(0.95);
  const [seqLen, setSeqLen] = useState(10000);
  const [seed, setSeed] = useState(42);
  // Animation speed: ms per step. Lower = faster. Range 5-200.
  const [speed, setSpeed] = useState(30);

  // Per-regime parameter overrides (mean return, volatility)
  const [regimes, setRegimes] = useState<RegimeParams[]>(DEFAULT_REGIMES.map(r => ({ ...r })));

  // User-renamed state labels (fall back to COLORS.regimes[s].name when empty).
  // Persisted across re-renders so renames don't get clobbered by seed changes.
  const [customNames, setCustomNames] = useState<Record<number, string>>({});

  // When non-null, opens the regime editor popover for that state index.
  const [selectedRegime, setSelectedRegime] = useState<number | null>(null);

  // Toggle between state diagram and regime chart within the HMM page
  const [hmmView, setHmmView] = useState<'diagram' | 'regimes' | 'matrix'>('diagram');
  const [viewMode, setViewMode] = useState<ViewMode>('regimes');
  const [isPlaying, setIsPlaying] = useState(false);
  // Start at the end so the user sees the full picture immediately.
  // They can hit Play to watch it animate from the start, or scrub anywhere.
  const [currentStep, setCurrentStep] = useState(seqLen - 1);
  // Panels collapsed by default so the visualisation dominates the screen.
  // User opens them when they want to tweak config or check stats.
  const [showParams, setShowParams] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Pan/zoom state for SVG canvas interaction (drag to pan, scroll to zoom)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ width: 800, height: 500 });

  // Measure container
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

  // Reset pan/zoom on view change
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [viewMode]);

  // Wheel zoom toward cursor position
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
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Drag to pan
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
    function onUp() { setIsDragging(false); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  const handleDoubleClick = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Generate HMM data and run inference algorithms
  const hmmData = useMemo(
    () => generateHMMData(seqLen, numStates, stickiness, regimes, seed),
    [seqLen, numStates, stickiness, regimes, seed]
  );

  const alpha = useMemo(
    () => forwardAlgorithm(hmmData.returns, numStates, hmmData.transMatrix, regimes),
    [hmmData, numStates, regimes]
  );

  const viterbi = useMemo(
    () => viterbiAlgorithm(hmmData.returns, numStates, hmmData.transMatrix, regimes),
    [hmmData, numStates, regimes]
  );

  // Animation timer: speed controls ms per step (lower = faster)
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentStep(prev => {
        if (prev >= seqLen - 1) { setIsPlaying(false); return prev; }
        return prev + 1;
      });
    }, speed);
    return () => clearInterval(interval);
  }, [isPlaying, seqLen, speed]);

  // Reset shows all data (jump to end). Play button handles resetting to 0 before animating.
  const resetAnimation = useCallback(() => {
    setCurrentStep(seqLen - 1);
    setIsPlaying(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [seqLen]);

  const stepForward = useCallback(() => {
    setCurrentStep(prev => Math.min(prev + 1, seqLen - 1));
  }, [seqLen]);

  // Update a single regime's parameters
  const updateRegime = useCallback((idx: number, field: keyof RegimeParams, value: number) => {
    setRegimes(prev => {
      const next = prev.map(r => ({ ...r }));
      next[idx][field] = value;
      return next;
    });
  }, []);

  // Statistics computed from current state
  const stats = useMemo(() => {
    const currentState = viterbi.path[currentStep] ?? 0;
    const currentProbs = alpha[currentStep] || [];

    // Count regime durations
    const regimeCounts = new Array(numStates).fill(0);
    const transitionCount = { total: 0 };
    for (let t = 0; t <= currentStep; t++) {
      regimeCounts[viterbi.path[t]]++;
      if (t > 0 && viterbi.path[t] !== viterbi.path[t - 1]) transitionCount.total++;
    }

    // Average regime duration (steps between transitions)
    const avgDuration = currentStep > 0 ? (currentStep + 1) / (transitionCount.total + 1) : 0;

    // Accuracy vs true states
    let correct = 0;
    for (let t = 0; t <= currentStep; t++) {
      if (viterbi.path[t] === hmmData.trueStates[t]) correct++;
    }

    return {
      currentState,
      currentRegime: COLORS.regimes[currentState],
      currentProbs,
      regimeCounts,
      transitions: transitionCount.total,
      avgDuration: avgDuration.toFixed(1),
      accuracy: currentStep > 0 ? (correct / (currentStep + 1) * 100).toFixed(1) : '0.0',
      currentReturn: hmmData.returns[currentStep]?.toFixed(3) ?? '0',
      currentPrice: hmmData.prices[currentStep + 1]?.toFixed(2) ?? '0',
      confidence: ((viterbi.confidence[currentStep] ?? 0) * 100).toFixed(0),
    };
  }, [viterbi, alpha, currentStep, numStates, hmmData]);

  return (
    <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[#1c1c1c] rounded-lg overflow-hidden border border-border">
      {/* Header */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none z-10">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-card text-[#e8e8e8] rounded-lg px-4 py-2 border border-border flex items-center gap-2">
            <span className="font-semibold text-[#e8e8e8]">HMM</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-[#b0b0b0] cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="text-sm">Interactive HMM regime detection. The model infers hidden market states (bull/bear/sideways) from observed returns using the Forward and Viterbi algorithms.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Sub-page toggle: switch between state diagram and regime chart */}
        <div className="flex items-center gap-1 pointer-events-auto">
          <Button
            variant={hmmView === 'diagram' ? 'default' : 'outline'} size="sm"
            onClick={() => setHmmView('diagram')}
            className={hmmView === 'diagram' ? '' : 'bg-card text-[#e8e8e8]'}
          >
            State Diagram
          </Button>
          <Button
            variant={hmmView === 'regimes' ? 'default' : 'outline'} size="sm"
            onClick={() => setHmmView('regimes')}
            className={hmmView === 'regimes' ? '' : 'bg-card text-[#e8e8e8]'}
          >
            Regime Chart
          </Button>
          <Button
            variant={hmmView === 'matrix' ? 'default' : 'outline'} size="sm"
            onClick={() => setHmmView('matrix')}
            className={hmmView === 'matrix' ? '' : 'bg-card text-[#e8e8e8]'}
          >
            Transition Matrix
          </Button>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <Button
            variant={isPlaying ? 'default' : 'outline'} size="sm"
            onClick={() => {
              if (!isPlaying) {
                // If at the end, reset to start before playing
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
          <Button variant="outline" size="sm" onClick={stepForward}
            className="bg-card text-[#e8e8e8]" disabled={currentStep >= seqLen - 1}>
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={resetAnimation}
            className="bg-card text-[#e8e8e8]">
            <RotateCcw className="h-4 w-4" />
          </Button>
          {/* Shock: bump the seed to force a different random regime history from t=0.
              Equivalent to re-running the simulation with fresh noise, which surfaces
              a new transition pattern while keeping all user-tuned params intact. */}
          <Button variant="outline" size="sm"
            onClick={() => { setSeed(s => (s + 1) % 1000); resetAnimation(); }}
            className="bg-card text-[#e8e8e8] gap-1">
            <Zap className="h-4 w-4" />
            <span className="hidden md:inline">Shock</span>
          </Button>
        </div>
      </div>

      {/* Left Panel: Model Config */}
      <div className="absolute left-4 top-20 w-64 space-y-2 pointer-events-auto z-10 max-h-[calc(100%-120px)] overflow-y-auto">
        <Collapsible open={showParams} onOpenChange={setShowParams}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[#e8e8e8]">
              <span className="flex items-center gap-2"><Settings className="h-4 w-4" />Model Config</span>
              {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card text-[#e8e8e8] border-border space-y-4">
              {/* Number of states */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">States</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{numStates}</span>
                </div>
                <Slider value={[numStates]} onValueChange={([v]) => { setNumStates(v); resetAnimation(); }}
                  min={2} max={6} step={1} />
              </div>

              {/* Stickiness (transition diagonal) */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Stickiness</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{stickiness.toFixed(2)}</span>
                </div>
                <Slider value={[stickiness]} onValueChange={([v]) => { setStickiness(v); resetAnimation(); }}
                  min={0.5} max={0.99} step={0.01} />
              </div>

              {/* Sequence length */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Sequence Length</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{seqLen}</span>
                </div>
                <Slider value={[seqLen]} onValueChange={([v]) => { setSeqLen(v); resetAnimation(); }}
                  min={50} max={10000} step={50} />
              </div>

              {/* Animation speed */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Speed</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{speed <= 10 ? 'Max' : speed <= 30 ? 'Fast' : speed <= 80 ? 'Normal' : 'Slow'}</span>
                </div>
                <Slider value={[speed]} onValueChange={([v]) => setSpeed(v)}
                  min={5} max={200} step={5} />
              </div>

              {/* Seed */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Seed</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{seed}</span>
                </div>
                <Slider value={[seed]} onValueChange={([v]) => { setSeed(v); resetAnimation(); }}
                  min={0} max={999} step={1} />
              </div>

              {/* Timestep scrubber */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex justify-between">
                  <Label className="text-xs text-[#b0b0b0]">Timestep</Label>
                  <span className="text-xs font-medium text-[#e8e8e8]">{currentStep + 1} / {seqLen}</span>
                </div>
                <Slider value={[currentStep]} onValueChange={([v]) => setCurrentStep(v)}
                  min={0} max={seqLen - 1} step={1} />
              </div>

              {/* Per-regime parameters */}
              <div className="pt-2 border-t border-border space-y-3">
                <Label className="text-xs text-[#b0b0b0]">Regime Parameters</Label>
                {Array.from({ length: numStates }).map((_, s) => {
                  const regime = COLORS.regimes[s];
                  return (
                    <div key={s} className="space-y-2 pl-2 border-l-2" style={{ borderColor: regime.color }}>
                      <span className="text-xs font-medium" style={{ color: regime.color }}>{regime.name}</span>

                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <Label className="text-[10px] text-[#808080]">Mean Return</Label>
                          <span className="text-[10px] font-mono text-[#b0b0b0]">{regimes[s].meanReturn.toFixed(2)}%</span>
                        </div>
                        <Slider value={[regimes[s].meanReturn]}
                          onValueChange={([v]) => updateRegime(s, 'meanReturn', v)}
                          min={-0.5} max={0.5} step={0.02} />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <Label className="text-[10px] text-[#808080]">Volatility</Label>
                          <span className="text-[10px] font-mono text-[#b0b0b0]">{regimes[s].volatility.toFixed(1)}%</span>
                        </div>
                        <Slider value={[regimes[s].volatility]}
                          onValueChange={([v]) => updateRegime(s, 'volatility', v)}
                          min={0.1} max={5.0} step={0.1} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Right Panel: Stats */}
      <div className="absolute right-4 top-20 w-56 pointer-events-auto z-10">
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[#e8e8e8]">
              <span className="flex items-center gap-2"><Info className="h-4 w-4" />Model Stats</span>
              {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-3 bg-card text-[#e8e8e8] border-border space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-[#b0b0b0]">Regime</span>
                <span className="text-sm font-bold" style={{ color: stats.currentRegime.color }}>
                  {stats.currentRegime.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-[#b0b0b0]">Accuracy</span>
                <span className="text-xs font-mono text-[#e8e8e8]">{stats.accuracy}%</span>
              </div>

              {/* Mini probability bars per state */}
              {stats.currentProbs.map((prob, s) => (
                <div key={s} className="flex justify-between items-center">
                  <span className="text-xs" style={{ color: COLORS.regimes[s].color }}>
                    {COLORS.regimes[s].name}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-2 rounded-full" style={{ background: COLORS.gridLine }}>
                      <div className="h-2 rounded-full" style={{
                        width: `${prob * 100}%`,
                        background: COLORS.regimes[s].color,
                        opacity: 0.6,
                      }} />
                    </div>
                    <span className="text-[10px] font-mono" style={{ color: COLORS.regimes[s].color }}>
                      {(prob * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Center: SVG Visualisation */}
      <div ref={containerRef} className="absolute inset-0 top-16 bottom-0 left-0 right-0">
        <svg
          ref={svgRef}
          width={svgSize.width} height={svgSize.height}
          viewBox={`0 0 ${svgSize.width} ${svgSize.height}`}
          className="w-full h-full"
          style={{
            background: 'var(--bg, #1c1c1c)',
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {hmmView === 'diagram' && (
              <StateDiagramView
                width={svgSize.width} height={svgSize.height}
                viterbiPath={viterbi.path} numStates={numStates}
                currentStep={currentStep} transMatrix={hmmData.transMatrix}
                regimes={regimes} alpha={alpha}
                returns={hmmData.returns} trueStates={hmmData.trueStates}
                seed={seed}
                customNames={customNames}
                selectedRegime={selectedRegime}
                onStateClick={(idx) => setSelectedRegime(prev => prev === idx ? null : idx)}
              />
            )}
            {hmmView === 'regimes' && (
              <RegimeChartView
                width={svgSize.width} height={svgSize.height}
                prices={hmmData.prices} viterbiPath={viterbi.path}
                numStates={numStates} currentStep={currentStep}
              />
            )}
            {hmmView === 'matrix' && (
              <TransitionMatrixView
                width={svgSize.width} height={svgSize.height}
                transMatrix={hmmData.transMatrix} numStates={numStates}
                viterbiPath={viterbi.path} currentStep={currentStep}
              />
            )}
          </g>

          {/* Zoom indicator (outside transform group) */}
          {zoom !== 1 && (
            <g transform={`translate(${svgSize.width - 120}, 12)`}>
              <rect width={100} height={22} rx={4} fill="#2a2a2a" stroke={COLORS.gridLine} />
              <text x={50} y={15} textAnchor="middle" fill={COLORS.textDim} fontSize={10} fontFamily="monospace">
                zoom: {(zoom * 100).toFixed(0)}%
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Bottom scrubber: wide time slider with live regime indicator.
          Promotes the timestep control out of the Config panel so a user can
          drag through history without opening any drawers. */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto z-10 w-[min(900px,calc(100%-48px))]">
        <div className="bg-card text-[#e8e8e8] rounded-lg px-4 py-3 border border-border space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="text-[#b0b0b0]">t</span>
              <span className="font-bold text-[#e8e8e8]">{currentStep + 1}</span>
              <span className="text-[#808080]">/ {seqLen}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#b0b0b0]">REGIME</span>
              <span className="font-bold" style={{ color: stats.currentRegime.color }}>
                S{stats.currentState + 1}: {(customNames[stats.currentState] && customNames[stats.currentState].trim()) || stats.currentRegime.name}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[#b0b0b0]">RET</span>
              <span className={`font-mono ${parseFloat(stats.currentReturn) >= 0 ? 'text-[#21b3a4]' : 'text-[#f0426c]'}`}>
                {parseFloat(stats.currentReturn) >= 0 ? '+' : ''}{stats.currentReturn}%
              </span>
              <span className="text-[#808080]">|</span>
              <span className="text-[#b0b0b0]">CONF</span>
              <span className="text-[#b0b0b0]">{stats.confidence}%</span>
            </div>
          </div>
          <Slider
            value={[currentStep]}
            onValueChange={([v]) => { if (isPlaying) setIsPlaying(false); setCurrentStep(v); }}
            min={0} max={Math.max(0, seqLen - 1)} step={1}
          />
          <div className="flex items-center justify-between text-[10px] font-mono text-[#808080]">
            <span>drag slider to scrub · drag canvas to pan · scroll to zoom · dbl-click canvas to reset view</span>
            <span>click a state to edit it</span>
          </div>
        </div>
      </div>

      {/* Regime editor popover: opens when user clicks a state circle on the
          diagram. Lets them rename the state and tune its mean/vol without
          opening the full Config panel. */}
      {selectedRegime !== null && selectedRegime < numStates && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-80 pointer-events-auto z-20">
          <Card className="p-4 bg-card text-[#e8e8e8] border-border space-y-3"
            style={{ borderColor: COLORS.regimes[selectedRegime].color, borderWidth: 2 }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.regimes[selectedRegime].color }} />
                <span className="text-xs font-mono text-[#b0b0b0]">EDIT STATE S{selectedRegime + 1}</span>
              </div>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-[#b0b0b0] hover:text-[#e8e8e8]"
                onClick={() => setSelectedRegime(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-[#b0b0b0]">Name</Label>
              <input
                type="text"
                className="w-full bg-[#262626] border border-border rounded px-2 py-1 text-sm font-mono text-[#e8e8e8] focus:outline-none focus:ring-1"
                style={{ borderColor: COLORS.regimes[selectedRegime].color }}
                value={customNames[selectedRegime] ?? COLORS.regimes[selectedRegime].name}
                onChange={(e) => setCustomNames(prev => ({ ...prev, [selectedRegime]: e.target.value }))}
                placeholder={COLORS.regimes[selectedRegime].name}
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-xs text-[#b0b0b0]">Mean return</Label>
                <span className="text-xs font-mono" style={{ color: COLORS.regimes[selectedRegime].color }}>
                  {regimes[selectedRegime].meanReturn >= 0 ? '+' : ''}{regimes[selectedRegime].meanReturn.toFixed(2)}%
                </span>
              </div>
              <Slider
                value={[regimes[selectedRegime].meanReturn]}
                onValueChange={([v]) => updateRegime(selectedRegime, 'meanReturn', v)}
                min={-0.5} max={0.5} step={0.02}
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-xs text-[#b0b0b0]">Volatility</Label>
                <span className="text-xs font-mono" style={{ color: COLORS.regimes[selectedRegime].color }}>
                  {regimes[selectedRegime].volatility.toFixed(1)}%
                </span>
              </div>
              <Slider
                value={[regimes[selectedRegime].volatility]}
                onValueChange={([v]) => updateRegime(selectedRegime, 'volatility', v)}
                min={0.1} max={5.0} step={0.1}
              />
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" className="flex-1 text-xs text-[#e8e8e8]"
                onClick={() => {
                  setCustomNames(prev => { const next = { ...prev }; delete next[selectedRegime]; return next; });
                  const def = DEFAULT_REGIMES[selectedRegime];
                  if (def) { updateRegime(selectedRegime, 'meanReturn', def.meanReturn); updateRegime(selectedRegime, 'volatility', def.volatility); }
                }}>
                Reset
              </Button>
              <Button variant="outline" size="sm" className="flex-1 text-xs text-[#e8e8e8]"
                onClick={() => setSelectedRegime(null)}>
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

