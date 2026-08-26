/**
 * Transformer Self-Attention Heatmap
 *
 * Three interactive views over a simulated multi-head self-attention layer
 * applied to 12 trading features per bar tick.
 *
 * Views
 * ─────
 * Heatmap     - main 12×12 grid (left) + top-pairs bar chart + entropy history (right)
 * Head Compare - 2×2 grid showing H1-H4 side-by-side so specialisation is obvious
 * Feature Profile - horizontal bar charts: attention received vs attention given per feature
 *
 * Bottom stats bar mirrors the HMM layout: tick, head, max weight, entropy, top pair.
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, RotateCcw, ChevronRight } from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────

// 8 features, reduced from 12 so labels are readable on narrow portrait screens.
// Shorter names (≤5 chars) so they fit without truncation.
const FEATURES = [
  'RSI', 'MACD', 'Volume', 'ATR',
  'BB%B', 'Lag-1', 'Lag-2', 'Ret1d',
];
const N = FEATURES.length;
const N_HEADS = 4;
const HISTORY = 70;

// Feature cluster index map for 8-feature set.
const HEAD_BIAS: number[][] = [
  [5, 6],    // H1 - price lags   (Lag-1, Lag-2)
  [0, 1],    // H2 - momentum     (RSI, MACD)
  [2, 3, 4], // H3 - volatility   (Volume, ATR, BB%B)
  [7],       // H4 - returns      (Ret1d)
];
const HEAD_LABELS = ['H1', 'H2', 'H3', 'H4', 'Avg'];
const HEAD_NAMES  = ['Lags', 'Momentum', 'Volatility', 'Returns'];

// Terminal palette (hex fallbacks: canvas 2D cannot resolve CSS vars).
// Four heads must stay mutually distinguishable, so each takes one muted
// terminal accent; Avg is the primary series colour.
const HEAD_COLORS = [
  '#21b3a4', // H1 muted teal (var(--up) fallback)
  '#b0b0b0', // H2 neutral grey (was blue; terminal has no blue accent)
  '#c58435', // H3 muted amber
  '#f0426c', // H4 muted rose (var(--down) fallback)
  '#e8e8e8', // Avg primary series
];

// Four tracked pairs, one per head cluster, for the dynamics chart.
const TRACKED_PAIRS: [number, number][] = [
  [5, 6], // Lag-1 -> Lag-2  (H1)
  [0, 1], // RSI   -> MACD   (H2)
  [2, 3], // Vol   -> ATR    (H3)
  [7, 0], // Ret1d -> RSI    (cross-cluster)
];
const PAIR_LABELS = ['Lag-1→Lag-2', 'RSI→MACD', 'Vol→ATR', 'Ret→RSI'];
const PAIR_COLORS = [
  HEAD_COLORS[0],
  HEAD_COLORS[1],
  HEAD_COLORS[2],
  HEAD_COLORS[3],
];

type View = 'heatmap' | 'heads' | 'profile';

// ── Math ──────────────────────────────────────────────────────────────────────

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function softmax(arr: number[]): number[] {
  const max = Math.max(...arr);
  const exps = arr.map(x => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(x => x / sum);
}

// Direct-logit generation: wide stable range + per-tick noise + strong
// in-cluster boost so focused feature pairs have obviously higher weights.
function computeAttentionMatrix(tick: number, headIdx: number): number[][] {
  const stableRand = seededRand(headIdx * 997 + 42);
  const noiseRand  = seededRand(tick * 7919 + headIdx * 131 + 1);
  const focused    = new Set(HEAD_BIAS[headIdx] ?? []);

  const logits = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => {
      const base  = (stableRand() * 2 - 1) * 3;
      const noise = (noiseRand() * 2 - 1) * 1.2;
      const boost = (focused.has(i) && focused.has(j)) ? 4.5 : 0;
      return base + noise + boost;
    })
  );
  return logits.map(row => softmax(row));
}

function avgMatrices(matrices: number[][][]): number[][] {
  return Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) =>
      matrices.reduce((s, m) => s + m[i][j], 0) / matrices.length
    )
  );
}

function lerpMatrix(a: number[][], b: number[][], t: number): number[][] {
  return a.map((row, i) => row.map((v, j) => v + (b[i][j] - v) * t));
}

// Normalised ramp: terminal bg #1c1c1c -> near-white #e8e8e8 (neutral, no tint).
// minW/maxW from the current frame so the full range is always used regardless
// of softmax entropy.
function cellColor(w: number, minW: number, maxW: number): string {
  const norm = maxW > minW ? (w - minW) / (maxW - minW) : 0;
  const t = Math.pow(Math.max(0, Math.min(1, norm)), 0.65);
  const v = Math.round(28 + 204 * t);
  return `rgb(${v},${v},${v})`;
}

// Head-tinted mini cell for Heads view: same ramp but tinted toward head color.
function headCellColor(w: number, minW: number, maxW: number, headIdx: number): string {
  const norm = maxW > minW ? (w - minW) / (maxW - minW) : 0;
  const t    = Math.pow(Math.max(0, Math.min(1, norm)), 0.65);
  const hex  = HEAD_COLORS[headIdx];
  const rH   = parseInt(hex.slice(1, 3), 16);
  const gH   = parseInt(hex.slice(3, 5), 16);
  const bH   = parseInt(hex.slice(5, 7), 16);
  // Dark base: terminal bg rgb(28,28,28); saturate toward head colour at high attention
  const r = Math.round(28 + (rH - 28) * t);
  const g = Math.round(28 + (gH - 28) * t);
  const b = Math.round(28 + (bH - 28) * t);
  return `rgb(${r},${g},${b})`;
}

// Shannon entropy (bits) of the flattened attention matrix.
function entropy(mat: number[][]): number {
  const eps = 1e-12;
  return -mat.flat().reduce((s, p) => s + (p > eps ? p * Math.log2(p) : 0), 0);
}

// Pre-seed HISTORY bars of retroactive data so charts are immediately full on
// mount rather than building up from the left edge.
function initAvgMatrix(tick: number): number[][] {
  return avgMatrices(Array.from({ length: N_HEADS }, (_, h) => computeAttentionMatrix(tick, h)));
}
function initPairHistory(): number[][] {
  return Array.from({ length: TRACKED_PAIRS.length }, (_, k) =>
    Array.from({ length: HISTORY }, (_, i) => {
      const mat = initAvgMatrix(i);
      return mat[TRACKED_PAIRS[k][0]][TRACKED_PAIRS[k][1]];
    })
  );
}
function initEntropyHistory(): number[] {
  return Array.from({ length: HISTORY }, (_, i) => entropy(initAvgMatrix(i)));
}

// ── Theme hook ────────────────────────────────────────────────────────────────

function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const sync = () => setIsDark(document.documentElement.classList.contains('dark'));
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('theme-change', sync);
    return () => { obs.disconnect(); window.removeEventListener('theme-change', sync); };
  }, []);
  return isDark;
}

// ── Draw helpers ──────────────────────────────────────────────────────────────

interface GridLayout {
  x0: number; y0: number; x1: number; y1: number;
}

// Draw a single NxN heatmap inside the given bounding box.
// Returns the cell sizes so callers can do hover math.
function drawGrid(
  ctx: CanvasRenderingContext2D,
  mat: number[][], minW: number, maxW: number,
  box: GridLayout,
  opts: {
    headIdx: number;        // -1 = neutral ramp, 0-3 = head tint
    hov?: { row: number; col: number } | null;
    clusterBoxes?: boolean; // draw cluster boundary outlines
    labelL?: number;        // left label margin inside box
    labelT?: number;        // top label margin inside box
    fontSize?: number;
    isDark?: boolean;
  }
) {
  const { headIdx, hov, clusterBoxes, isDark = true } = opts;
  const labelL = opts.labelL ?? 70;
  const labelT = opts.labelT ?? 62;
  const fs     = opts.fontSize ?? 10;

  const gW = (box.x1 - box.x0) - labelL - 4;
  const gH = (box.y1 - box.y0) - labelT - 4;
  const cW = gW / N;
  const cH = gH / N;
  const gX = box.x0 + labelL;
  const gY = box.y0 + labelT;

  // Cells with optional weight labels in high-attention cells
  const normThresh = 0; // show value text in every cell
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const w    = mat[row][col];
      const norm = maxW > minW ? (w - minW) / (maxW - minW) : 0;
      const x    = gX + col * cW;
      const y    = gY + row * cH;
      const fill = headIdx >= 0
        ? headCellColor(w, minW, maxW, headIdx)
        : cellColor(w, minW, maxW);
      ctx.fillStyle = fill;
      ctx.fillRect(x + 0.5, y + 0.5, cW - 1, cH - 1);

      // Show weight in every cell; opacity scales with brightness so dark cells stay readable
      if (cW >= 22 && cH >= 12) {
        const alpha = Math.round((0.45 + norm * 0.55) * 100) / 100;
        // Ramps now end on light colours, so bright cells need dark text to stay readable
        const [cr, cg, cb] = fill.match(/\d+/g)!.map(Number);
        const bright = (cr * 299 + cg * 587 + cb * 114) / 1000 > 140;
        ctx.fillStyle = bright ? `rgba(28,28,28,${alpha})` : `rgba(232,232,232,${alpha})`;
        ctx.font      = `bold ${Math.min(norm > 0.55 ? 11 : 10, Math.floor(cH * 0.54))}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(w.toFixed(2), x + cW / 2, y + cH / 2);
      }
    }
  }

  // Cluster bounding boxes with solid-colour label tag on the diagonal block
  if (clusterBoxes) {
    HEAD_BIAS.forEach((group, hi) => {
      const sorted = [...group].sort((a, b) => a - b);
      const r0 = sorted[0], r1 = sorted[sorted.length - 1];
      const bx = gX + r0 * cW;
      const by = gY + r0 * cH;
      const bw = (r1 - r0 + 1) * cW;
      const bh = (r1 - r0 + 1) * cH;

      // Solid border (no dash) so it reads clearly at small cell sizes
      ctx.save();
      ctx.strokeStyle = HEAD_COLORS[hi] + 'cc';
      ctx.lineWidth   = 2;
      ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);

      // Small coloured label in the top-left corner of the block
      const lbl = HEAD_NAMES[hi].split(' ')[0]; // first word: "Price", "Momentum", etc.
      const lblW = Math.min(bw - 4, 52);
      const lblH = 10;
      // Neutral tag bg (var(--bg2) fallback) with head-coloured text: no solid colour fills
      ctx.fillStyle = 'rgba(38,38,38,0.9)';
      ctx.fillRect(bx + 1, by + 1, lblW, lblH);
      ctx.fillStyle = HEAD_COLORS[hi];
      ctx.font = `bold 7px system-ui, sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(lbl, bx + 3, by + 6);
      ctx.restore();
    });
  }

  // Hover highlight
  if (hov) {
    const x = gX + hov.col * cW;
    const y = gY + hov.row * cH;
    ctx.save();
    ctx.strokeStyle = 'rgba(232,232,232,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, cW - 2, cH - 2);
    // Row + col bands
    ctx.fillStyle = 'rgba(232,232,232,0.05)';
    ctx.fillRect(gX, y + 0.5, gW, cH - 1);
    ctx.fillRect(x + 0.5, gY, cW - 1, gH);
    ctx.restore();
  }

  // Y-axis labels
  ctx.font        = `bold ${fs}px system-ui, sans-serif`;
  ctx.textAlign   = 'right';
  ctx.textBaseline = 'middle';
  for (let row = 0; row < N; row++) {
    const y = gY + row * cH + cH / 2;
    const focused = headIdx >= 0 && HEAD_BIAS[headIdx]?.includes(row);
    ctx.fillStyle = focused
      ? HEAD_COLORS[headIdx]
      : (isDark ? '#e8e8e8' : '#171717');
    ctx.fillText(FEATURES[row], gX - 5, y);
  }

  // X-axis labels (rotated): use at least fs so labels don't shrink on narrow cells
  const xfs = Math.max(fs - 1, Math.min(fs, Math.floor(cW * 0.72)));
  ctx.font      = `bold ${xfs}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let col = 0; col < N; col++) {
    const x = gX + col * cW + cW / 2;
    const focused = headIdx >= 0 && HEAD_BIAS[headIdx]?.includes(col);
    ctx.fillStyle = focused
      ? HEAD_COLORS[headIdx]
      : (isDark ? '#e8e8e8' : '#171717');
    ctx.save();
    ctx.translate(x, gY - 7);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(FEATURES[col], 0, 0);
    ctx.restore();
  }

  return { cW, cH, gX, gY };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AttentionHeatmapVisualization() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);
  const animRef     = useRef<number>();
  const lastTimeRef = useRef<number>();

  // Animation-loop refs (mutable without re-render)
  const tickRef     = useRef(0);
  const progressRef = useRef(0);
  const playingRef  = useRef(true);
  const speedRef    = useRef(0.8);
  const headRef     = useRef(4);     // 4 = Avg
  const viewRef     = useRef<View>('heatmap');
  const hoverRef    = useRef<{ row: number; col: number } | null>(null);
  const entropyRef  = useRef<number[]>(initEntropyHistory());
  const pairHistRef = useRef<number[][]>(initPairHistory());
  // Stats shared between draw loop and React render
  const statsRef    = useRef({ maxW: 0, minW: 0, entropyVal: 0, topPair: '' });

  // React state (drives re-render, mirrors refs for UI)
  const [playing, setPlaying]   = useState(true);
  const [speed,   setSpeed]     = useState(0.8);
  const [head,    setHead]      = useState(4);
  const [view,    setView]      = useState<View>('heatmap');
  const [tick,    setTick]      = useState(0);
  const [stats,   setStats]     = useState({ maxW: 0, minW: 0, entropyVal: 0, topPair: '' });
  const [hover,   setHover]     = useState<{ row: number; col: number; w: number } | null>(null);
  const isDark = useIsDarkTheme();

  // Keep refs in sync
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current   = speed;   }, [speed]);
  useEffect(() => { headRef.current    = head;    }, [head]);
  useEffect(() => { viewRef.current    = view;    }, [view]);

  const getMatrix = useCallback((t: number, h: number): number[][] => {
    if (h < N_HEADS) return computeAttentionMatrix(t, h);
    return avgMatrices(Array.from({ length: N_HEADS }, (_, i) => computeAttentionMatrix(t, i)));
  }, []);

  // ── Draw views ─────────────────────────────────────────────────────────────

  const drawHeatmapView = useCallback((
    ctx: CanvasRenderingContext2D, W: number, H: number,
    mat: number[][], minW: number, maxW: number
  ) => {
    // Portrait stacked layout: grid 36%, top-pairs 24%, dynamics 40%
    const ZONE1 = Math.round(H * 0.36);
    const ZONE2 = Math.round(H * 0.60);
    const PAD   = 8;

    // ── Zone 1: main grid (full width) ────────────────────────────────────
    const gridBox: GridLayout = { x0: 0, y0: 0, x1: W - 18, y1: ZONE1 };
    drawGrid(ctx, mat, minW, maxW, gridBox, {
      headIdx: headRef.current < N_HEADS ? headRef.current : -1,
      hov: hoverRef.current,
      clusterBoxes: true,
      labelL: 60, labelT: 56,
      fontSize: 11,
      isDark,
    });

    // Axis titles
    ctx.fillStyle = isDark ? '#808080' : '#a3a3a3';
    ctx.font = '8px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Key  (attended to)', W / 2, 6);
    ctx.save();
    ctx.translate(7, ZONE1 / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Query', 0, 0);
    ctx.restore();

    // Colour scale bar (thin strip at far right edge of grid zone)
    const scX = W - 16;
    const scY = 54; const scH = ZONE1 - 66;
    const grad0 = ctx.createLinearGradient(0, scY + scH, 0, scY);
    grad0.addColorStop(0, cellColor(minW, minW, maxW));
    grad0.addColorStop(1, cellColor(maxW, minW, maxW));
    ctx.fillStyle = grad0;
    ctx.fillRect(scX, scY, 5, scH);
    ctx.fillStyle = isDark ? '#808080' : '#a3a3a3';
    ctx.font = '6px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(maxW.toFixed(2), scX + 7, scY + 4);
    ctx.fillText(minW.toFixed(2), scX + 7, scY + scH - 4);

    // ── Divider 1 ──────────────────────────────────────────────────────────
    ctx.strokeStyle = isDark ? '#2e2e2e' : '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ZONE1); ctx.lineTo(W, ZONE1); ctx.stroke();

    // ── Zone 2: Top attention pairs (full-width horizontal bars) ──────────
    const PY  = ZONE1 + PAD;
    const PH  = ZONE2 - ZONE1 - PAD * 2;
    const hc  = headRef.current < N_HEADS ? headRef.current : 4;

    ctx.fillStyle = isDark ? '#e8e8e8' : '#171717';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('TOP ATTENTION PAIRS', PAD, PY + 9);

    const allPairs: { row: number; col: number; w: number }[] = [];
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        allPairs.push({ row: r, col: c, w: mat[r][c] });
    allPairs.sort((a, b) => b.w - a.w);
    const topK   = Math.min(6, allPairs.length);
    const labelW = 100;
    const barX   = PAD + labelW + 6;
    const barW   = W - barX - 52;
    const rowH   = (PH - 22) / topK;

    for (let k = 0; k < topK; k++) {
      const { row, col, w } = allPairs[k];
      const y = PY + 22 + k * rowH + rowH / 2;
      const label = `${FEATURES[row]}→${FEATURES[col]}`;

      ctx.fillStyle = isDark ? '#b0b0b0' : '#171717';
      ctx.font = `bold ${Math.min(11, Math.floor(rowH * 0.58))}px system-ui, sans-serif`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(label, PAD + labelW, y);

      ctx.fillStyle = isDark ? '#2e2e2e' : '#e5e5e5';
      ctx.fillRect(barX, y - rowH * 0.28, barW, rowH * 0.55);

      ctx.fillStyle = HEAD_COLORS[hc] + (k === 0 ? 'ff' : 'cc');
      ctx.fillRect(barX, y - rowH * 0.28, barW * (w / (maxW || 1)), rowH * 0.55);

      ctx.fillStyle = isDark ? '#b0b0b0' : '#171717';
      ctx.font = `bold 10px monospace`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(w.toFixed(3), barX + barW + 4, y);
    }

    // ── Divider 2 ──────────────────────────────────────────────────────────
    ctx.strokeStyle = isDark ? '#2e2e2e' : '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ZONE2); ctx.lineTo(W, ZONE2); ctx.stroke();

    // ── Zone 3: Dynamics chart (full width) ───────────────────────────────
    const DY     = ZONE2 + PAD;
    const DH     = H - DY - 10;
    const DX     = 40;
    const DW     = W - DX - 88;

    ctx.fillStyle = isDark ? '#e8e8e8' : '#171717';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('ATTENTION DYNAMICS', DX, DY + 9);

    const chartY = DY + 18;
    const chartH = DH - 22;
    const chartX = DX;
    const chartW = DW;

    const allVals = pairHistRef.current.flat();
    const dynMax  = Math.max(...allVals, 0.01);

    [0, 0.25, 0.5, 0.75, 1].forEach(p => {
      const y = chartY + chartH * (1 - p);
      ctx.strokeStyle = isDark ? '#2e2e2e' : '#f5f5f5';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(chartX, y); ctx.lineTo(chartX + chartW, y); ctx.stroke();
      if (p > 0) {
        ctx.fillStyle = isDark ? '#b0b0b0' : '#171717';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText((dynMax * p).toFixed(3), chartX - 3, y);
      }
    });

    ctx.strokeStyle = isDark ? '#3a3a3a' : '#e5e5e5';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(chartX + chartW, chartY); ctx.lineTo(chartX + chartW, chartY + chartH); ctx.stroke();
    ctx.setLineDash([]);

    pairHistRef.current.forEach((hist, k) => {
      if (hist.every(v => v === 0)) return;
      const color = PAIR_COLORS[k];

      ctx.beginPath();
      hist.forEach((val, i) => {
        const x = chartX + (i / (HISTORY - 1)) * chartW;
        const y = chartY + chartH * (1 - val / dynMax);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.lineTo(chartX + chartW, chartY + chartH);
      ctx.lineTo(chartX, chartY + chartH);
      ctx.closePath();
      const areaGrad = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
      areaGrad.addColorStop(0, color + '22');
      areaGrad.addColorStop(1, color + '00');
      ctx.fillStyle = areaGrad;
      ctx.fill();

      ctx.beginPath();
      hist.forEach((val, i) => {
        const x = chartX + (i / (HISTORY - 1)) * chartW;
        const y = chartY + chartH * (1 - val / dynMax);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const lastVal = hist[hist.length - 1];
      const dotX    = chartX + chartW;
      const dotY    = chartY + chartH * (1 - lastVal / dynMax);
      ctx.beginPath();
      ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });

    const LX = chartX + chartW + 8;
    PAIR_LABELS.forEach((label, k) => {
      const ly = chartY + 12 + k * 20;
      ctx.fillStyle = PAIR_COLORS[k];
      ctx.fillRect(LX, ly - 1, 14, 3);
      ctx.fillStyle = isDark ? '#e8e8e8' : '#171717';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, LX + 17, ly);
    });

    ctx.fillStyle = isDark ? '#808080' : '#a3a3a3';
    ctx.font = '7px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`← last ${HISTORY} bars`, chartX + chartW / 2, chartY + chartH + 10);
  }, [isDark]);

  const drawHeadsView = useCallback((
    ctx: CanvasRenderingContext2D, W: number, H: number,
    t: number, prog: number
  ) => {
    const cols = 2; const rows = 2;
    const cW = W / cols; const cH = H / rows;

    for (let hi = 0; hi < N_HEADS; hi++) {
      const col = hi % cols; const row = Math.floor(hi / cols);
      const bx0 = col * cW; const by0 = row * cH;

      // Flat neutral panel fill (no head-coloured wash; terminal chrome stays neutral)
      ctx.fillStyle = '#212121';
      ctx.fillRect(bx0 + 1, by0 + 1, cW - 2, cH - 2);

      // Head label (top-left of panel)
      ctx.fillStyle = HEAD_COLORS[hi];
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`${HEAD_LABELS[hi]}: ${HEAD_NAMES[hi]}`, bx0 + 8, by0 + 8);

      // Get interpolated matrix for this head
      const matA = computeAttentionMatrix(t, hi);
      const matB = computeAttentionMatrix(t + 1, hi);
      const mat  = lerpMatrix(matA, matB, prog);
      const flat = mat.flat();
      const minW = Math.min(...flat); const maxW = Math.max(...flat);

      const box: GridLayout = {
        x0: bx0, y0: by0 + 6,
        x1: bx0 + cW - 2, y1: by0 + cH - 2,
      };
      drawGrid(ctx, mat, minW, maxW, box, {
        headIdx: hi,
        clusterBoxes: false,
        labelL: 60, labelT: 56,
        fontSize: 10,
        isDark,
      });

      // Panel border: neutral edge; the coloured head label already identifies the panel
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx0 + 0.5, by0 + 0.5, cW - 1, cH - 1);
    }
  }, [isDark]);

  const drawProfileView = useCallback((
    ctx: CanvasRenderingContext2D, W: number, H: number, mat: number[][]
  ) => {
    const MID    = W / 2;
    const PAD    = 12;
    const LABEL  = 68;
    const barH   = Math.floor((H - 54) / N);
    const maxBarW = MID - LABEL - PAD * 2;
    const hc = headRef.current < N_HEADS ? headRef.current : 4;
    const color  = HEAD_COLORS[hc];

    // Column sums = attention RECEIVED by each feature
    const received = Array.from({ length: N }, (_, j) =>
      mat.reduce((s, row) => s + row[j], 0) / N
    );
    // Row sums = attention GIVEN by each feature
    const given = Array.from({ length: N }, (_, i) =>
      mat[i].reduce((a, b) => a + b, 0) / N
    );
    const rMax = Math.max(...received);
    const gMax = Math.max(...given);

    // Sort indices by descending received for left panel
    const sortedByReceived = Array.from({ length: N }, (_, i) => i)
      .sort((a, b) => received[b] - received[a]);

    // Sort indices by descending given for right panel
    const sortedByGiven = Array.from({ length: N }, (_, i) => i)
      .sort((a, b) => given[b] - given[a]);

    // Title row
    ctx.fillStyle = isDark ? '#808080' : '#a3a3a3';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('ATTENTION RECEIVED  (total inbound per feature)', PAD, 16);
    ctx.fillText('ATTENTION GIVEN  (total outbound per feature)', MID + PAD, 16);

    // Left: received bars
    sortedByReceived.forEach((fi, k) => {
      const y  = 32 + k * barH + barH / 2;
      const bx = PAD + LABEL;
      const bw = maxBarW * (received[fi] / (rMax || 1));

      ctx.fillStyle = isDark ? '#b0b0b0' : '#525252';
      ctx.font = `${Math.min(9, barH * 0.55)}px system-ui, sans-serif`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(FEATURES[fi], PAD + LABEL - 4, y);

      ctx.fillStyle = isDark ? '#2e2e2e' : '#f5f5f5';
      ctx.fillRect(bx, y - barH * 0.3, maxBarW, barH * 0.6);

      ctx.fillStyle = color + 'cc';
      ctx.fillRect(bx, y - barH * 0.3, bw, barH * 0.6);

      // Is this feature in the focused group?
      const isHead = headRef.current < N_HEADS && HEAD_BIAS[headRef.current]?.includes(fi);
      if (isHead) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, y - barH * 0.3, maxBarW, barH * 0.6);
      }

      ctx.fillStyle = isDark ? '#808080' : '#a3a3a3';
      ctx.font = '7px monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(received[fi].toFixed(3), bx + bw + 3, y);
    });

    // Vertical divider
    ctx.strokeStyle = isDark ? '#2e2e2e' : '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(MID, 8); ctx.lineTo(MID, H - 8); ctx.stroke();

    // Right: given bars
    sortedByGiven.forEach((fi, k) => {
      const y  = 32 + k * barH + barH / 2;
      const bx = MID + PAD + LABEL;
      const bw = maxBarW * (given[fi] / (gMax || 1));

      ctx.fillStyle = isDark ? '#b0b0b0' : '#525252';
      ctx.font = `${Math.min(9, barH * 0.55)}px system-ui, sans-serif`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(FEATURES[fi], MID + PAD + LABEL - 4, y);

      ctx.fillStyle = isDark ? '#2e2e2e' : '#f5f5f5';
      ctx.fillRect(bx, y - barH * 0.3, maxBarW, barH * 0.6);

      ctx.fillStyle = color + '99';
      ctx.fillRect(bx, y - barH * 0.3, bw, barH * 0.6);

      const isHead = headRef.current < N_HEADS && HEAD_BIAS[headRef.current]?.includes(fi);
      if (isHead) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, y - barH * 0.3, maxBarW, barH * 0.6);
      }

      ctx.fillStyle = isDark ? '#808080' : '#a3a3a3';
      ctx.font = '7px monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(given[fi].toFixed(3), bx + bw + 3, y);
    });
  }, [isDark]);

  // ── Main draw dispatcher ───────────────────────────────────────────────────

  const draw = useCallback((prog: number, t: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.width  / dpr;
    const H   = canvas.height / dpr;

    // Get current matrix (interpolated between ticks)
    const mat  = lerpMatrix(getMatrix(t, headRef.current), getMatrix(t + 1, headRef.current), prog);
    const flat = mat.flat();
    const minW = Math.min(...flat);
    const maxW = Math.max(...flat);
    const ent  = entropy(mat);

    // Top pair for stats bar
    let topRow = 0, topCol = 0;
    flat.forEach((v, idx) => { if (v > mat[topRow][topCol]) { topRow = Math.floor(idx / N); topCol = idx % N; } });
    const topPair = `${FEATURES[topRow]} → ${FEATURES[topCol]}`;

    // Update stats (throttled to avoid too many re-renders)
    statsRef.current = { maxW, minW, entropyVal: ent, topPair };

    // Background
    // Flat terminal bg (var(--bg) fallback; canvas cannot resolve CSS vars)
    ctx.fillStyle = isDark ? '#1c1c1c' : '#fafafa';
    ctx.fillRect(0, 0, W, H);

    const v = viewRef.current;
    if (v === 'heatmap')  drawHeatmapView(ctx, W, H, mat, minW, maxW);
    else if (v === 'heads')   drawHeadsView(ctx, W, H, t, prog);
    else                      drawProfileView(ctx, W, H, mat);

    // Tick progress strip at very bottom of canvas
    ctx.fillStyle = isDark ? '#2e2e2e' : '#e5e5e5';
    ctx.fillRect(0, H - 3, W, 3);
    ctx.fillStyle = HEAD_COLORS[headRef.current < N_HEADS ? headRef.current : 4];
    ctx.fillRect(0, H - 3, W * prog, 3);
  }, [isDark, getMatrix, drawHeatmapView, drawHeadsView, drawProfileView]);

  // ── Animation loop ─────────────────────────────────────────────────────────

  const animate = useCallback((time: number) => {
    if (!lastTimeRef.current) lastTimeRef.current = time;
    const dt = time - lastTimeRef.current;
    lastTimeRef.current = time;

    if (playingRef.current) {
      progressRef.current += dt / (1000 / speedRef.current);
      if (progressRef.current >= 1) {
        progressRef.current -= 1;
        tickRef.current += 1;
        setTick(t => t + 1);
        // Record entropy for history chart
        const mat = getMatrix(tickRef.current, headRef.current);
        const e   = entropy(mat);
        entropyRef.current = [...entropyRef.current.slice(-(HISTORY - 1)), e];
        // Record each tracked pair's weight for the dynamics chart
        TRACKED_PAIRS.forEach(([r, c], k) => {
          const w = mat[r][c];
          pairHistRef.current[k] = [...pairHistRef.current[k].slice(-(HISTORY - 1)), w];
        });
      }
    }

    draw(progressRef.current, tickRef.current);
    // Sync stats to React state (cheap, just primitives)
    const s = statsRef.current;
    setStats({ maxW: s.maxW, minW: s.minW, entropyVal: s.entropyVal, topPair: s.topPair });

    animRef.current = requestAnimationFrame(animate);
  }, [draw, getMatrix]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [animate]);

  // ── Canvas resize ──────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap   = wrapRef.current;
    if (!canvas || !wrap) return;

    const resize = () => {
      const dpr  = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      const h    = Math.min(Math.max(rect.width * 1.6, 680), window.innerHeight * 0.88, 1080);
      canvas.width  = rect.width * dpr;
      canvas.height = h * dpr;
      canvas.style.width  = `${rect.width}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr); }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ── Mouse hover (heatmap view only) ───────────────────────────────────────

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (viewRef.current !== 'heatmap') { hoverRef.current = null; setHover(null); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect  = canvas.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const W     = rect.width;
    const H     = rect.height;
    const ZONE1 = H * 0.36;  // grid zone (portrait layout: top 36%)
    const LL = 56; const LT = 52;
    const gW = (W - 18) - LL - 4;
    const gH = ZONE1 - LT - 4;
    const gX = LL; const gY = LT;
    const cW = gW / N; const cH = gH / N;

    if (mx < gX || mx > gX + gW || my < gY || my > ZONE1) {
      hoverRef.current = null; setHover(null); return;
    }
    const col = Math.floor((mx - gX) / cW);
    const row = Math.floor((my - gY) / cH);
    if (col < 0 || col >= N || row < 0 || row >= N) { hoverRef.current = null; setHover(null); return; }

    const mat = lerpMatrix(
      getMatrix(tickRef.current, headRef.current),
      getMatrix(tickRef.current + 1, headRef.current),
      progressRef.current
    );
    hoverRef.current = { row, col };
    setHover({ row, col, w: mat[row][col] });
  }, [getMatrix]);

  const onMouseLeave = useCallback(() => {
    hoverRef.current = null; setHover(null);
  }, []);

  // ── Controls ───────────────────────────────────────────────────────────────

  const togglePlay = () => setPlaying(p => !p);
  const step = () => {
    if (playingRef.current) return;
    progressRef.current = 0; tickRef.current += 1; setTick(t => t + 1);
  };
  const reset = () => {
    tickRef.current = 0; progressRef.current = 0;
    entropyRef.current  = initEntropyHistory();
    pairHistRef.current = initPairHistory();
    setTick(0); setPlaying(false); lastTimeRef.current = undefined;
  };
  const handleSpeed  = (v: number[]) => { setSpeed(v[0]);  speedRef.current  = v[0]; };
  const handleHead   = (h: number)   => { setHead(h);      headRef.current   = h;    };
  const handleView   = (v: View)     => { setView(v);      viewRef.current   = v;    };

  // ── Render ─────────────────────────────────────────────────────────────────

  const VIEW_TABS: { id: View; label: string }[] = [
    { id: 'heatmap',  label: 'Heatmap' },
    { id: 'heads',    label: 'Head Compare' },
    { id: 'profile',  label: 'Feature Profile' },
  ];

  return (
    <Card className="bg-background border-border overflow-hidden">

      {/* ── Top controls ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border">

        {/* View tabs */}
        <div className="flex items-center gap-1 mr-2">
          {VIEW_TABS.map(vt => (
            <button
              key={vt.id}
              onClick={() => handleView(vt.id)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                view === vt.id
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {vt.label}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-border" />

        {/* Head selector (only relevant for heatmap + profile views) */}
        {view !== 'heads' && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground mr-0.5">Head</span>
              {HEAD_LABELS.map((label, i) => (
                <button
                  key={label}
                  onClick={() => handleHead(i)}
                  className="px-2 py-0.5 rounded text-xs font-mono transition-colors"
                  style={{
                    // Selected chip: neutral hover bg + head-coloured text, no solid colour fill
                    background: head === i ? 'var(--hover)' : '',
                    color: head === i ? HEAD_COLORS[i] : '',
                    opacity: head === i ? 1 : 0.6,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="w-px h-4 bg-border" />
          </>
        )}

        {/* Speed */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Speed</span>
          <div className="w-20">
            <Slider min={0.2} max={3} step={0.1} value={[speed]} onValueChange={handleSpeed} />
          </div>
          <span className="text-xs font-mono text-muted-foreground w-7">{speed.toFixed(1)}x</span>
        </div>

        <div className="w-px h-4 bg-border" />

        {/* Transport */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={togglePlay}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={step} disabled={playing}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Title */}
        <span className="ml-3 text-xs font-medium text-muted-foreground/70 tracking-wide hidden sm:inline">
          Transformer Attention
        </span>

        {/* Live badge */}
        <div className="ml-auto flex items-center gap-1.5">
          {playing && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: HEAD_COLORS[head < N_HEADS ? head : 4] }} />
              <span className="relative inline-flex rounded-full h-2 w-2"
                style={{ background: HEAD_COLORS[head < N_HEADS ? head : 4] }} />
            </span>
          )}
          <span className="text-xs font-mono text-muted-foreground">
            {playing ? 'LIVE' : `bar ${tick}`}
          </span>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div ref={wrapRef} className="relative w-full px-2 pt-1 pb-0">
        <canvas
          ref={canvasRef}
          className="w-full block"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />

        {/* Hover tooltip (heatmap view only) */}
        {view === 'heatmap' && hover && (
          <div className="pointer-events-none absolute top-2 right-3 bg-popover border border-border rounded px-3 py-2 text-xs font-mono shadow-lg">
            <div className="text-muted-foreground mb-0.5">
              <span className="text-foreground font-semibold">{FEATURES[hover.row]}</span>
              {' attends to '}
              <span className="text-foreground font-semibold">{FEATURES[hover.col]}</span>
            </div>
            <div className="text-xl font-bold" style={{ color: HEAD_COLORS[head < N_HEADS ? head : 4] }}>
              {hover.w.toFixed(4)}
            </div>
            <div className="text-muted-foreground text-[10px] mt-0.5">
              {HEAD_LABELS[head]} softmax weight
            </div>
          </div>
        )}
      </div>

      {/* ── Stats bar (like HMM's bottom status strip) ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-t border-border bg-muted/20 font-mono text-xs">
        <span className="text-muted-foreground">
          t <span className="text-foreground font-semibold">{tick}</span>
        </span>
        <span className="text-muted-foreground">
          Head <span className="font-semibold" style={{ color: HEAD_COLORS[head < N_HEADS ? head : 4] }}>
            {HEAD_LABELS[head]}
          </span>
        </span>
        <span className="text-muted-foreground">
          Max <span className="text-foreground">{stats.maxW.toFixed(4)}</span>
        </span>
        <span className="text-muted-foreground">
          Min <span className="text-foreground">{stats.minW.toFixed(4)}</span>
        </span>
        <span className="text-muted-foreground">
          Entropy <span className="text-foreground">{stats.entropyVal.toFixed(2)}</span>
          <span className="text-muted-foreground/50"> bits</span>
        </span>
        {view === 'heatmap' && stats.topPair && (
          <span className="text-muted-foreground">
            Top <span className="text-foreground">{stats.topPair}</span>
          </span>
        )}
        <div className="ml-auto text-muted-foreground/50 text-[10px]">
          A = softmax(QK&#x1D40; / &radic;d&#x2096;)&nbsp;&nbsp;H=4&nbsp;&nbsp;d&#x2096;=3
        </div>
      </div>

    </Card>
  );
}
