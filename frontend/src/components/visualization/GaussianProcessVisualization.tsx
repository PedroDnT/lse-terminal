import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Info, ChevronDown, ChevronUp, Settings, Eye, RotateCcw, Play, Pause, Shuffle, Film, FilmIcon, Clapperboard, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type ObsLayout = 'uniform' | 'clustered' | 'random';

interface GPParams {
  lengthScale: number;
  signalSigma: number;
  noiseSigma: number;
  numObs: number;
  seed: number;
  obsLayout: ObsLayout;
}

const X_MIN = 0;
const X_MAX = 10;
const Y_MIN = -3;
const Y_MAX = 3;
const TEST_RES = 200;
// Prior view defaults at zoom = 1.
const PRIOR_X_MIN = -3;
const PRIOR_X_MAX = 13;
// Prior samples are actually generated over a far wider x range than the
// default viewport so the curves still reach the canvas edges when the user
// zooms out. 300 points over 50 units keeps the lines smooth at every zoom.
const PRIOR_SAMPLE_X_MIN = -20;
const PRIOR_SAMPLE_X_MAX = 30;
const PRIOR_SAMPLE_RES = 300;

function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    return document.documentElement.classList.contains('dark');
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const sync = () => setIsDark(document.documentElement.classList.contains('dark'));
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('theme-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('theme-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return isDark;
}

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function rbf(x1: number, x2: number, ell: number, sigmaF: number): number {
  const d = x1 - x2;
  return sigmaF * sigmaF * Math.exp(-0.5 * d * d / (ell * ell));
}

// Cholesky factorization of a small symmetric PD matrix. Jitter on the diagonal
// prevents the solver from blowing up when two observations land on top of each
// other or the noise term is near zero.
function cholesky(A: number[][]): number[][] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) L[i][j] = Math.sqrt(Math.max(1e-10, sum));
      else L[i][j] = sum / L[j][j];
    }
  }
  return L;
}

function cholSolve(L: number[][], b: number[]): number[] {
  const n = L.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

// Deterministic "true" function the GP is trying to discover. Two sines plus a
// drift term, all seeded; same seed gives same target, so Replay is reproducible.
function buildTrueFn(seed: number): (x: number) => number {
  const rand = mulberry32(seed);
  const a1 = 0.6 + rand() * 0.9;
  const f1 = 0.4 + rand() * 0.7;
  const p1 = rand() * Math.PI * 2;
  const a2 = 0.25 + rand() * 0.5;
  const f2 = 1.1 + rand() * 1.5;
  const p2 = rand() * Math.PI * 2;
  const drift = (rand() - 0.5) * 0.12;
  return (x: number) => a1 * Math.sin(f1 * x + p1) + a2 * Math.sin(f2 * x + p2) + drift * (x - 5);
}

function buildObservations(params: GPParams, trueFn: (x: number) => number): { X: number[]; y: number[] } {
  const { numObs, seed, noiseSigma, obsLayout } = params;
  const rand = mulberry32(seed + 9999);
  const X: number[] = [];
  const span = X_MAX - X_MIN;
  if (obsLayout === 'uniform') {
    for (let i = 0; i < numObs; i++) {
      const frac = numObs === 1 ? 0.5 : (i + 0.5) / numObs;
      const jitter = (rand() - 0.5) * (span / numObs) * 0.3;
      X.push(X_MIN + frac * span + jitter);
    }
  } else if (obsLayout === 'clustered') {
    for (let i = 0; i < numObs; i++) {
      const center = (X_MIN + X_MAX) / 2;
      X.push(center + gaussian(rand) * 1.2);
    }
  } else {
    for (let i = 0; i < numObs; i++) X.push(X_MIN + rand() * span);
  }
  X.sort((a, b) => a - b);
  const y = X.map(x => trueFn(x) + gaussian(rand) * noiseSigma);
  return { X, y };
}

interface Posterior {
  testX: number[];
  mean: number[];
  std: number[];
  logLik: number;
}

function gpPosterior(params: GPParams, Xtrain: number[], ytrain: number[]): Posterior {
  const { lengthScale: ell, signalSigma: sigmaF, noiseSigma: sigmaN } = params;
  const testX: number[] = new Array(TEST_RES);
  for (let i = 0; i < TEST_RES; i++) testX[i] = X_MIN + (i / (TEST_RES - 1)) * (X_MAX - X_MIN);

  const N = Xtrain.length;
  if (N === 0) {
    return { testX, mean: testX.map(() => 0), std: testX.map(() => sigmaF), logLik: 0 };
  }

  const K: number[][] = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => rbf(Xtrain[i], Xtrain[j], ell, sigmaF) + (i === j ? sigmaN * sigmaN + 1e-6 : 0))
  );
  const L = cholesky(K);
  const alpha = cholSolve(L, ytrain);

  const mean: number[] = new Array(TEST_RES);
  const std: number[] = new Array(TEST_RES);
  for (let m = 0; m < TEST_RES; m++) {
    const kStar: number[] = new Array(N);
    for (let i = 0; i < N; i++) kStar[i] = rbf(testX[m], Xtrain[i], ell, sigmaF);
    let mu = 0;
    for (let i = 0; i < N; i++) mu += kStar[i] * alpha[i];
    mean[m] = mu;
    const v = cholSolve(L, kStar);
    let varVal = sigmaF * sigmaF;
    for (let i = 0; i < N; i++) varVal -= kStar[i] * v[i];
    std[m] = Math.sqrt(Math.max(1e-8, varVal));
  }

  let logLik = 0;
  for (let i = 0; i < N; i++) logLik -= 0.5 * ytrain[i] * alpha[i];
  for (let i = 0; i < N; i++) logLik -= Math.log(L[i][i]);
  logLik -= (N / 2) * Math.log(2 * Math.PI);

  return { testX, mean, std, logLik };
}

// Prior samples for the "before any data" pane. We draw independent function
// realizations from the GP prior so the viewer sees what the kernel's smoothness
// assumption actually looks like as curves. xMin/xMax let the caller render over
// a wider range than the posterior's [0,10] when we want samples to reach the
// edges of a wide canvas instead of hugging the middle.
function buildPriorSamples(params: GPParams, count: number, xMin = X_MIN, xMax = X_MAX, resolution = TEST_RES): { testX: number[]; samples: number[][] } {
  const { lengthScale: ell, signalSigma: sigmaF, seed } = params;
  const testX: number[] = new Array(resolution);
  for (let i = 0; i < resolution; i++) testX[i] = xMin + (i / (resolution - 1)) * (xMax - xMin);
  const K: number[][] = Array.from({ length: resolution }, (_, i) =>
    Array.from({ length: resolution }, (_, j) => rbf(testX[i], testX[j], ell, sigmaF) + (i === j ? 1e-5 : 0))
  );
  const L = cholesky(K);
  const samples: number[][] = [];
  for (let s = 0; s < count; s++) {
    const rand = mulberry32(seed + 1337 + s * 101);
    const z: number[] = new Array(resolution);
    for (let i = 0; i < resolution; i++) z[i] = gaussian(rand);
    const sample: number[] = new Array(resolution).fill(0);
    for (let i = 0; i < resolution; i++) {
      let acc = 0;
      for (let k = 0; k <= i; k++) acc += L[i][k] * z[k];
      sample[i] = acc;
    }
    samples.push(sample);
  }
  return { testX, samples };
}

// Educational GP posterior over an arbitrary x-range. Mirrors gpPosterior but
// lets the explainer section fit yield-curve-style data (maturity ∈ [0, 32])
// instead of the main viz's fixed [0, 10] domain. Same math: RBF kernel, Cholesky
// solve. The caller handles the non-zero prior mean by subtracting it from
// ytrain before calling and adding it back to mean[] when plotting.
function computeEduPosterior(
  ell: number, sigmaF: number, sigmaN: number,
  Xtrain: number[], ytrain: number[],
  xMin: number, xMax: number, resolution: number,
): { testX: number[]; mean: number[]; std: number[] } {
  const testX: number[] = new Array(resolution);
  for (let i = 0; i < resolution; i++) testX[i] = xMin + (i / (resolution - 1)) * (xMax - xMin);
  const N = Xtrain.length;
  if (N === 0) {
    return { testX, mean: testX.map(() => 0), std: testX.map(() => sigmaF) };
  }
  const K: number[][] = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => rbf(Xtrain[i], Xtrain[j], ell, sigmaF) + (i === j ? sigmaN * sigmaN + 1e-6 : 0))
  );
  const L = cholesky(K);
  const alpha = cholSolve(L, ytrain);
  const mean: number[] = new Array(resolution);
  const std: number[] = new Array(resolution);
  for (let m = 0; m < resolution; m++) {
    const kStar: number[] = new Array(N);
    for (let i = 0; i < N; i++) kStar[i] = rbf(testX[m], Xtrain[i], ell, sigmaF);
    let mu = 0;
    for (let i = 0; i < N; i++) mu += kStar[i] * alpha[i];
    mean[m] = mu;
    const v = cholSolve(L, kStar);
    let varVal = sigmaF * sigmaF;
    for (let i = 0; i < N; i++) varVal -= kStar[i] * v[i];
    std[m] = Math.sqrt(Math.max(1e-8, varVal));
  }
  return { testX, mean, std };
}

// Single static explainer panel: one axes-labelled SVG showing the yield curve
// with a GP posterior at a given evidence level (0, 2, or 5 observations). SVG
// rather than canvas because the annotations (tick labels, axis titles) are much
// easier to position declaratively here, and the panels never redraw.
function EduPanel({ title, posterior, data, priorMean, isDark, caption }: {
  title: string;
  posterior: { testX: number[]; mean: number[]; std: number[] };
  data: [number, number][];
  priorMean: number;
  isDark: boolean;
  caption: string;
}) {
  const W = 420, H = 300;
  const padL = 54, padR = 18, padT = 16, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xMin = 0, xMax = 32;
  const yMin = 3.0, yMax = 5.0;
  const toPx = (mat: number, yld: number): [number, number] => [
    padL + ((mat - xMin) / (xMax - xMin)) * plotW,
    padT + (1 - (yld - yMin) / (yMax - yMin)) * plotH,
  ];

  const N = posterior.testX.length;
  // Band polygon: trace upper edge left-to-right, then lower edge right-to-left.
  let bandD = '';
  for (let i = 0; i < N; i++) {
    const upper = posterior.mean[i] + priorMean + 2 * posterior.std[i];
    const [px, py] = toPx(posterior.testX[i], upper);
    bandD += (i === 0 ? 'M' : 'L') + `${px.toFixed(2)},${py.toFixed(2)} `;
  }
  for (let i = N - 1; i >= 0; i--) {
    const lower = posterior.mean[i] + priorMean - 2 * posterior.std[i];
    const [px, py] = toPx(posterior.testX[i], lower);
    bandD += `L${px.toFixed(2)},${py.toFixed(2)} `;
  }
  bandD += 'Z';

  let meanD = '';
  for (let i = 0; i < N; i++) {
    const [px, py] = toPx(posterior.testX[i], posterior.mean[i] + priorMean);
    meanD += (i === 0 ? 'M' : 'L') + `${px.toFixed(2)},${py.toFixed(2)} `;
  }

  const bandFill = isDark ? 'rgba(232,232,232,0.16)' : 'rgba(28,28,28,0.14)';
  const meanStroke = isDark ? '#e8e8e8' : '#3c3c3c';
  const axisColor = isDark ? '#b0b0b0' : '#505050';
  const gridColor = isDark ? '#2e2e2e' : '#d8d8d8';
  const plotBg = isDark ? '#1c1c1c' : '#f7f7f7';
  const dotOuter = isDark ? '#e8e8e8' : '#1c1c1c';
  const dotInner = isDark ? '#1c1c1c' : '#ffffff';
  const xTicks = [1, 5, 10, 20, 30];
  const yTicks = [3.5, 4.0, 4.5];

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 px-1 font-mono text-xs text-[color:var(--text)] font-semibold">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={title}>
        <rect x={padL} y={padT} width={plotW} height={plotH} fill={plotBg} stroke={gridColor} />
        {xTicks.map(t => {
          const [px] = toPx(t, yMin);
          return <line key={`gx${t}`} x1={px} x2={px} y1={padT} y2={padT + plotH} stroke={gridColor} strokeWidth={1} />;
        })}
        {yTicks.map(t => {
          const [, py] = toPx(xMin, t);
          return <line key={`gy${t}`} x1={padL} x2={padL + plotW} y1={py} y2={py} stroke={gridColor} strokeWidth={1} />;
        })}
        <path d={bandD} fill={bandFill} />
        <path d={meanD} fill="none" stroke={meanStroke} strokeWidth={2.2} />
        {data.map(([mat, yld], i) => {
          const [px, py] = toPx(mat, yld);
          return (
            <g key={i}>
              <circle cx={px} cy={py} r={6} fill={dotOuter} />
              <circle cx={px} cy={py} r={3.4} fill={dotInner} />
            </g>
          );
        })}
        {xTicks.map(t => {
          const [px] = toPx(t, yMin);
          return (
            <g key={`tx${t}`}>
              <line x1={px} x2={px} y1={padT + plotH} y2={padT + plotH + 4} stroke={axisColor} strokeWidth={1} />
              <text x={px} y={padT + plotH + 16} textAnchor="middle" fontSize={11} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={axisColor}>{t}Y</text>
            </g>
          );
        })}
        {yTicks.map(t => {
          const [, py] = toPx(xMin, t);
          return (
            <g key={`ty${t}`}>
              <line x1={padL - 4} x2={padL} y1={py} y2={py} stroke={axisColor} strokeWidth={1} />
              <text x={padL - 7} y={py + 4} textAnchor="end" fontSize={11} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={axisColor}>{t.toFixed(1)}%</text>
            </g>
          );
        })}
        <text x={padL + plotW / 2} y={H - 6} textAnchor="middle" fontSize={11} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={axisColor}>maturity (years)</text>
        <text x={14} y={padT + plotH / 2} textAnchor="middle" fontSize={11} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fill={axisColor} transform={`rotate(-90, 14, ${padT + plotH / 2})`}>yield</text>
      </svg>
      <div className="mt-2 px-1 text-[11px] text-[color:var(--dim)] font-mono leading-snug">{caption}</div>
    </div>
  );
}

interface Preset {
  id: string;
  label: string;
  blurb: string;
  params: Pick<GPParams, 'lengthScale' | 'signalSigma' | 'noiseSigma' | 'numObs' | 'obsLayout'>;
  seed: number;
}

const PRESETS: Preset[] = [
  {
    id: 'smooth',
    label: 'Smooth signal',
    blurb: 'Long length scale, low noise. The posterior glides through sparse observations with confidence.',
    params: { lengthScale: 2.0, signalSigma: 1.0, noiseSigma: 0.05, numObs: 8, obsLayout: 'uniform' },
    seed: 11,
  },
  {
    id: 'wiggly',
    label: 'Wiggly signal',
    blurb: 'Short length scale. The model bends tight around every point at the cost of looser extrapolation.',
    params: { lengthScale: 0.45, signalSigma: 1.0, noiseSigma: 0.05, numObs: 16, obsLayout: 'uniform' },
    seed: 22,
  },
  {
    id: 'noisy',
    label: 'Noisy data',
    blurb: 'High observation noise. The posterior stays humble even with plenty of observations.',
    params: { lengthScale: 1.2, signalSigma: 1.0, noiseSigma: 0.4, numObs: 16, obsLayout: 'uniform' },
    seed: 33,
  },
  {
    id: 'sparse',
    label: 'Sparse evidence',
    blurb: 'Only five observations. Watch the confidence band balloon between them.',
    params: { lengthScale: 1.0, signalSigma: 1.0, noiseSigma: 0.05, numObs: 5, obsLayout: 'uniform' },
    seed: 44,
  },
  {
    id: 'clustered',
    label: 'Extrapolation',
    blurb: 'All observations near the centre. The band swells at the edges — classic GP humility beyond the data.',
    params: { lengthScale: 1.0, signalSigma: 1.0, noiseSigma: 0.05, numObs: 10, obsLayout: 'clustered' },
    seed: 55,
  },
  {
    id: 'oversmooth',
    label: 'Over-smoothed',
    blurb: 'Length scale far longer than the true signal. The posterior misses the wiggles entirely.',
    params: { lengthScale: 3.0, signalSigma: 1.0, noiseSigma: 0.05, numObs: 14, obsLayout: 'uniform' },
    seed: 66,
  },
];

interface CanvasDims { width: number; height: number; }
interface Viewport { xMin: number; xMax: number; yMin: number; yMax: number; }

function mapX(x: number, view: Viewport, dims: CanvasDims, pad: number) {
  return pad + ((x - view.xMin) / (view.xMax - view.xMin)) * (dims.width - 2 * pad);
}
function mapY(y: number, view: Viewport, dims: CanvasDims, pad: number) {
  return pad + (1 - (y - view.yMin) / (view.yMax - view.yMin)) * (dims.height - 2 * pad);
}

// Pixel -> data inverse. Used by the wheel handler to anchor zoom at the cursor
// so the point under the pointer stays fixed as the view scales.
function invMapX(px: number, view: Viewport, dims: CanvasDims, pad: number) {
  return view.xMin + ((px - pad) / (dims.width - 2 * pad)) * (view.xMax - view.xMin);
}
function invMapY(py: number, view: Viewport, dims: CanvasDims, pad: number) {
  return view.yMin + (1 - (py - pad) / (dims.height - 2 * pad)) * (view.yMax - view.yMin);
}

// Pick a grid step that keeps 8-ish lines visible regardless of zoom.
function pickGridStep(span: number): number {
  const target = span / 10;
  const exp = Math.floor(Math.log10(target));
  const m = target / Math.pow(10, exp);
  let step;
  if (m < 1.5) step = 1;
  else if (m < 3.5) step = 2;
  else if (m < 7.5) step = 5;
  else step = 10;
  return step * Math.pow(10, exp);
}

interface DrawArgs {
  ctx: CanvasRenderingContext2D;
  dims: CanvasDims;
  view: Viewport;
  isDark: boolean;
  posterior: Posterior;
  obs: { X: number[]; y: number[] };
  revealSteps: number;
  trueFn: (x: number) => number;
  showTrue: boolean;
  showPriorSamples: boolean;
  priorSamples: number[][];
  bandOpacity: number;
}

function drawScene(args: DrawArgs) {
  const { ctx, dims, view, isDark, posterior, obs, revealSteps, trueFn, showTrue, showPriorSamples, priorSamples, bandOpacity } = args;
  const pad = 32;
  ctx.clearRect(0, 0, dims.width, dims.height);

  // Background
  // Flat terminal surface; canvas cannot resolve CSS vars so the var(--bg) hex fallback is used.
  ctx.fillStyle = isDark ? '#1c1c1c' : '#f0f0f0';
  ctx.fillRect(0, 0, dims.width, dims.height);

  // Clip subsequent drawing to the plot area so panned/zoomed content doesn't
  // bleed into the padding region where axis labels live.
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, dims.width - 2 * pad, dims.height - 2 * pad);
  ctx.clip();

  // Grid: step auto-scales so the grid stays readable at any zoom level.
  ctx.strokeStyle = isDark ? '#2e2e2e' : '#d8d8d8';
  ctx.lineWidth = 1;
  const xStep = pickGridStep(view.xMax - view.xMin);
  const yStep = pickGridStep(view.yMax - view.yMin);
  for (let gx = Math.ceil(view.xMin / xStep) * xStep; gx <= view.xMax; gx += xStep) {
    const px = mapX(gx, view, dims, pad);
    ctx.beginPath(); ctx.moveTo(px, pad); ctx.lineTo(px, dims.height - pad); ctx.stroke();
  }
  for (let gy = Math.ceil(view.yMin / yStep) * yStep; gy <= view.yMax; gy += yStep) {
    const py = mapY(gy, view, dims, pad);
    ctx.beginPath(); ctx.moveTo(pad, py); ctx.lineTo(dims.width - pad, py); ctx.stroke();
  }

  // Zero line a little stronger
  if (view.yMin <= 0 && view.yMax >= 0) {
    ctx.strokeStyle = isDark ? '#3a3a3a' : '#c0c0c0';
    ctx.beginPath();
    const zeroY = mapY(0, view, dims, pad);
    ctx.moveTo(pad, zeroY); ctx.lineTo(dims.width - pad, zeroY); ctx.stroke();
  }

  // Prior samples (only meaningful when showPriorSamples = true; drawn faint)
  if (showPriorSamples && priorSamples.length > 0) {
    ctx.strokeStyle = isDark ? 'rgba(176,176,176,0.35)' : 'rgba(96,96,96,0.35)';
    ctx.lineWidth = 1;
    for (const sample of priorSamples) {
      ctx.beginPath();
      for (let i = 0; i < sample.length; i++) {
        const px = mapX(posterior.testX[i], view, dims, pad);
        const py = mapY(sample[i], view, dims, pad);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  // Confidence band (±2σ). Neutral near-white at low opacity so it reads as a
  // soft envelope on the flat terminal background, matching the primary series.
  ctx.fillStyle = isDark ? `rgba(232, 232, 232, ${bandOpacity})` : `rgba(28, 28, 28, ${bandOpacity})`;
  ctx.beginPath();
  for (let i = 0; i < posterior.testX.length; i++) {
    const upper = posterior.mean[i] + 2 * posterior.std[i];
    const px = mapX(posterior.testX[i], view, dims, pad);
    const py = mapY(upper, view, dims, pad);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  for (let i = posterior.testX.length - 1; i >= 0; i--) {
    const lower = posterior.mean[i] - 2 * posterior.std[i];
    const px = mapX(posterior.testX[i], view, dims, pad);
    const py = mapY(lower, view, dims, pad);
    ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  // True function (faint dashed teal). Hidden by default; toggle to compare
  // the posterior against what the GP is trying to discover.
  if (showTrue) {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = isDark ? 'rgba(33,179,164,0.75)' : 'rgba(19,128,117,0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < posterior.testX.length; i++) {
      const px = mapX(posterior.testX[i], view, dims, pad);
      const py = mapY(trueFn(posterior.testX[i]), view, dims, pad);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Posterior mean curve, thick near-white (primary series color)
  ctx.strokeStyle = isDark ? '#e8e8e8' : '#3c3c3c';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < posterior.testX.length; i++) {
    const px = mapX(posterior.testX[i], view, dims, pad);
    const py = mapY(posterior.mean[i], view, dims, pad);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Observation dots: reveal up to `revealSteps`. Dots appear with a short
  // "pop" as the animation reaches them: scale grows from 0 to full over a
  // fractional step window so the reveal feels continuous, not stepped.
  const revealInt = Math.floor(revealSteps);
  const revealFrac = revealSteps - revealInt;
  for (let i = 0; i < obs.X.length; i++) {
    let scale = 0;
    if (i < revealInt) scale = 1;
    else if (i === revealInt) scale = Math.min(1, revealFrac * 2);
    if (scale <= 0) continue;
    const px = mapX(obs.X[i], view, dims, pad);
    const py = mapY(obs.y[i], view, dims, pad);
    ctx.fillStyle = isDark ? '#e8e8e8' : '#1c1c1c';
    ctx.beginPath();
    ctx.arc(px, py, 5.5 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isDark ? '#1c1c1c' : '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 3.2 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore(); // end plot-area clip

  // Axis labels: short, mono, not obtrusive
  ctx.fillStyle = isDark ? '#b0b0b0' : '#606060';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'alphabetic';
  if (view.yMin <= 0 && view.yMax >= 0) {
    const zeroY = mapY(0, view, dims, pad);
    ctx.fillText('x', dims.width - pad + 4, zeroY + 4);
  }
  ctx.fillText('f(x)', pad - 24, pad - 4);
}

// Shared chrome for non-posterior views: flat background, grid, zero line.
// Keeps the three modes visually consistent without duplicating 30 lines each.
function drawChrome(ctx: CanvasRenderingContext2D, dims: CanvasDims, view: Viewport, isDark: boolean, pad: number) {
  ctx.clearRect(0, 0, dims.width, dims.height);
  // Flat terminal surface; canvas cannot resolve CSS vars so the var(--bg) hex fallback is used.
  ctx.fillStyle = isDark ? '#1c1c1c' : '#f0f0f0';
  ctx.fillRect(0, 0, dims.width, dims.height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, dims.width - 2 * pad, dims.height - 2 * pad);
  ctx.clip();

  ctx.strokeStyle = isDark ? '#2e2e2e' : '#d8d8d8';
  ctx.lineWidth = 1;
  const xStep = pickGridStep(view.xMax - view.xMin);
  const yStep = pickGridStep(view.yMax - view.yMin);
  for (let gx = Math.ceil(view.xMin / xStep) * xStep; gx <= view.xMax; gx += xStep) {
    const px = mapX(gx, view, dims, pad);
    ctx.beginPath(); ctx.moveTo(px, pad); ctx.lineTo(px, dims.height - pad); ctx.stroke();
  }
  for (let gy = Math.ceil(view.yMin / yStep) * yStep; gy <= view.yMax; gy += yStep) {
    const py = mapY(gy, view, dims, pad);
    ctx.beginPath(); ctx.moveTo(pad, py); ctx.lineTo(dims.width - pad, py); ctx.stroke();
  }

  if (view.yMin <= 0 && view.yMax >= 0) {
    ctx.strokeStyle = isDark ? '#3a3a3a' : '#c0c0c0';
    ctx.beginPath();
    const zeroY = mapY(0, view, dims, pad);
    ctx.moveTo(pad, zeroY); ctx.lineTo(dims.width - pad, zeroY); ctx.stroke();
  }
}

interface PriorDrawArgs {
  ctx: CanvasRenderingContext2D;
  dims: CanvasDims;
  view: Viewport;
  isDark: boolean;
  testX: number[];
  samples: number[][];
  signalSigma: number;
}

// Prior-samples view: shows what the kernel considers plausible before any
// data. Anchored by a ±2σ horizontal band (the "envelope" the RBF prior lives
// inside, since k(x,x) = σ_f² is stationary) plus a small number of sample
// realizations. Palette is intentionally monochrome grey so samples read as
// variations on a theme rather than a rainbow of unrelated signals.
function drawPriorScene(args: PriorDrawArgs) {
  const { ctx, dims, view, isDark, testX, samples, signalSigma } = args;
  const pad = 32;
  drawChrome(ctx, dims, view, isDark, pad);

  // ±2σ band: constant height since the RBF prior variance doesn't depend on x.
  // Gives the eye a fixed reference for "where samples are expected to live".
  ctx.fillStyle = isDark ? 'rgba(232, 232, 232, 0.12)' : 'rgba(28, 28, 28, 0.10)';
  const topPx = mapY(2 * signalSigma, view, dims, pad);
  const botPx = mapY(-2 * signalSigma, view, dims, pad);
  ctx.fillRect(pad, topPx, dims.width - 2 * pad, botPx - topPx);

  // Monochrome grey palette with varying alpha/lightness. One sample is bold
  // and full-opacity so the viewer has a clear "hero" curve; the rest recede
  // into supporting context. This mirrors how textbook GP figures highlight a
  // representative sample against the kernel envelope.
  const palette = isDark
    ? [{ c: '#e8e8e8', a: 0.95, w: 2.4 },
       { c: '#c8c8c8', a: 0.72, w: 1.6 },
       { c: '#a0a0a0', a: 0.72, w: 1.6 },
       { c: '#e8e8e8', a: 0.48, w: 1.4 },
       { c: '#c8c8c8', a: 0.35, w: 1.4 }]
    : [{ c: '#3c3c3c', a: 0.95, w: 2.4 },
       { c: '#585858', a: 0.72, w: 1.6 },
       { c: '#707070', a: 0.72, w: 1.6 },
       { c: '#3c3c3c', a: 0.48, w: 1.4 },
       { c: '#585858', a: 0.35, w: 1.4 }];

  for (let s = 0; s < samples.length; s++) {
    const style = palette[s % palette.length];
    ctx.strokeStyle = style.c;
    ctx.globalAlpha = style.a;
    ctx.lineWidth = style.w;
    ctx.beginPath();
    for (let i = 0; i < samples[s].length; i++) {
      const px = mapX(testX[i], view, dims, pad);
      const py = mapY(samples[s][i], view, dims, pad);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // Axes labels (subtle).
  ctx.fillStyle = isDark ? '#b0b0b0' : '#606060';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  if (view.yMin <= 0 && view.yMax >= 0) {
    const zeroY = mapY(0, view, dims, pad);
    ctx.fillText('x', dims.width - pad + 4, zeroY + 4);
  }
  ctx.fillText('f(x)', pad - 24, pad - 4);

  // In-canvas caption tells the viewer what they're actually looking at without
  // forcing them to read the side panel. Low-contrast so it doesn't fight the
  // sample curves for attention.
  ctx.fillStyle = isDark ? 'rgba(176,176,176,0.6)' : 'rgba(96,96,96,0.6)';
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`${samples.length} functions drawn from the GP prior · band = ±2σ_f`, pad + 6, pad + 16);
}

interface KernelDrawArgs {
  ctx: CanvasRenderingContext2D;
  dims: CanvasDims;
  view: Viewport;
  isDark: boolean;
  lengthScale: number;
  signalSigma: number;
}

// Kernel view: plots k(Δ) = σ_f² · exp(-Δ²/2ℓ²) against distance Δ. Makes the
// abstract "length scale" parameter visible: ℓ is the distance at which the
// correlation has dropped to e^(-½) ≈ 0.607 of its peak. Amber shade marks 3ℓ,
// the conventional effective range where the kernel retains >~1% of weight.
function drawKernelScene(args: KernelDrawArgs) {
  const { ctx, dims, view, isDark, lengthScale, signalSigma } = args;
  const pad = 40;
  drawChrome(ctx, dims, view, isDark, pad);

  const sigma2 = signalSigma * signalSigma;

  // Effective-range band [0, 3ℓ]. Visual anchor tying the slider value to a
  // physical "how far can two points still see each other" distance.
  const rangeEnd = Math.min(view.xMax, 3 * lengthScale);
  if (rangeEnd > 0) {
    // Muted amber (#c58435): the one secondary accent, kept so the "shaded amber
    // band" wording in the side panel stays true without a neon hue.
    ctx.fillStyle = isDark ? 'rgba(197,132,53,0.12)' : 'rgba(150,95,30,0.10)';
    const x0 = mapX(0, view, dims, pad);
    const x1 = mapX(rangeEnd, view, dims, pad);
    const y0 = mapY(view.yMin, view, dims, pad);
    const y1 = mapY(view.yMax, view, dims, pad);
    ctx.fillRect(x0, y1, x1 - x0, y0 - y1);
  }

  ctx.strokeStyle = isDark ? '#e8e8e8' : '#3c3c3c';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  const N = 240;
  for (let i = 0; i < N; i++) {
    const d = view.xMin + (i / (N - 1)) * (view.xMax - view.xMin);
    const k = sigma2 * Math.exp(-0.5 * d * d / (lengthScale * lengthScale));
    const px = mapX(d, view, dims, pad);
    const py = mapY(k, view, dims, pad);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  if (lengthScale >= view.xMin && lengthScale <= view.xMax) {
    ctx.strokeStyle = isDark ? 'rgba(33,179,164,0.8)' : 'rgba(19,128,117,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    const px = mapX(lengthScale, view, dims, pad);
    ctx.moveTo(px, pad);
    ctx.lineTo(px, dims.height - pad);
    ctx.stroke();
    ctx.setLineDash([]);
    const kEll = sigma2 * Math.exp(-0.5);
    const py = mapY(kEll, view, dims, pad);
    ctx.fillStyle = isDark ? '#21b3a4' : '#138075';
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  ctx.fillStyle = isDark ? '#b0b0b0' : '#505050';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('Δx (distance)', dims.width - pad - 80, dims.height - pad + 18);
  ctx.save();
  ctx.translate(pad - 28, pad + 90);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('k(Δx) covariance', 0, 0);
  ctx.restore();

  ctx.fillStyle = isDark ? '#e8e8e8' : '#3c3c3c';
  const peakPx = mapX(0, view, dims, pad);
  const peakPy = mapY(sigma2, view, dims, pad);
  ctx.fillText(`k(0) = σ_f² = ${sigma2.toFixed(2)}`, peakPx + 10, peakPy + 4);

  if (lengthScale >= view.xMin && lengthScale <= view.xMax) {
    ctx.fillStyle = isDark ? '#21b3a4' : '#138075';
    const lx = mapX(lengthScale, view, dims, pad);
    ctx.fillText(`ℓ = ${lengthScale.toFixed(2)}`, lx + 6, pad + 14);
  }
}

export default function GaussianProcessVisualization() {
  const [params, setParams] = useState<GPParams>({
    lengthScale: 1.0,
    signalSigma: 1.0,
    noiseSigma: 0.1,
    numObs: 10,
    seed: 7,
    obsLayout: 'uniform',
  });

  const [showTrue, setShowTrue] = useState(true);
  const [showPriorSamples, setShowPriorSamples] = useState(false);
  const [bandOpacity, setBandOpacity] = useState(0.22);
  const [showParams, setShowParams] = useState(true);
  const [showVisuals, setShowVisuals] = useState(false);
  const [showStats, setShowStats] = useState(true);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(2.5); // observations revealed per second
  const [revealSteps, setRevealSteps] = useState(params.numObs);

  const [activePreset, setActivePreset] = useState<Preset | null>(null);
  const [cinematic, setCinematic] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);

  // Which of the three views is active. Mirrors HMM's three-button pattern.
  // Posterior = current fit with data, Prior = kernel-only samples,
  // Kernel = the covariance function k(Δ) plotted against distance.
  // Switching view resets zoom/pan (see effect below) so a stale zoom state
  // from one view can't cluster the next view's content in the middle.
  const [gpView, setGpView] = useState<'posterior' | 'prior' | 'kernel'>('posterior');

  // Viewport: zoom factor + pan offset in data units. Default view fills the
  // full [0,10] × [-3,3] domain. Pan shifts the view centre; zoom shrinks the
  // span symmetrically around that centre.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Reset zoom/pan whenever the user switches view. Without this, a zoomed-in
  // posterior state carries into prior/kernel where the viewport math differs,
  // producing awkward partial views on first entry.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [gpView]);

  const isDark = useIsDarkTheme();

  const trueFn = useMemo(() => buildTrueFn(params.seed), [params.seed]);
  const obs = useMemo(() => buildObservations(params, trueFn), [params, trueFn]);

  // Compute posterior using only the currently-revealed observations. This is
  // the core of the animation: as revealSteps grows, more data feeds the
  // conditioning and the band collapses around those points.
  const posterior = useMemo(() => {
    const revealInt = Math.max(0, Math.min(obs.X.length, Math.floor(revealSteps)));
    return gpPosterior(params, obs.X.slice(0, revealInt), obs.y.slice(0, revealInt));
  }, [params, obs, revealSteps]);

  // Prior-overlay samples shown in Posterior mode share the posterior's x-grid
  // [X_MIN, X_MAX], so callers can draw them against posterior.testX directly.
  const priorSamples = useMemo(
    () => showPriorSamples ? buildPriorSamples(params, 3).samples : [],
    [params, showPriorSamples]
  );

  // Prior view animation tick. Bumped by the Play loop so samples re-roll over
  // time, giving the Prior view something to animate instead of being static.
  const [priorTick, setPriorTick] = useState(0);

  // Prior samples: 5 draws (down from 8) over a deliberately wide fixed range
  // so the same sample set still reaches the canvas edges when the user zooms
  // out 2x or 3x. Cholesky runs once per (params, tick) change; zooming doesn't
  // re-trigger it. priorTick folds into the seed so Play produces a fresh set.
  const viewPriorSamples = useMemo(() => {
    if (gpView !== 'prior') return { testX: [] as number[], samples: [] as number[][] };
    const offsetSeed = params.seed + Math.floor(priorTick) * 1009;
    return buildPriorSamples({ ...params, seed: offsetSeed }, 5, PRIOR_SAMPLE_X_MIN, PRIOR_SAMPLE_X_MAX, PRIOR_SAMPLE_RES);
  }, [params, gpView, priorTick]);

  // Canvas rendering. ResizeObserver keeps the bitmap matched to the container
  // so the scene stays crisp at any viewport size. devicePixelRatio capped at 2
  // to avoid burning fill rate on high-DPI screens (matches the iPhone DPR cap
  // convention used elsewhere in the repo).
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<CanvasDims>({ width: 800, height: 600 });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        const h = Math.floor(entry.contentRect.height);
        if (w > 0 && h > 0) setDims({ width: w, height: h });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const view = useMemo<Viewport>(() => {
    // Kernel view plots k(Δ) vs distance, so its axes are tied to σ_f² and ℓ
    // rather than the function-space [-3, 3] we use for posterior/prior.
    if (gpView === 'kernel') {
      const sigma2 = params.signalSigma * params.signalSigma;
      const xSpan = Math.max(4, params.lengthScale * 4);
      return {
        xMin: -xSpan * 0.03,
        xMax: xSpan,
        yMin: -sigma2 * 0.08,
        yMax: sigma2 * 1.18,
      };
    }
    // Prior view uses the wider PRIOR_X range for its viewport so the sample
    // curves fill the canvas edge-to-edge. Y is loose enough (≈3σ each side)
    // that samples rarely clip even at extreme kernel parameters.
    if (gpView === 'prior') {
      const xCenter = (PRIOR_X_MIN + PRIOR_X_MAX) / 2 + pan.x;
      const yCenter = 0 + pan.y;
      const xSpan = (PRIOR_X_MAX - PRIOR_X_MIN) / zoom;
      const yHalf = Math.max(2.4, params.signalSigma * 3.0) / zoom;
      return {
        xMin: xCenter - xSpan / 2,
        xMax: xCenter + xSpan / 2,
        yMin: yCenter - yHalf,
        yMax: yCenter + yHalf,
      };
    }
    const xCenter = (X_MIN + X_MAX) / 2 + pan.x;
    const yCenter = (Y_MIN + Y_MAX) / 2 + pan.y;
    const xSpan = (X_MAX - X_MIN) / zoom;
    const ySpan = (Y_MAX - Y_MIN) / zoom;
    return {
      xMin: xCenter - xSpan / 2,
      xMax: xCenter + xSpan / 2,
      yMin: yCenter - ySpan / 2,
      yMax: yCenter + ySpan / 2,
    };
  }, [zoom, pan, gpView, params.signalSigma, params.lengthScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = dims.width * dpr;
    canvas.height = dims.height * dpr;
    canvas.style.width = dims.width + 'px';
    canvas.style.height = dims.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (gpView === 'prior') {
      drawPriorScene({ ctx, dims, view, isDark, testX: viewPriorSamples.testX, samples: viewPriorSamples.samples, signalSigma: params.signalSigma });
    } else if (gpView === 'kernel') {
      drawKernelScene({ ctx, dims, view, isDark, lengthScale: params.lengthScale, signalSigma: params.signalSigma });
    } else {
      drawScene({
        ctx, dims, view, isDark, posterior, obs, revealSteps, trueFn,
        showTrue, showPriorSamples, priorSamples, bandOpacity,
      });
    }
  }, [dims, view, isDark, posterior, obs, revealSteps, trueFn, showTrue, showPriorSamples, priorSamples, bandOpacity, gpView, viewPriorSamples, params.lengthScale, params.signalSigma]);

  // Refs mirror state so event handlers can subscribe once and still read the
  // latest values. Subscribing on every zoom/pan tick would tear down and
  // re-add the window listeners each frame, which drops events mid-drag.
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const dimsRef = useRef(dims);
  const viewRef = useRef(view);
  const draggingRef = useRef(false);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { dimsRef.current = dims; }, [dims]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { draggingRef.current = isDragging; }, [isDragging]);

  // Wheel zoom, anchored at the cursor so the point under the pointer stays in
  // place. `passive: false` lets us call preventDefault and stop the page from
  // scrolling while the user zooms the canvas.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const pad = 32;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const curZoom = zoomRef.current;
      const curDims = dimsRef.current;
      const curView = viewRef.current;
      // Min zoom 0.5 gives the user headroom to zoom out for context while
      // preventing the posterior data from collapsing to a dot in the middle.
      // Prior samples are generated over a much wider range than the default
      // viewport so they still reach the edges at zoom = 0.5.
      const newZoom = Math.max(0.5, Math.min(40, curZoom * factor));
      if (newZoom === curZoom) return;
      const dataX = invMapX(px, curView, curDims, pad);
      const dataY = invMapY(py, curView, curDims, pad);
      const newXSpan = (X_MAX - X_MIN) / newZoom;
      const newYSpan = (Y_MAX - Y_MIN) / newZoom;
      const fracX = (px - pad) / (curDims.width - 2 * pad);
      const fracY = 1 - (py - pad) / (curDims.height - 2 * pad);
      const newXMin = dataX - fracX * newXSpan;
      const newYMin = dataY - fracY * newYSpan;
      setZoom(newZoom);
      setPan({
        x: (newXMin + newXSpan / 2) - (X_MIN + X_MAX) / 2,
        y: (newYMin + newYSpan / 2) - (Y_MIN + Y_MAX) / 2,
      });
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // Click-drag to pan. Mousedown on canvas captures; mousemove/mouseup on
  // window so the gesture survives even if the cursor leaves the canvas.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let startPx = { x: 0, y: 0 };
    let startPan = { x: 0, y: 0 };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      startPx = { x: e.clientX, y: e.clientY };
      startPan = { ...panRef.current };
      setIsDragging(true);
    };
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const dxPx = e.clientX - startPx.x;
      const dyPx = e.clientY - startPx.y;
      const curZoom = zoomRef.current;
      const curDims = dimsRef.current;
      const xSpan = (X_MAX - X_MIN) / curZoom;
      const ySpan = (Y_MAX - Y_MIN) / curZoom;
      const dxData = -dxPx / (curDims.width - 64) * xSpan;
      const dyData = dyPx / (curDims.height - 64) * ySpan;
      setPan({ x: startPan.x + dxData, y: startPan.y + dyData });
    };
    const onUp = () => setIsDragging(false);
    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      container.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Playback loop: what "play" means depends on the active view.
  //   Posterior -> advance revealSteps so observations appear one by one and the
  //     band collapses. Auto-stops at numObs since there's nothing left to reveal.
  //   Prior -> bump priorTick so a fresh set of sample curves is drawn on each
  //     integer tick, giving a continuous slideshow of kernel draws.
  //   Kernel -> oscillate length scale between 0.3 and 3.0 so the k(Δ) curve
  //     widens and narrows, showing how ℓ controls correlation decay.
  // Wall-clock delta keeps playSpeed feeling consistent regardless of frame rate.
  useEffect(() => {
    if (!isPlaying) return;
    let last = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (gpView === 'posterior') {
        setRevealSteps(prev => {
          const next = prev + dt * playSpeed;
          if (next >= params.numObs) {
            setIsPlaying(false);
            return params.numObs;
          }
          return next;
        });
      } else if (gpView === 'prior') {
        // 0.12 factor means samples re-roll roughly every ~3s at playSpeed=2.5,
        // slow enough that the eye can follow the evolving population instead
        // of seeing a blur of constantly-changing lines.
        setPriorTick(prev => prev + dt * playSpeed * 0.12);
      } else {
        // Kernel sweep: sine wave phase advances with playSpeed. ℓ travels
        // 0.3 ↔ 3.0 on each half-cycle, matching the slider's clamp range.
        const phase = (now / 1000) * 0.35 * playSpeed;
        const ell = 1.65 + 1.35 * Math.sin(phase);
        setParams(p => p.lengthScale === ell ? p : { ...p, lengthScale: ell });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, playSpeed, params.numObs, gpView]);

  // When obs set changes (seed, layout, count), jump to fully-revealed so the
  // user sees the finished fit immediately. Replay/Play rewinds explicitly.
  useEffect(() => { setRevealSteps(params.numObs); }, [params.numObs, params.seed, params.obsLayout]);

  const stats = useMemo(() => {
    const revealInt = Math.max(0, Math.min(obs.X.length, Math.floor(revealSteps)));
    const avgStd = posterior.std.reduce((a, b) => a + b, 0) / posterior.std.length;
    const avgCIWidth = 4 * avgStd;
    let rmse = 0;
    for (let i = 0; i < posterior.testX.length; i++) {
      const err = posterior.mean[i] - trueFn(posterior.testX[i]);
      rmse += err * err;
    }
    rmse = Math.sqrt(rmse / posterior.testX.length);
    return {
      observed: revealInt,
      total: obs.X.length,
      logLik: posterior.logLik,
      avgCIWidth,
      rmse,
    };
  }, [posterior, obs, revealSteps, trueFn]);

  const handlePlayToggle = () => {
    // Only the posterior loop has a "finished" state (all obs revealed) that
    // needs rewinding on replay. Prior/kernel loops are open-ended.
    if (gpView === 'posterior' && revealSteps >= params.numObs) setRevealSteps(0);
    setIsPlaying(p => !p);
  };
  const handleReset = () => {
    setRevealSteps(0);
    setIsPlaying(true);
  };
  const handleShuffle = () => {
    setParams(p => ({ ...p, seed: (p.seed + 1) | 0 }));
    setRevealSteps(0);
    setIsPlaying(true);
  };
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const applyPreset = useCallback((preset: Preset) => {
    setParams(p => ({ ...p, ...preset.params, seed: preset.seed }));
    setActivePreset(preset);
    setRevealSteps(0);
    setIsPlaying(true);
  }, []);

  useEffect(() => {
    if (!tourActive) return;
    applyPreset(PRESETS[tourIndex % PRESETS.length]);
    const t = setTimeout(() => setTourIndex(i => i + 1), 10000);
    return () => clearTimeout(t);
  }, [tourActive, tourIndex, applyPreset]);

  // Educational triptych below the interactive viz: same GP math applied to a
  // fixed yield-curve example at 0 / 2 / 5 observations. Hardcoded data so the
  // three panels are stable reference material, not animated. ℓ=5 years matches
  // the scale at which yield changes correlate across the curve; σ_f=0.5 is
  // tuned to make the ±2σ prior band a believable "fat strip" of plausible
  // yields (~±1%); σ_n is tiny since observed bond yields are essentially exact.
  const EDU_PRIOR_MEAN = 4.0;
  const EDU_X = [1, 2, 5, 10, 30];
  const EDU_Y = [4.5, 4.0, 3.7, 4.1, 4.4];
  const EDU_DEV = EDU_Y.map(y => y - EDU_PRIOR_MEAN);
  const eduPriorOnly = useMemo(
    () => computeEduPosterior(5, 0.5, 0.02, [], [], 0, 32, 120),
    []
  );
  const eduTwoObs = useMemo(
    () => computeEduPosterior(5, 0.5, 0.02, [EDU_X[1], EDU_X[3]], [EDU_DEV[1], EDU_DEV[3]], 0, 32, 120),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const eduFiveObs = useMemo(
    () => computeEduPosterior(5, 0.5, 0.02, EDU_X, EDU_DEV, 0, 32, 120),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div>
    <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[color:var(--bg)] rounded-lg overflow-hidden border border-border">
      <div
        ref={containerRef}
        className={`absolute inset-0 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <canvas ref={canvasRef} className="block" />
      </div>

      {/* Header: title + stats chips + Play / Scenarios / Modes popovers */}
      <div className={`absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none transition-opacity ${cinematic ? 'opacity-0' : 'opacity-100'}`}>
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-2 text-[color:var(--text)]">
            <span className="font-semibold font-mono">Gaussian Process</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-[color:var(--dim)] cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm font-mono">
                  <p className="text-sm">k(x,x') = σ²_f · exp(-½(x-x')²/ℓ²)</p>
                  <p className="text-xs mt-1 text-[color:var(--dim)]">RBF kernel. Press Play to watch the posterior band collapse as each observation feeds in.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="px-3 py-1 rounded text-xs font-mono bg-card border border-border text-[color:var(--text)]">
            obs {stats.observed}/{stats.total}
          </div>
          <div className="px-3 py-1 rounded text-xs font-mono bg-[color:var(--bg2)] border border-[color:var(--edge)] text-[color:var(--up)]">
            logL: {stats.logLik.toFixed(2)}
          </div>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <Button variant="outline" size="sm" onClick={handlePlayToggle} className="bg-card gap-1 text-[color:var(--text)] hover:text-[color:var(--text)]">
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span className="hidden md:inline">{isPlaying ? 'Pause' : 'Play'}</span>
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={activePreset ? 'default' : 'outline'}
                size="sm"
                className={`gap-1 font-mono ${activePreset ? 'bg-[color:var(--hover)] text-[color:var(--text)] hover:bg-[color:var(--edge)]' : 'bg-card text-[color:var(--text)] hover:text-[color:var(--text)]'}`}
              >
                <Film className="h-4 w-4" />
                <span className="hidden md:inline">{activePreset ? activePreset.label : 'Scenarios'}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 p-1 bg-card font-mono">
              {PRESETS.map(preset => {
                const isActive = activePreset?.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => { if (tourActive) setTourActive(false); applyPreset(preset); }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[color:var(--hover)] ${isActive ? 'text-[#c58435]' : 'text-[color:var(--text)]'}`}
                  >
                    <Film className="h-3.5 w-3.5" /> {preset.label}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={tourActive || cinematic ? 'default' : 'outline'}
                size="sm"
                className={`gap-1 font-mono ${tourActive || cinematic ? 'bg-[color:var(--hover)] text-[color:var(--text)] hover:bg-[color:var(--edge)]' : 'bg-card text-[color:var(--text)] hover:text-[color:var(--text)]'}`}
              >
                <FilmIcon className="h-4 w-4" />
                <span className="hidden md:inline">
                  {tourActive ? `Tour ${(tourIndex % PRESETS.length) + 1}/${PRESETS.length}` : cinematic ? 'Cinema' : 'Modes'}
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1 bg-card font-mono">
              <button onClick={handleReset} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[color:var(--hover)] text-[color:var(--text)]">
                <RotateCcw className="h-3.5 w-3.5" /> Replay
              </button>
              <button onClick={handleShuffle} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[color:var(--hover)] text-[color:var(--text)]">
                <Shuffle className="h-3.5 w-3.5" /> New seed
              </button>
              <button onClick={resetView} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[color:var(--hover)] text-[color:var(--text)]">
                <RotateCcw className="h-3.5 w-3.5" /> Reset view
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                onClick={() => { if (tourActive) { setTourActive(false); } else { setTourIndex(0); setTourActive(true); } }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[color:var(--hover)] ${tourActive ? 'text-[#c58435]' : 'text-[color:var(--text)]'}`}
              >
                <FilmIcon className="h-3.5 w-3.5" /> {tourActive ? 'Stop tour' : 'Guided tour'}
              </button>
              <button
                onClick={() => setCinematic(c => !c)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[color:var(--hover)] ${cinematic ? 'text-[#c58435]' : 'text-[color:var(--text)]'}`}
              >
                <Clapperboard className="h-3.5 w-3.5" /> {cinematic ? 'Exit cinema' : 'Cinema mode'}
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {cinematic && (
        <div className="absolute top-4 right-4 pointer-events-auto z-30">
          <Button variant="outline" size="sm" onClick={() => setCinematic(false)}
            className="bg-card text-[color:var(--text)] hover:text-[color:var(--text)] border-[color:var(--edge)] gap-1">
            <X className="h-4 w-4" />
            Exit Cinema
          </Button>
        </div>
      )}

      {/* View switcher: three modes, mirrors HMM's diagram/regime/matrix pattern.
          Centered above everything else so it reads as the primary axis of navigation. */}
      <div className={`absolute top-16 md:top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto transition-opacity ${cinematic ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex items-center gap-1 bg-card rounded-lg p-1 border border-border">
          <Button
            variant={gpView === 'posterior' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setGpView('posterior')}
            className={gpView === 'posterior' ? 'font-mono' : 'font-mono bg-transparent border-0 text-[color:var(--text)] hover:bg-[color:var(--hover)] hover:text-[color:var(--text)]'}
          >
            Posterior
          </Button>
          <Button
            variant={gpView === 'prior' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setGpView('prior')}
            className={gpView === 'prior' ? 'font-mono' : 'font-mono bg-transparent border-0 text-[color:var(--text)] hover:bg-[color:var(--hover)] hover:text-[color:var(--text)]'}
          >
            Prior Samples
          </Button>
          <Button
            variant={gpView === 'kernel' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setGpView('kernel')}
            className={gpView === 'kernel' ? 'font-mono' : 'font-mono bg-transparent border-0 text-[color:var(--text)] hover:bg-[color:var(--hover)] hover:text-[color:var(--text)]'}
          >
            Kernel
          </Button>
        </div>
      </div>

      {/* Left: parameters + visuals collapsibles (matches GARCH chrome) */}
      <div className={`absolute left-4 top-20 w-72 space-y-2 pointer-events-auto max-h-[calc(100%-120px)] overflow-y-auto transition-opacity ${cinematic ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <Collapsible open={showParams} onOpenChange={setShowParams}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-[color:var(--text)] hover:text-[color:var(--text)]">
              <span className="flex items-center gap-2"><Settings className="h-4 w-4" /> PARAMETERS</span>
              {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-3 text-[color:var(--text)]">
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[color:var(--dim)]">LENGTH SCALE (ℓ)</Label><span className="text-xs">{params.lengthScale.toFixed(2)}</span></div>
                <Slider value={[params.lengthScale * 100]} onValueChange={([v]) => setParams(p => ({ ...p, lengthScale: v / 100 }))} min={20} max={400} step={5} />
                <div className="text-[10px] text-[#808080] font-mono">smoothness — bigger = straighter</div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[color:var(--dim)]">SIGNAL σ_f</Label><span className="text-xs">{params.signalSigma.toFixed(2)}</span></div>
                <Slider value={[params.signalSigma * 100]} onValueChange={([v]) => setParams(p => ({ ...p, signalSigma: v / 100 }))} min={20} max={250} step={5} />
                <div className="text-[10px] text-[#808080] font-mono">vertical amplitude of the prior</div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[color:var(--dim)]">NOISE σ_n</Label><span className="text-xs">{params.noiseSigma.toFixed(2)}</span></div>
                <Slider value={[params.noiseSigma * 100]} onValueChange={([v]) => setParams(p => ({ ...p, noiseSigma: v / 100 }))} min={1} max={80} step={1} />
                <div className="text-[10px] text-[#808080] font-mono">observation noise</div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[color:var(--dim)]">OBSERVATIONS</Label><span className="text-xs">{params.numObs}</span></div>
                <Slider value={[params.numObs]} onValueChange={([v]) => setParams(p => ({ ...p, numObs: v }))} min={2} max={25} step={1} />
              </div>
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[color:var(--dim)]">PLAYBACK SPEED</Label><span className="text-xs">{playSpeed.toFixed(1)} obs/s</span></div>
                <Slider value={[playSpeed * 10]} onValueChange={([v]) => setPlaySpeed(v / 10)} min={5} max={100} step={5} />
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={showVisuals} onOpenChange={setShowVisuals}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-[color:var(--text)] hover:text-[color:var(--text)]">
              <span className="flex items-center gap-2"><Eye className="h-4 w-4" /> VISUALS</span>
              {showVisuals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[color:var(--text)]">
              <div className="flex items-center justify-between"><Label className="text-xs text-[color:var(--dim)] font-mono">TRUE FUNCTION</Label><Switch checked={showTrue} onCheckedChange={setShowTrue} /></div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[color:var(--dim)] font-mono">PRIOR SAMPLES</Label><Switch checked={showPriorSamples} onCheckedChange={setShowPriorSamples} /></div>
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[color:var(--dim)]">BAND OPACITY</Label><span className="text-xs">{(bandOpacity * 100).toFixed(0)}%</span></div>
                <Slider value={[bandOpacity * 100]} onValueChange={([v]) => setBandOpacity(v / 100)} min={5} max={60} step={1} />
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Right: live stats. Panel contents switch per view so the numbers match
          what the user is actually looking at (posterior fit / prior shape / kernel decay). */}
      <div className={`absolute right-4 top-20 w-56 pointer-events-auto transition-opacity ${cinematic ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-[color:var(--text)] hover:text-[color:var(--text)]">
              <span className="flex items-center gap-2"><Info className="h-4 w-4" /> {gpView === 'prior' ? 'PRIOR' : gpView === 'kernel' ? 'KERNEL' : 'POSTERIOR'}</span>
              {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-3 bg-card border-border space-y-3 text-[color:var(--text)]">
              {gpView === 'posterior' && (
                <>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">OBSERVED</span><span className="text-sm">{stats.observed}/{stats.total}</span></div>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">log p(y|X)</span><span className="text-sm text-[color:var(--up)]">{stats.logLik.toFixed(2)}</span></div>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">AVG 95% CI</span><span className="text-sm">{stats.avgCIWidth.toFixed(2)}</span></div>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">RMSE vs TRUE</span><span className="text-sm">{stats.rmse.toFixed(3)}</span></div>
                  <div className="pt-2 border-t border-border text-[10px] text-[color:var(--dim)] font-mono leading-relaxed">
                    The shaded band is ±2σ. It collapses tight where data arrives and
                    balloons where the kernel can't see the data. Log-likelihood
                    scores the kernel's marginal fit to the observed points.
                  </div>
                </>
              )}
              {gpView === 'prior' && (
                <>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">SAMPLES</span><span className="text-sm">8</span></div>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">LENGTH SCALE ℓ</span><span className="text-sm">{params.lengthScale.toFixed(2)}</span></div>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">SIGNAL σ_f</span><span className="text-sm">{params.signalSigma.toFixed(2)}</span></div>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">PRIOR VAR</span><span className="text-sm">{(params.signalSigma * params.signalSigma).toFixed(2)}</span></div>
                  <div className="pt-2 border-t border-border text-[10px] text-[color:var(--dim)] font-mono leading-relaxed">
                    These are functions drawn from the GP prior before any data.
                    Short ℓ → jagged samples; long ℓ → smooth glides. The spread
                    is set by σ_f. This is what the kernel considers plausible
                    before conditioning on observations.
                  </div>
                </>
              )}
              {gpView === 'kernel' && (
                <>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">k(0) = σ_f²</span><span className="text-sm">{(params.signalSigma * params.signalSigma).toFixed(2)}</span></div>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">k(ℓ)</span><span className="text-sm text-[color:var(--up)]">{(params.signalSigma * params.signalSigma * Math.exp(-0.5)).toFixed(2)}</span></div>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">LENGTH SCALE ℓ</span><span className="text-sm">{params.lengthScale.toFixed(2)}</span></div>
                  <div className="flex justify-between font-mono"><span className="text-xs text-[color:var(--dim)]">EFFECTIVE RANGE</span><span className="text-sm">{(3 * params.lengthScale).toFixed(2)}</span></div>
                  <div className="pt-2 border-t border-border text-[10px] text-[color:var(--dim)] font-mono leading-relaxed">
                    The RBF kernel decides how much two points covary based on
                    their distance. At Δ=ℓ correlation is e^(-½) ≈ 0.61 of peak.
                    Beyond 3ℓ points are essentially uncorrelated — that's the
                    shaded amber band.
                  </div>
                </>
              )}
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>

    {/* Educational triptych: the "what a Gaussian Process actually does" story
        told with a fixed yield-curve example. Three static panels show the same
        axes at 0 / 2 / 5 observations, so the viewer sees the uncertainty band
        pinch around data as evidence accumulates. No animation, no knobs. */}
    <section className="mt-8 p-6 rounded-lg border border-border bg-card">
      <h2 className="text-lg font-semibold font-mono text-[color:var(--text)]">
        What a Gaussian Process actually does
      </h2>
      <p className="mt-2 text-sm text-[color:var(--dim)] leading-relaxed max-w-3xl">
        Here's the same idea as the canvas above, told with a concrete example: building a yield curve from a handful of bond yields. In each panel the <span className="text-[color:var(--text)] font-semibold">solid line</span> is the GP's best guess of the yield at every maturity, the <span className="text-[color:var(--text)] font-semibold">shaded band</span> is its ±2σ uncertainty, and the <span className="font-semibold">dots</span> are the yields we actually observed.
      </p>
      <p className="mt-2 text-sm text-[color:var(--dim)] leading-relaxed max-w-3xl">
        Watch the band. It pinches tight at every dot and swells in the gaps and past the edges — that's the GP saying "I know here, I'm guessing there". More dots ⇒ tighter curve.
      </p>
      <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        <EduPanel
          title="0 observations — pure prior"
          posterior={eduPriorOnly}
          data={[]}
          priorMean={EDU_PRIOR_MEAN}
          isDark={isDark}
          caption="No data. The band is a uniform fat strip — every yield between 3% and 5% is equally plausible."
        />
        <EduPanel
          title="2 observations"
          posterior={eduTwoObs}
          data={[[EDU_X[1], EDU_Y[1]], [EDU_X[3], EDU_Y[3]]]}
          priorMean={EDU_PRIOR_MEAN}
          isDark={isDark}
          caption="Add the 2Y and 10Y yields. Band collapses at those maturities, still fat everywhere else."
        />
        <EduPanel
          title="5 observations"
          posterior={eduFiveObs}
          data={EDU_X.map((x, i) => [x, EDU_Y[i]] as [number, number])}
          priorMean={EDU_PRIOR_MEAN}
          isDark={isDark}
          caption="Five yields is enough. The whole curve is pinned down with tight uncertainty across every maturity."
        />
      </div>
      <p className="mt-5 text-xs text-[color:var(--dim)] leading-relaxed max-w-3xl">
        That's it. That's what a Gaussian Process is for — fit a curve through sparse points <em>and tell you how sure it is at every x</em>. The interactive canvas above does the same thing with a synthetic function; these three panels just strip the noise away so you can see the shape of the idea.
      </p>
    </section>
    </div>
  );
}
