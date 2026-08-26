import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Info, ChevronDown, ChevronUp, Settings, Eye, RotateCcw, Grid3X3, Box, Play, Pause, Shuffle, Film, FilmIcon, Clapperboard, X } from 'lucide-react';
import { ColorScheme, COLOR_SCHEMES } from './types';
import ColorSchemeSelector from './ColorSchemeSelector';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface GARCHParams {
  omega: number;
  alpha: number;
  shockSize: number;
  steps: number;
  betaRes: number;
  seed: number;
}

interface SurfaceData {
  sigmaGrid: number[][];    // [betaIdx][timeIdx], σ in percent, full pre-computed series
  relGrid: number[][];      // σₜ/σ̄ − 1
  uncondSigmaPct: number[];
  betas: number[];
  yScale: number;           // for mesh mapping
}

const AX_X = 8;
const AX_Z = 6;
const AX_Y = 8;
// No burn-in: the opening kick at t=0 is the dramatic intro of the simulation.
// Subsequent columns mix in ongoing gaussian shocks so clusters keep forming.
const BURN_IN = 0;

// Track the global light/dark theme so the 3D scene + UI chrome can switch
// palettes. The rest of the app toggles the `dark` class on documentElement
// and broadcasts a `theme-change` CustomEvent; we observe both.
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

// Pre-compute the full σ surface once per param change. The play button just
// animates a reveal cursor; the underlying physics doesn't re-run.
function simulateFullSurface(params: GARCHParams): SurfaceData {
  const { omega, alpha, shockSize, steps, betaRes, seed } = params;
  const betaMax = Math.max(0.01, Math.min(0.98, 0.99 - alpha));

  // Shared shock stream across every β slice. Same news, different persistence.
  const totalSteps = BURN_IN + steps;
  const rand = mulberry32(seed);
  const shocks: number[] = new Array(totalSteps);
  for (let t = 0; t < totalSteps; t++) shocks[t] = gaussian(rand);

  const betas: number[] = new Array(betaRes);
  for (let j = 0; j < betaRes; j++) betas[j] = (j / (betaRes - 1)) * betaMax;

  const sigmaGrid: number[][] = new Array(betaRes);
  const relGrid: number[][] = new Array(betaRes);
  const uncondSigmaPct: number[] = new Array(betaRes);
  let maxRel = 0;

  for (let j = 0; j < betaRes; j++) {
    const beta = betas[j];
    const uncondVar = omega / (1 - alpha - beta);
    const uncondSigma = Math.sqrt(uncondVar);
    uncondSigmaPct[j] = uncondSigma * 100;

    const sigmaRow: number[] = new Array(steps);
    const relRow: number[] = new Array(steps);
    let sigma2Prev = uncondVar;
    // Seed shock: a shockSize · σ̄ kick that starts all β slices off at the
    // same elevated state, so the opening frame of the animation has visible
    // drama instead of a flat plane.
    let rPrev = shockSize * uncondSigma;

    for (let t = 0; t < totalSteps; t++) {
      const sigma2 = omega + alpha * rPrev * rPrev + beta * sigma2Prev;
      const sigma = Math.sqrt(sigma2);
      if (t >= BURN_IN) {
        const idx = t - BURN_IN;
        sigmaRow[idx] = sigma * 100;
        relRow[idx] = sigma / uncondSigma - 1;
        if (relRow[idx] > maxRel) maxRel = relRow[idx];
      }
      const rt = sigma * shocks[t];
      sigma2Prev = sigma2;
      rPrev = rt;
    }
    sigmaGrid[j] = sigmaRow;
    relGrid[j] = relRow;
  }

  return { sigmaGrid, relGrid, uncondSigmaPct, betas, yScale: Math.max(maxRel, 0.05) };
}

// Build the mesh geometry up to `revealSteps` columns. Columns beyond that get
// their Y snapped to 0 so the surface "grows forward in time" as playback advances.
function buildGeometry(data: SurfaceData, steps: number, revealSteps: number): THREE.BufferGeometry {
  const { relGrid, betas, yScale } = data;
  const betaRes = betas.length;
  const vertices: number[] = [];
  const indices: number[] = [];
  const reveal = Math.max(0, Math.min(steps, revealSteps));

  for (let j = 0; j < betaRes; j++) {
    for (let i = 0; i < steps; i++) {
      const x = -AX_X + (i / (steps - 1)) * (2 * AX_X);
      const z = -AX_Z + (j / (betaRes - 1)) * (2 * AX_Z);
      // Clamp to ≥0 so the surface only shows excess vol above equilibrium.
      // Quiet stretches (σₜ < σ̄) collapse to the base plane instead of poking
      // through as downward spikes, which reads as noise in a 3D view.
      const lift = Math.max(0, relGrid[j][i]);
      const y = i < reveal ? (lift / yScale) * AX_Y : 0;
      vertices.push(x, y, z);
    }
  }
  for (let j = 0; j < betaRes - 1; j++) {
    for (let i = 0; i < steps - 1; i++) {
      const a = j * steps + i;
      indices.push(a, a + 1, a + steps);
      indices.push(a + 1, a + steps + 1, a + steps);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Colours: green at base plane, amber for mid lift, red at peak. Stays
// consistent across reveals because color is baked into the buffer.
const LIFT_WHITE = new THREE.Color('#ffffff');

function colorizeGeometry(geometry: THREE.BufferGeometry, colorScheme: ColorScheme, lift = 0) {
  const positions = geometry.attributes.position.array;
  const colors = new Float32Array(positions.length);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxY - minY < 0.001) maxY = minY + 0.001;
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    const c = new THREE.Color(colorScheme.getColor(y, minY, maxY));
    // Light mode: the ramps' low end is near-black and the flat floor is
    // most of the surface, which read as a black slab on the pale canvas.
    // A small lerp toward white lifts the whole ramp without reordering it.
    if (lift > 0) c.lerp(LIFT_WHITE, lift);
    colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

interface AnimatedSurfaceProps {
  data: SurfaceData;
  steps: number;
  isPlaying: boolean;
  speed: number;           // steps per second
  colorScheme: ColorScheme;
  surfaceOpacity: number;
  showWireframe: boolean;
  wireframeOpacity: number;
  highlightBeta: number;
  showHighlight: boolean;
  onProgress: (revealSteps: number) => void;
  resetSignal: number;
  isDark: boolean;
}

function AnimatedSurface({ data, steps, isPlaying, speed, colorScheme, surfaceOpacity, showWireframe, wireframeOpacity, highlightBeta, showHighlight, onProgress, resetSignal, isDark }: AnimatedSurfaceProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const ridgeRef = useRef<THREE.Line>(null);
  const revealRef = useRef<number>(steps); // start fully revealed
  const prevResetSignal = useRef<number>(resetSignal);

  // Reset cursor on explicit Replay/New/Shuffle. Guarded so the initial mount
  // render (where resetSignal equals its initial value) doesn't collapse the
  // surface to flat: the default state should show the fully simulated view.
  useEffect(() => {
    if (prevResetSignal.current === resetSignal) return;
    prevResetSignal.current = resetSignal;
    revealRef.current = 0;
    onProgress(0);
  }, [resetSignal, onProgress]);

  // Colour is applied on the initial build and every time params change.
  useEffect(() => {
    if (!meshRef.current) return;
    const geo = buildGeometry(data, steps, revealRef.current);
    colorizeGeometry(geo, colorScheme, isDark ? 0 : 0.22);
    meshRef.current.geometry.dispose();
    meshRef.current.geometry = geo;
    if (wireRef.current) {
      wireRef.current.geometry.dispose();
      wireRef.current.geometry = geo.clone();
    }
  }, [data, steps, colorScheme, isDark]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    if (isPlaying) {
      revealRef.current = Math.min(steps, revealRef.current + delta * speed);
      if (revealRef.current >= steps) onProgress(steps);
      else onProgress(revealRef.current);
    }

    // Update Y coordinates in-place for the reveal mask. Faster than rebuilding
    // the whole buffer: we only touch positions and leave indices/normals alone.
    const positions = meshRef.current.geometry.attributes.position.array as Float32Array;
    const revealInt = Math.floor(revealRef.current);
    const revealFrac = revealRef.current - revealInt;
    const { relGrid, betas, yScale } = data;
    const betaRes = betas.length;

    for (let j = 0; j < betaRes; j++) {
      for (let i = 0; i < steps; i++) {
        const vi = (j * steps + i) * 3 + 1;
        const lift = Math.max(0, relGrid[j][i]);
        let y = 0;
        if (i < revealInt) {
          y = (lift / yScale) * AX_Y;
        } else if (i === revealInt && revealInt < steps) {
          y = (lift / yScale) * AX_Y * revealFrac;
        }
        positions[vi] = y;
      }
    }
    meshRef.current.geometry.attributes.position.needsUpdate = true;
    meshRef.current.geometry.computeVertexNormals();

    if (wireRef.current) {
      (wireRef.current.geometry.attributes.position.array as Float32Array).set(positions);
      wireRef.current.geometry.attributes.position.needsUpdate = true;
    }

    if (ridgeRef.current && showHighlight) {
      // Snap the white ridge to the highlighted β index on every frame.
      let bestIdx = 0, bestErr = Infinity;
      for (let j = 0; j < betas.length; j++) {
        const e = Math.abs(betas[j] - highlightBeta);
        if (e < bestErr) { bestErr = e; bestIdx = j; }
      }
      const z = -AX_Z + (bestIdx / (betaRes - 1)) * (2 * AX_Z);
      const ridgePos = ridgeRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < steps; i++) {
        ridgePos[i * 3] = -AX_X + (i / (steps - 1)) * (2 * AX_X);
        let y = 0;
        const lift = Math.max(0, relGrid[bestIdx][i]);
        if (i < revealInt) y = (lift / yScale) * AX_Y;
        else if (i === revealInt && revealInt < steps) y = (lift / yScale) * AX_Y * revealFrac;
        ridgePos[i * 3 + 1] = y + 0.04;
        ridgePos[i * 3 + 2] = z;
      }
      ridgeRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  const initialGeometry = useMemo(() => {
    // Build fully revealed so the colour gradient is anchored to the real Y
    // range. If we built flat (y=0 everywhere), every vertex would colorize
    // identically and the surface would stay flat-toned even after useFrame
    // has lifted the vertices.
    const geo = buildGeometry(data, steps, steps);
    colorizeGeometry(geo, colorScheme, isDark ? 0 : 0.22);
    return geo;
  }, [data, steps, colorScheme, isDark]);

  const ridgeGeometry = useMemo(() => {
    const pts = new Float32Array(steps * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    return geo;
  }, [steps]);

  return (
    <>
      <mesh ref={meshRef} geometry={initialGeometry}>
        <meshStandardMaterial
          vertexColors
          side={THREE.DoubleSide}
          roughness={0.35}
          metalness={0.25}
          transparent
          opacity={surfaceOpacity}
        />
      </mesh>
      {showWireframe && (
        <mesh ref={wireRef} geometry={initialGeometry.clone()}>
          <meshBasicMaterial color={isDark ? '#e8e8e8' : '#3a3a3a'} wireframe transparent opacity={wireframeOpacity} />
        </mesh>
      )}
      {showHighlight && (
        // react-three-fiber primitive vs SVG line type ambiguity, intentional cast.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((<line ref={ridgeRef as any} geometry={ridgeGeometry as any} {...({} as any)}>
          <lineBasicMaterial color={isDark ? '#e8e8e8' : '#1c1c1c'} />
        </line>) as any)
      )}
    </>
  );
}

function ImmersiveGrid({ show, size = 20, isDark }: { show: boolean; size?: number; isDark: boolean }) {
  if (!show) return null;
  // Neutral terminal grid greys (three.js cannot resolve CSS vars, hex only).
  // Light mode needs darker lines against the light background, otherwise the
  // grid fades into the backdrop.
  const major = isDark ? '#3a3a3a' : '#a3a3a3';
  const minor = isDark ? '#2e2e2e' : '#d4d4d4';
  return (
    <group>
      <gridHelper args={[size, size, major, minor]} position={[0, 0, 0]} />
      <gridHelper args={[size, size, major, minor]} position={[0, size / 2, -size / 2]} rotation={[Math.PI / 2, 0, 0]} />
      <gridHelper args={[size, size, major, minor]} position={[-size / 2, size / 2, 0]} rotation={[0, 0, Math.PI / 2]} />
    </group>
  );
}

function AxisLines({ show, isDark }: { show: boolean; isDark: boolean }) {
  if (!show) return null;
  // Axis chrome is recessive neutral ink, not series color: the label TEXT
  // names each axis, so red/green/blue added nothing but noise against the
  // surface (same treatment as the other model scenes).
  const cTime = isDark ? '#b0b0b0' : '#555555';
  const cSigma = isDark ? '#b0b0b0' : '#555555';
  const cBeta = isDark ? '#b0b0b0' : '#555555';
  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={2} array={new Float32Array([-AX_X, 0, 0, AX_X, 0, 0])} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color={cTime} />
      </line>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={2} array={new Float32Array([0, 0, 0, 0, AX_Y, 0])} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color={cSigma} />
      </line>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={2} array={new Float32Array([0, 0, -AX_Z, 0, 0, AX_Z])} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color={cBeta} />
      </line>
      <Billboard position={[AX_X + 0.6, 0, 0]}><Text fontSize={0.45} color={cTime}>Time</Text></Billboard>
      <Billboard position={[0, AX_Y + 0.6, 0]}><Text fontSize={0.45} color={cSigma}>σₜ</Text></Billboard>
      <Billboard position={[0, 0, AX_Z + 0.6]}><Text fontSize={0.45} color={cBeta}>β</Text></Billboard>
    </group>
  );
}

// Famous volatility events reproduced as GARCH presets. Each scenario tunes α
// (shock reactivity), ω (baseline variance), shockSize (opening kick in σ̄
// units), and an anchor β that best illustrates the event's persistence.
// Values are chosen so the resulting surface visibly matches the archetype:
// short-sharp (Flash Crash), slow-burn (GFC), multi-year (Dot-com), quiet (2017).
interface Preset {
  id: string;
  label: string;
  blurb: string;
  params: Pick<GARCHParams, 'omega' | 'alpha' | 'shockSize' | 'seed'>;
  highlightBeta: number;
}

const PRESETS: Preset[] = [
  {
    id: 'gfc',
    label: 'GFC 2008',
    blurb: 'Global Financial Crisis — Lehman collapse. High α, sticky β. Vol stays elevated for months.',
    params: { omega: 0.00003, alpha: 0.15, shockSize: 6.0, seed: 11 },
    highlightBeta: 0.82,
  },
  {
    id: 'covid',
    label: 'COVID 2020',
    blurb: 'Fastest bear market ever. Extreme shock reactivity, rapid spike then sharp normalization.',
    params: { omega: 0.00004, alpha: 0.22, shockSize: 8.0, seed: 77 },
    highlightBeta: 0.75,
  },
  {
    id: 'flash',
    label: 'Flash Crash',
    blurb: 'May 2010 intraday crash. Huge 10σ̄ shock, α spikes but β=low so normalises within weeks.',
    params: { omega: 0.00002, alpha: 0.30, shockSize: 10.0, seed: 33 },
    highlightBeta: 0.55,
  },
  {
    id: 'dotcom',
    label: 'Dot-com 2000',
    blurb: 'Tech bubble unwind. Moderate α, very high β. Multi-year drawdown, persistent elevated vol.',
    params: { omega: 0.00003, alpha: 0.10, shockSize: 4.0, seed: 55 },
    highlightBeta: 0.87,
  },
  {
    id: 'crypto',
    label: 'Crypto Winter',
    blurb: '2022 Terra + FTX collapse. Very high shock, long recovery. Extreme β persistence.',
    params: { omega: 0.00005, alpha: 0.18, shockSize: 7.0, seed: 99 },
    highlightBeta: 0.80,
  },
  {
    id: 'calm',
    label: 'Calm 2017',
    blurb: 'Historically low-vol year. α≈0, tiny shocks, σₜ barely deviates from σ̄.',
    params: { omega: 0.00001, alpha: 0.03, shockSize: 0.5, seed: 42 },
    highlightBeta: 0.85,
  },
];

// Time cursor: a thin vertical plane that sweeps across the X axis in sync with
// the reveal. Gives the user a visible "now" marker during playback.
function TimeCursor({ revealSteps, steps, show }: { revealSteps: number; steps: number; show: boolean }) {
  if (!show || revealSteps <= 0 || revealSteps >= steps) return null;
  const x = -AX_X + (revealSteps / (steps - 1)) * (2 * AX_X);
  return (
    <group position={[x, 0, 0]}>
      <mesh>
        <planeGeometry args={[2 * AX_Z, AX_Y]} />
        <meshBasicMaterial color="#c58435" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={2} array={new Float32Array([0, 0, -AX_Z, 0, 0, AX_Z])} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color="#c58435" />
      </line>
    </group>
  );
}

export default function GARCHVisualization() {
  const [params, setParams] = useState<GARCHParams>({
    omega: 0.00002,
    alpha: 0.10,
    shockSize: 3.0,
    steps: 150,
    betaRes: 60,
    seed: 42
  });
  const [highlightBeta, setHighlightBeta] = useState(0.85);

  // Default to the zinc scheme: terminal chrome is neutral, no neon ramps.
  const [colorScheme, setColorScheme] = useState<ColorScheme>(COLOR_SCHEMES[4]);
  const [showWireframe, setShowWireframe] = useState(true);
  const [wireframeOpacity, setWireframeOpacity] = useState(0.12);
  const [surfaceOpacity, setSurfaceOpacity] = useState(0.92);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [showHighlight, setShowHighlight] = useState(true);
  const [showCursor, setShowCursor] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [rotateSpeed, setRotateSpeed] = useState(1);
  const [showParams, setShowParams] = useState(true);
  const [showVisuals, setShowVisuals] = useState(false);
  const [showStats, setShowStats] = useState(true);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(40); // steps per second
  const [revealSteps, setRevealSteps] = useState(params.steps);
  const [resetSignal, setResetSignal] = useState(0);

  // Active preset: drives the Scenarios popover label and tour progression.
  const [activePreset, setActivePreset] = useState<Preset | null>(null);

  // Cinematic mode: hides all UI chrome, turns on slow auto-rotate, expands
  // the canvas. Intended for screen recording a short clip of the surface.
  const [cinematic, setCinematic] = useState(false);

  // Tour mode: cycles through every preset in order, 12s per scenario, with
  // caption rotating and camera auto-rotating. Perfect for a 60s reel.
  const [tourActive, setTourActive] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);

  const isDark = useIsDarkTheme();

  const surfaceData = useMemo(() => simulateFullSurface(params), [params]);

  // When params or seed change, drop back to fully revealed so the user sees
  // the updated surface immediately. Only the explicit Reset button rewinds.
  useEffect(() => { setRevealSteps(params.steps); }, [params]);

  const stats = useMemo(() => {
    let bestIdx = 0, bestErr = Infinity;
    for (let j = 0; j < surfaceData.betas.length; j++) {
      const e = Math.abs(surfaceData.betas[j] - highlightBeta);
      if (e < bestErr) { bestErr = e; bestIdx = j; }
    }
    const actualBeta = surfaceData.betas[bestIdx];
    const persistence = params.alpha + actualBeta;
    const halfLife = persistence > 0 && persistence < 1
      ? Math.log(0.5) / Math.log(persistence)
      : Infinity;

    const row = surfaceData.sigmaGrid[bestIdx];
    const revealIdx = Math.max(0, Math.min(row.length - 1, Math.floor(revealSteps) - 1));
    const currentSigma = row[revealIdx];
    const meanSigma = row.slice(0, revealIdx + 1).reduce((a, b) => a + b, 0) / Math.max(1, revealIdx + 1);
    const peakSigma = Math.max(...row.slice(0, revealIdx + 1));
    const uncondSigma = surfaceData.uncondSigmaPct[bestIdx];
    const currentLift = currentSigma / uncondSigma - 1;

    return {
      actualBeta, persistence, halfLife,
      currentSigma, meanSigma, peakSigma, uncondSigma, currentLift
    };
  }, [surfaceData, highlightBeta, revealSteps, params.alpha]);

  const controlsRef = useRef<any>(null);
  const resetCamera = () => controlsRef.current?.reset();

  const handlePlayToggle = () => {
    if (revealSteps >= params.steps) {
      // If we're at the end, restart from scratch.
      setResetSignal(s => s + 1);
      setRevealSteps(0);
    }
    setIsPlaying(p => !p);
  };
  const handleReset = () => {
    setResetSignal(s => s + 1);
    setRevealSteps(0);
    setIsPlaying(true);
  };
  const handleShuffle = () => {
    setParams(p => ({ ...p, seed: (p.seed + 1) | 0 }));
    setResetSignal(s => s + 1);
    setRevealSteps(0);
    setIsPlaying(true);
  };

  // Apply a preset: merge its params over current ones, anchor the highlight
  // ridge, rewind reveal to 0, auto-play.
  const applyPreset = useCallback((preset: Preset) => {
    setParams(p => ({ ...p, ...preset.params }));
    setHighlightBeta(preset.highlightBeta);
    setActivePreset(preset);
    setResetSignal(s => s + 1);
    setRevealSteps(0);
    setIsPlaying(true);
  }, []);

  // Tour cycle: advance every 12 seconds. Stops on manual exit or when the
  // user interacts with a different preset button.
  useEffect(() => {
    if (!tourActive) return;
    applyPreset(PRESETS[tourIndex % PRESETS.length]);
    const t = setTimeout(() => setTourIndex(i => i + 1), 12000);
    return () => clearTimeout(t);
  }, [tourActive, tourIndex, applyPreset]);

  // Stop playing when we've revealed everything.
  useEffect(() => {
    if (revealSteps >= params.steps && isPlaying) setIsPlaying(false);
  }, [revealSteps, params.steps, isPlaying]);

  return (
    <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-neutral-100 dark:bg-[#1c1c1c] rounded-lg overflow-hidden border border-border">
      <Canvas
        camera={{ position: [14, 10, 14], fov: 45 }}
        style={{
          // Flat terminal background, no gradient: the scene sits on the same
          // neutral canvas as every other chart surface.
          background: isDark ? 'var(--bg, #1c1c1c)' : '#ebebeb',
        }}
      >
        {/* Light mode bumps ambient so the darkened grid + surface read cleanly
            without sacrificing the directional highlight on the ridge. */}
        <ambientLight intensity={isDark ? 0.45 : 0.85} />
        <pointLight position={[10, 20, 10]} intensity={isDark ? 1.2 : 0.9} />
        <directionalLight position={[-10, 15, 10]} intensity={isDark ? 0.8 : 0.6} />
        {/* Neutral fill light: the old amber tint washed the whole scene warm,
            which fights the flat terminal palette. */}
        <pointLight position={[-10, 8, -10]} intensity={isDark ? 0.4 : 0.2} color="#ffffff" />

        <ImmersiveGrid show={showGrid} size={20} isDark={isDark} />
        <AxisLines show={showAxes} isDark={isDark} />

        <AnimatedSurface
          data={surfaceData}
          steps={params.steps}
          isPlaying={isPlaying}
          speed={playSpeed}
          colorScheme={colorScheme}
          surfaceOpacity={surfaceOpacity}
          showWireframe={showWireframe}
          wireframeOpacity={wireframeOpacity}
          highlightBeta={highlightBeta}
          showHighlight={showHighlight}
          onProgress={setRevealSteps}
          resetSignal={resetSignal}
          isDark={isDark}
        />

        <TimeCursor revealSteps={Math.floor(revealSteps)} steps={params.steps} show={showCursor && isPlaying} />

        <OrbitControls
          ref={controlsRef}
          enablePan enableZoom enableRotate
          minDistance={5} maxDistance={60}
          autoRotate={autoRotate || cinematic || tourActive}
          autoRotateSpeed={cinematic || tourActive ? 1.2 : rotateSpeed}
        />
      </Canvas>

      {/* Header: hidden in cinematic mode for screen-capture cleanliness */}
      <div className={`absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none transition-opacity ${cinematic ? 'opacity-0' : 'opacity-100'}`}>
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-2 text-[var(--text)]">
            <span className="font-semibold font-mono">GARCH(1,1) Simulation</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-[var(--dim)] cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm font-mono">
                  <p className="text-sm">σ²ₜ = ω + α·r²ₜ₋₁ + β·σ²ₜ₋₁</p>
                  <p className="text-xs mt-1 text-[var(--dim)]">Every β slice runs on the same seeded shock stream. Press Play to watch clusters form.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="px-3 py-1 rounded text-xs font-mono bg-[var(--bg2)] border border-[var(--edge)] text-[var(--up)]">
            α+β: {stats.persistence.toFixed(3)} ✓
          </div>
          <div className="px-3 py-1 rounded text-xs font-mono bg-card border border-border text-[var(--dim)]">
            t={Math.floor(revealSteps)}/{params.steps}
          </div>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Primary action stays visible; secondary verbs collapse into Modes
              so the top bar reads cleanly on video. */}
          <Button variant="outline" size="sm" onClick={handlePlayToggle} className="bg-card gap-1 text-[var(--text)] hover:text-[var(--text)]">
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span className="hidden md:inline">{isPlaying ? 'Pause' : 'Play'}</span>
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={activePreset ? 'default' : 'outline'}
                size="sm"
                className={`gap-1 font-mono ${activePreset ? 'bg-[var(--hover)] text-[var(--text)] hover:bg-[var(--hover)]' : 'bg-card text-[var(--text)] hover:text-[var(--text)]'}`}
              >
                <Film className="h-4 w-4" />
                <span className="hidden md:inline">{activePreset ? activePreset.label : 'Scenarios'}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1 bg-card font-mono">
              {PRESETS.map(preset => {
                const isActive = activePreset?.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => { if (tourActive) setTourActive(false); applyPreset(preset); }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[var(--hover)] ${isActive ? 'text-[#c58435]' : 'text-[var(--text)]'}`}
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
                className={`gap-1 font-mono ${tourActive || cinematic ? 'bg-[var(--hover)] text-[var(--text)] hover:bg-[var(--hover)]' : 'bg-card text-[var(--text)] hover:text-[var(--text)]'}`}
              >
                <FilmIcon className="h-4 w-4" />
                <span className="hidden md:inline">
                  {tourActive ? `Tour ${(tourIndex % PRESETS.length) + 1}/${PRESETS.length}` : cinematic ? 'Cinema' : 'Modes'}
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1 bg-card font-mono">
              <button onClick={handleReset} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[var(--hover)] text-[var(--text)]">
                <RotateCcw className="h-3.5 w-3.5" /> Replay
              </button>
              <button onClick={handleShuffle} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[var(--hover)] text-[var(--text)]">
                <Shuffle className="h-3.5 w-3.5" /> New seed
              </button>
              <button onClick={resetCamera} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[var(--hover)] text-[var(--text)]">
                <RotateCcw className="h-3.5 w-3.5" /> Reset view
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                onClick={() => { if (tourActive) { setTourActive(false); } else { setTourIndex(0); setTourActive(true); } }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[var(--hover)] ${tourActive ? 'text-[#c58435]' : 'text-[var(--text)]'}`}
              >
                <FilmIcon className="h-3.5 w-3.5" /> {tourActive ? 'Stop tour' : 'Guided tour'}
              </button>
              <button
                onClick={() => setCinematic(c => !c)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-[var(--hover)] ${cinematic ? 'text-[#c58435]' : 'text-[var(--text)]'}`}
              >
                <Clapperboard className="h-3.5 w-3.5" /> {cinematic ? 'Exit cinema' : 'Cinema mode'}
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Cinematic exit: floats as a tiny button so the user can escape when
          UI is hidden. Only visible when cinematic is on. */}
      {cinematic && (
        <div className="absolute top-4 right-4 pointer-events-auto z-30">
          <Button variant="outline" size="sm" onClick={() => setCinematic(false)}
            className="bg-card text-[var(--text)] hover:text-[var(--text)] border-border gap-1">
            <X className="h-4 w-4" />
            Exit Cinema
          </Button>
        </div>
      )}

      {/* Left panel */}
      <div className={`absolute left-4 top-20 w-72 space-y-2 pointer-events-auto max-h-[calc(100%-120px)] overflow-y-auto transition-opacity ${cinematic ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <Collapsible open={showParams} onOpenChange={setShowParams}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-[var(--text)] hover:text-[var(--text)]">
              <span className="flex items-center gap-2"><Settings className="h-4 w-4" /> PARAMETERS</span>
              {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-3 text-[var(--text)]">
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">ALPHA (α)</Label><span className="text-xs">{params.alpha.toFixed(3)}</span></div>
                <Slider value={[params.alpha * 1000]} onValueChange={([v]) => setParams(p => ({ ...p, alpha: v / 1000 }))} min={0} max={400} step={5} />
                <div className="text-[10px] text-[#808080] font-mono">shock reactivity</div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">OMEGA (ω) ×10⁵</Label><span className="text-xs">{(params.omega * 1e5).toFixed(1)}</span></div>
                <Slider value={[params.omega * 1e7]} onValueChange={([v]) => setParams(p => ({ ...p, omega: v / 1e7 }))} min={1} max={500} step={1} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">SEED SHOCK</Label><span className="text-xs">{params.shockSize.toFixed(1)}σ̄</span></div>
                <Slider value={[params.shockSize * 10]} onValueChange={([v]) => setParams(p => ({ ...p, shockSize: v / 10 }))} min={0} max={60} step={1} />
                <div className="text-[10px] text-[#808080] font-mono">opening kick at t=0</div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">HIGHLIGHT β</Label><span className="text-xs">{stats.actualBeta.toFixed(2)}</span></div>
                <Slider value={[highlightBeta * 100]} onValueChange={([v]) => setHighlightBeta(v / 100)} min={0} max={Math.max(1, Math.round((0.99 - params.alpha) * 100))} step={1} />
                <div className="text-[10px] text-[#808080] font-mono">bright ridge + stats anchor</div>
              </div>
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">PLAYBACK SPEED</Label><span className="text-xs">{playSpeed} st/s</span></div>
                <Slider value={[playSpeed]} onValueChange={([v]) => setPlaySpeed(v)} min={5} max={200} step={5} />
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={showVisuals} onOpenChange={setShowVisuals}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-[var(--text)] hover:text-[var(--text)]">
              <span className="flex items-center gap-2"><Eye className="h-4 w-4" /> VISUALS</span>
              {showVisuals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[var(--text)]">
              <ColorSchemeSelector value={colorScheme.id} onChange={setColorScheme} />
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">SURFACE OPACITY</Label><span className="text-xs">{(surfaceOpacity * 100).toFixed(0)}%</span></div>
                <Slider value={[surfaceOpacity * 100]} onValueChange={([v]) => setSurfaceOpacity(v / 100)} min={20} max={100} step={5} />
              </div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono">WIREFRAME</Label><Switch checked={showWireframe} onCheckedChange={setShowWireframe} /></div>
              {showWireframe && (
                <div className="space-y-2">
                  <div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">WIRE OPACITY</Label><span className="text-xs">{(wireframeOpacity * 100).toFixed(0)}%</span></div>
                  <Slider value={[wireframeOpacity * 100]} onValueChange={([v]) => setWireframeOpacity(v / 100)} min={5} max={60} step={5} />
                </div>
              )}
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">TIME RES</Label><span className="text-xs">{params.steps}</span></div>
                <Slider value={[params.steps]} onValueChange={([v]) => setParams(p => ({ ...p, steps: v }))} min={60} max={300} step={10} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">β RES</Label><span className="text-xs">{params.betaRes}</span></div>
                <Slider value={[params.betaRes]} onValueChange={([v]) => setParams(p => ({ ...p, betaRes: v }))} min={20} max={80} step={5} />
              </div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono">HIGHLIGHT RIDGE</Label><Switch checked={showHighlight} onCheckedChange={setShowHighlight} /></div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono">TIME CURSOR</Label><Switch checked={showCursor} onCheckedChange={setShowCursor} /></div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono"><Grid3X3 className="h-3 w-3 inline mr-1" />GRID</Label><Switch checked={showGrid} onCheckedChange={setShowGrid} /></div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono"><Box className="h-3 w-3 inline mr-1" />AXES</Label><Switch checked={showAxes} onCheckedChange={setShowAxes} /></div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono">AUTO ROTATE</Label><Switch checked={autoRotate} onCheckedChange={setAutoRotate} /></div>
              {autoRotate && (
                <div className="space-y-2">
                  <div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">SPEED</Label><span className="text-xs">{rotateSpeed.toFixed(1)}</span></div>
                  <Slider value={[rotateSpeed * 10]} onValueChange={([v]) => setRotateSpeed(v / 10)} min={1} max={40} step={1} />
                </div>
              )}
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Right panel: live stats */}
      <div className={`absolute right-4 top-20 w-56 pointer-events-auto transition-opacity ${cinematic ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs text-[var(--text)] hover:text-[var(--text)]">
              <span className="flex items-center gap-2"><Info className="h-4 w-4" /> β={stats.actualBeta.toFixed(2)} LIVE</span>
              {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-3 bg-card border-border space-y-3 text-[var(--text)]">
              <div>
                <div className="flex justify-between mb-1 font-mono"><span className="text-xs text-[var(--dim)]">PERSISTENCE</span><span className={`text-sm font-bold ${stats.persistence >= 0.95 ? 'text-[#c58435]' : stats.persistence >= 0.8 ? 'text-[var(--up)]' : 'text-[var(--text)]'}`}>{stats.persistence.toFixed(3)}</span></div>
                <div className="w-full bg-muted h-1.5 rounded"><div className={`h-full rounded ${stats.persistence >= 0.95 ? 'bg-[#c58435]' : stats.persistence >= 0.8 ? 'bg-[var(--up)]' : 'bg-[var(--dim)]'}`} style={{ width: `${Math.min(stats.persistence * 100, 100)}%` }} /></div>
              </div>
              <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">HALF-LIFE</span><span className="text-sm text-[var(--text)]">{isFinite(stats.halfLife) ? `${stats.halfLife.toFixed(1)} steps` : '∞'}</span></div>
              <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">UNCOND σ̄</span><span className="text-sm text-[var(--text)]">{stats.uncondSigma.toFixed(2)}%</span></div>
              <div className="pt-2 border-t border-border space-y-2 font-mono">
                <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">σ NOW</span><span className={`text-sm font-bold ${stats.currentLift > 0.3 ? 'text-[var(--down)]' : stats.currentLift > 0 ? 'text-[#c58435]' : 'text-[var(--up)]'}`}>{stats.currentSigma.toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">LIFT vs σ̄</span><span className={`text-sm ${stats.currentLift > 0 ? 'text-[#c58435]' : 'text-[var(--up)]'}`}>{stats.currentLift >= 0 ? '+' : ''}{(stats.currentLift * 100).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">PEAK so far</span><span className="text-sm text-[var(--down)]">{stats.peakSigma.toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">MEAN so far</span><span className="text-sm">{stats.meanSigma.toFixed(2)}%</span></div>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="text-xs text-[var(--dim)] mb-2 font-mono">σ HEIGHT SCALE</div>
                <div className="flex h-3 rounded overflow-hidden">
                  {colorScheme.colors.map((color, i) => (<div key={i} className="flex-1" style={{ backgroundColor: color }} />))}
                </div>
                <div className="flex justify-between text-xs text-[var(--dim)] mt-1 font-mono"><span>LOW</span><span>HIGH</span></div>
              </div>
              <div className="pt-2 border-t border-border text-[10px] text-[var(--dim)] font-mono leading-relaxed">
                Play: watch clusters form as shocks arrive.<br />
                New: re-seed for a different history.<br />
                Back ridge (β near 1): long persistent tails.
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

    </div>
  );
}
