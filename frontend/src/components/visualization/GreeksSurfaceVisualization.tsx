import { useMemo, useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Activity, Info, ChevronDown, ChevronUp, Settings, Eye, RotateCcw, Grid3X3, Box } from 'lucide-react';
import { ColorScheme, COLOR_SCHEMES } from './types';
import ColorSchemeSelector from './ColorSchemeSelector';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface SurfaceData {
    geometry: THREE.BufferGeometry;
    minZ: number;
    maxZ: number;
}

interface GreeksParams {
    spotPrice: number;
    volatility: number;
    riskFreeRate: number;
    greekType: 'delta' | 'gamma';
}

// Black-Scholes d1 calculation
function d1(S: number, K: number, T: number, r: number, sigma: number): number {
    return (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

// Standard normal CDF approximation
function normCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
}

// Standard normal PDF
function normPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Calculate Delta for a call option
function calcDelta(S: number, K: number, T: number, r: number, sigma: number): number {
    if (T <= 0.001) return S >= K ? 1 : 0;
    const d = d1(S, K, T, r, sigma);
    return normCDF(d);
}

// Calculate Gamma
function calcGamma(S: number, K: number, T: number, r: number, sigma: number): number {
    if (T <= 0.001) return 0;
    const d = d1(S, K, T, r, sigma);
    return normPDF(d) / (S * sigma * Math.sqrt(T));
}

function GreekSurface({ data, colorScheme, opacity }: { data: SurfaceData; colorScheme: ColorScheme; opacity: number }) {
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
            <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[0, 0, 0]} />
            <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[0, size / 2, -size / 2]} rotation={[Math.PI / 2, 0, 0]} />
            <gridHelper args={[size, size, '#3a3a3a', '#2e2e2e']} position={[-size / 2, size / 2, 0]} rotation={[0, 0, Math.PI / 2]} />
        </group>
    );
}

function AxisLines({ show, range, greekType }: { show: boolean; range: number; greekType: string }) {
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
            <Text position={[range + 0.5, 0, 0]} fontSize={0.4} color="#b0b0b0">Strike</Text>
            <Text position={[0, range + 0.5, 0]} fontSize={0.4} color="#b0b0b0">{greekType === 'delta' ? 'Delta' : 'Gamma'}</Text>
            <Text position={[0, 0, range + 0.5]} fontSize={0.4} color="#b0b0b0">Expiry</Text>
        </group>
    );
}

export default function GreeksSurfaceVisualization() {
    const [params, setParams] = useState<GreeksParams>({
        spotPrice: 100,
        volatility: 0.25,
        riskFreeRate: 0.05,
        greekType: 'delta',
    });

    const [colorScheme, setColorScheme] = useState<ColorScheme>(COLOR_SCHEMES[4]); // Zinc, terminal default
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

    const surfaceData = useMemo(() => {
        const strikeCount = resolution;
        const expiryCount = resolution;

        // Strike range: 70% to 130% of spot
        const strikes = Array.from({ length: strikeCount }, (_, i) =>
            params.spotPrice * (0.7 + (i / (strikeCount - 1)) * 0.6)
        );
        // Expiry range: 0.05 to 2 years
        const expiries = Array.from({ length: expiryCount }, (_, i) =>
            0.05 + (i / (expiryCount - 1)) * 1.95
        );

        const vertices: number[] = [];
        const indices: number[] = [];
        let minZ = Infinity, maxZ = -Infinity;

        for (let i = 0; i < strikeCount; i++) {
            for (let j = 0; j < expiryCount; j++) {
                const K = strikes[i];
                const T = expiries[j];

                let greekValue: number;
                if (params.greekType === 'delta') {
                    greekValue = calcDelta(params.spotPrice, K, T, params.riskFreeRate, params.volatility);
                } else {
                    greekValue = calcGamma(params.spotPrice, K, T, params.riskFreeRate, params.volatility);
                }

                // Normalize to 3D space
                const x = (K / params.spotPrice - 0.7) / 0.6 * 10 - 5; // Strike axis
                const y = params.greekType === 'delta'
                    ? greekValue * 8 // Delta ranges 0-1, scale to 0-8
                    : Math.min(greekValue * 200, 10); // Gamma is small, scale up
                const z = (T - 0.05) / 1.95 * 10; // Expiry axis

                vertices.push(x, y, z);
                minZ = Math.min(minZ, y);
                maxZ = Math.max(maxZ, y);

                if (i < strikeCount - 1 && j < expiryCount - 1) {
                    const a = i * expiryCount + j;
                    indices.push(a, a + 1, a + expiryCount);
                    indices.push(a + 1, a + expiryCount + 1, a + expiryCount);
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
        // Calculate key metrics
        const atmDelta = calcDelta(params.spotPrice, params.spotPrice, 0.25, params.riskFreeRate, params.volatility);
        const atmGamma = calcGamma(params.spotPrice, params.spotPrice, 0.25, params.riskFreeRate, params.volatility);
        const itm25Delta = calcDelta(params.spotPrice, params.spotPrice * 0.85, 0.25, params.riskFreeRate, params.volatility);
        const otm25Delta = calcDelta(params.spotPrice, params.spotPrice * 1.15, 0.25, params.riskFreeRate, params.volatility);

        return {
            atmDelta: atmDelta.toFixed(3),
            atmGamma: (atmGamma * 100).toFixed(3),
            deltaSkew: (itm25Delta - otm25Delta).toFixed(3),
            peakGamma: (atmGamma * 100).toFixed(3),
            spotPrice: params.spotPrice,
            impliedVol: (params.volatility * 100).toFixed(0),
        };
    }, [params]);

    const controlsRef = useRef<any>(null);
    const resetCamera = () => controlsRef.current?.reset();

    return (
        <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[var(--bg)] rounded-lg overflow-hidden border border-border">
            <Canvas
                camera={{ position: [15, 10, 15], fov: 45 }}
                style={{ background: 'var(--bg, #1c1c1c)' }}
            >
                <ambientLight intensity={0.4} />
                <pointLight position={[10, 20, 10]} intensity={1.2} />
                <directionalLight position={[-10, 15, 10]} intensity={0.8} />
                <directionalLight position={[10, -10, -10]} intensity={0.3} />

                <ImmersiveGrid show={showGrid} size={20} />
                <AxisLines show={showAxes} range={8} greekType={params.greekType} />

                <GreekSurface data={surfaceData} colorScheme={colorScheme} opacity={surfaceOpacity} />
                {showWireframe && <WireframeSurface data={surfaceData} opacity={wireframeOpacity} />}

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
                        
                        <span className="font-semibold text-[var(--text)]">Option Greeks Surface</span>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-4 w-4 text-[var(--dim)] cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm">
                                    <p className="text-sm">3D visualization of option {params.greekType} across strike prices and expiration dates using Black-Scholes model.</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
                <div className="flex items-center gap-2 pointer-events-auto">
                    <Button variant="outline" size="sm" onClick={resetCamera} className="bg-card text-[var(--text)]">
                        <RotateCcw className="h-4 w-4 mr-1" />Reset View
                    </Button>
                </div>
            </div>

            {/* Left Panel */}
            <div className="absolute left-4 top-20 w-72 space-y-2 pointer-events-auto">
                <Collapsible open={showParams} onOpenChange={setShowParams}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)]">
                            <span className="flex items-center gap-2"><Settings className="h-4 w-4" />Greeks Parameters</span>
                            {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[var(--text)]">
                            <div className="space-y-2">
                                <Label className="text-xs text-[var(--dim)]">Greek Type</Label>
                                <Select value={params.greekType} onValueChange={(v) => setParams(p => ({ ...p, greekType: v as 'delta' | 'gamma' }))}>
                                    <SelectTrigger className="h-8 text-[var(--text)]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="delta">Delta (Δ)</SelectItem>
                                        <SelectItem value="gamma">Gamma (Γ)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Spot Price</Label><span className="text-xs font-medium text-[var(--text)]">${params.spotPrice}</span></div>
                                <Slider value={[params.spotPrice]} onValueChange={([v]) => setParams(p => ({ ...p, spotPrice: v }))} min={50} max={200} step={5} />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Volatility</Label><span className="text-xs font-medium text-[var(--text)]">{(params.volatility * 100).toFixed(0)}%</span></div>
                                <Slider value={[params.volatility * 100]} onValueChange={([v]) => setParams(p => ({ ...p, volatility: v / 100 }))} min={10} max={80} step={5} />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Risk-Free Rate</Label><span className="text-xs font-medium text-[var(--text)]">{(params.riskFreeRate * 100).toFixed(1)}%</span></div>
                                <Slider value={[params.riskFreeRate * 100]} onValueChange={([v]) => setParams(p => ({ ...p, riskFreeRate: v / 100 }))} min={0} max={10} step={0.5} />
                            </div>
                        </Card>
                    </CollapsibleContent>
                </Collapsible>

                <Collapsible open={showVisuals} onOpenChange={setShowVisuals}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)]">
                            <span className="flex items-center gap-2"><Eye className="h-4 w-4" />Visual Settings</span>
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
                            {showWireframe && (
                                <div className="space-y-2">
                                    <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Wireframe Opacity</Label><span className="text-xs font-medium text-[var(--text)]">{(wireframeOpacity * 100).toFixed(0)}%</span></div>
                                    <Slider value={[wireframeOpacity * 100]} onValueChange={([v]) => setWireframeOpacity(v / 100)} min={5} max={50} step={5} />
                                </div>
                            )}
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Resolution</Label><span className="text-xs font-medium text-[var(--text)]">{resolution}×{resolution}</span></div>
                                <Slider value={[resolution]} onValueChange={([v]) => setResolution(v)} min={20} max={80} step={10} />
                            </div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] flex items-center gap-1"><Grid3X3 className="h-3 w-3" /> Grid</Label><Switch checked={showGrid} onCheckedChange={setShowGrid} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] flex items-center gap-1"><Box className="h-3 w-3" /> Axes</Label><Switch checked={showAxes} onCheckedChange={setShowAxes} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)]">Auto Rotate</Label><Switch checked={autoRotate} onCheckedChange={setAutoRotate} /></div>
                            {autoRotate && (
                                <div className="space-y-2">
                                    <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Rotation Speed</Label><span className="text-xs font-medium text-[var(--text)]">{rotateSpeed}×</span></div>
                                    <Slider value={[rotateSpeed]} onValueChange={([v]) => setRotateSpeed(v)} min={0.5} max={5} step={0.5} />
                                </div>
                            )}
                        </Card>
                    </CollapsibleContent>
                </Collapsible>
            </div>

            {/* Right Panel - Stats */}
            <div className="absolute right-4 top-20 w-56 pointer-events-auto">
                <Collapsible open={showStats} onOpenChange={setShowStats}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)]">
                            <span className="flex items-center gap-2"><Info className="h-4 w-4" />Greeks Metrics</span>
                            {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-3 bg-card border-border space-y-3 text-[var(--text)]">
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">ATM Delta (3M)</span><span className="text-sm font-medium text-[var(--text)]">{metrics.atmDelta}</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">ATM Gamma (3M)</span><span className="text-sm font-medium text-[var(--text)]">{metrics.atmGamma}%</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">Delta Skew</span><span className="text-sm font-medium text-[var(--text)]">{metrics.deltaSkew}</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">Spot Price</span><span className="text-sm font-medium text-[var(--text)]">${metrics.spotPrice}</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">Implied Vol</span><span className="text-sm font-medium text-[var(--text)]">{metrics.impliedVol}%</span></div>
                            <div className="pt-2 border-t border-border">
                                <div className="text-xs text-[var(--dim)] mb-2">{params.greekType === 'delta' ? 'Delta' : 'Gamma'} Scale</div>
                                <div className="flex h-3 rounded overflow-hidden">
                                    {colorScheme.colors.map((color, i) => (<div key={i} className="flex-1" style={{ backgroundColor: color }} />))}
                                </div>
                                <div className="flex justify-between text-xs text-[var(--dim)] mt-1"><span>Low</span><span>High</span></div>
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
                    <span>Right-click to pan</span><span className="text-border">•</span>
                    <span>Resolution: {resolution}²</span>
                </div>
            </div>
        </div>
    );
}
