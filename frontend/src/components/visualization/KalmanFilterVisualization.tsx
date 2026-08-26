import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

// Kalman filter visualization. A linear state space estimator run over a noisy
// price series. State is [level, trend] with the constant velocity model
// F = [[1,1],[0,1]], observation H = [1,0]. The filter alternates a predict step
// (project state forward, add process noise Q so the +/-2 sigma band widens) and
// an update step (fold in the new measurement, weighted by the Kalman gain, so
// the band contracts). Raising R makes the filter trust the price less, so the
// estimate smooths and lags; raising Q makes it track every tick. The dashed
// tail is the forecast: no measurements arrive, so the band fans out every step.
// Mirrors the production model in ml_datasets/.../time_series/kalman_filter.py.

interface Step {
  t: number;        // time index
  obs: number;      // noisy measurement (the printed price)
  level: number;    // filtered level estimate
  trend: number;    // filtered trend estimate (for the readout)
  std: number;      // sqrt of filtered level variance (post update), drives the band
  predStd: number;  // sqrt of predicted level variance (pre update), for the sawtooth
  innov: number;    // innovation: obs - predicted level (residual plot)
  innovStd: number; // sqrt of innovation variance, for the residual band
  gain: number;     // Kalman gain on level at this step (Ppred/(Ppred+R))
}

interface ForecastPoint {
  t: number;
  level: number;
  std: number;
}

const N = 60;          // visible window length (observations on screen at once)
const FORECAST = 16;   // forecast steps drawn past the last update
const WARMUP = 30;     // extra ticks fed to the filter left of the window so the
                       // visible left edge is already converged (no fake-wide band)

// Reads the site theme off the documentElement class. The theme hook
// (useTheme) toggles 'dark'/'light' there, so a MutationObserver on it is the
// canonical way a viz follows the theme (same pattern as the GP component).
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const sync = () => setIsDark(document.documentElement.classList.contains('dark'));
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('theme-change', sync);
    return () => { observer.disconnect(); window.removeEventListener('theme-change', sync); };
  }, []);
  return isDark;
}

// Deterministic pseudo random generator so the series is stable across renders
// (the same intent as the GP component pinning a fixed observation set).
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pointwise generators for the hidden true level and the noisy observation at an
// arbitrary tick t. Making these O(1) functions of t (rather than a forward loop
// from zero) is what lets the chart scroll forever: we only ever build the
// visible window, never the whole history, and there is no end to wrap back to.
//
// truthAt is the closed form of the original recurrence
//   level(0) = 100;  level += 0.12 + 0.288 * sin(t / 9)
// using the Dirichlet identity
//   sum_{k=0..t} sin(k a) = sin((t+1)a/2) * sin(t a/2) / sin(a/2).
function truthAt(t: number): number {
  const a = 1 / 9;
  const sinSum = (Math.sin(((t + 1) * a) / 2) * Math.sin((t * a) / 2)) / Math.sin(a / 2);
  return 100 + 0.12 * (t + 1) + 0.288 * sinSum;
}

// Per tick Gaussian keyed on (seed, t) via Box Muller. Keying on t (not a
// sequential stream) keeps each tick's measurement noise stable no matter where
// the window starts, while the "New series" button (which bumps seed) still
// redraws a fresh instrument.
function gaussAt(seed: number, t: number): number {
  const rand = mulberry32((seed ^ Math.imul(t, 0x9e3779b1)) >>> 0);
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Build only the ticks in [fromT, toT]. obs carries the baked-in measurement noise.
function buildWindow(seed: number, fromT: number, toT: number) {
  const out: { t: number; truth: number; obs: number }[] = [];
  for (let t = fromT; t <= toT; t++) {
    const tr = truthAt(t);
    out.push({ t, truth: tr, obs: tr + gaussAt(seed, t) * 1.4 });
  }
  return out;
}

// Run the [level, trend] Kalman filter for given Q and R, returning per step
// estimates plus a forecast projected from the final state.
function runKalman(obs: number[], Q: number, R: number) {
  // 2x2 covariance, 2 vector state. F = [[1,1],[0,1]], H = [1,0].
  let x0 = obs[0], x1 = 0;                      // state: level, trend
  let p00 = 1, p01 = 0, p10 = 0, p11 = 1;       // covariance P

  const steps: Step[] = [];
  for (let t = 0; t < obs.length; t++) {
    // Predict: x = F x, P = F P F^T + Q
    const xp0 = x0 + x1;
    const xp1 = x1;
    // F P F^T for F=[[1,1],[0,1]]
    const a00 = p00 + p01 + p10 + p11;
    const a01 = p01 + p11;
    const a10 = p10 + p11;
    const a11 = p11;
    const pp00 = a00 + Q, pp01 = a01, pp10 = a10, pp11 = a11 + Q;

    // Update: innovation against the level only (H = [1,0])
    const y = obs[t] - xp0;
    const S = pp00 + R;
    const k0 = pp00 / S;       // Kalman gain for level
    const k1 = pp10 / S;       // Kalman gain for trend
    x0 = xp0 + k0 * y;
    x1 = xp1 + k1 * y;
    // P = (I - K H) P_pred, with K H = [[k0,0],[k1,0]]
    p00 = (1 - k0) * pp00;
    p01 = (1 - k0) * pp01;
    p10 = pp10 - k1 * pp00;
    p11 = pp11 - k1 * pp01;

    steps.push({
      t,
      obs: obs[t],
      level: x0,
      trend: x1,
      std: Math.sqrt(Math.max(p00, 1e-9)),
      predStd: Math.sqrt(Math.max(pp00, 1e-9)),
      innov: y,
      innovStd: Math.sqrt(Math.max(S, 1e-9)),
      gain: k0,
    });
  }

  // Forecast: keep predicting with no new measurement, band fans out.
  const forecast: ForecastPoint[] = [];
  let fx0 = x0, fx1 = x1;
  let fp00 = p00, fp01 = p01, fp10 = p10, fp11 = p11;
  for (let k = 1; k <= FORECAST; k++) {
    fx0 = fx0 + fx1;
    const a00 = fp00 + fp01 + fp10 + fp11;
    const a01 = fp01 + fp11;
    const a10 = fp10 + fp11;
    const a11 = fp11;
    fp00 = a00 + Q; fp01 = a01; fp10 = a10; fp11 = a11 + Q;
    forecast.push({ t: obs.length - 1 + k, level: fx0, std: Math.sqrt(Math.max(fp00, 1e-9)) });
  }

  return { steps, forecast };
}

export default function KalmanFilterVisualization() {
  const [processNoise, setProcessNoise] = useState(0.02); // Q
  const [measureNoise, setMeasureNoise] = useState(1.5);  // R
  const [isAnimating, setIsAnimating] = useState(true);
  // autoTune drives Q and R off a slow oscillation so the whole instrument is
  // visibly in motion (estimate morphs smooth<->snappy, gain re-settles, the
  // sawtooth and residual band react, the readouts tick). It pauses the moment
  // a user grabs a slider so it never fights someone trying to learn.
  const [autoTune, setAutoTune] = useState(true);
  const [phase, setPhase] = useState(0);
  // Seed is a piece of state so the "New series" button can refresh the
  // observation draw without page reload.
  const [seed, setSeed] = useState(20260531);
  // headF is the (fractional) latest tick. It advances continuously while
  // playing, so the window scrolls forward forever and never resets. Starts at
  // N-1 so the first frame shows ticks 0..N-1 exactly like a static chart.
  const [headF, setHeadF] = useState(N - 1);
  const animationRef = useRef<number | null>(null);

  const isDark = useIsDarkTheme();

  // When the user touches a slider, take manual control: stop the oscillation.
  const setQManual = (v: number) => { setAutoTune(false); setProcessNoise(v); };
  const setRManual = (v: number) => { setAutoTune(false); setMeasureNoise(v); };

  // SVG palette derived from the theme. SVG fill/stroke can't read CSS variables
  // reliably, so we resolve concrete colours here. Terminal chrome: neutral
  // greys for structure, off-white for the primary series, muted amber only
  // for the secondary (forecast/variance) dimension. No blue tint anywhere.
  const c = useMemo(() => isDark ? {
    grid: '#2e2e2e',
    axis: '#b0b0b0',
    // Faint grey dashed reference line for the hidden true level.
    truth: 'rgba(176,176,176,0.60)',
    // Faint grey dots for observations: background noise, not a signal.
    obs: '#808080',
    band: 'rgba(232,232,232,0.10)',
    // Neutral near-white band; alpha lowered vs the old steel blue because
    // white reads brighter than blue at equal alpha on the dark ground.
    spread: 'rgba(232,232,232,0.14)',
    // Off-white estimate line: the primary signal in the chart.
    estimate: '#e8e8e8',
    marker: '#e8e8e8',
    // Muted amber forecast: the second data dimension, kept distinguishable.
    forecast: '#c58435',
    forecastBand: 'rgba(197,132,53,0.13)',
    accent: '#c58435',
    nowLine: 'rgba(176,176,176,0.5)',
  } : {
    grid: 'rgba(28,28,28,0.10)',
    axis: '#606060',
    // Grey dashed reference line for the hidden true level.
    truth: 'rgba(96,96,96,0.60)',
    // Grey dots for observations in light mode.
    obs: '#707070',
    band: 'rgba(28,28,28,0.08)',
    // Neutral dark band for the ±2σ band in light mode.
    spread: 'rgba(28,28,28,0.12)',
    // Near-black estimate line for light mode.
    estimate: '#1c1c1c',
    marker: '#1c1c1c',
    // Same muted amber forecast in light mode.
    forecast: '#c58435',
    forecastBand: 'rgba(197,132,53,0.15)',
    accent: '#c58435',
    nowLine: 'rgba(96,96,96,0.5)',
  }, [isDark]);

  // Sliding window over an endless series. We build and filter only the visible
  // ticks plus a short warm-up lead-in, so cost stays flat however long it runs.
  const head = Math.floor(headF);
  const windowStartF = headF - (N - 1);                 // leftmost visible tick (fractional, for smooth scroll)
  const firstVisible = Math.max(0, Math.ceil(windowStartF));
  const runStart = Math.max(0, firstVisible - WARMUP);

  const win = useMemo(() => buildWindow(seed, runStart, head), [seed, runStart, head]);
  const obsArr = useMemo(() => win.map(w => w.obs), [win]);
  const kal = useMemo(
    () => runKalman(obsArr, processNoise, measureNoise),
    [obsArr, processNoise, measureNoise]
  );
  // runKalman numbers its steps from 0; rebase onto absolute tick indices so the
  // window can sit anywhere on the timeline.
  const allSteps = useMemo(() => kal.steps.map(s => ({ ...s, t: s.t + runStart })), [kal, runStart]);
  const truthPts = useMemo(
    () => win.filter(w => w.t >= firstVisible).map(w => ({ t: w.t, v: w.truth })),
    [win, firstVisible]
  );

  // Ambient auto-tune: advance a phase ~20x/sec and map it to Q and R so the
  // estimate, band, gain and sawtooth keep morphing on top of the scroll. Two
  // different periods on Q and R keep the pair from moving in lockstep, so the
  // estimate wanders through the full smooth<->snappy space rather than
  // oscillating on one axis. Gated on autoTune so a manual slider freezes it.
  useEffect(() => {
    if (!autoTune || !isAnimating) return;
    const id = setInterval(() => setPhase(p => p + 0.05), 50);
    animationRef.current = id as unknown as number;
    return () => clearInterval(id);
  }, [autoTune, isAnimating]);

  useEffect(() => {
    if (!autoTune) return;
    // R swings across its trust range; Q across its on a faster, offset cycle.
    const r = 1.5 + 1.45 * Math.sin(phase);
    const q = 0.06 + 0.055 * Math.sin(phase * 1.7 + 1.2);
    setMeasureNoise(Math.max(0.05, r));
    setProcessNoise(Math.max(0.001, q));
  }, [phase, autoTune]);

  // Forward scroll: advance headF continuously while playing. requestAnimationFrame
  // (not setInterval) keeps the motion smooth and frame-rate independent. Scrolling
  // is gated only on Play/Pause, so the chart keeps moving even while you drag the
  // Q/R sliders, which only stop the auto-tune oscillation, not the timeline.
  useEffect(() => {
    if (!isAnimating) return;
    let raf = 0;
    let prev: number | null = null;
    const SPEED = 14; // ticks per second (brisker scroll = more visible price movement)
    const loop = (ts: number) => {
      if (prev === null) prev = ts;
      const dt = (ts - prev) / 1000;
      prev = ts;
      setHeadF(h => h + SPEED * dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isAnimating]);

  const shown = useMemo(() => allSteps.filter(s => s.t >= firstVisible), [allSteps, firstVisible]);
  const last = shown.length ? shown[shown.length - 1] : null;

  // Per-step forecast cone anchored at the current revealed step rather than
  // only the final one. Uses a linear projection (level += trend, std grows
  // with horizon) so the cone is on screen throughout the sweep.
  const liveForecast: ForecastPoint[] = useMemo(() => {
    if (!last) return [];
    const out: ForecastPoint[] = [];
    for (let k = 1; k <= FORECAST; k++) {
      out.push({
        t: last.t + k,
        level: last.level + k * last.trend,
        std: Math.sqrt(last.std * last.std * (1 + k * 0.4) + processNoise * k),
      });
    }
    return out;
  }, [last, processNoise]);

  // Main plot geometry. viewBox scaling lets the SVG fill the container width.
  const W = 960, H = 400, padX = 56, padY = 30;
  const xMax = N - 1 + FORECAST;
  // xRel positions a fixed screen slot (0..xMax): used by the axis grid, which
  // stays put while data flows under it. xToPx positions a data tick by its
  // absolute index, offset by the fractional window start so the series scrolls
  // smoothly (sub-tick) rather than jumping a whole tick at a time.
  const xRel = (rel: number) => padX + (rel / xMax) * (W - 2 * padX);
  const xToPx = (t: number) => xRel(t - windowStartF);

  // Price domain from the visible window plus its live forecast band, so the
  // view re-centres as the series scrolls and the price level drifts. Nothing
  // clips, and the gentle vertical pan reinforces that the chart is live.
  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    shown.forEach(s => {
      lo = Math.min(lo, s.obs, s.level - 2 * s.std);
      hi = Math.max(hi, s.obs, s.level + 2 * s.std);
    });
    liveForecast.forEach(f => { lo = Math.min(lo, f.level - 2 * f.std); hi = Math.max(hi, f.level + 2 * f.std); });
    if (!isFinite(lo) || !isFinite(hi)) { lo = 98; hi = 102; }
    const pad = (hi - lo) * 0.08 || 1;
    return { yMin: lo - pad, yMax: hi + pad };
  }, [shown, liveForecast]);
  const yToPx = (y: number) => padY + (1 - (y - yMin) / (yMax - yMin)) * (H - 2 * padY);

  // Four price gridlines / ticks for the main plot y-axis.
  const yTicks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= 4; i++) out.push(yMin + (i / 4) * (yMax - yMin));
    return out;
  }, [yMin, yMax]);

  // X-axis ticks every 15 steps plus the forecast horizon end. Labels read
  // "0, 15, 30, 45, 60 (now), +16" so a reader instantly sees where the
  // filtered history ends and the forecast begins.
  const xTicks = useMemo(() => {
    return [0, 15, 30, 45, N - 1, N - 1 + FORECAST];
  }, []);

  const meanPath = shown.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(s.t)} ${yToPx(s.level)}`).join(' ');
  const bandPath = [
    ...shown.map(s => `${xToPx(s.t)} ${yToPx(s.level + 2 * s.std)}`),
    ...shown.slice().reverse().map(s => `${xToPx(s.t)} ${yToPx(s.level - 2 * s.std)}`),
  ];

  // Live forecast cone path, anchored to the last revealed step.
  const fcMeanPath = last
    ? `M ${xToPx(last.t)} ${yToPx(last.level)} ` +
      liveForecast.map(f => `L ${xToPx(f.t)} ${yToPx(f.level)}`).join(' ')
    : '';
  const fcBandPath = last
    ? [
        `${xToPx(last.t)} ${yToPx(last.level)}`,
        ...liveForecast.map(f => `${xToPx(f.t)} ${yToPx(f.level + 2 * f.std)}`),
        ...liveForecast.slice().reverse().map(f => `${xToPx(f.t)} ${yToPx(f.level - 2 * f.std)}`),
        `${xToPx(last.t)} ${yToPx(last.level)}`,
      ]
    : [];

  // Live readout values come straight from the step (no recompute / no approx).
  const gain = last ? last.gain : 0;
  const innov = last ? last.innov : 0;

  // Secondary-panel geometry. Three small coordinated diagrams share one x-axis
  // mapping (step index) so they read as views of the same run.
  const SW = 380, SHs = 180, sPadX = 36, sPadY = 24;
  const sxMax = N - 1;
  // Same window offset as the main plot: data ticks slide, so subtract the
  // fractional window start before mapping to the panel's x.
  const sxToPx = (t: number) => sPadX + (sxMax === 0 ? 0 : ((t - windowStartF) / sxMax)) * (SW - 2 * sPadX);

  // Panel 1: innovation residuals against the ±2σ_innov envelope.
  const innovBound = useMemo(() => {
    let m = 0;
    shown.forEach(s => { m = Math.max(m, 2 * s.innovStd, Math.abs(s.innov)); });
    return Math.max(m * 1.15, 0.5);
  }, [shown]);
  const innovToPx = (v: number) => sPadY + (1 - (v + innovBound) / (2 * innovBound)) * (SHs - 2 * sPadY);
  const innovBandPath = [
    ...shown.map(s => `${sxToPx(s.t)} ${innovToPx(2 * s.innovStd)}`),
    ...shown.slice().reverse().map(s => `${sxToPx(s.t)} ${innovToPx(-2 * s.innovStd)}`),
  ];

  // Panel 2: predictive-distribution heatmap. Each column is the filter's
  // Gaussian belief over price at that step, N(level, std). We bucket the
  // visible price range into rows and shade each cell by its density, so the
  // bright band tracks the estimate and fans out as std grows. It is the same
  // distribution the ±2σ band draws, rendered as a streaming probability field
  // rather than a single line, which catches the eye while staying faithful.
  // Heatmap cell hue: neutral grey, matched to the ±2σ spread colour.
  const heatRGB = isDark ? '232,232,232' : '28,28,28';
  const HEAT_ROWS = 9;
  const heatCells = useMemo(() => {
    const cells: { x: number; y: number; w: number; h: number; a: number }[] = [];
    const colW = (sxMax === 0 ? 8 : ((SW - 2 * sPadX) / sxMax)) * 1.08;
    const rowH = (SHs - 2 * sPadY) / HEAT_ROWS;
    const span = yMax - yMin || 1;
    shown.forEach(s => {
      const cx = sxToPx(s.t);
      for (let r = 0; r < HEAT_ROWS; r++) {
        const price = yMax - ((r + 0.5) / HEAT_ROWS) * span;   // row centre price
        const z = s.std > 1e-9 ? (price - s.level) / s.std : (price - s.level) * 1e9;
        const a = Math.exp(-0.5 * z * z);                       // Gaussian density, peak 1
        if (a < 0.05) continue;                                 // skip near-zero cells
        cells.push({ x: cx - colW / 2, y: sPadY + r * rowH, w: colW, h: rowH, a });
      }
    });
    return cells;
  }, [shown, yMin, yMax]);

  // Panel 3: the predict/update variance sawtooth.
  const varBound = useMemo(() => {
    let m = 0;
    shown.forEach(s => { m = Math.max(m, s.predStd * s.predStd); });
    return Math.max(m * 1.1, 1e-6);
  }, [shown]);
  const varToPx = (v: number) => sPadY + (1 - v / varBound) * (SHs - 2 * sPadY);
  const sawPath = shown.length
    ? 'M ' + shown.map(s =>
        `${sxToPx(s.t)} ${varToPx(s.predStd * s.predStd)} L ${sxToPx(s.t)} ${varToPx(s.std * s.std)}`
      ).join(' L ')
    : '';

  return (
    <Card className="p-4 sm:p-5 bg-card border-border">
      {/* header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">Kalman Filter</h3>
            <p className="text-xs text-muted-foreground">Recursive denoiser. Recovers the unknown true price from noisy ticks without lagging like a moving average.</p>
          </div>
          {/* Live regime chip: flips as the auto-tune walks R across its range, so
              the eye always has a changing token to track. */}
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border text-[11px] font-mono text-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-foreground animate-pulse" />
            {measureNoise > 2.2 ? 'SMOOTHING' : measureNoise < 0.9 ? 'TRACKING' : 'BALANCED'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSeed(s => s + 1)}>
            New series
          </Button>
          <Button size="sm" variant={autoTune ? 'default' : 'secondary'} onClick={() => setAutoTune(a => !a)}>
            {autoTune ? 'Auto-tune: on' : 'Auto-tune: off'}
          </Button>
          <Button size="sm" variant={isAnimating ? 'secondary' : 'default'} onClick={() => setIsAnimating(a => !a)}>
            {isAnimating ? 'Pause' : 'Play'}
          </Button>
        </div>
      </div>

      {/* What/why preamble. Sized for 1080p screen recordings (text-base
          on body, text-lg on the heading word) so a viewer at typical
          YouTube/Twitter compression can still read it. */}
      <div className="mb-4 rounded-md border border-border bg-muted/30 p-4 sm:p-5 text-base text-muted-foreground leading-relaxed">
        <span className="block mb-1 text-lg sm:text-xl text-foreground font-semibold">How it works</span>
        Each tick the filter does two things:
        a <span className="text-foreground font-medium">predict</span> step projects the previous estimate forward
        (state = level + trend), then an <span className="text-foreground font-medium">update</span> step folds in
        the new observation, weighted by the Kalman gain K. K is the optimal trade-off between the model's variance
        and the measurement's variance — if the model is more certain, K is small and the price barely nudges the
        estimate; if the measurement is more certain, K is large and the estimate snaps onto the tick. Q (process
        noise) and R (measurement noise) set that balance.
      </div>

      {/* Main plot. viewBox makes it scale to the full card width. */}
      {/* Solid bg-background: the terminal chart ground is flat, no translucent tint over the card. */}
      <div className="w-full rounded-md border border-border bg-background p-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* y gridlines + price ticks */}
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={padX} x2={W - padX} y1={yToPx(v)} y2={yToPx(v)} stroke={c.grid} strokeWidth={1} />
              <text x={padX - 8} y={yToPx(v) + 3} textAnchor="end" fill={c.axis} fontSize="10" fontFamily="monospace">{v.toFixed(1)}</text>
            </g>
          ))}
          {/* y-axis title, rotated. Calling it "Price": same word the obs/estimate are in. */}
          <text x={14} y={H / 2} fill={c.axis} fontSize="10" fontFamily="monospace" textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`}>Price</text>
          {/* x-axis baseline + ticks + labels. Last two ticks are 'now' and the forecast horizon. */}
          <line x1={padX} x2={W - padX} y1={H - padY} y2={H - padY} stroke={c.axis} strokeWidth={1} />
          {xTicks.map((t, i) => {
            const isNow = t === N - 1;
            const isForecastEnd = t === N - 1 + FORECAST;
            const label = isNow ? `now` : isForecastEnd ? `+${FORECAST}` : `${t}`;
            return (
              <g key={i}>
                <line x1={xRel(t)} x2={xRel(t)} y1={H - padY} y2={H - padY + 4} stroke={c.axis} strokeWidth={1} />
                <text x={xRel(t)} y={H - padY + 15} textAnchor="middle" fill={c.axis} fontSize="10" fontFamily="monospace">{label}</text>
              </g>
            );
          })}
          <text x={W - padX} y={H - 4} textAnchor="end" fill={c.axis} fontSize="10" fontFamily="monospace">tick →</text>
          {/* "now" divider between filtered region and forecast */}
          {last && (
            <line x1={xToPx(last.t)} x2={xToPx(last.t)} y1={padY} y2={H - padY} stroke={c.nowLine} strokeWidth={1} strokeDasharray="3 3" />
          )}
          {/* live forecast band (behind everything) */}
          {fcBandPath.length > 0 && (
            <polygon points={fcBandPath.join(' ')} fill={c.forecastBand} stroke="none" />
          )}
          {/* filtered uncertainty band (the spread) */}
          <polygon points={bandPath.join(' ')} fill={c.spread} stroke="none" />
          {/* hidden true level */}
          <path
            d={truthPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(p.t)} ${yToPx(p.v)}`).join(' ')}
            fill="none" stroke={c.truth} strokeWidth={1} strokeDasharray="2 3"
          />
          {/* observations */}
          {shown.map((s, i) => (
            <circle key={i} cx={xToPx(s.t)} cy={yToPx(s.obs)} r={2.4} fill={c.obs} />
          ))}
          {/* live forecast mean (dashed projection) */}
          {fcMeanPath && (
            <path d={fcMeanPath} fill="none" stroke={c.forecast} strokeWidth={1.75} strokeDasharray="5 4" />
          )}
          {/* filtered estimate */}
          <path d={meanPath} fill="none" stroke={c.estimate} strokeWidth={2.25} />
          {/* current marker */}
          {last && <circle cx={xToPx(last.t)} cy={yToPx(last.level)} r={4} fill={c.marker} stroke={c.estimate} strokeWidth={1} />}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-muted-foreground">
        <LegendDot color={c.obs} shape="dot" label="Observed price" />
        <LegendDot color={c.estimate} shape="line" label="Filtered estimate" />
        <LegendDot color={isDark ? 'rgba(232,232,232,0.55)' : 'rgba(28,28,28,0.50)'} shape="band" label="±2σ uncertainty" />
        <LegendDot color={c.forecast} shape="dash" label="Forecast" />
        <LegendDot color={c.truth} shape="dash" label="Hidden true level" />
      </div>

      {/* Secondary panel row. Three coordinated diagnostics sharing the same
          x-axis (step index). Each panel has axis labels + a 'what to look for'
          hint, so the row reads as analysis, not decoration. */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Panel title="Innovation residuals" hint="obs − predicted. Should sit inside the ±2σ band with no drift. Drift outside = Q or R is mis-tuned.">
          <svg viewBox={`0 0 ${SW} ${SHs}`} className="w-full h-auto">
            {innovBandPath.length > 0 && (
              <polygon points={innovBandPath.join(' ')} fill={c.band} stroke="none" />
            )}
            <line x1={sPadX} x2={SW - sPadX} y1={innovToPx(0)} y2={innovToPx(0)} stroke={c.axis} strokeWidth={1} strokeDasharray="2 3" />
            {shown.map((s, i) => (
              <line key={i} x1={sxToPx(s.t)} x2={sxToPx(s.t)} y1={innovToPx(0)} y2={innovToPx(s.innov)} stroke={c.estimate} strokeWidth={1} opacity={0.6} />
            ))}
            {last && <circle cx={sxToPx(last.t)} cy={innovToPx(last.innov)} r={2.8} fill={c.marker} stroke={c.estimate} strokeWidth={0.75} />}
            <PanelAxes
              c={c} SW={SW} SHs={SHs} sPadX={sPadX} sPadY={sPadY}
              yTop={innovBound} yBot={-innovBound} yLabel="innov"
            />
          </svg>
        </Panel>

        <Panel title="Predictive distribution" hint="Each column is the filter's probability over price at that step, N(level, σ²). The bright band is the most likely price; it widens as uncertainty grows.">
          <svg viewBox={`0 0 ${SW} ${SHs}`} className="w-full h-auto">
            {heatCells.map((cell, i) => (
              <rect key={i} x={cell.x} y={cell.y} width={cell.w} height={cell.h}
                fill={`rgba(${heatRGB},${Math.min(0.85, cell.a * 0.9).toFixed(3)})`} />
            ))}
            {last && (
              <circle cx={sxToPx(last.t)} cy={sPadY + (1 - (last.level - yMin) / ((yMax - yMin) || 1)) * (SHs - 2 * sPadY)}
                r={2.6} fill={c.marker} stroke={c.estimate} strokeWidth={0.75} />
            )}
            <PanelAxes
              c={c} SW={SW} SHs={SHs} sPadX={sPadX} sPadY={sPadY}
              yTop={yMax} yBot={yMin} yLabel="price"
            />
          </svg>
        </Panel>

        <Panel title="Variance (predict ↔ update)" hint="Each predict step adds Q (variance rises); each update folds in a tick (variance drops). The sawtooth is the filter breathing.">
          <svg viewBox={`0 0 ${SW} ${SHs}`} className="w-full h-auto">
            <line x1={sPadX} x2={SW - sPadX} y1={SHs - sPadY} y2={SHs - sPadY} stroke={c.axis} strokeWidth={1} />
            {sawPath && <path d={sawPath} fill="none" stroke={c.accent} strokeWidth={1.5} />}
            {shown.map((s, i) => (
              <circle key={i} cx={sxToPx(s.t)} cy={varToPx(s.std * s.std)} r={1.5} fill={c.obs} />
            ))}
            <PanelAxes
              c={c} SW={SW} SHs={SHs} sPadX={sPadX} sPadY={sPadY}
              yTop={varBound} yBot={0} yLabel="σ²"
            />
          </svg>
        </Panel>
      </div>

      {/* Live readout. All five tiles update continuously with the auto-tune. */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        <Stat label="Kalman gain K" value={gain.toFixed(3)} />
        <Stat label="Innovation" value={innov.toFixed(2)} />
        <Stat label="Estimate ±2σ" value={last ? (2 * last.std).toFixed(2) : '0.00'} />
        <Stat label="Process noise Q" value={processNoise.toFixed(3)} />
        <Stat label="Measurement noise R" value={measureNoise.toFixed(2)} />
      </div>

      {/* controls */}
      <div className="mt-5 space-y-4">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span>Process Noise Q (model trust)</span>
            <span className="font-mono text-foreground">{processNoise.toFixed(3)}</span>
          </div>
          {/* Shared Slider, not a native range input: the browser default
              accent renders blue on some platforms, which the terminal bans. */}
          <Slider min={0.001} max={0.4} step={0.001} value={[processNoise]}
            onValueChange={v => setQManual(v[0])} />
        </div>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span>Measurement Noise R (price trust)</span>
            <span className="font-mono text-foreground">{measureNoise.toFixed(2)}</span>
          </div>
          <Slider min={0.05} max={6} step={0.05} value={[measureNoise]}
            onValueChange={v => setRManual(v[0])} />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Low Q with high R gives a smooth, lagging estimate. High Q with low R snaps the estimate onto every tick. Watch the residual band: when Q or R is mistuned, the innovations drift outside ±2σ.
        </p>
      </div>
    </Card>
  );
}

// Small numeric tile.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 border border-border px-3 py-2">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className="text-foreground font-mono text-[13px]">{value}</div>
    </div>
  );
}

// Bordered panel wrapper for the secondary-diagram row.
function Panel({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-muted/30 border border-border p-3">
      <div className="text-[11px] uppercase tracking-wider text-foreground font-mono">{title}</div>
      <div className="text-[10px] text-muted-foreground mb-2 leading-snug">{hint}</div>
      {children}
    </div>
  );
}

// Shared axis decoration for the three secondary panels: top + bottom y-tick
// labels, x-axis tick labels at 0 / N/2 / N-1, and a small "tick ->" arrow
// in the bottom-right corner. Pulled into a helper because all three panels
// need exactly the same treatment.
function PanelAxes({
  c, SW, SHs, sPadX, sPadY, yTop, yBot, yLabel,
}: {
  c: { axis: string };
  SW: number; SHs: number; sPadX: number; sPadY: number;
  yTop: number; yBot: number; yLabel: string;
}) {
  const fmt = (v: number) => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  // Fixed reference slots across the window (data scrolls under them), so the
  // labels stay put instead of sliding off with the moving series.
  const slots: { rel: number; label: string }[] = [
    { rel: 0, label: '0' },
    { rel: Math.floor((N - 1) / 2), label: `${Math.floor((N - 1) / 2)}` },
    { rel: N - 1, label: 'now' },
  ];
  const xRelP = (rel: number) => sPadX + (rel / (N - 1)) * (SW - 2 * sPadX);
  return (
    <g pointerEvents="none">
      {/* y-axis labels: top and bottom */}
      <text x={sPadX - 4} y={sPadY + 3} textAnchor="end" fill={c.axis} fontSize="9" fontFamily="monospace">{fmt(yTop)}</text>
      <text x={sPadX - 4} y={SHs - sPadY + 3} textAnchor="end" fill={c.axis} fontSize="9" fontFamily="monospace">{fmt(yBot)}</text>
      <text x={6} y={SHs / 2} textAnchor="middle" fill={c.axis} fontSize="9" fontFamily="monospace" transform={`rotate(-90 6 ${SHs / 2})`}>{yLabel}</text>
      {/* x-axis tick labels */}
      {slots.map(s => (
        <text key={s.rel} x={xRelP(s.rel)} y={SHs - 4} textAnchor="middle" fill={c.axis} fontSize="9" fontFamily="monospace">{s.label}</text>
      ))}
      <text x={SW - sPadX} y={SHs - 4} textAnchor="end" fill={c.axis} fontSize="9" fontFamily="monospace">tick</text>
    </g>
  );
}

// Legend swatch. Renders a small shape matching how the series appears on the plot.
function LegendDot({ color, shape, label }: { color: string; shape: 'dot' | 'line' | 'dash' | 'band'; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="20" height="10" className="shrink-0">
        {shape === 'dot' && <circle cx="10" cy="5" r="3" fill={color} />}
        {shape === 'line' && <line x1="2" x2="18" y1="5" y2="5" stroke={color} strokeWidth="2.25" />}
        {shape === 'dash' && <line x1="2" x2="18" y1="5" y2="5" stroke={color} strokeWidth="2" strokeDasharray="4 3" />}
        {shape === 'band' && <rect x="2" y="2" width="16" height="6" fill={color} rx="1" />}
      </svg>
      {label}
    </span>
  );
}
