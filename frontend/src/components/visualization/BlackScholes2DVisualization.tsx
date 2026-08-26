import { useMemo, useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Calculator, Info, ChevronDown, ChevronUp, Settings, Eye, RotateCcw, Grid3X3, Box } from 'lucide-react';
import { ColorScheme, COLOR_SCHEMES } from './types';
import ColorSchemeSelector from './ColorSchemeSelector';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// Cumulative normal distribution
function normalCDF(x: number): number {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
}

// Black-Scholes pricing
function blackScholesPrice(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
    if (T <= 0) return isCall ? Math.max(S - K, 0) : Math.max(K - S, 0);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    if (isCall) {
        return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
    } else {
        return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
    }
}

// Black-Scholes Delta
function blackScholesDelta(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
    if (T <= 0) return isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    return isCall ? normalCDF(d1) : normalCDF(d1) - 1;
}

interface SurfaceData {
    geometry: THREE.BufferGeometry;
    minZ: number;
    maxZ: number;
}

function OptionSurface({ data, colorScheme, opacity }: { data: SurfaceData; colorScheme: ColorScheme; opacity: number }) {
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
            <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.4} metalness={0.1} transparent opacity={opacity} />
        </mesh>
    );
}

function WireframeSurface({ data, opacity }: { data: SurfaceData; opacity: number }) {
    return (
        <mesh geometry={data.geometry} rotation={[-Math.PI / 2, 0, 0]}>
            <meshBasicMaterial color="#e8e8e8" wireframe transparent opacity={opacity} />
        </mesh>
    );
}

function ImmersiveGrid({ show, size = 20 }: { show: boolean; size?: number }) {
    if (!show) return null;
    return (
        <group>
            {/* three.js cannot resolve CSS vars; hex fallbacks: --edge center lines, #2e2e2e grid */}
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
            <line><bufferGeometry><bufferAttribute attach="attributes-position" count={2} array={new Float32Array([-range, 0, 0, range, 0, 0])} itemSize={3} /></bufferGeometry><lineBasicMaterial color="#808080" /></line>
            <line><bufferGeometry><bufferAttribute attach="attributes-position" count={2} array={new Float32Array([0, 0, 0, 0, range, 0])} itemSize={3} /></bufferGeometry><lineBasicMaterial color="#808080" /></line>
            <line><bufferGeometry><bufferAttribute attach="attributes-position" count={2} array={new Float32Array([0, 0, -range, 0, 0, range])} itemSize={3} /></bufferGeometry><lineBasicMaterial color="#808080" /></line>
            <Text position={[range + 0.5, 0, 0]} fontSize={0.4} color="#b0b0b0">Spot</Text>
            <Text position={[0, range + 0.5, 0]} fontSize={0.4} color="#b0b0b0">Value</Text>
            <Text position={[0, 0, range + 0.5]} fontSize={0.4} color="#b0b0b0">Time</Text>
        </group>
    );
}

type SurfaceMode = 'price' | 'delta';

export default function BlackScholes2DVisualization() {
    const [strikePrice, setStrikePrice] = useState(100);
    const [volatility, setVolatility] = useState(25);
    const [riskFreeRate, setRiskFreeRate] = useState(5);
    const [isCall, setIsCall] = useState(true);
    const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>('price');
    const [colorScheme, setColorScheme] = useState<ColorScheme>(COLOR_SCHEMES[4]);

    const [showWireframe, setShowWireframe] = useState(true);
    const [wireframeOpacity, setWireframeOpacity] = useState(0.15);
    const [surfaceOpacity, setSurfaceOpacity] = useState(0.95);
    const [showGrid, setShowGrid] = useState(true);
    const [showAxes, setShowAxes] = useState(true);
    const [autoRotate, setAutoRotate] = useState(false);
    const [rotateSpeed, setRotateSpeed] = useState(1);
    const [resolution, setResolution] = useState(40);

    const [showParams, setShowParams] = useState(true);
    const [showVisuals, setShowVisuals] = useState(false);
    const [showStats, setShowStats] = useState(true);

    const controlsRef = useRef<any>(null);

    const surfaceData = useMemo(() => {
        const spotCount = resolution;
        const timeCount = resolution;
        const spots = Array.from({ length: spotCount }, (_, i) => 0.5 + (i / (spotCount - 1)) * 1.0); // 50% to 150% of strike
        const times = Array.from({ length: timeCount }, (_, i) => 0.02 + (i / (timeCount - 1)) * 1.98); // 0.02 to 2 years

        const vertices: number[] = [];
        const indices: number[] = [];
        let minZ = Infinity, maxZ = -Infinity;

        const sigma = volatility / 100;
        const r = riskFreeRate / 100;

        for (let i = 0; i < timeCount; i++) {
            for (let j = 0; j < spotCount; j++) {
                const T = times[i];
                const S = spots[j] * strikePrice;

                let value: number;
                if (surfaceMode === 'price') {
                    value = blackScholesPrice(S, strikePrice, T, r, sigma, isCall);
                } else {
                    value = blackScholesDelta(S, strikePrice, T, r, sigma, isCall);
                    value = value * 20; // Scale delta for visibility
                }

                const x = (spots[j] - 0.5) / 1.0 * 10 - 5; // Map 0.5-1.5 to -5 to 5
                const y = surfaceMode === 'price' ? value / 5 : value; // Scale price
                const z = T * 5; // Map 0-2Y to 0-10

                vertices.push(x, y, z);
                minZ = Math.min(minZ, y);
                maxZ = Math.max(maxZ, y);

                if (i < timeCount - 1 && j < spotCount - 1) {
                    const a = i * spotCount + j;
                    const b = a + 1;
                    const c = a + spotCount;
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

        return { geometry, minZ, maxZ };
    }, [strikePrice, volatility, riskFreeRate, isCall, surfaceMode, resolution]);

    const stats = useMemo(() => {
        const sigma = volatility / 100;
        const r = riskFreeRate / 100;
        const atmPrice = blackScholesPrice(strikePrice, strikePrice, 1, r, sigma, isCall);
        const atmDelta = blackScholesDelta(strikePrice, strikePrice, 1, r, sigma, isCall);
        return { atmPrice, atmDelta };
    }, [strikePrice, volatility, riskFreeRate, isCall]);

    const resetCamera = () => { if (controlsRef.current) controlsRef.current.reset(); };

    return (
        <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[var(--bg)] rounded-lg overflow-hidden border border-border">
            {/* WebGL canvas background: hex fallback for var(--bg), CSS vars do not resolve in three.js */}
            <Canvas camera={{ position: [15, 10, 15], fov: 45 }} style={{ background: '#1c1c1c' }}>
                <ambientLight intensity={0.4} />
                <pointLight position={[10, 20, 10]} intensity={1.2} />
                <directionalLight position={[-10, 15, 10]} intensity={0.8} />
                <directionalLight position={[10, -10, -10]} intensity={0.3} />

                <ImmersiveGrid show={showGrid} size={20} />
                <AxisLines show={showAxes} range={8} />

                <OptionSurface data={surfaceData} colorScheme={colorScheme} opacity={surfaceOpacity} />
                {showWireframe && <WireframeSurface data={surfaceData} opacity={wireframeOpacity} />}

                <OrbitControls ref={controlsRef} enablePan enableZoom enableRotate minDistance={5} maxDistance={60} autoRotate={autoRotate} autoRotateSpeed={rotateSpeed} />
            </Canvas>

            {/* Header */}
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
                <div className="flex items-center gap-3 pointer-events-auto">
                    <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-2">
                        
                        <span className="font-semibold font-mono">3D BLACK-SCHOLES {surfaceMode === 'price' ? 'PRICE' : 'DELTA'} SURFACE</span>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild><Info className="h-4 w-4 text-[var(--dim)] cursor-help" /></TooltipTrigger>
                                <TooltipContent className="max-w-sm font-mono"><p className="text-sm">C = S·N(d₁) - K·e^(-rT)·N(d₂)</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <div className={`px-3 py-1 rounded text-xs font-mono font-semibold bg-[var(--bg2)] border border-[var(--edge)] ${isCall ? 'text-[var(--up)]' : 'text-[var(--down)]'}`}>
                        {isCall ? 'CALL' : 'PUT'}
                    </div>
                </div>
                <div className="flex items-center gap-2 pointer-events-auto">
                    <Button variant="outline" size="sm" onClick={resetCamera} className="bg-card">
                        <RotateCcw className="h-4 w-4 mr-1" />Reset View
                    </Button>
                </div>
            </div>

            {/* Left Panel */}
            <div className="absolute left-4 top-20 w-72 space-y-2 pointer-events-auto max-h-[calc(100%-140px)] overflow-y-auto">
                <Collapsible open={showParams} onOpenChange={setShowParams}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs">
                            <span className="flex items-center gap-2"><Settings className="h-4 w-4" /> PARAMETERS</span>
                            {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-4 bg-card border-border space-y-4">
                            <div className="flex gap-2">
                                <Button variant={isCall ? 'default' : 'outline'} size="sm" onClick={() => setIsCall(true)} className="flex-1 font-mono text-xs">CALL</Button>
                                <Button variant={!isCall ? 'default' : 'outline'} size="sm" onClick={() => setIsCall(false)} className="flex-1 font-mono text-xs">PUT</Button>
                            </div>
                            <div className="flex gap-2">
                                <Button variant={surfaceMode === 'price' ? 'default' : 'outline'} size="sm" onClick={() => setSurfaceMode('price')} className="flex-1 font-mono text-xs">PRICE</Button>
                                <Button variant={surfaceMode === 'delta' ? 'default' : 'outline'} size="sm" onClick={() => setSurfaceMode('delta')} className="flex-1 font-mono text-xs">DELTA</Button>
                            </div>
                            <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">STRIKE (K)</Label><span className="text-xs">${strikePrice}</span></div><Slider value={[strikePrice]} onValueChange={([v]) => setStrikePrice(v)} min={50} max={200} step={5} /></div>
                            <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">VOL (σ)</Label><span className="text-xs">{volatility}%</span></div><Slider value={[volatility]} onValueChange={([v]) => setVolatility(v)} min={5} max={100} step={1} /></div>
                            <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">RATE (r)</Label><span className="text-xs">{riskFreeRate}%</span></div><Slider value={[riskFreeRate]} onValueChange={([v]) => setRiskFreeRate(v)} min={0} max={15} step={0.5} /></div>
                        </Card>
                    </CollapsibleContent>
                </Collapsible>

                <Collapsible open={showVisuals} onOpenChange={setShowVisuals}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs">
                            <span className="flex items-center gap-2"><Eye className="h-4 w-4" /> DISPLAY</span>
                            {showVisuals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-4 bg-card border-border space-y-4">
                            <ColorSchemeSelector value={colorScheme.id} onChange={setColorScheme} />
                            <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">OPACITY</Label><span className="text-xs">{(surfaceOpacity * 100).toFixed(0)}%</span></div><Slider value={[surfaceOpacity * 100]} onValueChange={([v]) => setSurfaceOpacity(v / 100)} min={20} max={100} step={5} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono">WIREFRAME</Label><Switch checked={showWireframe} onCheckedChange={setShowWireframe} /></div>
                            {showWireframe && <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">WIRE OPACITY</Label><span className="text-xs">{(wireframeOpacity * 100).toFixed(0)}%</span></div><Slider value={[wireframeOpacity * 100]} onValueChange={([v]) => setWireframeOpacity(v / 100)} min={5} max={50} step={5} /></div>}
                            <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">RESOLUTION</Label><span className="text-xs">{resolution}²</span></div><Slider value={[resolution]} onValueChange={([v]) => setResolution(v)} min={20} max={80} step={10} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono flex items-center gap-1"><Grid3X3 className="h-3 w-3" /> GRID</Label><Switch checked={showGrid} onCheckedChange={setShowGrid} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono flex items-center gap-1"><Box className="h-3 w-3" /> AXES</Label><Switch checked={showAxes} onCheckedChange={setShowAxes} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono">AUTO ROTATE</Label><Switch checked={autoRotate} onCheckedChange={setAutoRotate} /></div>
                            {autoRotate && <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">SPEED</Label><span className="text-xs">{rotateSpeed}×</span></div><Slider value={[rotateSpeed]} onValueChange={([v]) => setRotateSpeed(v)} min={0.5} max={5} step={0.5} /></div>}
                        </Card>
                    </CollapsibleContent>
                </Collapsible>
            </div>

            {/* Right Panel */}
            <div className="absolute right-4 top-20 w-56 pointer-events-auto">
                <Collapsible open={showStats} onOpenChange={setShowStats}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card font-mono text-xs">
                            <span className="flex items-center gap-2"><Info className="h-4 w-4" /> STATISTICS</span>
                            {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-3 bg-card border-border space-y-3">
                            <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">ATM PRICE (1Y)</span><span className="text-sm font-bold text-[var(--up)]">${stats.atmPrice.toFixed(2)}</span></div>
                            <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">ATM DELTA (1Y)</span><span className="text-sm">{stats.atmDelta.toFixed(4)}</span></div>
                            <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">STRIKE</span><span className="text-sm">${strikePrice}</span></div>
                            <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">VOLATILITY</span><span className="text-sm">{volatility}%</span></div>
                            <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">RISK-FREE</span><span className="text-sm">{riskFreeRate}%</span></div>
                            <div className="pt-2 border-t border-border">
                                <div className="text-xs text-[var(--dim)] mb-2 font-mono">{surfaceMode === 'price' ? 'PRICE' : 'DELTA'} SCALE</div>
                                <div className="flex h-3 rounded overflow-hidden">{colorScheme.colors.map((c, i) => (<div key={i} className="flex-1" style={{ backgroundColor: c }} />))}</div>
                                <div className="flex justify-between text-xs text-[var(--dim)] mt-1 font-mono"><span>LOW</span><span>HIGH</span></div>
                            </div>
                        </Card>
                    </CollapsibleContent>
                </Collapsible>
            </div>

            {/* Bottom hint */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
                <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-4 text-xs text-[var(--dim)] font-mono">
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
