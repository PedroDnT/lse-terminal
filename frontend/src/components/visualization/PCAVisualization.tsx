// ============================================================================
// PCAVisualization - RESEARCH > QUANT MODELS > PCA Factor Structure.
//
// Parametric mode: a synthetic 3-factor point cloud whose factor variances
// and noise the user drives with sliders; the recovered principal axes are
// re-estimated live from the cloud (3x3 Jacobi), so dragging "Factor 1
// variance" visibly stretches the cigar AND swings the PC1 arrow onto it.
// That is the whole idea of PCA in one picture.
//
// Fitted mode (engine fit_pca payload): every bar of the user's aligned
// universe (or curve columns) projected onto PC1-3, colored by that bar's
// mean cross-sectional move (product up/down colors, gray at zero), with a
// fading trail through the most recent bars. Scores arrive in PC units;
// axes are normalized per-axis by default so structure stays visible, with
// a true-scale switch that shows honest relative variance as elongation.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Billboard, OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, ChevronUp, Settings, RotateCcw, BarChart3, Play, Pause } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export type PCAFitPayload = {
  kind: 'instruments' | 'columns';
  names: string[];
  tf: string;
  n_bars: number;
  var_pct: number[];
  eff_dim: number;
  mp_edge: number;
  signal_factors: number;
  loadings: { pc1: number[]; pc2: number[]; pc3: number[] };
  scores: [number, number, number][];
  color: number[];
  color_label: string;
  color_lim: number;
  // Epoch seconds per point (newer engines only); drives the time sweep.
  ts?: number[];
};

function cssColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Diverging point color: down-pole -> neutral gray -> up-pole, the product's
// own market colors. t in [-1, 1].
function divergingColor(t: number, up: THREE.Color, down: THREE.Color, mid: THREE.Color): THREE.Color {
  const c = mid.clone();
  if (t < 0) c.lerp(down, Math.min(1, -t));
  else c.lerp(up, Math.min(1, t));
  return c;
}

// Symmetric 3x3 eigendecomposition (cyclic Jacobi). Small enough to run per
// slider tick; returns eigenvalues descending with column eigenvectors.
function eig3(m: number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((r) => [...r]);
  let v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (let p = 0; p < 2; p++)
      for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-14) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const pairs = [0, 1, 2].map((i) => ({ val: a[i][i], vec: [v[0][i], v[1][i], v[2][i]] }));
  pairs.sort((x, y) => y.val - x.val);
  return { values: pairs.map((p) => Math.max(0, p.val)), vectors: pairs.map((p) => p.vec) };
}

// Deterministic pseudo-random stream so the demo cloud is stable across
// renders and slider moves reshape the SAME points instead of resampling.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ImmersiveGrid({ size = 20 }: { size?: number }) {
  return (
    <group>
      <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[0, -size / 4, 0]} />
      <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[0, size / 4, -size / 2]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}

function PointCloud({ positions, colors, size, onMesh, onHover }: {
  positions: Float32Array; colors: Float32Array; size: number;
  // Hands the InstancedMesh to the parent so the time-sweep animation can
  // drive mesh.count imperatively without a React render per frame.
  onMesh?: (m: THREE.InstancedMesh) => void;
  // Instance under the pointer (null on leave) with client coordinates;
  // drives the per-bar hover card in fitted mode.
  onHover?: (i: number | null, x: number, y: number) => void;
}) {
  // Lit instanced spheres instead of flat point sprites: each bar is a small
  // shaded ball, so the cloud reads as a sculpture with real depth instead of
  // confetti. A few thousand
  // instances of a 12x8 sphere is nothing for the GPU.
  const mesh = useMemo(() => {
    const n = positions.length / 3;
    const geo = new THREE.SphereGeometry(size, 12, 8);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.12 });
    const m = new THREE.InstancedMesh(geo, mat, n);
    const t = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      t.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      t.updateMatrix();
      m.setMatrixAt(i, t.matrix);
      c.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
      m.setColorAt(i, c);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    return m;
  }, [positions, colors, size]);
  useEffect(() => { onMesh?.(mesh); }, [mesh, onMesh]);
  return (
    <primitive
      object={mesh}
      onPointerMove={onHover ? (e: { instanceId?: number; clientX: number; clientY: number; stopPropagation: () => void }) => {
        e.stopPropagation();
        onHover(e.instanceId ?? null, e.clientX, e.clientY);
      } : undefined}
      onPointerOut={onHover ? () => onHover(null, 0, 0) : undefined}
    />
  );
}

// A THREE.Line built imperatively and mounted via <primitive>: r3f's
// lowercase <line> intrinsic collides with the SVG line element in TSX.
function Line3({ pts, color, opacity = 1 }: { pts: Float32Array; color: string; opacity?: number }) {
  const obj = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  }, [pts, color, opacity]);
  return <primitive object={obj} />;
}

const WORLD = 6; // half-extent the cloud is normalized into, world units

export default function PCAVisualization({ fitted }: { fitted?: PCAFitPayload }) {
  const [showParams, setShowParams] = useState(true);
  const [showStats, setShowStats] = useState(true);
  // Off by default: consecutive bars jump across factor space (returns are
  // noise-dominated bar to bar), so the connected path reads as a web, not
  // a trajectory. The switch is there for slow-moving curve data.
  const [trail, setTrail] = useState(false);
  const [trueScale, setTrueScale] = useState(false);
  const controlsRef = useRef<{ reset: () => void } | null>(null);

  // Demo dials: the variance each latent factor pumps into the cloud.
  const [f1, setF1] = useState(2.2);
  const [f2, setF2] = useState(1.1);
  const [f3, setF3] = useState(0.45);
  const [noise, setNoise] = useState(0.25);
  const [nPts, setNPts] = useState(900);

  const tokens = useMemo(() => ({
    up: new THREE.Color(cssColor('--up', '#21b3a4')),
    down: new THREE.Color(cssColor('--down', '#f0426c')),
    mid: new THREE.Color(cssColor('--dim', '#b0b0b0')),
    text: cssColor('--text', '#e8e8e8'),
    dim: cssColor('--dim', '#b0b0b0'),
    edge: cssColor('--edge', '#3a3a3a'),
  }), []);

  // ---- DEMO: synthetic cloud + live-recovered principal axes -------------
  const demo = useMemo(() => {
    if (fitted) return null;
    const rnd = mulberry32(1337);
    const gauss = () => {
      // Box-Muller on the deterministic stream.
      const u = Math.max(rnd(), 1e-9), w = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
    };
    // Fixed rotation so the latent factors are NOT axis-aligned: the point
    // is watching PCA find them anyway.
    const e = new THREE.Euler(0.55, 0.65, 0.25);
    const R = new THREE.Matrix4().makeRotationFromEuler(e);
    const pos = new Float32Array(nPts * 3);
    const col = new Float32Array(nPts * 3);
    const raw: [number, number, number][] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < nPts; i++) {
      const z1 = gauss() * f1, z2 = gauss() * f2, z3 = gauss() * f3;
      v.set(z1 + gauss() * noise, z2 + gauss() * noise, z3 + gauss() * noise);
      v.applyMatrix4(R);
      raw.push([v.x, v.y, v.z]);
    }
    // Sample covariance of what was actually drawn, then eigendecompose:
    // the arrows are DISCOVERED from the cloud, not copied from the sliders.
    const mean = [0, 1, 2].map((k) => raw.reduce((s, p) => s + p[k], 0) / nPts);
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of raw)
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++)
          C[a][b] += (p[a] - mean[a]) * (p[b] - mean[b]) / (nPts - 1);
    const { values, vectors } = eig3(C);
    const spread = Math.sqrt(values[0]) * 2.6 || 1;
    const s = WORLD / spread;
    for (let i = 0; i < nPts; i++) {
      pos[i * 3] = (raw[i][0] - mean[0]) * s;
      pos[i * 3 + 1] = (raw[i][1] - mean[1]) * s;
      pos[i * 3 + 2] = (raw[i][2] - mean[2]) * s;
      // Color by the point's coordinate along PC1: the cloud itself shows
      // what "the first factor" means before any real data is involved.
      const proj = (raw[i][0] - mean[0]) * vectors[0][0] + (raw[i][1] - mean[1]) * vectors[0][1]
        + (raw[i][2] - mean[2]) * vectors[0][2];
      const t = Math.max(-1, Math.min(1, proj / (Math.sqrt(values[0]) * 2 || 1)));
      const c = divergingColor(t, tokens.up, tokens.down, tokens.mid);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const total = values[0] + values[1] + values[2] || 1;
    const axes = vectors.map((vec, k) => {
      const len = Math.sqrt(values[k]) * 2.2 * s;
      return {
        tip: [vec[0] * len, vec[1] * len, vec[2] * len] as [number, number, number],
        neg: [-vec[0] * len, -vec[1] * len, -vec[2] * len] as [number, number, number],
        pct: (values[k] / total) * 100,
      };
    });
    return { pos, col, axes, varPct: values.map((x) => (x / total) * 100) };
  }, [fitted, f1, f2, f3, noise, nPts, tokens]);

  // ---- FITTED: the user's bars in factor space ---------------------------
  const fit = useMemo(() => {
    if (!fitted) return null;
    const n = fitted.scores.length;
    const std = [0, 1, 2].map((k) => {
      let s = 0, s2 = 0;
      for (const p of fitted.scores) { s += p[k]; s2 += p[k] * p[k]; }
      const m = s / n;
      return Math.sqrt(Math.max(s2 / n - m * m, 1e-12));
    });
    // Normalized: each axis on its own 3-sigma so PC3 structure survives
    // next to PC1. True scale: shared PC1 sigma, honest elongation.
    const div = trueScale
      ? [std[0] * 3, std[0] * 3, std[0] * 3]
      : [std[0] * 3, std[1] * 3, std[2] * 3];
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const lim = fitted.color_lim || 1;
    for (let i = 0; i < n; i++) {
      const p = fitted.scores[i];
      pos[i * 3] = (p[0] / div[0]) * WORLD;
      pos[i * 3 + 1] = (p[1] / div[1]) * WORLD;
      pos[i * 3 + 2] = (p[2] / div[2]) * WORLD;
      const cv = fitted.color[i];
      const t = Number.isFinite(cv) ? Math.max(-1, Math.min(1, cv / lim)) : 0;
      const c = divergingColor(t, tokens.up, tokens.down, tokens.mid);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    // The single farthest bar gets named on the canvas: a claim about one
    // sphere is worthless if the viewer cannot tell which sphere it is.
    let extremeIdx = 0, extremeD = -1;
    for (let i = 0; i < n; i++) {
      const d = pos[i * 3] ** 2 + pos[i * 3 + 1] ** 2 + pos[i * 3 + 2] ** 2;
      if (d > extremeD) { extremeD = d; extremeIdx = i; }
    }
    const et = fitted.ts?.[extremeIdx];
    const extreme = {
      idx: extremeIdx,
      pos: [pos[extremeIdx * 3], pos[extremeIdx * 3 + 1], pos[extremeIdx * 3 + 2]] as [number, number, number],
      label: et
        ? new Date(et * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        : '',
    };
    return { pos, col, n, extreme, std };
  }, [fitted, trueScale, tokens]);

  // Trail over the FULL point buffer with a drawRange window: idle it shows
  // the last 100 bars; during the time sweep it follows the reveal.
  const trailLine = useMemo(() => {
    if (!fit) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(fit.pos, 3));
    g.setDrawRange(Math.max(0, fit.n - 100), Math.min(100, fit.n));
    return new THREE.Line(g, new THREE.LineBasicMaterial({
      color: tokens.text, transparent: true, opacity: 0.35 }));
  }, [fit, tokens]);

  // ---- Time sweep: Play reveals the bars in
  // chronological order with the date on screen. All per-frame work is
  // imperative (mesh.count, trail drawRange, overlay text); React state only
  // flips the Play/Pause button.
  const [playing, setPlaying] = useState(false);
  const anim = useRef({ i: -1 });
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const dateRef = useRef<HTMLDivElement | null>(null);

  const applyFrame = (i: number) => {
    if (!fit) return;
    anim.current.i = i;
    if (meshRef.current) meshRef.current.count = i;
    if (trailLine) trailLine.geometry.setDrawRange(Math.max(0, i - 100), Math.min(100, i));
    const el = dateRef.current;
    if (el) {
      el.style.display = 'block';
      const t = fitted?.ts?.[i - 1];
      const v = fitted?.color?.[i - 1];
      const when = t
        ? new Date(t * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : `bar ${i} of ${fit.n}`;
      el.textContent = Number.isFinite(v) ? `${when}   ${(v as number).toFixed(2)}` : when;
    }
  };

  // Rebuilds (true-scale toggle) recreate the mesh; re-apply the current
  // sweep position so the reveal survives the swap.
  const onFittedMesh = (m: THREE.InstancedMesh) => {
    meshRef.current = m;
    if (fit && anim.current.i >= 0) m.count = anim.current.i;
  };

  useEffect(() => {
    if (!playing || !fit) return;
    // Full sweep in roughly 24 seconds at 60 frames per second.
    const step = Math.max(1, Math.round(fit.n / 1440));
    let raf = 0;
    const tick = () => {
      let i = anim.current.i + step;
      if (i >= fit.n) { i = fit.n; applyFrame(i); setPlaying(false); return; }
      applyFrame(i);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // applyFrame closes over current fit/trailLine; both are deps via fit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, fit]);

  // Per-bar hover card: written imperatively into hoverRef so pointer moves
  // never trigger React renders.
  const hoverRef = useRef<HTMLDivElement | null>(null);
  const onBarHover = (i: number | null, x: number, y: number) => {
    const el = hoverRef.current;
    if (!el) return;
    if (i == null || !fit || !fitted) { el.style.display = 'none'; return; }
    const wrap = el.parentElement;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const t = fitted.ts?.[i];
    const when = t
      ? new Date(t * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      : `bar ${i + 1} of ${fit.n}`;
    const v = fitted.color[i];
    const sc = fitted.scores[i];
    const sig = (k: number) => {
      const z = sc[k] / (fit.std[k] || 1);
      return `${z > 0 ? '+' : ''}${z.toFixed(1)}\u03c3`;
    };
    el.innerHTML =
      `<div style="color:var(--text)">${when}</div>` +
      (Number.isFinite(v)
        ? `<div>${v > 0 ? '+' : ''}${v.toFixed(2)} ${fitted.color_label}</div>`
        : '') +
      `<div>PC1 ${sig(0)} &nbsp; PC2 ${sig(1)} &nbsp; PC3 ${sig(2)}</div>`;
    el.style.left = Math.min(x - r.left + 14, r.width - 190) + 'px';
    el.style.top = Math.max(y - r.top - 12, 6) + 'px';
    el.style.display = 'block';
  };

  const togglePlay = () => {
    if (!fit) return;
    if (playing) { setPlaying(false); return; }
    if (anim.current.i < 0 || anim.current.i >= fit.n) applyFrame(0);
    setPlaying(true);
  };

  const varPct: number[] = fitted ? fitted.var_pct : (demo ? demo.varPct : []);
  const axisLabel = (k: number) =>
    `PC${k + 1}${varPct[k] != null ? ' ' + varPct[k].toFixed(1) + '%' : ''}`;

  // Fitted axes are the coordinate axes (scores already live in PC basis).
  const AXIS_LEN = WORLD * 1.15;
  const fittedAxes: [number, number, number][] = [
    [AXIS_LEN, 0, 0], [0, AXIS_LEN, 0], [0, 0, AXIS_LEN]];

  // Loadings, largest first, for the stats card (fitted only).
  const topLoads = useMemo(() => {
    if (!fitted) return null;
    return (['pc1', 'pc2', 'pc3'] as const).map((key) => {
      const vec = fitted.loadings[key] || [];
      return vec.map((v, i) => ({ name: fitted.names[i], v }))
        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 4);
    });
  }, [fitted]);

  return (
    <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[var(--bg)] rounded-lg overflow-hidden border border-border">
      <Canvas camera={{ position: [13, 9, 13], fov: 45 }} style={{ background: 'var(--bg, #1c1c1c)' }}>
        {/* Sphere shading needs directional form light, same rig as the
            surface views; ambient alone flattens the sculpture back out. */}
        <ambientLight intensity={0.45} />
        <pointLight position={[10, 20, 10]} intensity={1.1} />
        <directionalLight position={[-10, 15, 10]} intensity={0.7} />
        <directionalLight position={[10, -10, -10]} intensity={0.25} />

        <ImmersiveGrid size={20} />

        {demo && (
          <>
            <PointCloud positions={demo.pos} colors={demo.col} size={0.11} />
            {demo.axes.map((a, k) => (
              <group key={k}>
                <Line3 pts={new Float32Array([...a.neg, ...a.tip])} color={tokens.text} opacity={k === 0 ? 0.9 : 0.55} />
                <Text position={a.tip} fontSize={0.42} color={tokens.dim} anchorX="left">
                  {'  PC' + (k + 1) + ' ' + a.pct.toFixed(0) + '%'}
                </Text>
              </group>
            ))}
          </>
        )}

        {fit && fitted && (
          <>
            <PointCloud positions={fit.pos} colors={fit.col} size={0.13} onMesh={onFittedMesh} onHover={onBarHover} />
            {fittedAxes.map((tip, k) => (
              <group key={k}>
                <Line3
                  pts={new Float32Array([-tip[0], -tip[1], -tip[2], tip[0], tip[1], tip[2]])}
                  color={tokens.edge} opacity={0.9}
                />
                <Text position={tip} fontSize={0.42} color={tokens.dim} anchorX="left">
                  {'  ' + axisLabel(k)}
                </Text>
              </group>
            ))}
            {trail && trailLine && <primitive object={trailLine} />}
            {fit.extreme.label && !playing && (
              <Billboard position={[fit.extreme.pos[0], fit.extreme.pos[1] + 0.7, fit.extreme.pos[2]]}>
                <Text fontSize={0.55} color={tokens.text} anchorX="center">
                  {fit.extreme.label}
                </Text>
              </Billboard>
            )}
          </>
        )}

        <OrbitControls ref={controlsRef as never} enablePan enableZoom enableRotate minDistance={4} maxDistance={50} />
      </Canvas>

      {/* Floating header */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        {/* One quiet name, both modes; no mode narration, no tooltip. */}
        <div className="rounded px-2.5 py-1 border border-border text-xs"
             style={{ background: 'var(--panel)', color: 'var(--dim)' }}>
          Principal Component Analysis
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {fitted && (
            <Button variant="outline" size="sm" onClick={togglePlay} className="bg-card text-[var(--text)] hover:text-[var(--text)]">
              {playing ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              {playing ? 'Pause' : 'Play'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => controlsRef.current?.reset()} className="bg-card text-[var(--text)] hover:text-[var(--text)]">
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset View
          </Button>
        </div>
      </div>

      {/* Left panel: demo sliders only. The fitted-mode View card (true
          scale + trail switches) was removed as clutter on the canvas;
          the defaults stand (per-axis scale, no trail). */}
      {!fitted && (
      <div className="absolute left-4 top-20 w-72 space-y-2 pointer-events-auto">
        <Collapsible open={showParams} onOpenChange={setShowParams}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)] hover:text-[var(--text)]">
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Factor Parameters
              </span>
              {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[var(--text)]">
              {!fitted && (
                <>
                  {([
                    ['Factor 1 Variance', f1, setF1, 0.2, 3],
                    ['Factor 2 Variance', f2, setF2, 0.1, 3],
                    ['Factor 3 Variance', f3, setF3, 0.05, 3],
                    ['Noise', noise, setNoise, 0, 1.5],
                  ] as [string, number, (v: number) => void, number, number][]).map(([label, val, set, min, max]) => (
                    <div className="space-y-2" key={label}>
                      <div className="flex justify-between">
                        <Label className="text-xs text-[var(--dim)]">{label}</Label>
                        <span className="text-xs font-medium text-[var(--text)]">{val.toFixed(2)}</span>
                      </div>
                      <Slider value={[val]} onValueChange={([v]) => set(v)} min={min} max={max} step={0.05} />
                    </div>
                  ))}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-xs text-[var(--dim)]">Points</Label>
                      <span className="text-xs font-medium text-[var(--text)]">{nPts}</span>
                    </div>
                    <Slider value={[nPts]} onValueChange={([v]) => setNPts(v)} min={200} max={3000} step={100} />
                  </div>
                </>
              )}
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>
      )}

      {/* Right panel: statistics + loadings */}
      <div className="absolute right-4 top-20 w-64 space-y-2 pointer-events-auto">
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)] hover:text-[var(--text)]">
              <span className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Statistics
              </span>
              {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-1.5 text-[var(--text)]">
              {varPct.slice(0, 3).map((v, k) => (
                <div key={k} className="flex justify-between text-xs">
                  <span style={{ color: 'var(--dim)' }}>PC{k + 1} variance</span>
                  <span className="font-medium">{v.toFixed(1)}%</span>
                </div>
              ))}
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--dim)' }}>Top 3 together</span>
                <span className="font-medium">
                  {varPct.slice(0, 3).reduce((s, x) => s + x, 0).toFixed(1)}%
                </span>
              </div>
              {fitted && (
                <>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--dim)' }}>Effective factors</span>
                    <span className="font-medium">{fitted.eff_dim}</span>
                  </div>
                  {/* Cutoff rows removed: the Marchenko Pastur story is
                      told from the CLASSICS entry in RESEARCH > ARTICLES
                      instead of a stat row here. */}
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--dim)' }}>Bars</span>
                    <span className="font-medium">{fitted.n_bars.toLocaleString()} ({fitted.tf})</span>
                  </div>
                  <div className="pt-2" style={{ borderTop: '1px solid var(--edge)' }}>
                    <div className="text-[10px] tracking-widest pb-1" style={{ color: 'var(--dim)' }}>
                      COLOR: {fitted.color_label.toUpperCase()}
                    </div>
                    <div style={{
                      height: 8, borderRadius: 2, border: '1px solid var(--edge)',
                      background: 'linear-gradient(90deg, var(--down), var(--dim), var(--up))',
                    }} />
                    <div className="flex justify-between text-[10px]" style={{ color: 'var(--dim)' }}>
                      <span>-{fitted.color_lim}</span><span>0</span><span>+{fitted.color_lim}</span>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </CollapsibleContent>
        </Collapsible>

        {fitted && topLoads && (
          <Card className="p-4 bg-card border-border text-[var(--text)]">
            {topLoads.map((rows, k) => (
              <div key={k} className={k ? 'pt-2' : ''}>
                <div className="text-[10px] tracking-widest pb-1" style={{ color: 'var(--dim)' }}>
                  PC{k + 1} DRIVERS
                </div>
                {rows.map((r) => (
                  <div key={r.name} className="flex items-center gap-2 py-0.5">
                    <span className="text-[11px] truncate" style={{ width: 92 }}>{r.name}</span>
                    <span style={{ flex: 1, position: 'relative', height: 4, background: 'var(--bg)', borderRadius: 2 }}>
                      <i style={{
                        position: 'absolute', top: 0, height: '100%', left: '50%', borderRadius: 2,
                        width: Math.round(Math.abs(r.v) * 50) + '%',
                        background: r.v < 0 ? 'var(--down)' : 'var(--up)',
                        transform: r.v < 0 ? 'translateX(-100%)' : undefined,
                      }} />
                    </span>
                    <span className="text-[10px] tabular-nums" style={{ color: 'var(--dim)', width: 34, textAlign: 'right' }}>
                      {(r.v > 0 ? '+' : '') + r.v.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </Card>
        )}
      </div>

      {/* Per-bar hover card: filled imperatively by onBarHover. */}
      <div ref={hoverRef} className="absolute pointer-events-none bg-card rounded-lg px-3 py-2 border border-border"
           style={{ display: 'none', fontSize: 11.5, lineHeight: 1.6, color: 'var(--dim)',
                    fontVariantNumeric: 'tabular-nums', zIndex: 5, minWidth: 150 }} />

      {/* Time-sweep readout: date of the bar being revealed plus its color
          value; written imperatively by applyFrame, hidden until first Play. */}
      <div ref={dateRef} className="absolute bottom-4 left-4 pointer-events-none bg-card rounded-lg px-4 py-2 border border-border"
           style={{ display: 'none', color: 'var(--text)', fontSize: 15,
                    fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--mono)' }} />

      {/* Bottom hint strip, same idiom as the surface views */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
        <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-6 text-[11px]" style={{ color: 'var(--dim)' }}>
          <span>Drag to rotate</span>
          <span>Scroll to zoom</span>
          <span>Right-click to pan</span>
          <span>{fitted ? `Points: ${fitted.scores.length.toLocaleString()}` : `Points: ${nPts.toLocaleString()}`}</span>
        </div>
      </div>
    </div>
  );
}
