// ============================================================================
// DiffusionVisualization.tsx - RESEARCH > QUANT MODELS > Diffusion simulator.
//
// A denoising diffusion model over price PATHS, run live in the browser:
// a few hundred sample paths start as pure Gaussian noise and are pulled,
// one reverse-diffusion (DDIM) step per animation frame, onto the
// distribution of the training windows. The fog condensing into a forecast
// fan IS the model working; there is no pre-rendered result.
//
// Honesty contract (same doctrine as engine/quant_fit.py):
// - The denoiser is the CLOSED-FORM posterior mean E[x0|xt] under the
//   empirical distribution of the training windows. That is the exact
//   function a trained network approximates, so nothing here pretends a
//   network was trained in milliseconds, and the known failure mode of a
//   perfectly fit denoiser (it reproduces training windows at low noise) is
//   MEASURED and shown as the memorisation meter instead of hidden.
// - The scorecard compares the stylised facts of the generated samples
//   against the user's data live at every noise level. At high noise the
//   numbers are far off; watching them converge is the point.
// - Demo mode runs the identical pipeline on a synthetic vol-clustered
//   series generated client-side, and says so. FIT TO MY DATA (the page's
//   fit bar) swaps in the user's own windows via engine/quant_fit.py.
//
// This is a native terminal component (plain zinc divs off the shell's css
// variables, like the QuantModels page shell and DataViz), not a port of the
// website's shadcn chrome: it was written for this page, so it follows the
// page's own idiom.
//
// Everything is canvas 2D. The denoise step is O(samples * windows * horizon)
// typed-array math (~30-60ms at defaults); at most ONE step is computed per
// animation frame and every computed step is cached, so playback and timeline
// scrubbing are instant once a step exists and the UI never blocks.
// ============================================================================

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type DiffusionStats = {
  kurtosis: number;
  skew: number;
  acf_return: number;
  acf_abs: number[];
  vol_annual: number;
  var99: number;
  sigma_bar: number;
};

// Shape of engine/quant_fit.py fit_diffusion()'s params payload.
export type DiffusionFitPayload = {
  windows: number[][];
  horizon: number;
  n_windows: number;
  stride: number;
  sigma_bar: number;
  last_price: number;
  tail: number[];
  bars_per_year: number;
  timeframe: string;
  log_returns: boolean;
  symbol: string;
  stats: DiffusionStats;
};

type Params = {
  steps: number;      // reverse-diffusion steps T
  samples: number;    // generated paths
  schedule: 'cosine' | 'linear';
  eta: number;        // 0 = deterministic DDIM, 1 = full DDPM noise
  sharp: number;      // denoiser softmax temperature; 1 = exact posterior
  temp: number;       // initial noise scale
  bw: number;         // diversity floor: stop the denoise at this residual
                      // noise level (whitened units) instead of at zero
  horizon: number;    // demo mode only; fitted mode uses the payload's
  seed: number;
};

type Sim = {
  T: number;
  h: number;
  nS: number;
  // Training windows, per-coordinate whitened (see buildSim), plus the
  // subset the denoiser actually sums over and its cached norms.
  W: Float32Array;
  nW: number;
  dW: Float32Array;
  dnW: number;
  dwn2: Float32Array;
  coord: Float32Array;       // per-coordinate std, to denormalise for display
  ab: Float64Array;          // alpha-bar by noise level 0..T (0 = clean)
  traj: Float32Array[];      // snapshot after k steps; traj[0] = pure noise
  x0traj: Float32Array[];    // denoiser guess used to produce traj[k+1]
  scratch: Float64Array;
  blend: Float32Array;       // interpolated frame buffer for drawing
  rng: () => number;
  spare: number | null;      // Box-Muller cache
  // display mapping
  sigma: number;
  lastPrice: number;
  tail: number[];
  logRet: boolean;
  barsPerYear: number;
  symbol: string;
  nWindowsTotal: number;
  stride: number;
  dataStats: DiffusionStats;
  wTermPrice: Float32Array;  // window terminal prices, for the data ridge
  yMin: number;
  yMax: number;
  stepStats: (ReturnType<typeof sampleStats> | null)[];
  // memorisation meter, computed in chunks after the last step
  memDist: Float32Array;
  memProgress: number;
  memBaseline: number;       // mean window-to-window distance, the yardstick
  isDemo: boolean;
};

// ---------------------------------------------------------------------------
// small math
// ---------------------------------------------------------------------------

// Deterministic seeded RNG so REGENERATE is a new draw and everything else
// replays exactly (same reason the backend fitters take a seed).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(sim: { rng: () => number; spare: number | null }): number {
  if (sim.spare !== null) { const s = sim.spare; sim.spare = null; return s; }
  let u = 0, v = 0;
  while (u === 0) u = sim.rng();
  v = sim.rng();
  const r = Math.sqrt(-2 * Math.log(u));
  sim.spare = r * Math.sin(2 * Math.PI * v);
  return r * Math.cos(2 * Math.PI * v);
}

function acf1(x: ArrayLike<number>): number {
  const n = x.length;
  if (n < 3) return 0;
  let m = 0;
  for (let i = 0; i < n; i++) m += x[i];
  m /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - m;
    den += d * d;
    if (i > 0) num += d * (x[i - 1] - m);
  }
  return den > 0 ? num / den : 0;
}

function seriesStats(r: ArrayLike<number>, barsPerYear: number): DiffusionStats {
  const n = r.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += r[i];
  m /= n;
  let m2 = 0, m3 = 0, m4 = 0;
  const abs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = r[i] - m;
    m2 += d * d; m3 += d * d * d; m4 += d * d * d * d;
    abs[i] = Math.abs(r[i]);
  }
  m2 /= n; m3 /= n; m4 /= n;
  const sd = Math.sqrt(m2) || 1e-12;
  const sorted = Array.from(r as ArrayLike<number>).sort((a, b) => a - b);
  return {
    kurtosis: m4 / (m2 * m2) - 3,
    skew: m3 / (sd * sd * sd),
    acf_return: acf1(r),
    acf_abs: [acf1(abs)],
    vol_annual: sd * Math.sqrt(barsPerYear),
    var99: sorted[Math.max(0, Math.floor(0.01 * n))],
    sigma_bar: sd,
  };
}

// Stylised facts of the CURRENT sample paths, pooled across paths (moments,
// VaR) or averaged per path (autocorrelations: pooling across path
// boundaries would fabricate correlation at the seams).
function sampleStats(buf: Float32Array, sim: Sim) {
  const { nS, h, coord, sigma } = sim;
  const nr = h - 1;
  const all = new Float32Array(nS * nr);
  let acfR = 0, acfA = 0;
  const path = new Float32Array(nr);
  const pabs = new Float32Array(nr);
  for (let i = 0; i < nS; i++) {
    const o = i * h;
    for (let k = 1; k < h; k++) {
      const v = (buf[o + k] * coord[k] - buf[o + k - 1] * coord[k - 1]) * sigma;
      path[k - 1] = v;
      pabs[k - 1] = Math.abs(v);
      all[i * nr + k - 1] = v;
    }
    acfR += acf1(path);
    acfA += acf1(pabs);
  }
  const s = seriesStats(all, sim.barsPerYear);
  s.acf_return = acfR / nS;
  s.acf_abs = [acfA / nS];
  return s;
}

// The ModelLab teal ramp, so the QUANT MODELS surfaces, the Model Lab and
// this page read as one product (same reasoning as ModelLab.tsx's RAMP).
const RAMP = ['#0b3b39', '#0f766e', '#14b8a6', '#5eead4', '#c7fff4'];

function hexLerp(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((x, i) => Math.round(x + (pb[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function rampAt(t: number): string {
  const c = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(c));
  return hexLerp(RAMP[i], RAMP[i + 1], c - i);
}

const cssVar = (name: string, fallback: string): string =>
  (typeof document !== 'undefined' &&
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

const fmtPrice = (p: number): string =>
  Math.abs(p) >= 1000 ? p.toLocaleString(undefined, { maximumFractionDigits: 0 })
  : Math.abs(p) >= 10 ? p.toFixed(2)
  : p.toFixed(4);

// ---------------------------------------------------------------------------
// demo data: the same pipeline as the backend, on a synthetic series
// ---------------------------------------------------------------------------

// GARCH(1,1) with a fat-tail shock mixture: enough structure (vol clustering,
// excess kurtosis) that the scorecard has real facts to converge on, unlike
// plain white noise which would make every stylised fact trivially zero.
function demoSeries(seed: number, n: number): Float32Array {
  const st = { rng: mulberry32(seed * 2654435761 + 1), spare: null as number | null };
  const alpha = 0.12, beta = 0.85, v0 = 1.44e-4;
  const omega = v0 * (1 - alpha - beta);
  const r = new Float32Array(n);
  let v = v0;
  for (let i = 0; i < n; i++) {
    let z = gauss(st);
    if (st.rng() < 0.04) z *= 2.6;
    r[i] = Math.sqrt(v) * z;
    v = omega + alpha * r[i] * r[i] + beta * v;
  }
  return r;
}

// ---------------------------------------------------------------------------
// sim construction and the DDIM step
// ---------------------------------------------------------------------------

// Denoiser window cap. The per-step cost is samples * windows * horizon, so
// the softmax runs over a stride subset above this; the full set still feeds
// the ridge, the stats and the memorisation meter. Reported in the UI.
const DEN_CAP = 900;

function makeSchedule(T: number, kind: Params['schedule']): Float64Array {
  const ab = new Float64Array(T + 1);
  if (kind === 'cosine') {
    const s = 0.008;
    const f = (t: number) => Math.cos(((t / T + s) / (1 + s)) * Math.PI / 2) ** 2;
    const f0 = f(0);
    for (let t = 0; t <= T; t++) ab[t] = Math.max(1e-6, f(t) / f0);
  } else {
    // Linear in alpha-bar: signal power decays linearly to zero. Chosen over
    // the classic linear-beta schedule because that one is calibrated for
    // T=1000 and leaves visible signal in "pure noise" at T=40.
    for (let t = 0; t <= T; t++) ab[t] = Math.max(1e-6, 1 - t / T);
  }
  ab[0] = 1;
  return ab;
}

function buildSim(p: Params, fitted: DiffusionFitPayload | null): Sim {
  let rows: number[][];
  let sigma: number, lastPrice: number, tail: number[], logRet: boolean;
  let barsPerYear: number, symbol: string, nWindowsTotal: number, stride: number;
  let dataStats: DiffusionStats;
  let h: number;

  if (fitted) {
    rows = fitted.windows;
    h = fitted.horizon;
    sigma = fitted.sigma_bar;
    lastPrice = fitted.last_price;
    tail = fitted.tail || [fitted.last_price];
    logRet = fitted.log_returns;
    barsPerYear = fitted.bars_per_year;
    symbol = fitted.symbol;
    nWindowsTotal = fitted.n_windows;
    stride = fitted.stride;
    dataStats = fitted.stats;
  } else {
    // Demo: build windows from a synthetic series EXACTLY like the backend
    // does from a real one (de-mean, cumsum, sigma-scale), so demo and
    // fitted mode are the same machine on different data.
    h = p.horizon;
    const r = demoSeries(p.seed, 2400);
    let m = 0;
    for (let i = 0; i < r.length; i++) m += r[i];
    m /= r.length;
    for (let i = 0; i < r.length; i++) r[i] -= m;
    dataStats = seriesStats(r, 8766);
    sigma = dataStats.sigma_bar;
    barsPerYear = 8766;
    symbol = 'DEMO';
    logRet = true;
    const nAll = r.length - h + 1;
    stride = Math.max(1, Math.ceil(nAll / 600));
    rows = [];
    for (let s0 = 0; s0 < nAll; s0 += stride) {
      const w = new Array(h);
      let c = 0;
      for (let k = 0; k < h; k++) { c += r[s0 + k]; w[k] = c / sigma; }
      rows.push(w);
    }
    nWindowsTotal = rows.length;
    lastPrice = 100;
    tail = [];
    let lp = 0;
    for (let i = r.length - 140; i < r.length; i++) lp += r[i];
    let acc = -lp;
    for (let i = r.length - 140; i < r.length; i++) { acc += r[i]; tail.push(100 * Math.exp(acc)); }
    lastPrice = tail[tail.length - 1];
  }

  const nW = rows.length;
  if (!nW || h < 4) throw new Error('no training windows');

  // Per-coordinate whitening. Window coordinates are cumulative sums, so
  // their spread grows like sqrt(k); diffusing them raw would mean the noise
  // drowns the first bars long before the last ones and the denoise resolves
  // back-to-front. Unit-variance coordinates make the process isotropic; the
  // scale comes back at display time through coord[].
  const coord = new Float32Array(h);
  for (let k = 0; k < h; k++) {
    let s2 = 0;
    for (let j = 0; j < nW; j++) s2 += rows[j][k] * rows[j][k];
    coord[k] = Math.max(1e-4, Math.sqrt(s2 / nW));
  }
  const W = new Float32Array(nW * h);
  for (let j = 0; j < nW; j++)
    for (let k = 0; k < h; k++) W[j * h + k] = rows[j][k] / coord[k];

  const dStride = nW > DEN_CAP ? Math.ceil(nW / DEN_CAP) : 1;
  const dnW = Math.floor((nW + dStride - 1) / dStride);
  const dW = new Float32Array(dnW * h);
  const dwn2 = new Float32Array(dnW);
  for (let j = 0; j < dnW; j++) {
    const src = j * dStride * h;
    let n2 = 0;
    for (let k = 0; k < h; k++) { const v = W[src + k]; dW[j * h + k] = v; n2 += v * v; }
    dwn2[j] = n2;
  }

  const nS = p.samples;
  // Diversity floor. Denoising an empirical mixture of deltas all the way to
  // zero noise collapses every sample onto its nearest training window (the
  // first live run did exactly that: 256 of 256 near-copies). Stopping at a
  // residual bandwidth turns the training set into a kernel density estimate,
  // which is the standard fix, so samples are new paths NEAR the data instead
  // of replays of it. ab' = ab/(1 + ab*bw^2) keeps ab(T) ~ 0 (pure noise
  // start untouched) and caps ab(0) at 1/(1+bw^2) (the floor); at bw = 0 it
  // is the identity, so the slider exposes the memorisation trade honestly.
  const ab = makeSchedule(p.steps, p.schedule);
  if (p.bw > 0)
    for (let t2 = 0; t2 <= p.steps; t2++) ab[t2] = ab[t2] / (1 + ab[t2] * p.bw * p.bw);

  const sim: Sim = {
    T: p.steps, h, nS, W, nW, dW, dnW, dwn2, coord,
    ab,
    traj: [], x0traj: [],
    scratch: new Float64Array(dnW),
    blend: new Float32Array(nS * h),
    rng: mulberry32(p.seed * 1000003 + 17), spare: null,
    sigma, lastPrice, tail, logRet, barsPerYear, symbol, nWindowsTotal, stride,
    dataStats,
    wTermPrice: new Float32Array(nW),
    yMin: 0, yMax: 1,
    stepStats: new Array(p.steps + 1).fill(null),
    memDist: new Float32Array(nS),
    memProgress: 0,
    memBaseline: 1,
    isDemo: !fitted,
  };

  const toPrice = (sigUnits: number): number =>
    logRet ? lastPrice * Math.exp(sigma * sigUnits) : lastPrice + sigma * sigUnits;
  for (let j = 0; j < nW; j++) sim.wTermPrice[j] = toPrice(rows[j][h - 1]);

  // Memorisation yardstick: how far two unrelated training windows sit from
  // each other, on average. A sample's nearest-window distance is reported
  // relative to this, which is unit-free and honest across datasets.
  let base = 0, cnt = 0;
  const pr = mulberry32(p.seed + 99);
  for (let it = 0; it < 300; it++) {
    const a = Math.floor(pr() * nW) * h, b = Math.floor(pr() * nW) * h;
    if (a === b) continue;
    let d = 0;
    for (let k = 0; k < h; k++) { const v = W[a + k] - W[b + k]; d += v * v; }
    base += Math.sqrt(d / h); cnt++;
  }
  sim.memBaseline = cnt ? base / cnt : 1;

  // Initial state: pure noise, the thing the animation starts from.
  const X = new Float32Array(nS * h);
  for (let i = 0; i < X.length; i++) X[i] = p.temp * gauss(sim);
  sim.traj.push(X);

  // Fixed vertical frame from the NOISE stage plus the recent history: the
  // whole show is the fog collapsing into the fan, so the frame is sized to
  // the fog and never rescales mid-animation (rescaling reads as seasick).
  const vals: number[] = [];
  for (let i = 0; i < nS; i++) vals.push(toPrice(X[i * h + h - 1] * coord[h - 1]));
  vals.sort((a, b) => a - b);
  let lo = vals[Math.floor(0.05 * vals.length)];
  let hi = vals[Math.floor(0.95 * vals.length)];
  for (const t of tail) { lo = Math.min(lo, t); hi = Math.max(hi, t); }
  const pad = (hi - lo) * 0.08 || 1;
  sim.yMin = lo - pad;
  sim.yMax = hi + pad;
  return sim;
}

// One reverse step: noise level t -> t-1 for every sample. This is the whole
// model. E[x0|xt] is an exact softmax over the training windows because the
// training distribution is an empirical mixture of deltas; a trained network
// would be an approximation of exactly this function.
//
// The FINAL step (tp = 0) swaps the isotropic residual for walk-shaped
// kernel noise: white noise per whitened coordinate decorrelates adjacent
// coordinates, which showed up on the live scorecard as per-bar volatility
// DOUBLING (10% vs 5% on EUR_USD). A kernel proportional to the data's own
// covariance (a random walk, whitened) is the standard multivariate-KDE
// bandwidth shape for path data and inflates vol by only sqrt(1+bw^2).
function denoiseStep(sim: Sim, eta: number, sharp: number, bw: number): void {
  const k = sim.traj.length - 1;
  if (k >= sim.T) return;
  const t = sim.T - k, tp = t - 1;
  const { h, nS, dW, dnW, dwn2, ab, scratch } = sim;
  const abT = ab[t], abP = ab[tp];
  const ct = Math.sqrt(abT), st = Math.sqrt(Math.max(1e-12, 1 - abT));
  const inv2v = sharp / (2 * Math.max(1e-9, 1 - abT));
  const sig = eta * Math.sqrt((1 - abP) / Math.max(1e-9, 1 - abT))
                  * Math.sqrt(Math.max(0, 1 - abT / Math.max(abP, 1e-9)));
  const dirC = Math.sqrt(Math.max(0, 1 - abP - sig * sig));
  const cP = Math.sqrt(abP);

  const X = sim.traj[k];
  const out = new Float32Array(nS * h);
  const x0s = new Float32Array(nS * h);
  for (let i = 0; i < nS; i++) {
    const xo = i * h;
    let xx = 0;
    for (let q = 0; q < h; q++) { const v = X[xo + q]; xx += v * v; }
    let mx = -Infinity;
    for (let j = 0; j < dnW; j++) {
      const wo = j * h;
      let dot = 0;
      for (let q = 0; q < h; q++) dot += X[xo + q] * dW[wo + q];
      const lg = -(xx - 2 * ct * dot + abT * dwn2[j]) * inv2v;
      scratch[j] = lg;
      if (lg > mx) mx = lg;
    }
    let se = 0;
    for (let j = 0; j < dnW; j++) { const e = Math.exp(scratch[j] - mx); scratch[j] = e; se += e; }
    // Windows with negligible weight are skipped: at low noise the softmax
    // is nearly one-hot, so this drops the inner loop to a handful of rows.
    const cut = se * 1e-4;
    for (let j = 0; j < dnW; j++) {
      const w = scratch[j];
      if (w < cut) continue;
      const g = w / se, wo = j * h;
      for (let q = 0; q < h; q++) x0s[xo + q] += g * dW[wo + q];
    }
    if (tp === 0 && bw > 0) {
      // final step: local-average posterior mean plus walk-kernel bandwidth
      let walk = 0;
      for (let q = 0; q < h; q++) {
        walk += gauss(sim);
        out[xo + q] = x0s[xo + q] + (bw * walk) / sim.coord[q];
      }
    } else {
      for (let q = 0; q < h; q++) {
        const x0 = x0s[xo + q];
        const eps = (X[xo + q] - ct * x0) / st;
        out[xo + q] = cP * x0 + dirC * eps + (sig > 0 ? sig * gauss(sim) : 0);
      }
    }
  }
  sim.x0traj.push(x0s);
  sim.traj.push(out);
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

const DEFAULTS: Params = {
  steps: 40, samples: 256, schedule: 'cosine',
  eta: 0.15, sharp: 1, temp: 1, bw: 0.2, horizon: 64, seed: 7,
};

export default function DiffusionVisualization({ fitted }: { fitted?: DiffusionFitPayload | null }) {
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [playing, setPlaying] = useState(true);
  const [showGuess, setShowGuess] = useState(false);
  const [uiStep, setUiStep] = useState(0);
  const [mem, setMem] = useState<{ median: number; min: number; close: number } | null>(null);
  const [err, setErr] = useState('');
  const [showCtl, setShowCtl] = useState(true);
  const [showStats, setShowStats] = useState(true);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const stepLblRef = useRef<HTMLSpanElement>(null);
  const simRef = useRef<Sim | null>(null);
  const playRef = useRef({ playing: true, head: 0, speed: 7 });
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const uiStepRef = useRef(0);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const paramsRef = useRef(params);
  const showGuessRef = useRef(showGuess);
  paramsRef.current = params;
  showGuessRef.current = showGuess;

  // (Re)build on any parameter or dataset change; the sim is cheap to build
  // (the expensive part, the denoise steps, streams in through the rAF loop).
  useEffect(() => {
    try {
      setErr('');
      simRef.current = buildSim(params, fitted || null);
      playRef.current.head = 0;
      playRef.current.playing = true;
      setPlaying(true);
      uiStepRef.current = 0;
      setUiStep(0);
      setMem(null);
    } catch (e) {
      simRef.current = null;
      setErr(String((e as Error)?.message || e));
    }
  }, [params, fitted]);

  // Canvas sizing: backing store tracks element size * devicePixelRatio.
  useEffect(() => {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // The animation loop: advance the playhead, compute at most one denoise
  // step per frame until the trajectory is complete, then chunk through the
  // memorisation scan, and draw whatever the playhead points at.
  useEffect(() => {
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const sim = simRef.current;
      const cv = canvasRef.current;
      if (!sim || !cv) { lastRef.current = now; return; }
      const dt = Math.min(0.1, (now - lastRef.current) / 1000 || 0);
      lastRef.current = now;

      const done = sim.traj.length - 1;
      if (done < sim.T) denoiseStep(sim, paramsRef.current.eta, paramsRef.current.sharp,
                                    paramsRef.current.bw);

      if (playRef.current.playing) {
        playRef.current.head += dt * playRef.current.speed;
        if (playRef.current.head >= sim.T) {
          playRef.current.head = sim.T;
          playRef.current.playing = false;
          setPlaying(false);
        }
      }
      const maxHead = sim.traj.length - 1;
      if (playRef.current.head > maxHead) playRef.current.head = maxHead;

      // Memorisation meter: nearest-window scan over the FULL window set,
      // 24 samples per frame so the final frame never stutters.
      if (sim.traj.length - 1 >= sim.T && sim.memProgress < sim.nS) {
        const fin = sim.traj[sim.T];
        const end = Math.min(sim.nS, sim.memProgress + 24);
        for (let i = sim.memProgress; i < end; i++) {
          let best = Infinity;
          const xo = i * sim.h;
          for (let j = 0; j < sim.nW; j++) {
            const wo = j * sim.h;
            let d = 0;
            for (let q = 0; q < sim.h; q++) { const v = fin[xo + q] - sim.W[wo + q]; d += v * v; }
            if (d < best) best = d;
          }
          sim.memDist[i] = Math.sqrt(best / sim.h) / sim.memBaseline;
        }
        sim.memProgress = end;
        if (end >= sim.nS) {
          const ds = Array.from(sim.memDist).sort((a, b) => a - b);
          setMem({
            median: ds[Math.floor(ds.length / 2)],
            min: ds[0],
            close: ds.filter((d) => d < 0.05).length,
          });
        }
      }

      const k = Math.floor(playRef.current.head);
      if (k !== uiStepRef.current) { uiStepRef.current = k; setUiStep(k); }
      if (!sim.stepStats[k]) sim.stepStats[k] = sampleStats(sim.traj[k], sim);

      draw(cv, sim, playRef.current.head, showGuessRef.current, hoverRef.current);

      // Timeline chrome is updated imperatively: doing this through React
      // state would re-render the cards 60 times a second for a bar fill.
      if (fillRef.current) fillRef.current.style.width = `${(playRef.current.head / sim.T) * 100}%`;
      if (doneRef.current) doneRef.current.style.width = `${((sim.traj.length - 1) / sim.T) * 100}%`;
      if (stepLblRef.current) {
        const sig = Math.sqrt(sim.ab[Math.max(0, sim.T - k)]);
        stepLblRef.current.textContent =
          `step ${k}/${sim.T} · signal ${(sig * 100).toFixed(0)}%`;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const scrub = (e: React.PointerEvent) => {
    const el = trackRef.current, sim = simRef.current;
    if (!el || !sim) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    playRef.current.head = Math.min(frac * sim.T, sim.traj.length - 1);
    playRef.current.playing = false;
    setPlaying(false);
  };

  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch }));

  const sim = simRef.current;
  const stats = sim?.stepStats[Math.min(uiStep, sim.T)] || null;
  const ds = sim?.dataStats || null;

  // Scorecard row: a stylised fact, the data's value, the samples' value,
  // and whether they agree within a tolerance that respects the fact's scale.
  const row = (label: string, dv: number, sv: number, tol: number, fmt: (x: number) => string) => {
    const ok = Math.abs(dv - sv) <= tol;
    return (
      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
        <span style={{ color: 'var(--dim)', flex: 1 }}>{label}</span>
        <span style={{ fontFamily: 'var(--mono)', width: 52, textAlign: 'right' }}>{fmt(dv)}</span>
        <span style={{ fontFamily: 'var(--mono)', width: 52, textAlign: 'right',
                       color: ok ? RAMP[3] : 'var(--dim)' }}>{fmt(sv)}</span>
        <span style={{ width: 8, textAlign: 'center',
                       color: ok ? RAMP[2] : 'var(--err, #f0426c)' }}>{ok ? '●' : '○'}</span>
      </div>
    );
  };

  const card: React.CSSProperties = {
    background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
    border: '1px solid var(--edge)', borderRadius: 3,
    padding: '10px 12px', backdropFilter: 'blur(3px)',
  };
  const head6: React.CSSProperties = {
    fontSize: 10, letterSpacing: '.1em', color: 'var(--dim)',
    display: 'flex', justifyContent: 'space-between', cursor: 'pointer',
    userSelect: 'none',
  };
  const btn: React.CSSProperties = {
    background: 'var(--raise, var(--hover))', border: '1px solid var(--edge)',
    color: 'var(--text)', borderRadius: 2, padding: '3px 10px',
    fontSize: 10.5, letterSpacing: '.06em', cursor: 'pointer',
  };
  const slider = (label: string, value: number, min: number, max: number,
                  step: number, show: string, on: (v: number) => void) => (
    <div key={label} style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
        <span style={{ color: 'var(--dim)' }}>{label}</span>
        <span style={{ fontFamily: 'var(--mono)' }}>{show}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => on(Number(e.target.value))}
        style={{ width: '100%', accentColor: RAMP[2], height: 14 }} />
    </div>
  );

  return (
    <div ref={wrapRef}
      className="relative w-full h-[calc(100vh-180px)] min-h-[560px] overflow-hidden rounded-sm"
      style={{ background: 'var(--bg)', border: '1px solid var(--edge)' }}
      onPointerMove={(e) => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (r) hoverRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      onPointerLeave={() => { hoverRef.current = null; }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {err && (
        <div className="absolute left-4 top-4 text-xs" style={{ color: 'var(--err, #f0426c)' }}>
          {err}
        </div>
      )}

      {/* left: sampler controls */}
      <div className="absolute left-3 top-3 w-56" style={card}>
        <div style={head6} onClick={() => setShowCtl(!showCtl)}>
          <span>SAMPLER</span><span>{showCtl ? '▾' : '▸'}</span>
        </div>
        {showCtl && (
          <>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button style={btn} onClick={() => {
                const p = playRef.current;
                if (!p.playing && simRef.current && p.head >= simRef.current.T) p.head = 0;
                p.playing = !p.playing;
                setPlaying(p.playing);
              }}>{playing ? 'PAUSE' : 'PLAY'}</button>
              <button style={btn} onClick={() => {
                playRef.current.head = 0; playRef.current.playing = true; setPlaying(true);
              }}>RESTART</button>
              <button style={btn} title="new noise draw, same data"
                onClick={() => set({ seed: params.seed + 1 })}>RESEED</button>
            </div>
            {slider('speed', playRef.current.speed, 1, 20, 1,
              `${playRef.current.speed} st/s`, (v) => { playRef.current.speed = v; set({}); })}
            {slider('denoise steps', params.steps, 20, 80, 5,
              `${params.steps}`, (v) => set({ steps: v }))}
            {slider('sample paths', params.samples, 100, 600, 50,
              `${params.samples}`, (v) => set({ samples: v }))}
            {!fitted && slider('horizon', params.horizon, 16, 96, 8,
              `${params.horizon} bars`, (v) => set({ horizon: v }))}
            {slider('eta (DDIM to DDPM)', params.eta, 0, 1, 0.05,
              params.eta.toFixed(2), (v) => set({ eta: v }))}
            {slider('sharpness', params.sharp, 0.5, 2, 0.05,
              `${params.sharp.toFixed(2)}x`, (v) => set({ sharp: v }))}
            {slider('diversity (bandwidth)', params.bw, 0, 0.5, 0.05,
              params.bw.toFixed(2), (v) => set({ bw: v }))}
            {slider('noise temperature', params.temp, 0.7, 1.5, 0.05,
              `${params.temp.toFixed(2)}x`, (v) => set({ temp: v }))}
            <div style={{ display: 'flex', gap: 10, marginTop: 8, fontSize: 10.5 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--dim)' }}>
                <input type="checkbox" checked={params.schedule === 'linear'}
                  onChange={(e) => set({ schedule: e.target.checked ? 'linear' : 'cosine' })} />
                linear schedule
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--dim)' }}>
                <input type="checkbox" checked={showGuess}
                  onChange={(e) => setShowGuess(e.target.checked)} />
                show guess
              </label>
            </div>
          </>
        )}
      </div>

      {/* right: the model versus the data it was fit to */}
      <div className="absolute right-3 top-3 w-64" style={card}>
        <div style={head6} onClick={() => setShowStats(!showStats)}>
          <span>SAMPLES VS {sim?.isDemo ? 'DEMO DATA' : (sim?.symbol || 'DATA').toUpperCase()}</span>
          <span>{showStats ? '▾' : '▸'}</span>
        </div>
        {showStats && sim && stats && ds && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', gap: 6, fontSize: 9.5, color: 'var(--dim)',
                          letterSpacing: '.06em' }}>
              <span style={{ flex: 1 }} />
              <span style={{ width: 52, textAlign: 'right' }}>DATA</span>
              <span style={{ width: 52, textAlign: 'right' }}>SAMPLES</span>
              <span style={{ width: 8 }} />
            </div>
            {row('excess kurtosis', ds.kurtosis, stats.kurtosis,
                 Math.max(0.8, Math.abs(ds.kurtosis) * 0.5), (x) => x.toFixed(1))}
            {row('skew', ds.skew, stats.skew, 0.35, (x) => x.toFixed(2))}
            {row('ACF(1) returns', ds.acf_return, stats.acf_return, 0.08, (x) => x.toFixed(2))}
            {row('ACF(1) |returns|', ds.acf_abs[0], stats.acf_abs[0], 0.08, (x) => x.toFixed(2))}
            {row('vol (annual)', ds.vol_annual, stats.vol_annual,
                 ds.vol_annual * 0.2, (x) => `${(x * 100).toFixed(0)}%`)}
            {row('VaR 99 / bar', ds.var99, stats.var99,
                 Math.abs(ds.var99) * 0.3, (x) => `${(x * 100).toFixed(2)}%`)}

            <div style={{ borderTop: '1px solid var(--edge)', marginTop: 4, paddingTop: 6,
                          fontSize: 10.5, color: 'var(--dim)' }}>
              {mem ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>nearest training window</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>
                      {mem.median.toFixed(2)}x median
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>closest sample</span>
                    <span style={{ fontFamily: 'var(--mono)',
                                   color: mem.min < 0.05 ? 'var(--err, #f0426c)' : 'var(--text)' }}>
                      {mem.min.toFixed(2)}x
                    </span>
                  </div>
                  <div>
                    {mem.close
                      ? `${mem.close} of ${sim.nS} samples are near-copies of a training window`
                      : 'no sample is a copy of a training window'}
                    {' '}(1.0x = typical spacing between two windows)
                  </div>
                </>
              ) : (
                <span>memorisation meter: measuring after the last step</span>
              )}
            </div>

            <div style={{ fontSize: 10, color: 'var(--dim)' }}>
              {sim.nWindowsTotal.toLocaleString()} windows × {sim.h} bars
              {sim.stride > 1 ? `, every ${sim.stride} bars` : ''}
              {sim.dnW < sim.nW ? `; denoiser sums ${sim.dnW}` : ''}
            </div>
            {sim.isDemo && (
              <div style={{ fontSize: 10, color: 'var(--dim)' }}>
                demo distribution: synthetic vol-clustered series. FIT TO MY
                DATA above runs this on your own dataset.
              </div>
            )}
          </div>
        )}
      </div>

      {/* bottom: the denoise timeline */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3"
           style={{ ...card, padding: '8px 14px', width: 'min(560px, 70%)' }}>
        <button style={{ ...btn, width: 30, textAlign: 'center', flexShrink: 0 }}
          onClick={() => {
            const p = playRef.current;
            if (!p.playing && simRef.current && p.head >= simRef.current.T) p.head = 0;
            p.playing = !p.playing;
            setPlaying(p.playing);
          }}>{playing ? '❚❚' : '▶'}</button>
        <div ref={trackRef} style={{ position: 'relative', flex: 1, height: 14,
              background: 'var(--hover)', borderRadius: 2, cursor: 'pointer',
              touchAction: 'none' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }}
          onPointerMove={(e) => { if (e.buttons & 1) scrub(e); }}>
          {/* computed extent, then the playhead fill on top of it */}
          <div ref={doneRef} style={{ position: 'absolute', inset: 0, width: 0,
                background: 'color-mix(in srgb, var(--text) 12%, transparent)',
                borderRadius: 2 }} />
          <div ref={fillRef} style={{ position: 'absolute', inset: 0, width: 0,
                background: `linear-gradient(90deg, ${RAMP[1]}, ${RAMP[3]})`,
                borderRadius: 2, opacity: 0.85 }} />
        </div>
        <span ref={stepLblRef}
          style={{ fontSize: 10.5, fontFamily: 'var(--mono)', color: 'var(--dim)',
                   whiteSpace: 'nowrap', flexShrink: 0 }}>step 0</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

function draw(cv: HTMLCanvasElement, sim: Sim, head: number,
              showGuess: boolean, hover: { x: number; y: number } | null): void {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.width / dpr, H = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const { h, nS, coord, sigma, lastPrice, logRet, tail } = sim;
  const textCol = cssVar('--text', '#e4e4e7');
  const dimCol = cssVar('--dim', '#a1a1aa');
  const edgeCol = cssVar('--edge', '#3f3f46');

  // Interpolate between the two computed steps around the playhead so path
  // motion is continuous even at low playback speeds.
  const k0 = Math.max(0, Math.min(Math.floor(head), sim.traj.length - 1));
  const k1 = Math.min(k0 + 1, sim.traj.length - 1);
  const f = Math.min(1, Math.max(0, head - k0));
  const A = sim.traj[k0], B = sim.traj[k1];
  const blend = sim.blend;
  for (let i = 0; i < blend.length; i++) blend[i] = A[i] + (B[i] - A[i]) * f;

  // Layout: recent real history on the left, the generated fan continuing
  // from it, terminal distribution ridge hugging the right edge.
  const padT = 8, padB = 46, ridgeW = Math.min(90, W * 0.1);
  const plotH = H - padT - padB;
  const tailX0 = 10, tailX1 = W * 0.32;
  const fanX0 = tailX1, fanX1 = W - ridgeW - 8;
  const toPrice = (v: number) => (logRet ? lastPrice * Math.exp(sigma * v) : lastPrice + sigma * v);
  const yOf = (p: number) => padT + (1 - (p - sim.yMin) / (sim.yMax - sim.yMin)) * plotH;
  const xTail = (i: number) => tailX0 + (i / Math.max(1, tail.length - 1)) * (tailX1 - tailX0);
  const xFan = (q: number) => fanX0 + ((q + 1) / h) * (fanX1 - fanX0);

  // faint horizontal grid with price labels, so the fan reads in money
  ctx.font = `10px ${cssVar('--mono', 'ui-monospace, monospace')}`;
  for (let g = 0; g <= 4; g++) {
    const p = sim.yMin + ((sim.yMax - sim.yMin) * g) / 4;
    const y = yOf(p);
    ctx.strokeStyle = edgeCol;
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(tailX0, y); ctx.lineTo(fanX1, y); ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = dimCol;
    ctx.fillText(fmtPrice(p), fanX1 + 4, y + 3);
  }
  ctx.globalAlpha = 1;

  // Noise-to-signal blend drives the palette: fog is neutral zinc, structure
  // is teal, so "how denoised is this" is readable without any legend.
  const t = sim.T - head;
  const ti = Math.max(0, Math.min(sim.T, Math.floor(t)));
  const abNow = sim.ab[ti] + (sim.ab[Math.min(sim.T, ti + 1)] - sim.ab[ti]) * (t - ti);
  const signal = Math.sqrt(Math.max(0, Math.min(1, abNow)));
  const fog = '#52525b';

  // terminal range of the current samples, for the per-path color ramp
  let tLo = Infinity, tHi = -Infinity;
  for (let i = 0; i < nS; i++) {
    const v = blend[i * h + h - 1] * coord[h - 1];
    if (v < tLo) tLo = v;
    if (v > tHi) tHi = v;
  }
  const tSpan = Math.max(1e-9, tHi - tLo);

  // the sample paths, the heart of the picture
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.12 + 0.2 * signal;
  const anchorY = yOf(lastPrice);
  for (let i = 0; i < nS; i++) {
    const o = i * h;
    const term = blend[o + h - 1] * coord[h - 1];
    ctx.strokeStyle = hexOrRgbMix(fog, rampAt((term - tLo) / tSpan), signal);
    ctx.beginPath();
    ctx.moveTo(fanX0, anchorY);
    for (let q = 0; q < h; q++) ctx.lineTo(xFan(q), yOf(toPrice(blend[o + q] * coord[q])));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // the denoiser's current belief E[x0|xt], as ghost paths
  if (showGuess && sim.x0traj.length > 0) {
    const G = sim.x0traj[Math.min(k0, sim.x0traj.length - 1)];
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = RAMP[4];
    for (let i = 0; i < nS; i++) {
      const o = i * h;
      ctx.beginPath();
      ctx.moveTo(fanX0, anchorY);
      for (let q = 0; q < h; q++) ctx.lineTo(xFan(q), yOf(toPrice(G[o + q] * coord[q])));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 5-95% band and median across samples, per future bar
  const col = new Float32Array(nS);
  const q05 = new Float32Array(h), q50 = new Float32Array(h), q95 = new Float32Array(h);
  for (let q = 0; q < h; q++) {
    for (let i = 0; i < nS; i++) col[i] = blend[i * h + q] * coord[q];
    col.sort();
    q05[q] = toPrice(col[Math.floor(0.05 * nS)]);
    q50[q] = toPrice(col[Math.floor(0.5 * nS)]);
    q95[q] = toPrice(col[Math.floor(0.95 * nS)]);
  }
  ctx.beginPath();
  ctx.moveTo(fanX0, anchorY);
  for (let q = 0; q < h; q++) ctx.lineTo(xFan(q), yOf(q95[q]));
  for (let q = h - 1; q >= 0; q--) ctx.lineTo(xFan(q), yOf(q05[q]));
  ctx.closePath();
  ctx.fillStyle = RAMP[2];
  ctx.globalAlpha = 0.05 + 0.05 * signal;
  ctx.fill();
  ctx.globalAlpha = 0.5 + 0.4 * signal;
  ctx.strokeStyle = RAMP[3];
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(fanX0, anchorY);
  for (let q = 0; q < h; q++) ctx.lineTo(xFan(q), yOf(q50[q]));
  ctx.stroke();
  ctx.globalAlpha = 1;

  // the real recent history, crisp, on top
  if (tail.length > 1) {
    ctx.strokeStyle = textCol;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < tail.length; i++) {
      const x = xTail(i), y = yOf(tail[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = dimCol;
    ctx.fillText(sim.isDemo ? 'demo history' : `${sim.symbol} history`, tailX0 + 2, padT + 12);
    ctx.fillText('generated', fanX0 + 6, padT + 12);
    // seam marker where history hands over to the model
    ctx.strokeStyle = edgeCol;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(fanX0, padT); ctx.lineTo(fanX0, padT + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // terminal distribution ridge: samples (filled) vs training windows
  // (outline). When the fill hugs the outline the model has learned the
  // data's end-state distribution; at high noise it is flat and wide.
  const bins = 44;
  const histS = new Float32Array(bins), histD = new Float32Array(bins);
  const binOf = (p: number) => Math.max(0, Math.min(bins - 1,
    Math.floor(((p - sim.yMin) / (sim.yMax - sim.yMin)) * bins)));
  for (let i = 0; i < nS; i++) histS[binOf(toPrice(blend[i * h + h - 1] * coord[h - 1]))]++;
  for (let j = 0; j < sim.nW; j++) histD[binOf(sim.wTermPrice[j])]++;
  let mS = 1, mD = 1;
  for (let b = 0; b < bins; b++) { mS = Math.max(mS, histS[b]); mD = Math.max(mD, histD[b]); }
  const rx = W - 4;
  ctx.fillStyle = RAMP[2];
  ctx.globalAlpha = 0.5;
  for (let b = 0; b < bins; b++) {
    const y0 = padT + (1 - (b + 1) / bins) * plotH;
    const bw = (histS[b] / mS) * (ridgeW - 8);
    if (bw > 0) ctx.fillRect(rx - bw, y0, bw, plotH / bins - 1);
  }
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = dimCol;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let b = bins - 1; b >= 0; b--) {
    const y = padT + (1 - (b + 0.5) / bins) * plotH;
    const x = rx - (histD[b] / mD) * (ridgeW - 8);
    if (b === bins - 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // hover: price readout at the cursor's height
  if (hover && hover.y > padT && hover.y < padT + plotH) {
    const p = sim.yMin + (1 - (hover.y - padT) / plotH) * (sim.yMax - sim.yMin);
    ctx.strokeStyle = dimCol;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(tailX0, hover.y); ctx.lineTo(fanX1, hover.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = textCol;
    ctx.fillText(fmtPrice(p), Math.min(hover.x + 8, fanX1 - 48), hover.y - 4);
  }
}

// Mix a css hex fog color toward a ramp rgb() color. rampAt returns rgb()
// strings, so parse both forms rather than assuming hex.
function hexOrRgbMix(fogHex: string, rgb: string, t: number): string {
  const m = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!m) return rgb;
  const fr = parseInt(fogHex.slice(1, 3), 16), fg = parseInt(fogHex.slice(3, 5), 16),
        fb = parseInt(fogHex.slice(5, 7), 16);
  const r = Math.round(fr + (Number(m[1]) - fr) * t);
  const g = Math.round(fg + (Number(m[2]) - fg) * t);
  const b = Math.round(fb + (Number(m[3]) - fb) * t);
  return `rgb(${r},${g},${b})`;
}
