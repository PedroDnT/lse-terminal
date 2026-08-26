import { useMemo, useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Layers, Info, ChevronDown, ChevronUp, Settings, Eye, EyeOff, RotateCcw, Maximize2, Grid3X3, Box } from 'lucide-react';
import { VolatilitySurfaceParams, ColorScheme, COLOR_SCHEMES } from './types';
import ColorSchemeSelector from './ColorSchemeSelector';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface SurfaceData {
  geometry: THREE.BufferGeometry;
  minZ: number;
  maxZ: number;
}

function VolSurface({ data, colorScheme, opacity }: { data: SurfaceData; colorScheme: ColorScheme; opacity: number }) {
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
        roughness={0.4}
        metalness={0.1}
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
      {/* Bottom grid */}
      <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[0, 0, 0]} />
      {/* Back wall grid */}
      <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[0, size / 2, -size / 2]} rotation={[Math.PI / 2, 0, 0]} />
      {/* Side wall grid */}
      <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[-size / 2, size / 2, 0]} rotation={[0, 0, Math.PI / 2]} />
    </group>
  );
}

function AxisLines({ show, range }: { show: boolean; range: number }) {
  if (!show) return null;

  return (
    <group>
      {/* X axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([-range, 0, 0, range, 0, 0])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#808080" />
      </line>
      {/* Y axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0, 0, 0, 0, range, 0])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#808080" />
      </line>
      {/* Z axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([0, 0, -range, 0, 0, range])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#808080" />
      </line>

      {/* Axis labels */}
      <Text position={[range + 0.5, 0, 0]} fontSize={0.4} color="#b0b0b0">Strike</Text>
      <Text position={[0, range + 0.5, 0]} fontSize={0.4} color="#b0b0b0">IV</Text>
      <Text position={[0, 0, range + 0.5]} fontSize={0.4} color="#b0b0b0">Expiry</Text>
    </group>
  );
}

function AutoRotate({ enabled, speed }: { enabled: boolean; speed: number }) {
  const controlsRef = useRef<any>(null);

  useFrame(() => {
    if (enabled && controlsRef.current) {
      controlsRef.current.autoRotate = true;
      controlsRef.current.autoRotateSpeed = speed;
    }
  });

  return null;
}

export default function VolatilitySurfaceVisualization() {
  const [params, setParams] = useState<VolatilitySurfaceParams>({
    spotPrice: 100,
    riskFreeRate: 0.05,
    atmVol: 0.20,
    skew: -0.15,
    kurtosis: 0.05,
    termStructure: 0.03,
  });

  const [colorScheme, setColorScheme] = useState<ColorScheme>(COLOR_SCHEMES[4]);

  // Visual settings
  const [showWireframe, setShowWireframe] = useState(true);
  const [wireframeOpacity, setWireframeOpacity] = useState(0.15);
  const [surfaceOpacity, setSurfaceOpacity] = useState(0.95);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [rotateSpeed, setRotateSpeed] = useState(1);

  // Surface resolution
  const [resolution, setResolution] = useState(40);

  // Panel states
  const [showParams, setShowParams] = useState(true);
  const [showVisuals, setShowVisuals] = useState(false);
  const [showStats, setShowStats] = useState(true);

  const surfaceData = useMemo(() => {
    const strikesCount = resolution;
    const expiriesCount = resolution;
    const strikes = Array.from({ length: strikesCount }, (_, i) => 0.7 + (i / (strikesCount - 1)) * 0.6);
    const expiries = Array.from({ length: expiriesCount }, (_, i) => 0.1 + (i / (expiriesCount - 1)) * 1.9);

    // First pass: calculate all IV values to find min/max for normalization
    const ivValues: number[][] = [];
    let rawMinIV = Infinity, rawMaxIV = -Infinity;

    for (let i = 0; i < expiriesCount; i++) {
      ivValues[i] = [];
      for (let j = 0; j < strikesCount; j++) {
        const T = expiries[i];
        const K = strikes[j] * params.spotPrice;
        const moneyness = Math.log(K / params.spotPrice);

        const smile = params.atmVol + params.skew * moneyness + params.kurtosis * moneyness * moneyness;
        const termEffect = params.termStructure * Math.sqrt(T);
        const iv = Math.max(0.01, smile + termEffect);

        ivValues[i][j] = iv;
        rawMinIV = Math.min(rawMinIV, iv);
        rawMaxIV = Math.max(rawMaxIV, iv);
      }
    }

    // Second pass: generate normalized vertices that fit within Y range 0-8
    const vertices: number[] = [];
    const indices: number[] = [];
    const targetYMin = 0.5;
    const targetYMax = 8;
    const ivRange = rawMaxIV - rawMinIV || 1; // Avoid division by zero

    for (let i = 0; i < expiriesCount; i++) {
      for (let j = 0; j < strikesCount; j++) {
        const iv = ivValues[i][j];

        const x = (strikes[j] - 0.7) / 0.6 * 10 - 5;
        // Normalize IV to fit within target Y range
        const normalizedIV = (iv - rawMinIV) / ivRange;
        const y = targetYMin + normalizedIV * (targetYMax - targetYMin);
        const z = expiries[i] * 5;

        vertices.push(x, y, z);

        if (i < expiriesCount - 1 && j < strikesCount - 1) {
          const a = i * strikesCount + j;
          const b = a + 1;
          const c = a + strikesCount;
          const d = c + 1;
          indices.push(a, b, c);
          indices.push(b, d, c);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Return both display and actual IV ranges for statistics
    return { geometry, minZ: targetYMin, maxZ: targetYMax, rawMinIV, rawMaxIV };
  }, [params, resolution]);

  const controlsRef = useRef<any>(null);

  const resetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  return (
    <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[var(--bg)] rounded-lg overflow-hidden border border-border">
      {/* Main 3D Canvas - Full Size */}
      <Canvas
        camera={{ position: [15, 10, 15], fov: 45 }}
        style={{ background: 'var(--bg, #1c1c1c)' }}
      >
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 20, 10]} intensity={1.2} />
        <directionalLight position={[-10, 15, 10]} intensity={0.8} />
        <directionalLight position={[10, -10, -10]} intensity={0.3} />

        <ImmersiveGrid show={showGrid} size={20} />
        <AxisLines show={showAxes} range={8} />

        <VolSurface data={surfaceData} colorScheme={colorScheme} opacity={surfaceOpacity} />
        {showWireframe && <WireframeSurface data={surfaceData} opacity={wireframeOpacity} />}

        <OrbitControls
          ref={controlsRef}
          enablePan
          enableZoom
          enableRotate
          minDistance={5}
          maxDistance={60}
          autoRotate={autoRotate}
          autoRotateSpeed={rotateSpeed}
        />
      </Canvas>

      {/* Floating Header */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-2 text-[var(--text)]">
            <span className="font-semibold text-[var(--text)]">Implied Volatility Surface</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-[var(--dim)] cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="text-sm">
                    3D visualization of implied volatility across different strike prices
                    and expiration dates. Adjust all parameters in real-time.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          <Button variant="outline" size="sm" onClick={resetCamera} className="bg-card text-[var(--text)] hover:text-[var(--text)]">
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset View
          </Button>
        </div>
      </div>

      {/* Left Panel - Parameters */}
      <div className="absolute left-4 top-20 w-72 space-y-2 pointer-events-auto">
        <Collapsible open={showParams} onOpenChange={setShowParams}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)] hover:text-[var(--text)]">
              <span className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Surface Parameters
              </span>
              {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[var(--text)]">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[var(--dim)]">ATM Volatility</Label>
                  <span className="text-xs font-medium text-[var(--text)]">{(params.atmVol * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[params.atmVol * 100]}
                  onValueChange={([v]) => setParams(p => ({ ...p, atmVol: v / 100 }))}
                  min={5}
                  max={80}
                  step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[var(--dim)]">Skew</Label>
                  <span className="text-xs font-medium text-[var(--text)]">{(params.skew * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[params.skew * 100]}
                  onValueChange={([v]) => setParams(p => ({ ...p, skew: v / 100 }))}
                  min={-50}
                  max={20}
                  step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[var(--dim)]">Kurtosis (Smile)</Label>
                  <span className="text-xs font-medium text-[var(--text)]">{(params.kurtosis * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[params.kurtosis * 100]}
                  onValueChange={([v]) => setParams(p => ({ ...p, kurtosis: v / 100 }))}
                  min={0}
                  max={30}
                  step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[var(--dim)]">Term Structure</Label>
                  <span className="text-xs font-medium text-[var(--text)]">{(params.termStructure * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[params.termStructure * 100]}
                  onValueChange={([v]) => setParams(p => ({ ...p, termStructure: v / 100 }))}
                  min={-15}
                  max={20}
                  step={1}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[var(--dim)]">Risk-Free Rate</Label>
                  <span className="text-xs font-medium text-[var(--text)]">{(params.riskFreeRate * 100).toFixed(1)}%</span>
                </div>
                <Slider
                  value={[params.riskFreeRate * 100]}
                  onValueChange={([v]) => setParams(p => ({ ...p, riskFreeRate: v / 100 }))}
                  min={0}
                  max={15}
                  step={0.5}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[var(--dim)]">Spot Price</Label>
                  <span className="text-xs font-medium text-[var(--text)]">${params.spotPrice}</span>
                </div>
                <Slider
                  value={[params.spotPrice]}
                  onValueChange={([v]) => setParams(p => ({ ...p, spotPrice: v }))}
                  min={10}
                  max={500}
                  step={10}
                />
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={showVisuals} onOpenChange={setShowVisuals}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)] hover:text-[var(--text)]">
              <span className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Visual Settings
              </span>
              {showVisuals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[var(--text)]">
              <ColorSchemeSelector value={colorScheme.id} onChange={setColorScheme} />

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[var(--dim)]">Surface Opacity</Label>
                  <span className="text-xs font-medium text-[var(--text)]">{(surfaceOpacity * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[surfaceOpacity * 100]}
                  onValueChange={([v]) => setSurfaceOpacity(v / 100)}
                  min={20}
                  max={100}
                  step={5}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs text-[var(--dim)]">Wireframe</Label>
                <Switch checked={showWireframe} onCheckedChange={setShowWireframe} />
              </div>

              {showWireframe && (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-[var(--dim)]">Wireframe Opacity</Label>
                    <span className="text-xs font-medium text-[var(--text)]">{(wireframeOpacity * 100).toFixed(0)}%</span>
                  </div>
                  <Slider
                    value={[wireframeOpacity * 100]}
                    onValueChange={([v]) => setWireframeOpacity(v / 100)}
                    min={5}
                    max={50}
                    step={5}
                  />
                </div>
              )}

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs text-[var(--dim)]">Resolution</Label>
                  <span className="text-xs font-medium text-[var(--text)]">{resolution}×{resolution}</span>
                </div>
                <Slider
                  value={[resolution]}
                  onValueChange={([v]) => setResolution(v)}
                  min={20}
                  max={80}
                  step={10}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs text-[var(--dim)] flex items-center gap-1">
                  <Grid3X3 className="h-3 w-3" /> Grid
                </Label>
                <Switch checked={showGrid} onCheckedChange={setShowGrid} />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs text-[var(--dim)] flex items-center gap-1">
                  <Box className="h-3 w-3" /> Axes
                </Label>
                <Switch checked={showAxes} onCheckedChange={setShowAxes} />
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-xs text-[var(--dim)]">Auto Rotate</Label>
                <Switch checked={autoRotate} onCheckedChange={setAutoRotate} />
              </div>

              {autoRotate && (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-[var(--dim)]">Rotation Speed</Label>
                    <span className="text-xs font-medium text-[var(--text)]">{rotateSpeed}×</span>
                  </div>
                  <Slider
                    value={[rotateSpeed]}
                    onValueChange={([v]) => setRotateSpeed(v)}
                    min={0.5}
                    max={5}
                    step={0.5}
                  />
                </div>
              )}
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Right Panel - Statistics */}
      <div className="absolute right-4 top-20 w-56 pointer-events-auto">
        <Collapsible open={showStats} onOpenChange={setShowStats}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)] hover:text-[var(--text)]">
              <span className="flex items-center gap-2">
                <Info className="h-4 w-4" />
                Statistics
              </span>
              {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card className="mt-2 p-3 bg-card border-border space-y-3 text-[var(--text)]">
              <div className="flex justify-between">
                <span className="text-xs text-[var(--dim)]">ATM IV (1Y)</span>
                <span className="text-sm font-medium text-[var(--text)]">{(params.atmVol * 100 + params.termStructure * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-[var(--dim)]">25Δ Put Skew</span>
                <span className="text-sm font-medium text-[var(--text)]">{(params.skew * -15).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-[var(--dim)]">Butterfly</span>
                <span className="text-sm font-medium text-[var(--text)]">{(params.kurtosis * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-[var(--dim)]">Term Structure</span>
                <span className="text-sm font-medium text-[var(--text)]">
                  {params.termStructure > 0 ? 'Contango' : params.termStructure < 0 ? 'Backwardation' : 'Flat'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-[var(--dim)]">Risk-Free Rate</span>
                <span className="text-sm font-medium text-[var(--text)]">{(params.riskFreeRate * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-[var(--dim)]">Spot Price</span>
                <span className="text-sm font-medium text-[var(--text)]">${params.spotPrice}</span>
              </div>

              <div className="pt-2 border-t border-border">
                <div className="text-xs text-[var(--dim)] mb-2">IV Scale</div>
                <div className="flex h-3 rounded overflow-hidden">
                  {colorScheme.colors.map((color, i) => (
                    <div key={i} className="flex-1" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <div className="flex justify-between text-xs text-[var(--dim)] mt-1">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </div>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-4 text-xs text-[var(--dim)] text-[var(--text)]">
          <span>Drag to rotate</span>
          <span className="text-border">•</span>
          <span>Scroll to zoom</span>
          <span className="text-border">•</span>
          <span>Right-click to pan</span>
          <span className="text-border">•</span>
          <span>Resolution: {resolution}²</span>
        </div>
      </div>
    </div>
  );
}
