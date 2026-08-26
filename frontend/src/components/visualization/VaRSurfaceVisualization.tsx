import { useMemo, useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Info, ChevronDown, ChevronUp, Settings, Eye, RotateCcw, Grid3X3, Box } from 'lucide-react';
import { VaRSurfaceParams, ColorScheme, COLOR_SCHEMES } from './types';
import ColorSchemeSelector from './ColorSchemeSelector';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface SurfaceData {
  geometry: THREE.BufferGeometry;
  minZ: number;
  maxZ: number;
}

function RiskSurface({ data, colorScheme, opacity }: { data: SurfaceData; colorScheme: ColorScheme; opacity: number }) {
  const coloredGeometry = useMemo(() => {
    const geo = data.geometry.clone();
    const positions = geo.attributes.position.array;
    const colors = new Float32Array(positions.length);

    for (let i = 0; i < positions.length; i += 3) {
      const z = positions[i + 2];
      const color = new THREE.Color(colorScheme.getColor(z, data.minZ, data.maxZ));
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [data, colorScheme]);

  return (
    <mesh geometry={coloredGeometry} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial
        vertexColors
        side={THREE.DoubleSide}
        roughness={0.3}
        metalness={0.2}
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

function WireframeSurface({ data, opacity }: { data: SurfaceData; opacity: number }) {
  return (
    <mesh geometry={data.geometry} rotation={[-Math.PI / 2, 0, 0]}>
      <meshBasicMaterial
        color="#e8e8e8"
        wireframe
        transparent
        opacity={opacity}
      />
    </mesh>
  );
}

function ImmersiveGrid({ show, size = 20 }: { show: boolean; size?: number }) {
  if (!show) return null;
  return (
    <group>
      <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[0, 0, 0]} />
      <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[0, size / 2, -size / 2]} rotation={[Math.PI / 2, 0, 0]} />
      <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[-size / 2, size / 2, 0]} rotation={[0, 0, Math.PI / 2]} />
    </group>
  );
}

function AxisLines({ show, range }: { show: boolean; range: number }) {
  if (!show) return null;
  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={2} array={new Float32Array([-range, 0, 0, range, 0, 0])} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color="#808080" />
      </line>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={2} array={new Float32Array([0, 0, 0, 0, range, 0])} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color="#808080" />
      </line>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={2} array={new Float32Array([0, 0, -range, 0, 0, range])} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color="#808080" />
      </line>
      <Text position={[range + 0.5, 0, 0]} fontSize={0.4} color="#b0b0b0">Lookback</Text>
      <Text position={[0, range + 0.5, 0]} fontSize={0.4} color="#b0b0b0">Intensity</Text>
      <Text position={[0, 0, range + 0.5]} fontSize={0.4} color="#b0b0b0">Confidence</Text>
    </group>
  );
}

export default function VaRSurfaceVisualization() {
  const [params, setParams] = useState<VaRSurfaceParams>({
    lookbackPeriods: 50,
    confidenceLevels: 20,
    tailExponent: 2.5,
    clusterIntensity: 0.6,
  });

  const [colorScheme, setColorScheme] = useState<ColorScheme>(COLOR_SCHEMES[4]);
  const [showWireframe, setShowWireframe] = useState(true);
  const [wireframeOpacity, setWireframeOpacity] = useState(0.12);
  const [surfaceOpacity, setSurfaceOpacity] = useState(0.92);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [rotateSpeed, setRotateSpeed] = useState(1);
  const [resolution, setResolution] = useState(40);
  const [showParams, setShowParams] = useState(true);
  const [showVisuals, setShowVisuals] = useState(false);
  const [showStats, setShowStats] = useState(true);

  const surfaceData = useMemo(() => {
    const lookbackCount = resolution;
    const confidenceCount = resolution;
    const lookbacks = Array.from({ length: lookbackCount }, (_, i) => 20 + (i / (lookbackCount - 1)) * 230);
    const confidences = Array.from({ length: confidenceCount }, (_, i) => 0.90 + (i / (confidenceCount - 1)) * 0.099);

    const vertices: number[] = [];
    const indices: number[] = [];
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < lookbackCount; i++) {
      for (let j = 0; j < confidenceCount; j++) {
        const lookback = lookbacks[i];
        const confidence = confidences[j];

        const baseIntensity = Math.pow(1 - confidence, -params.tailExponent) / 100;
        const lookbackEffect = Math.pow(params.lookbackPeriods / lookback, 1.5);
        const clusterEffect = params.clusterIntensity * Math.sin(lookback / 30) * Math.cos(confidence * 20);
        const intensity = baseIntensity * lookbackEffect * (1 + Math.abs(clusterEffect));

        const x = (lookback - 20) / 230 * 10 - 5;
        const y = Math.log1p(intensity * 10) * 3;
        const z = (confidence - 0.90) / 0.099 * 10;

        vertices.push(x, y, z);
        minZ = Math.min(minZ, y);
        maxZ = Math.max(maxZ, y);

        if (i < lookbackCount - 1 && j < confidenceCount - 1) {
          const a = i * confidenceCount + j;
          indices.push(a, a + 1, a + confidenceCount);
          indices.push(a + 1, a + confidenceCount + 1, a + confidenceCount);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return { geometry, minZ, maxZ };
  }, [params, resolution]);

  const metrics = useMemo(() => {
    const var99 = 5.79 + (params.tailExponent - 2) * 1.5 + (1 - params.clusterIntensity) * 0.8;
    const es = var99 * (1 + 0.3 * params.clusterIntensity + 0.2 * (params.tailExponent - 2));
    return {
      var99: var99.toFixed(2),
      es: es.toFixed(2),
      esVarRatio: (es / var99).toFixed(2),
      exceedance: (1.5 + params.clusterIntensity * 0.8).toFixed(1),
      tailAlpha: params.tailExponent.toFixed(2),
      cluster: (params.clusterIntensity * 100).toFixed(0),
    };
  }, [params]);

  const controlsRef = useRef<any>(null);
  const resetCamera = () => controlsRef.current?.reset();

  return (
    <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[var(--bg)] rounded-lg overflow-hidden border border-border">
      <Canvas
        camera={{ position: [18, 12, 15], fov: 45 }}
        style={{ background: '#1c1c1c' }} // flat terminal bg; three.js canvas cannot resolve CSS vars, so hex fallback
      >
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 20, 10]} intensity={1.2} />
        <directionalLight position={[-10, 15, 10]} intensity={0.8} />

        <ImmersiveGrid show={showGrid} size={20} />
        <AxisLines show={showAxes} range={8} />

        <RiskSurface data={surfaceData} colorScheme={colorScheme} opacity={surfaceOpacity} />
        {showWireframe && <WireframeSurface data={surfaceData} opacity={wireframeOpacity} />}

        {/* Danger zone marker */}
        <Text position={[4, surfaceData.maxZ + 1, 8]} fontSize={0.5} color="#f0426c">TAIL DANGER</Text>

        <OrbitControls
          ref={controlsRef}
          enablePan enableZoom enableRotate
          minDistance={5} maxDistance={60}
          autoRotate={autoRotate} autoRotateSpeed={rotateSpeed}
        />
      </Canvas>

      {/* Header */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-2 text-[var(--text)]">
            <span className="font-semibold text-[var(--text)]">VaR Failure Intensity Surface</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-[var(--dim)] cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="text-sm">Risk surface showing VaR model failure intensity across lookback horizons and confidence levels.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={resetCamera} className="bg-card pointer-events-auto text-[var(--text)] hover:text-[var(--text)]">
          <RotateCcw className="h-4 w-4 mr-1" /> Reset
        </Button>
      </div>

      {/* Left Panel */}
      <div className="absolute left-4 top-20 w-72 space-y-2 pointer-events-auto">
        <Collapsible open={showParams} onOpenChange={setShowParams}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)]">
              <span className="flex items-center gap-2"><Settings className="h-4 w-4" /> Risk Parameters</span>
              {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[var(--text)]">
              <div className="space-y-2">
                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Lookback Period</Label><span className="text-xs font-medium text-[var(--text)]">{params.lookbackPeriods} days</span></div>
                <Slider value={[params.lookbackPeriods]} onValueChange={([v]) => setParams(p => ({ ...p, lookbackPeriods: v }))} min={20} max={250} step={10} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Tail Exponent (α)</Label><span className="text-xs font-medium text-[var(--text)]">{params.tailExponent.toFixed(1)}</span></div>
                <Slider value={[params.tailExponent * 10]} onValueChange={([v]) => setParams(p => ({ ...p, tailExponent: v / 10 }))} min={15} max={45} step={1} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Cluster Intensity</Label><span className="text-xs font-medium text-[var(--text)]">{(params.clusterIntensity * 100).toFixed(0)}%</span></div>
                <Slider value={[params.clusterIntensity * 100]} onValueChange={([v]) => setParams(p => ({ ...p, clusterIntensity: v / 100 }))} min={0} max={100} step={5} />
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={showVisuals} onOpenChange={setShowVisuals}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)]">
              <span className="flex items-center gap-2"><Eye className="h-4 w-4" /> Visuals</span>
              {showVisuals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[var(--text)]">
              <ColorSchemeSelector value={colorScheme.id} onChange={setColorScheme} />
              <div className="space-y-2">
                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Surface Opacity</Label><span className="text-xs font-medium text-[var(--text)]">{(surfaceOpacity * 100).toFixed(0)}%</span></div>
                <Slider value={[surfaceOpacity * 100]} onValueChange={([v]) => setSurfaceOpacity(v / 100)} min={20} max={100} step={5} />
              </div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)]">Wireframe</Label><Switch checked={showWireframe} onCheckedChange={setShowWireframe} /></div>
              <div className="space-y-2">
                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Resolution</Label><span className="text-xs font-medium text-[var(--text)]">{resolution}²</span></div>
                <Slider value={[resolution]} onValueChange={([v]) => setResolution(v)} min={20} max={80} step={10} />
              </div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)]"><Grid3X3 className="h-3 w-3 inline mr-1" />Grid</Label><Switch checked={showGrid} onCheckedChange={setShowGrid} /></div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)]"><Box className="h-3 w-3 inline mr-1" />Axes</Label><Switch checked={showAxes} onCheckedChange={setShowAxes} /></div>
              <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)]">Auto Rotate</Label><Switch checked={autoRotate} onCheckedChange={setAutoRotate} /></div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Right Panel - Stats */}
      <div className="absolute right-4 top-20 w-56 pointer-events-auto">
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)]">
              <span className="flex items-center gap-2"><Info className="h-4 w-4" /> Risk Metrics</span>
              {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-3 bg-card border-border space-y-3 text-[var(--text)]">
              <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">VaR(99%)</span><span className="text-sm font-medium text-[var(--down)]">{metrics.var99}%</span></div>
              <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">Expected Shortfall</span><span className="text-sm font-medium text-[#c58435]">{metrics.es}%</span></div>
              <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">ES/VaR Ratio</span><span className="text-sm font-medium text-[var(--text)]">{metrics.esVarRatio}×</span></div>
              <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">Exceedance</span><span className="text-sm font-medium text-[var(--text)]">{metrics.exceedance}×</span></div>
              <div className="flex justify-between">
                <span className="text-xs text-[var(--dim)]">Tail α</span>
                <span className={`text-sm font-medium ${parseFloat(metrics.tailAlpha) < 2 ? 'text-[var(--down)]' : parseFloat(metrics.tailAlpha) < 2.5 ? 'text-[#c58435]' : 'text-[var(--text)]'}`}>
                  {metrics.tailAlpha} ({parseFloat(metrics.tailAlpha) < 2 ? 'INFINITE' : parseFloat(metrics.tailAlpha) < 2.5 ? 'VERY FAT' : 'FAT'})
                </span>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="text-xs text-[var(--dim)] mb-2">Risk Scale</div>
                <div className="flex h-3 rounded overflow-hidden">
                  {colorScheme.colors.map((color, i) => (<div key={i} className="flex-1" style={{ backgroundColor: color }} />))}
                </div>
                <div className="flex justify-between text-xs text-[var(--dim)] mt-1"><span>Safe</span><span>Danger</span></div>
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Bottom */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-4 text-xs text-[var(--dim)] text-[var(--text)]">
          <span>Drag to rotate</span><span className="text-border">•</span>
          <span>Scroll to zoom</span><span className="text-border">•</span>
          <span>Right-click to pan</span>
        </div>
      </div>
    </div>
  );
}
