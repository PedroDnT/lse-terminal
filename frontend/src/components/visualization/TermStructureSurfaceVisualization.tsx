import { useMemo, useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { TrendingUp, Info, ChevronDown, ChevronUp, Settings, Eye, RotateCcw, Grid3X3, Box } from 'lucide-react';
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

interface TermStructureParams {
    curveShape: 'normal' | 'inverted' | 'flat' | 'humped';
    baseRate: number;
    steepness: number;
    volatility: number;
    timeEvolution: number;
}

// Nelson-Siegel-Svensson inspired yield curve model
function calculateYield(
    maturity: number,
    time: number,
    params: TermStructureParams
): number {
    const { curveShape, baseRate, steepness, volatility } = params;

    // Base yield components
    let level = baseRate;
    let slope = 0;
    let curvature = 0;

    switch (curveShape) {
        case 'normal':
            slope = steepness * 0.02;
            curvature = -steepness * 0.005;
            break;
        case 'inverted':
            slope = -steepness * 0.025;
            curvature = steepness * 0.003;
            break;
        case 'flat':
            slope = 0;
            curvature = 0;
            break;
        case 'humped':
            slope = steepness * 0.01;
            curvature = -steepness * 0.02;
            break;
    }

    // Nelson-Siegel factors
    const tau = 2;
    const factor1 = 1 - Math.exp(-maturity / tau);
    const factor2 = factor1 - maturity * Math.exp(-maturity / tau) / tau;

    // Base yield
    let y = level + slope * (factor1 / (maturity / tau)) + curvature * factor2;

    // Time evolution - rates change over observation period
    const timeShift = (time - 0.5) * params.timeEvolution * 0.01;
    y += timeShift;

    // Add some noise/volatility
    const noise = Math.sin(maturity * 3 + time * 5) * volatility * 0.002;
    y += noise;

    return Math.max(0, y);
}

function YieldSurface({ data, colorScheme, opacity }: { data: SurfaceData; colorScheme: ColorScheme; opacity: number }) {
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
                roughness={0.35}
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
            <Text position={[range + 0.8, 0, 0]} fontSize={0.4} color="#b0b0b0">Maturity</Text>
            <Text position={[0, range + 0.5, 0]} fontSize={0.4} color="#b0b0b0">Yield</Text>
            <Text position={[0, 0, range + 0.6]} fontSize={0.4} color="#b0b0b0">Time</Text>
        </group>
    );
}

export default function TermStructureSurfaceVisualization() {
    const [params, setParams] = useState<TermStructureParams>({
        curveShape: 'normal',
        baseRate: 0.04,
        steepness: 1.0,
        volatility: 0.5,
        timeEvolution: 0.5,
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
        const maturityCount = resolution;
        const timeCount = resolution;

        // Maturity range: 0.25Y to 30Y
        const maturities = Array.from({ length: maturityCount }, (_, i) =>
            0.25 + (i / (maturityCount - 1)) * 29.75
        );
        // Time range: 0 to 1 (observation period)
        const times = Array.from({ length: timeCount }, (_, i) =>
            i / (timeCount - 1)
        );

        const vertices: number[] = [];
        const indices: number[] = [];
        let minZ = Infinity, maxZ = -Infinity;

        for (let i = 0; i < maturityCount; i++) {
            for (let j = 0; j < timeCount; j++) {
                const maturity = maturities[i];
                const time = times[j];
                const y = calculateYield(maturity, time, params);

                // Map to 3D coordinates
                const x = (Math.log(maturity) - Math.log(0.25)) / (Math.log(30) - Math.log(0.25)) * 10 - 5; // Log scale for maturity
                const yPos = y * 100; // Scale yield to visible range
                const z = time * 10 - 5;

                vertices.push(x, yPos, z);
                minZ = Math.min(minZ, yPos);
                maxZ = Math.max(maxZ, yPos);

                if (i < maturityCount - 1 && j < timeCount - 1) {
                    const a = i * timeCount + j;
                    indices.push(a, a + 1, a + timeCount);
                    indices.push(a + 1, a + timeCount + 1, a + timeCount);
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
        // Calculate key curve metrics at t=0.5 (mid-observation)
        const y3m = calculateYield(0.25, 0.5, params);
        const y2y = calculateYield(2, 0.5, params);
        const y10y = calculateYield(10, 0.5, params);
        const y30y = calculateYield(30, 0.5, params);

        const spread2s10s = (y10y - y2y) * 100; // in bps
        const spread3m10y = (y10y - y3m) * 100;

        return {
            shortRate: (y3m * 100).toFixed(2),
            y2y: (y2y * 100).toFixed(2),
            y10y: (y10y * 100).toFixed(2),
            y30y: (y30y * 100).toFixed(2),
            spread2s10s: spread2s10s.toFixed(0),
            curveSlope: spread3m10y > 50 ? 'Steep' : spread3m10y > 0 ? 'Normal' : spread3m10y > -50 ? 'Flat' : 'Inverted',
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
                <AxisLines show={showAxes} range={8} />

                <YieldSurface data={surfaceData} colorScheme={colorScheme} opacity={surfaceOpacity} />
                {showWireframe && <WireframeSurface data={surfaceData} opacity={wireframeOpacity} />}

                {/* Maturity markers */}
                <Text position={[-5, 0.3, -6]} fontSize={0.3} color="#e8e8e8">3M</Text>
                <Text position={[-1, 0.3, -6]} fontSize={0.3} color="#e8e8e8">2Y</Text>
                <Text position={[2.5, 0.3, -6]} fontSize={0.3} color="#e8e8e8">10Y</Text>
                <Text position={[5, 0.3, -6]} fontSize={0.3} color="#e8e8e8">30Y</Text>

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
                        
                        <span className="font-semibold text-[var(--text)]">Term Structure Surface</span>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-4 w-4 text-[var(--dim)] cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm">
                                    <p className="text-sm">3D visualization of yield curve evolution over time using Nelson-Siegel model dynamics.</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
                <Button variant="outline" size="sm" onClick={resetCamera} className="bg-card pointer-events-auto text-[var(--text)] hover:text-[var(--text)]">
                    <RotateCcw className="h-4 w-4 mr-1" />Reset View
                </Button>
            </div>

            {/* Left Panel */}
            <div className="absolute left-4 top-20 w-72 space-y-2 pointer-events-auto">
                <Collapsible open={showParams} onOpenChange={setShowParams}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)]">
                            <span className="flex items-center gap-2"><Settings className="h-4 w-4" />Curve Parameters</span>
                            {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[var(--text)]">
                            <div className="space-y-2">
                                <Label className="text-xs text-[var(--dim)]">Curve Shape</Label>
                                <Select value={params.curveShape} onValueChange={(v) => setParams(p => ({ ...p, curveShape: v as TermStructureParams['curveShape'] }))}>
                                    <SelectTrigger className="h-8 text-[var(--text)]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="normal">Normal (Upward)</SelectItem>
                                        <SelectItem value="inverted">Inverted</SelectItem>
                                        <SelectItem value="flat">Flat</SelectItem>
                                        <SelectItem value="humped">Humped</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Base Rate</Label><span className="text-xs font-medium text-[var(--text)]">{(params.baseRate * 100).toFixed(1)}%</span></div>
                                <Slider value={[params.baseRate * 100]} onValueChange={([v]) => setParams(p => ({ ...p, baseRate: v / 100 }))} min={0} max={10} step={0.25} />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Steepness</Label><span className="text-xs font-medium text-[var(--text)]">{params.steepness.toFixed(1)}</span></div>
                                <Slider value={[params.steepness * 10]} onValueChange={([v]) => setParams(p => ({ ...p, steepness: v / 10 }))} min={0} max={20} step={1} />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Rate Volatility</Label><span className="text-xs font-medium text-[var(--text)]">{params.volatility.toFixed(1)}</span></div>
                                <Slider value={[params.volatility * 10]} onValueChange={([v]) => setParams(p => ({ ...p, volatility: v / 10 }))} min={0} max={20} step={1} />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[var(--dim)]">Time Evolution</Label><span className="text-xs font-medium text-[var(--text)]">{params.timeEvolution.toFixed(1)}</span></div>
                                <Slider value={[params.timeEvolution * 10]} onValueChange={([v]) => setParams(p => ({ ...p, timeEvolution: v / 10 }))} min={0} max={30} step={1} />
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
                        </Card>
                    </CollapsibleContent>
                </Collapsible>
            </div>

            {/* Right Panel - Stats */}
            <div className="absolute right-4 top-20 w-56 pointer-events-auto">
                <Collapsible open={showStats} onOpenChange={setShowStats}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)]">
                            <span className="flex items-center gap-2"><Info className="h-4 w-4" />Curve Metrics</span>
                            {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-3 bg-card border-border space-y-3 text-[var(--text)]">
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">3M Rate</span><span className="text-sm font-medium text-[var(--text)]">{metrics.shortRate}%</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">2Y Yield</span><span className="text-sm font-medium text-[var(--text)]">{metrics.y2y}%</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">10Y Yield</span><span className="text-sm font-medium text-[var(--text)]">{metrics.y10y}%</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">30Y Yield</span><span className="text-sm font-medium text-[var(--text)]">{metrics.y30y}%</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">2s10s Spread</span><span className={`text-sm font-medium ${parseInt(metrics.spread2s10s) < 0 ? 'text-[var(--down)]' : 'text-[var(--text)]'}`}>{metrics.spread2s10s}bps</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[var(--dim)]">Curve Shape</span><span className={`text-sm font-medium ${metrics.curveSlope === 'Inverted' ? 'text-[var(--down)]' : metrics.curveSlope === 'Flat' ? 'text-[#c58435]' : 'text-[var(--text)]'}`}>{metrics.curveSlope}</span></div>
                            <div className="pt-2 border-t border-border">
                                <div className="text-xs text-[var(--dim)] mb-2">Yield Scale</div>
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
