import { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, ChevronDown, ChevronUp, Settings, Eye, RotateCcw, Play } from 'lucide-react';

// Temporal Convolutional Network, in 3D. A TCN is a stack of dilated causal
// convolutions. The scene maps the three things that matter onto the three axes:
//   x = time      (the input sequence runs left to right; left is the past)
//   y = depth     (the input plane sits at the bottom; each conv layer stacks above)
//   z = channels  (every layer is a sheet of feature maps, into the screen; a real
//                  network carries hundreds, so this axis can be made very deep)
// Each layer reads only a few taps (kernel size k), but the spacing between taps
// DOUBLES every layer (dilation 1, 2, 4, 8...). One output node therefore reaches
// back over r = 1 + (k-1)*sum(d_i) steps through just a handful of layers, and it
// only ever connects down and to the left, so it reads its own past, never the
// future. The bright cone is the receptive field of the spotlight output, extruded
// through every channel; the pulses are signal flowing from those past inputs up
// to the prediction. With thousands of nodes the spheres are GPU-instanced.

const BASE = 2;        // dilation base: each layer multiplies the dilation by this.
const DZ = 0.42;       // fixed spacing between channel sheets, so they never merge.
const DY = 2.0;        // vertical gap between layers, so each layer reads as its own band.
const R_NODE = 0.12;   // node radius (constant; separation comes from spacing, not size).

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
    return () => { observer.disconnect(); window.removeEventListener('theme-change', sync); };
  }, []);
  return isDark;
}

// Receptive field of one output node: r = 1 + (k-1)*(B^L - 1)/(B - 1).
function receptiveField(k: number, L: number, base = BASE): number {
  let sum = 0;
  for (let i = 0; i < L; i++) sum += Math.pow(base, i);
  return 1 + (k - 1) * sum;
}

type Cell = { l: number; t: number };
type Layout = { dx: number; dy: number; dz: number; T: number; L: number; channels: number };
type Palette = ReturnType<typeof palette>;

function palette(isDark: boolean) {
  // three.js materials cannot resolve CSS vars, so terminal hex fallbacks are
  // used here: bg #1c1c1c, grid #2e2e2e, edge #3a3a3a, dim #b0b0b0, text #e8e8e8,
  // secondary-series amber #c58435. Backgrounds are flat (no gradients).
  return isDark ? {
    dorm: '#5a5a5a', dormEmissive: '#2e2e2e', dormEI: 0.18,
    active: '#e8e8e8', activeEmissive: '#808080', activeEI: 0.7,
    // the other (non-traced) channels of an active node: present but quiet
    activeDim: '#6a6a6a', activeDimEmissive: '#3a3a3a', activeDimEI: 0.32,
    spot: '#c58435', spotEmissive: '#7a5220', spotEI: 0.95,
    spotDim: '#8a6230', spotDimEmissive: '#4d3a18', spotDimEI: 0.35,
    edge: '#3a3a3a', edgeOpacity: 0.25, edgeActive: '#e8e8e8', pulse: '#e8e8e8',
    labelDim: '#b0b0b0', labelSpot: '#c58435', labelTime: '#808080',
    bg: '#1c1c1c',
    ambient: 0.45,
  } : {
    // mid grey so the dormant volume stays visible against the light ground
    dorm: '#8a8a8a', dormEmissive: '#6a6a6a', dormEI: 0.05,
    active: '#333333', activeEmissive: '#333333', activeEI: 0.22,
    activeDim: '#9a9a9a', activeDimEmissive: '#9a9a9a', activeDimEI: 0.05,
    spot: '#9a6a18', spotEmissive: '#9a6a18', spotEI: 0.28,
    spotDim: '#bda06a', spotDimEmissive: '#bda06a', spotDimEI: 0.05,
    edge: '#6a6a6a', edgeOpacity: 0.30, edgeActive: '#333333', pulse: '#333333',
    labelDim: '#4a4a4a', labelSpot: '#9a6a18', labelTime: '#6a6a6a',
    bg: '#f0f0f0',
    ambient: 0.95,
  };
}

// A small sphere moving from a (parent, lower) to b (child, upper) along an
// active edge: signal flowing forward in depth, past inputs feeding the output.
// Driven by the GPU clock, not React state, so pulse count stays cheap.
function Pulse({ a, b, offset, speed, color }: { a: [number, number, number]; b: [number, number, number]; offset: number; speed: number; color: string }) {
  const ref = useRef<any>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = ((clock.elapsedTime * speed + offset) % 1 + 1) % 1;
    ref.current.position.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

// One GPU-instanced sphere field. A whole category of nodes (dormant, active, or
// spotlight) is a single draw call, so the channel axis can run into the hundreds
// without the per-mesh overhead that would otherwise melt the frame rate.
function Nodes({
  cells, layout, radius, color, emissive, emissiveIntensity, channelMode = 'all', chIndex = 0,
}: {
  cells: Cell[]; layout: Layout; radius: number; color: string; emissive: string; emissiveIntensity: number;
  // 'all' = every channel; 'one' = just chIndex (the traced channel); 'except' = every
  // channel but chIndex (the other channels of an active node, rendered as a quiet mass).
  channelMode?: 'all' | 'one' | 'except'; chIndex?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { dx, dy, dz, T, L, channels } = layout;
  const perCell = channelMode === 'one' ? 1 : channelMode === 'except' ? Math.max(0, channels - 1) : channels;
  const count = Math.max(1, cells.length * perCell);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    let i = 0;
    for (const c of cells) {
      const x = (c.t - (T - 1) / 2) * dx;
      const y = (c.l - L / 2) * dy;
      for (let ch = 0; ch < channels; ch++) {
        if (channelMode === 'one' && ch !== chIndex) continue;
        if (channelMode === 'except' && ch === chIndex) continue;
        dummy.position.set(x, y, (ch - (channels - 1) / 2) * dz);
        dummy.scale.setScalar(radius);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }, [cells, dx, dy, dz, T, L, channels, radius, channelMode, chIndex]);
  return (
    // key on count forces a fresh instance buffer when the population changes.
    <instancedMesh key={count} ref={ref} args={[undefined as any, undefined as any, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} roughness={0.4} metalness={0.1} />
    </instancedMesh>
  );
}

function TCNScene({
  k, L, channels, activeT, showConnections, showLabels, animateFlow, p,
}: {
  k: number; L: number; channels: number; activeT: number;
  showConnections: boolean; showLabels: boolean; animateFlow: boolean; p: Palette;
}) {
  const RF = receptiveField(k, L);
  const T = Math.min(RF, 18); // visible time steps, capped so the cone stays legible

  // Layer spacing is the cap DY for shallow stacks (clear separation) but tightens
  // as layers grow so a deep 10-layer stack still fits the view top to bottom and
  // the cone is seen passing through every layer.
  const dx = 0.78, dy = Math.min(DY, 11 / L), dz = DZ;
  const layout: Layout = { dx, dy, dz, T, L, channels };
  const xAt = (t: number) => (t - (T - 1) / 2) * dx;
  const yAt = (l: number) => (l - L / 2) * dy;
  const zEdge = ((channels - 1) / 2) * dz; // front face: labels + faint structure
  // The traced channel: one channel followed in full brightness so the cone reads
  // cleanly. Its z plane (near the centre of the volume) carries the bright cone.
  const chTrace = Math.floor((channels - 1) / 2);
  const zTrace = (chTrace - (channels - 1) / 2) * dz;

  const rBase = R_NODE;

  // All (layer, time) cells; the dormant field is the full set, built once.
  const allCells = useMemo(() => {
    const out: Cell[] = [];
    for (let l = 0; l <= L; l++) for (let t = 0; t < T; t++) out.push({ l, t });
    return out;
  }, [L, T]);

  // Every causal dilated edge at the (layer, time) level.
  const edges = useMemo(() => {
    const out: { l: number; t: number; pt: number }[] = [];
    for (let l = 1; l <= L; l++) {
      const d = Math.pow(BASE, l - 1);
      for (let t = 0; t < T; t++) {
        for (let j = 0; j < k; j++) {
          const pt = t - j * d;
          if (pt < 0) continue;
          out.push({ l, t, pt });
        }
      }
    }
    return out;
  }, [k, L, T]);

  // Receptive field of the spotlight output: walk the taps down to the inputs.
  const activeSet = useMemo(() => {
    const s = new Set<string>();
    const stack: Cell[] = [{ l: L, t: activeT }];
    s.add(`${L}:${activeT}`);
    while (stack.length) {
      const { l, t } = stack.pop() as Cell;
      if (l === 0) continue;
      const d = Math.pow(BASE, l - 1);
      for (let j = 0; j < k; j++) {
        const pt = t - j * d;
        if (pt < 0) continue;
        const key = `${l - 1}:${pt}`;
        if (!s.has(key)) { s.add(key); stack.push({ l: l - 1, t: pt }); }
      }
    }
    return s;
  }, [k, L, activeT, T]);
  const isActive = (l: number, t: number) => activeSet.has(`${l}:${t}`);

  // Active (non-spotlight) cells, rebuilt as the spotlight sweeps.
  const activeCells = useMemo(
    () => allCells.filter(c => isActive(c.l, c.t) && !(c.l === L && c.t === activeT)),
    [allCells, activeSet, L, activeT]
  );
  const spotCells = useMemo<Cell[]>(() => [{ l: L, t: activeT }], [L, activeT]);

  const layerLabel = (l: number) =>
    l === 0 ? 'Input' : l === L ? `Dilation ${Math.pow(BASE, l - 1)} (output)` : `Dilation ${Math.pow(BASE, l - 1)}`;

  return (
    <group>
      {/* dormant volume (all nodes, dim) */}
      <Nodes cells={allCells} layout={layout} radius={rBase} color={p.dorm} emissive={p.dormEmissive} emissiveIntensity={p.dormEI} />
      {/* active node: the other channels stay quiet (present but not the focus) */}
      <Nodes cells={activeCells} layout={layout} radius={rBase} channelMode="except" chIndex={chTrace}
        color={p.activeDim} emissive={p.activeDimEmissive} emissiveIntensity={p.activeDimEI} />
      {/* active node: the traced channel is bright and larger, drawing the cone */}
      <Nodes cells={activeCells} layout={layout} radius={rBase * 1.5} channelMode="one" chIndex={chTrace}
        color={p.active} emissive={p.activeEmissive} emissiveIntensity={p.activeEI} />
      {/* spotlight output: quiet other channels + bright traced channel */}
      <Nodes cells={spotCells} layout={layout} radius={rBase * 1.15} channelMode="except" chIndex={chTrace}
        color={p.spotDim} emissive={p.spotDimEmissive} emissiveIntensity={p.spotDimEI} />
      <Nodes cells={spotCells} layout={layout} radius={rBase * 2.0} channelMode="one" chIndex={chTrace}
        color={p.spot} emissive={p.spotEmissive} emissiveIntensity={p.spotEI} />

      {/* per-layer baseline guides: one faint line per layer across the full time
          span, on both faces of the volume, so each layer reads as its own band
          and the depth is bounded rather than a wall of merged lines. */}
      {Array.from({ length: L + 1 }, (_, l) => (
        [zEdge, -zEdge].map((z, fi) => (
          <Line key={`base-${l}-${fi}`}
            points={[[xAt(0), yAt(l), z], [xAt(T - 1), yAt(l), z]]}
            color={p.edge} lineWidth={0.8} transparent opacity={p.edgeOpacity * 0.8} />
        ))
      ))}

      {/* faint structural edges on the front face */}
      {showConnections && edges.map((e, i) => {
        if (isActive(e.l, e.t) && isActive(e.l - 1, e.pt)) return null;
        return (
          <Line key={`e-${i}`}
            points={[[xAt(e.pt), yAt(e.l - 1), zEdge], [xAt(e.t), yAt(e.l), zEdge]]}
            color={p.edge} lineWidth={0.6} transparent opacity={p.edgeOpacity} />
        );
      })}

      {/* bright receptive-field edges + signal pulses, on the traced channel plane.
          Following one channel keeps the cone a clean 1, 2, 4, 8 fan instead of a
          wall, while the dim nodes around it show the other channels still mixing in. */}
      {edges.map((e, i) => {
        if (!(isActive(e.l, e.t) && isActive(e.l - 1, e.pt))) return null;
        const a: [number, number, number] = [xAt(e.pt), yAt(e.l - 1), zTrace];
        const b: [number, number, number] = [xAt(e.t), yAt(e.l), zTrace];
        return (
          <group key={`ae-${i}`}>
            <Line points={[a, b]} color={p.edgeActive} lineWidth={1.9} />
            {animateFlow && <Pulse a={a} b={b} offset={(i % 7) / 7} speed={0.7} color={p.pulse} />}
          </group>
        );
      })}

      {/* labels on the front face */}
      {showLabels && Array.from({ length: L + 1 }, (_, l) => (
        <Text key={`lab-${l}`} position={[xAt(0) - 0.9, yAt(l), zEdge]} fontSize={0.22} color={p.labelDim} anchorX="right" anchorY="middle">
          {layerLabel(l)}
        </Text>
      ))}
      {showLabels && (
        <Text position={[xAt(activeT), yAt(L) + 0.55, zEdge]} fontSize={0.26} color={p.labelSpot} anchorX="center" anchorY="middle">
          {`output t = ${activeT}`}
        </Text>
      )}
      {showLabels && (
        <>
          <Text position={[xAt(0), yAt(0) - 0.7, zEdge]} fontSize={0.2} color={p.labelTime} anchorX="left" anchorY="middle">past</Text>
          <Text position={[xAt(T - 1), yAt(0) - 0.7, zEdge]} fontSize={0.2} color={p.labelTime} anchorX="right" anchorY="middle">time {'→'}</Text>
        </>
      )}
    </group>
  );
}

export default function TCNVisualization() {
  const isDark = useIsDarkTheme();
  const p = useMemo(() => palette(isDark), [isDark]);

  const [kernelSize, setKernelSize] = useState(2);
  const [numLayers, setNumLayers] = useState(4);
  const [channels, setChannels] = useState(16);
  const [showConnections, setShowConnections] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [animateFlow, setAnimateFlow] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [activeT, setActiveT] = useState(0);

  const [showHow, setShowHow] = useState(true);
  const [showConfig, setShowConfig] = useState(true);
  const [showVisual, setShowVisual] = useState(false);
  const [showStats, setShowStats] = useState(true);

  const controlsRef = useRef<any>(null);
  const resetCamera = () => controlsRef.current?.reset();

  const k = kernelSize;
  const L = numLayers;
  const RF = receptiveField(k, L);
  const T = Math.min(RF, 18);
  const topDilation = Math.pow(BASE, L - 1);
  const plainLayers = Math.ceil((RF - 1) / (k - 1));

  useEffect(() => { setActiveT(t => Math.min(t, T - 1)); }, [T]);

  // Sweep the spotlight output left to right and wrap.
  useEffect(() => {
    const id = setInterval(() => setActiveT(t => (t + 1) % T), 1100);
    return () => clearInterval(id);
  }, [T]);

  // Theme-driven overlay styling so the light mode reads as a light tool.
  // Panels are solid terminal chrome (bg-card/border-border), no translucency or blur.
  const panelCls = isDark
    ? 'bg-card text-[var(--text)] border-border'
    : 'bg-card text-zinc-900 border-border';
  const btnCls = isDark
    ? 'bg-card text-[var(--text)]'
    : 'bg-card text-zinc-900';
  const sub = isDark ? 'text-[var(--dim)]' : 'text-zinc-500';

  return (
    <div className={`relative w-full h-[calc(100vh-180px)] min-h-[600px] rounded-lg overflow-hidden border border-border ${isDark ? 'bg-[var(--bg)]' : 'bg-zinc-100'}`}>
      <Canvas camera={{ position: [4.5, 3.2, 11], fov: 50 }} style={{ background: p.bg }}>
        <ambientLight intensity={p.ambient} />
        <pointLight position={[10, 10, 14]} intensity={0.8} />
        <pointLight position={[-10, -6, -10]} intensity={0.3} />
        <directionalLight position={[5, 15, 8]} intensity={0.55} />

        <TCNScene
          k={k} L={L} channels={channels} activeT={activeT}
          showConnections={showConnections} showLabels={showLabels} animateFlow={animateFlow} p={p}
        />

        <OrbitControls
          ref={controlsRef}
          enablePan enableZoom enableRotate
          minDistance={4} maxDistance={160}
          autoRotate={autoRotate} autoRotateSpeed={0.6}
        />
      </Canvas>

      {/* Header */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className={`rounded-lg px-4 py-2 border flex items-center gap-2 ${panelCls}`}>
            <span className="font-semibold">Temporal Convolutional Network</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className={`h-4 w-4 cursor-help ${sub}`} />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="text-sm">Dilated causal convolutions in 3D. Time runs along x, layers stack up y, and channels (feature maps) give depth in z. The bright cone is the receptive field of the highlighted output; it only reaches into the past.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <Button variant={animateFlow ? 'default' : 'outline'} size="sm" onClick={() => setAnimateFlow(a => !a)} className={animateFlow ? '' : btnCls}>
            <Play className="h-4 w-4 mr-1" />{animateFlow ? 'Stop flow' : 'Run flow'}
          </Button>
          <Button variant="outline" size="sm" onClick={resetCamera} className={btnCls}>
            <RotateCcw className="h-4 w-4 mr-1" />Reset view
          </Button>
        </div>
      </div>

      {/* Left panel */}
      <div className="absolute left-4 top-20 w-72 space-y-2 pointer-events-auto max-h-[calc(100%-7rem)] overflow-y-auto">
        <Collapsible open={showHow} onOpenChange={setShowHow}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className={`w-full justify-between ${btnCls}`}>
              <span className="flex items-center gap-2"><Info className="h-4 w-4" />How it works</span>
              {showHow ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className={`mt-2 p-4 text-xs leading-relaxed ${panelCls}`}>
              The bottom plane is the input sequence, one column per time step. Each layer above
              convolves over only {k} taps, but the spacing between them doubles every layer.
              The highlighted output reaches back over {RF} steps through just {L} layers, and
              every connection points down and to the left, so it reads only its past. The {channels}
              {' '}sheets running into the screen are the channels (feature maps) each layer carries.
              The bright path follows one channel so the cone stays a clean 1, 2, 4, 8 fan; the
              dimmer nodes beside it are the other channels, which all mix into every output.
              Drag to orbit the cone.
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={showConfig} onOpenChange={setShowConfig}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className={`w-full justify-between ${btnCls}`}>
              <span className="flex items-center gap-2"><Settings className="h-4 w-4" />Architecture</span>
              {showConfig ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className={`mt-2 p-4 space-y-4 ${panelCls}`}>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className={`text-xs ${sub}`}>Layers</Label>
                  <span className="text-xs font-medium">{L}</span>
                </div>
                <Slider value={[L]} onValueChange={([v]) => setNumLayers(v)} min={2} max={10} step={1} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className={`text-xs ${sub}`}>Kernel size k</Label>
                  <span className="text-xs font-medium">{k}</span>
                </div>
                <Slider value={[k]} onValueChange={([v]) => setKernelSize(v)} min={2} max={3} step={1} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className={`text-xs ${sub}`}>Channels (feature maps)</Label>
                  <span className="text-xs font-medium">{channels}</span>
                </div>
                <Slider value={[channels]} onValueChange={([v]) => setChannels(v)} min={1} max={64} step={1} />
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={showVisual} onOpenChange={setShowVisual}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className={`w-full justify-between ${btnCls}`}>
              <span className="flex items-center gap-2"><Eye className="h-4 w-4" />Visual</span>
              {showVisual ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className={`mt-2 p-4 space-y-4 ${panelCls}`}>
              <div className="flex items-center justify-between">
                <Label className={`text-xs ${sub}`}>Show connections</Label>
                <Switch checked={showConnections} onCheckedChange={setShowConnections} />
              </div>
              <div className="flex items-center justify-between">
                <Label className={`text-xs ${sub}`}>Show labels</Label>
                <Switch checked={showLabels} onCheckedChange={setShowLabels} />
              </div>
              <div className="flex items-center justify-between">
                <Label className={`text-xs ${sub}`}>Auto rotate</Label>
                <Switch checked={autoRotate} onCheckedChange={setAutoRotate} />
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Right panel */}
      <div className="absolute right-4 top-20 w-60 pointer-events-auto">
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className={`w-full justify-between ${btnCls}`}>
              <span className="flex items-center gap-2"><Info className="h-4 w-4" />Receptive field</span>
              {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className={`mt-2 p-3 space-y-3 ${panelCls}`}>
              <StatRow label="Receptive field" value={`${RF} steps`} sub={sub} highlight />
              <StatRow label="Layers" value={`${L}`} sub={sub} />
              <StatRow label="Kernel size k" value={`${k}`} sub={sub} />
              <StatRow label="Top dilation" value={`${topDilation}`} sub={sub} />
              <StatRow label="Channels" value={`${channels}`} sub={sub} />
              <div className="pt-2 border-t border-border">
                <div className={`text-xs mb-1 ${sub}`}>Plain conv for same reach</div>
                <div className="text-sm font-mono text-[var(--text)]">{plainLayers} layers</div>
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Bottom hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className={`rounded-lg px-4 py-2 border flex items-center gap-4 text-xs ${panelCls} ${sub}`}>
          <span>Drag to rotate</span><span className="opacity-50">{'•'}</span>
          <span>Scroll to zoom</span><span className="opacity-50">{'•'}</span>
          <span>Right-click to pan</span>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={`text-xs ${sub}`}>{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-[var(--text)]' : ''}`}>{value}</span>
    </div>
  );
}
