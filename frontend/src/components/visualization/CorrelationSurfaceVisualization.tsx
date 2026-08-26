import { useMemo, useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Network, Info, ChevronDown, ChevronUp, Settings, Eye, RotateCcw, Grid3X3, Box } from 'lucide-react';
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

interface CorrelationParams {
    assetCount: number;
    baseCorrelation: number;
    stressMultiplier: number;
    regime: 'normal' | 'stressed' | 'crisis';
    clusterStrength: number;
}

// Generate realistic correlation matrix with sector clustering
function generateCorrelationMatrix(params: CorrelationParams): number[][] {
    const n = params.assetCount;
    const matrix: number[][] = [];

    // Create sector assignments (3 sectors)
    const sectors = Array.from({ length: n }, (_, i) => Math.floor(i / (n / 3)));

    for (let i = 0; i < n; i++) {
        matrix[i] = [];
        for (let j = 0; j < n; j++) {
            if (i === j) {
                matrix[i][j] = 1;
            } else {
                // Base correlation with random noise
                let corr = params.baseCorrelation + (Math.random() - 0.5) * 0.3;

                // Same sector = higher correlation
                if (sectors[i] === sectors[j]) {
                    corr += params.clusterStrength * 0.3;
                }

                // Apply stress multiplier during stressed regimes
                if (params.regime === 'stressed') {
                    corr = corr + (1 - corr) * params.stressMultiplier * 0.3;
                } else if (params.regime === 'crisis') {
                    corr = corr + (1 - corr) * params.stressMultiplier * 0.6;
                }

                // Clamp to valid range
                matrix[i][j] = Math.max(-0.5, Math.min(0.99, corr));
            }
        }
    }

    return matrix;
}

function CorrelationSurface({ data, colorScheme, opacity }: { data: SurfaceData; colorScheme: ColorScheme; opacity: number }) {
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
                metalness={0.15}
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
            <Text position={[range + 0.8, 0, 0]} fontSize={0.4} color="#b0b0b0">Asset i</Text>
            <Text position={[0, range + 0.5, 0]} fontSize={0.4} color="#b0b0b0">ρ</Text>
            <Text position={[0, 0, range + 0.8]} fontSize={0.4} color="#b0b0b0">Asset j</Text>
        </group>
    );
}

export default function CorrelationSurfaceVisualization() {
    const [params, setParams] = useState<CorrelationParams>({
        assetCount: 20,
        baseCorrelation: 0.35,
        stressMultiplier: 0.5,
        regime: 'normal',
        clusterStrength: 0.6,
    });

    const [colorScheme, setColorScheme] = useState<ColorScheme>(COLOR_SCHEMES[5]); // P&L (red to green)
    const [showWireframe, setShowWireframe] = useState(true);
    const [wireframeOpacity, setWireframeOpacity] = useState(0.12);
    const [surfaceOpacity, setSurfaceOpacity] = useState(0.92);
    const [showGrid, setShowGrid] = useState(true);
    const [showAxes, setShowAxes] = useState(true);
    const [autoRotate, setAutoRotate] = useState(false);
    const [rotateSpeed, setRotateSpeed] = useState(1);
    const [showParams, setShowParams] = useState(true);
    const [showVisuals, setShowVisuals] = useState(false);
    const [showStats, setShowStats] = useState(true);

    // Generate correlation matrix with seed for consistency
    const corrMatrix = useMemo(() => generateCorrelationMatrix(params), [params]);

    const surfaceData = useMemo(() => {
        const n = params.assetCount;
        const vertices: number[] = [];
        const indices: number[] = [];
        let minZ = Infinity, maxZ = -Infinity;

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const corr = corrMatrix[i][j];

                // Map to 3D coordinates
                const x = (i / (n - 1)) * 10 - 5;
                const y = corr * 6; // Height = correlation (-0.5 to 1 -> -3 to 6)
                const z = (j / (n - 1)) * 10 - 5;

                vertices.push(x, y, z);
                minZ = Math.min(minZ, y);
                maxZ = Math.max(maxZ, y);

                if (i < n - 1 && j < n - 1) {
                    const a = i * n + j;
                    indices.push(a, a + 1, a + n);
                    indices.push(a + 1, a + n + 1, a + n);
                }
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        return { geometry, minZ, maxZ };
    }, [corrMatrix, params.assetCount]);

    const metrics = useMemo(() => {
        const n = params.assetCount;
        let sum = 0, count = 0, maxCorr = -1, minCorr = 1;

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const c = corrMatrix[i][j];
                sum += c;
                count++;
                maxCorr = Math.max(maxCorr, c);
                minCorr = Math.min(minCorr, c);
            }
        }

        const avgCorr = sum / count;

        // Calculate effective number of assets (diversification measure)
        const effectiveN = 1 / (1 / n + (1 - 1 / n) * avgCorr);

        return {
            avgCorrelation: avgCorr.toFixed(3),
            maxCorrelation: maxCorr.toFixed(3),
            minCorrelation: minCorr.toFixed(3),
            effectiveAssets: effectiveN.toFixed(1),
            diversificationRatio: (n / effectiveN).toFixed(2),
            regime: params.regime.charAt(0).toUpperCase() + params.regime.slice(1),
        };
    }, [corrMatrix, params]);

    const controlsRef = useRef<any>(null);
    const resetCamera = () => controlsRef.current?.reset();

    return (
        <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[#1c1c1c] rounded-lg overflow-hidden border border-border">
            <Canvas
                camera={{ position: [15, 12, 15], fov: 45 }}
                style={{ background: '#1c1c1c' }}
            >
                <ambientLight intensity={0.4} />
                <pointLight position={[10, 20, 10]} intensity={1.2} />
                <directionalLight position={[-10, 15, 10]} intensity={0.8} />
                <directionalLight position={[10, -10, -10]} intensity={0.3} />

                <ImmersiveGrid show={showGrid} size={20} />
                <AxisLines show={showAxes} range={8} />

                <CorrelationSurface data={surfaceData} colorScheme={colorScheme} opacity={surfaceOpacity} />
                {showWireframe && <WireframeSurface data={surfaceData} opacity={wireframeOpacity} />}

                {/* Sector labels */}
                <Text position={[-4, surfaceData.maxZ + 1, -4]} fontSize={0.35} color="#e8e8e8">Sector 1</Text>
                <Text position={[0, surfaceData.maxZ + 1, 0]} fontSize={0.35} color="#e8e8e8">Sector 2</Text>
                <Text position={[4, surfaceData.maxZ + 1, 4]} fontSize={0.35} color="#e8e8e8">Sector 3</Text>

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
                    <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-2 text-[#e8e8e8]">
                        
                        <span className="font-semibold text-[#e8e8e8]">Correlation Matrix Surface</span>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-4 w-4 text-[#b0b0b0] cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm">
                                    <p className="text-sm">3D visualization of pairwise asset correlations. Height represents correlation strength with sector clustering effects.</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
                <Button variant="outline" size="sm" onClick={resetCamera} className="bg-card pointer-events-auto text-[#e8e8e8] hover:text-[#e8e8e8]">
                    <RotateCcw className="h-4 w-4 mr-1" />Reset View
                </Button>
            </div>

            {/* Left Panel */}
            <div className="absolute left-4 top-20 w-72 space-y-2 pointer-events-auto">
                <Collapsible open={showParams} onOpenChange={setShowParams}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card text-[#e8e8e8]">
                            <span className="flex items-center gap-2"><Settings className="h-4 w-4" />Correlation Parameters</span>
                            {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[#e8e8e8]">
                            <div className="space-y-2">
                                <Label className="text-xs text-[#b0b0b0]">Market Regime</Label>
                                <Select value={params.regime} onValueChange={(v) => setParams(p => ({ ...p, regime: v as CorrelationParams['regime'] }))}>
                                    <SelectTrigger className="h-8 text-[#e8e8e8]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="normal">Normal</SelectItem>
                                        <SelectItem value="stressed">Stressed</SelectItem>
                                        <SelectItem value="crisis">Crisis</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[#b0b0b0]">Asset Count</Label><span className="text-xs font-medium text-[#e8e8e8]">{params.assetCount}</span></div>
                                <Slider value={[params.assetCount]} onValueChange={([v]) => setParams(p => ({ ...p, assetCount: v }))} min={10} max={40} step={5} />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[#b0b0b0]">Base Correlation</Label><span className="text-xs font-medium text-[#e8e8e8]">{(params.baseCorrelation * 100).toFixed(0)}%</span></div>
                                <Slider value={[params.baseCorrelation * 100]} onValueChange={([v]) => setParams(p => ({ ...p, baseCorrelation: v / 100 }))} min={0} max={80} step={5} />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[#b0b0b0]">Cluster Strength</Label><span className="text-xs font-medium text-[#e8e8e8]">{(params.clusterStrength * 100).toFixed(0)}%</span></div>
                                <Slider value={[params.clusterStrength * 100]} onValueChange={([v]) => setParams(p => ({ ...p, clusterStrength: v / 100 }))} min={0} max={100} step={10} />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[#b0b0b0]">Stress Multiplier</Label><span className="text-xs font-medium text-[#e8e8e8]">{params.stressMultiplier.toFixed(1)}×</span></div>
                                <Slider value={[params.stressMultiplier * 10]} onValueChange={([v]) => setParams(p => ({ ...p, stressMultiplier: v / 10 }))} min={0} max={10} step={1} />
                            </div>
                        </Card>
                    </CollapsibleContent>
                </Collapsible>

                <Collapsible open={showVisuals} onOpenChange={setShowVisuals}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card text-[#e8e8e8]">
                            <span className="flex items-center gap-2"><Eye className="h-4 w-4" />Visual Settings</span>
                            {showVisuals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-4 bg-card border-border space-y-4 text-[#e8e8e8]">
                            <ColorSchemeSelector value={colorScheme.id} onChange={setColorScheme} />
                            <div className="space-y-2">
                                <div className="flex justify-between"><Label className="text-xs text-[#b0b0b0]">Surface Opacity</Label><span className="text-xs font-medium text-[#e8e8e8]">{(surfaceOpacity * 100).toFixed(0)}%</span></div>
                                <Slider value={[surfaceOpacity * 100]} onValueChange={([v]) => setSurfaceOpacity(v / 100)} min={20} max={100} step={5} />
                            </div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[#b0b0b0]">Wireframe</Label><Switch checked={showWireframe} onCheckedChange={setShowWireframe} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[#b0b0b0] flex items-center gap-1"><Grid3X3 className="h-3 w-3" /> Grid</Label><Switch checked={showGrid} onCheckedChange={setShowGrid} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[#b0b0b0] flex items-center gap-1"><Box className="h-3 w-3" /> Axes</Label><Switch checked={showAxes} onCheckedChange={setShowAxes} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[#b0b0b0]">Auto Rotate</Label><Switch checked={autoRotate} onCheckedChange={setAutoRotate} /></div>
                        </Card>
                    </CollapsibleContent>
                </Collapsible>
            </div>

            {/* Right Panel - Stats */}
            <div className="absolute right-4 top-20 w-56 pointer-events-auto">
                <Collapsible open={showStats} onOpenChange={setShowStats}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card text-[#e8e8e8]">
                            <span className="flex items-center gap-2"><Info className="h-4 w-4" />Portfolio Metrics</span>
                            {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-3 bg-card border-border space-y-3 text-[#e8e8e8]">
                            <div className="flex justify-between"><span className="text-xs text-[#b0b0b0]">Regime</span><span className={`text-sm font-medium ${params.regime === 'crisis' ? 'text-[#f0426c]' : params.regime === 'stressed' ? 'text-[#c58435]' : 'text-[#e8e8e8]'}`}>{metrics.regime}</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[#b0b0b0]">Avg Correlation</span><span className="text-sm font-medium text-[#e8e8e8]">{metrics.avgCorrelation}</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[#b0b0b0]">Max Correlation</span><span className="text-sm font-medium text-[#e8e8e8]">{metrics.maxCorrelation}</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[#b0b0b0]">Min Correlation</span><span className="text-sm font-medium text-[#e8e8e8]">{metrics.minCorrelation}</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[#b0b0b0]">Effective Assets</span><span className="text-sm font-medium text-[#e8e8e8]">{metrics.effectiveAssets}</span></div>
                            <div className="flex justify-between"><span className="text-xs text-[#b0b0b0]">Diversification</span><span className="text-sm font-medium text-[#e8e8e8]">{metrics.diversificationRatio}×</span></div>
                            <div className="pt-2 border-t border-border">
                                <div className="text-xs text-[#b0b0b0] mb-2">Correlation Scale</div>
                                <div className="flex h-3 rounded overflow-hidden">
                                    {colorScheme.colors.map((color, i) => (<div key={i} className="flex-1" style={{ backgroundColor: color }} />))}
                                </div>
                                <div className="flex justify-between text-xs text-[#b0b0b0] mt-1"><span>-ρ</span><span>+ρ</span></div>
                            </div>
                        </Card>
                    </CollapsibleContent>
                </Collapsible>
            </div>

            {/* Bottom */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
                <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-4 text-xs text-[#b0b0b0]">
                    <span>Drag to rotate</span><span className="text-border">•</span>
                    <span>Scroll to zoom</span><span className="text-border">•</span>
                    <span>Right-click to pan</span><span className="text-border">•</span>
                    <span>Assets: {params.assetCount}×{params.assetCount}</span>
                </div>
            </div>
        </div>
    );
}
