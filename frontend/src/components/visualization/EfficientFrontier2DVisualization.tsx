import { useMemo, useState, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { PieChart, Info, ChevronDown, ChevronUp, Settings, Eye, RotateCcw, Grid3X3, Box, Shuffle } from 'lucide-react';
import { ColorScheme, COLOR_SCHEMES } from './types';
import ColorSchemeSelector from './ColorSchemeSelector';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface Asset {
    name: string;
    symbol: string;
    expectedReturn: number;
    volatility: number;
    color: string;
}

const DEFAULT_ASSETS: Asset[] = [
    // Terminal palette hexes (not CSS vars) so the dots stay valid if ever fed to three.js
    { name: 'S&P 500', symbol: 'SPY', expectedReturn: 10, volatility: 18, color: '#e8e8e8' },
    { name: 'Bonds', symbol: 'BND', expectedReturn: 4, volatility: 6, color: '#21b3a4' },
    { name: 'Gold', symbol: 'GLD', expectedReturn: 6, volatility: 15, color: '#c58435' },
    { name: 'Real Estate', symbol: 'VNQ', expectedReturn: 8, volatility: 20, color: '#b0b0b0' },
    { name: 'Emerging', symbol: 'EEM', expectedReturn: 12, volatility: 25, color: '#f0426c' },
];

const DEFAULT_CORRELATIONS = [
    [1.00, 0.10, 0.05, 0.65, 0.70],
    [0.10, 1.00, 0.20, 0.15, 0.10],
    [0.05, 0.20, 1.00, 0.10, 0.15],
    [0.65, 0.15, 0.10, 1.00, 0.55],
    [0.70, 0.10, 0.15, 0.55, 1.00],
];

function getCovarianceMatrix(assets: Asset[], correlations: number[][]): number[][] {
    const n = assets.length;
    const cov: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            cov[i][j] = correlations[i][j] * (assets[i].volatility / 100) * (assets[j].volatility / 100);
        }
    }
    return cov;
}

function calculatePortfolio(weights: number[], assets: Asset[], cov: number[][]): { expectedReturn: number; volatility: number; sharpe: number } {
    const n = assets.length;
    let expectedReturn = 0;
    for (let i = 0; i < n; i++) expectedReturn += weights[i] * assets[i].expectedReturn;
    let variance = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) variance += weights[i] * weights[j] * cov[i][j];
    }
    const volatility = Math.sqrt(variance) * 100;
    const sharpe = volatility > 0 ? (expectedReturn - 3) / volatility : 0;
    return { expectedReturn, volatility, sharpe };
}

interface SurfaceData {
    geometry: THREE.BufferGeometry;
    minZ: number;
    maxZ: number;
}

function PortfolioSurface({ data, colorScheme, opacity }: { data: SurfaceData; colorScheme: ColorScheme; opacity: number }) {
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
            <Text position={[range + 0.5, 0, 0]} fontSize={0.4} color="#b0b0b0">SPY%</Text>
            <Text position={[0, range + 0.5, 0]} fontSize={0.4} color="#b0b0b0">Sharpe</Text>
            <Text position={[0, 0, range + 0.5]} fontSize={0.4} color="#b0b0b0">BND%</Text>
        </group>
    );
}

// Portfolio scatter points component
function PortfolioPoints({ portfolios, maxSharpe }: { portfolios: { vol: number; ret: number; sharpe: number }[]; maxSharpe: number }) {
    const geometry = useMemo(() => {
        const positions = new Float32Array(portfolios.length * 3);
        const colors = new Float32Array(portfolios.length * 3);

        portfolios.forEach((p, i) => {
            // Map volatility (5-30%) to X (-5 to 5)
            positions[i * 3] = ((p.vol - 5) / 25) * 10 - 5;
            // Map sharpe to Y
            positions[i * 3 + 1] = p.sharpe * 5;
            // Map return (3-14%) to Z
            positions[i * 3 + 2] = ((p.ret - 3) / 11) * 10 - 5;

            // Color by sharpe ratio: lerp loss rose to gain teal (three.js cannot resolve CSS vars, so hex fallbacks of var(--down)/var(--up))
            const t = Math.max(0, Math.min(1, p.sharpe / maxSharpe));
            const color = new THREE.Color('#f0426c').lerp(new THREE.Color('#21b3a4'), t);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        });

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        return geo;
    }, [portfolios, maxSharpe]);

    return (
        <points geometry={geometry}>
            <pointsMaterial size={0.08} vertexColors transparent opacity={0.6} />
        </points>
    );
}

type SurfaceMode = 'sharpe' | 'return' | 'volatility';

export default function EfficientFrontier2DVisualization() {
    const [assets] = useState<Asset[]>(DEFAULT_ASSETS);
    const [riskFreeRate, setRiskFreeRate] = useState(3);
    const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>('sharpe');
    const [colorScheme, setColorScheme] = useState<ColorScheme>(COLOR_SCHEMES[4]);
    const [simulationKey, setSimulationKey] = useState(0);

    const [showWireframe, setShowWireframe] = useState(true);
    const [wireframeOpacity, setWireframeOpacity] = useState(0.15);
    const [surfaceOpacity, setSurfaceOpacity] = useState(0.9);
    const [showGrid, setShowGrid] = useState(true);
    const [showAxes, setShowAxes] = useState(true);
    const [showPoints, setShowPoints] = useState(true);
    const [autoRotate, setAutoRotate] = useState(false);
    const [rotateSpeed, setRotateSpeed] = useState(1);
    const [resolution, setResolution] = useState(30);

    const [showParams, setShowParams] = useState(true);
    const [showVisuals, setShowVisuals] = useState(false);
    const [showStats, setShowStats] = useState(true);

    const controlsRef = useRef<any>(null);

    const covMatrix = useMemo(() => getCovarianceMatrix(assets, DEFAULT_CORRELATIONS), [assets]);

    // Generate random portfolios for scatter plot
    const randomPortfolios = useMemo(() => {
        const portfolios: { vol: number; ret: number; sharpe: number }[] = [];
        for (let i = 0; i < 2000; i++) {
            const rawWeights = Array(assets.length).fill(0).map(() => Math.random());
            const sum = rawWeights.reduce((a, b) => a + b, 0);
            const weights = rawWeights.map(w => w / sum);
            const p = calculatePortfolio(weights, assets, covMatrix);
            portfolios.push({ vol: p.volatility, ret: p.expectedReturn, sharpe: p.sharpe });
        }
        return portfolios;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assets, covMatrix, simulationKey]);

    // Find max sharpe for coloring
    const maxSharpe = useMemo(() => Math.max(...randomPortfolios.map(p => p.sharpe)), [randomPortfolios]);

    // Generate surface: SPY weight vs BND weight, showing Sharpe/Return/Vol
    const surfaceData = useMemo(() => {
        const res = resolution;
        const vertices: number[] = [];
        const indices: number[] = [];
        let minZ = Infinity, maxZ = -Infinity;

        for (let i = 0; i < res; i++) {
            for (let j = 0; j < res; j++) {
                const spyWeight = i / (res - 1); // 0 to 100% SPY
                const bndWeight = j / (res - 1); // 0 to 100% BND
                const remaining = 1 - spyWeight - bndWeight;

                if (remaining < -0.01) {
                    // Invalid weight combination - clamp to minimum valid surface
                    const clampedRemaining = 0;
                    const clampedSpy = spyWeight / (spyWeight + bndWeight);
                    const clampedBnd = bndWeight / (spyWeight + bndWeight);
                    const weights = [clampedSpy, clampedBnd, 0, 0, 0];
                    const p = calculatePortfolio(weights, assets, covMatrix);
                    let value = surfaceMode === 'sharpe' ? p.sharpe * 8 : surfaceMode === 'return' ? p.expectedReturn / 2 : -p.volatility / 5;
                    const x = spyWeight * 10 - 5;
                    const y = value;
                    const z = bndWeight * 10 - 5;
                    vertices.push(x, y, z);
                    minZ = Math.min(minZ, y);
                    maxZ = Math.max(maxZ, y);
                } else {
                    // Distribute remaining among other assets
                    const weights = [
                        spyWeight,
                        bndWeight,
                        Math.max(0, remaining) * 0.4, // GLD
                        Math.max(0, remaining) * 0.35, // VNQ
                        Math.max(0, remaining) * 0.25, // EEM
                    ];
                    const sum = weights.reduce((a, b) => a + b, 0);
                    const normalizedWeights = weights.map(w => w / sum);

                    const p = calculatePortfolio(normalizedWeights, assets, covMatrix);

                    let value: number;
                    if (surfaceMode === 'sharpe') {
                        value = p.sharpe * 8; // Scale sharpe for visibility
                    } else if (surfaceMode === 'return') {
                        value = p.expectedReturn / 2; // Scale return
                    } else {
                        value = -p.volatility / 5; // Invert volatility (lower is better)
                    }

                    const x = spyWeight * 10 - 5; // Map 0-1 to -5 to 5
                    const y = value;
                    const z = bndWeight * 10 - 5;

                    vertices.push(x, y, z);
                    if (remaining >= -0.01) {
                        minZ = Math.min(minZ, y);
                        maxZ = Math.max(maxZ, y);
                    }
                }

                if (i < res - 1 && j < res - 1) {
                    const a = i * res + j;
                    const b = a + 1;
                    const c = a + res;
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
    }, [assets, covMatrix, surfaceMode, resolution, riskFreeRate]);

    // Find optimal portfolio
    const optimalPortfolio = useMemo(() => {
        let best = randomPortfolios[0];
        for (const p of randomPortfolios) {
            if (p.sharpe > best.sharpe) best = p;
        }
        return best;
    }, [randomPortfolios]);

    const resetCamera = () => { if (controlsRef.current) controlsRef.current.reset(); };

    return (
        <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[var(--bg)] rounded-lg overflow-hidden border border-border">
            <Canvas camera={{ position: [15, 12, 15], fov: 45 }} style={{ background: '#1c1c1c' }}>
                <ambientLight intensity={0.4} />
                <pointLight position={[10, 20, 10]} intensity={1.2} />
                <directionalLight position={[-10, 15, 10]} intensity={0.8} />
                <directionalLight position={[10, -10, -10]} intensity={0.3} />

                <ImmersiveGrid show={showGrid} size={20} />
                <AxisLines show={showAxes} range={8} />

                <PortfolioSurface data={surfaceData} colorScheme={colorScheme} opacity={surfaceOpacity} />
                {showWireframe && <WireframeSurface data={surfaceData} opacity={wireframeOpacity} />}
                {showPoints && <PortfolioPoints portfolios={randomPortfolios} maxSharpe={maxSharpe} />}

                <OrbitControls ref={controlsRef} enablePan enableZoom enableRotate minDistance={5} maxDistance={60} autoRotate={autoRotate} autoRotateSpeed={rotateSpeed} />
            </Canvas>

            {/* Header */}
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
                <div className="flex items-center gap-3 pointer-events-auto">
                    <div className="bg-card rounded-lg px-4 py-2 border border-border flex items-center gap-2">
                        
                        <span className="font-semibold font-mono">3D PORTFOLIO {surfaceMode.toUpperCase()} SURFACE</span>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild><Info className="h-4 w-4 text-[var(--dim)] cursor-help" /></TooltipTrigger>
                                <TooltipContent className="max-w-sm font-mono"><p className="text-sm">min σ²_p = w'Σw s.t. w'μ = μ_target</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <div className="px-3 py-1 rounded text-xs font-mono font-semibold border border-[var(--edge)] bg-[var(--bg2)]" style={{ color: optimalPortfolio.sharpe > 0.4 ? 'var(--up)' : '#c58435' }}>
                        MAX SR: {optimalPortfolio.sharpe.toFixed(2)}
                    </div>
                </div>
                <div className="flex items-center gap-2 pointer-events-auto">
                    <Button variant="outline" size="sm" onClick={() => setSimulationKey(k => k + 1)} className="bg-card">
                        <Shuffle className="h-4 w-4 mr-1" />Resample
                    </Button>
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
                            <div className="text-xs text-[var(--dim)] font-mono mb-2">SURFACE MODE</div>
                            <div className="flex gap-1">
                                <Button variant={surfaceMode === 'sharpe' ? 'default' : 'outline'} size="sm" onClick={() => setSurfaceMode('sharpe')} className="flex-1 font-mono text-xs">SHARPE</Button>
                                <Button variant={surfaceMode === 'return' ? 'default' : 'outline'} size="sm" onClick={() => setSurfaceMode('return')} className="flex-1 font-mono text-xs">RETURN</Button>
                                <Button variant={surfaceMode === 'volatility' ? 'default' : 'outline'} size="sm" onClick={() => setSurfaceMode('volatility')} className="flex-1 font-mono text-xs">VOL</Button>
                            </div>
                            <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">RISK-FREE (Rf)</Label><span className="text-xs">{riskFreeRate}%</span></div><Slider value={[riskFreeRate]} onValueChange={([v]) => setRiskFreeRate(v)} min={0} max={10} step={0.5} /></div>
                            <div className="pt-2 border-t border-border">
                                <div className="text-xs text-[var(--dim)] font-mono mb-2">ASSETS (Fixed)</div>
                                {assets.map((asset) => (
                                    <div key={asset.symbol} className="flex justify-between text-xs font-mono mb-1">
                                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: asset.color }} />{asset.symbol}</span>
                                        <span className="text-[var(--dim)]">μ={asset.expectedReturn}% σ={asset.volatility}%</span>
                                    </div>
                                ))}
                            </div>
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
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono">MONTE CARLO POINTS</Label><Switch checked={showPoints} onCheckedChange={setShowPoints} /></div>
                            <div className="space-y-2"><div className="flex justify-between font-mono"><Label className="text-xs text-[var(--dim)]">RESOLUTION</Label><span className="text-xs">{resolution}²</span></div><Slider value={[resolution]} onValueChange={([v]) => setResolution(v)} min={15} max={50} step={5} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono flex items-center gap-1"><Grid3X3 className="h-3 w-3" /> GRID</Label><Switch checked={showGrid} onCheckedChange={setShowGrid} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono flex items-center gap-1"><Box className="h-3 w-3" /> AXES</Label><Switch checked={showAxes} onCheckedChange={setShowAxes} /></div>
                            <div className="flex items-center justify-between"><Label className="text-xs text-[var(--dim)] font-mono">AUTO ROTATE</Label><Switch checked={autoRotate} onCheckedChange={setAutoRotate} /></div>
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
                            <div className="text-[10px] text-[var(--dim)] font-mono uppercase tracking-wide flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-[var(--up)]" />OPTIMAL PORTFOLIO
                            </div>
                            <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">RETURN</span><span className="text-sm text-[var(--up)]">{optimalPortfolio.ret.toFixed(2)}%</span></div>
                            <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">VOLATILITY</span><span className="text-sm text-[var(--up)]">{optimalPortfolio.vol.toFixed(2)}%</span></div>
                            <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">SHARPE</span><span className="text-sm text-[var(--up)] font-bold">{optimalPortfolio.sharpe.toFixed(3)}</span></div>
                            <div className="pt-2 border-t border-border">
                                <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">PORTFOLIOS</span><span className="text-sm">{randomPortfolios.length.toLocaleString()}</span></div>
                                <div className="flex justify-between font-mono"><span className="text-xs text-[var(--dim)]">RISK-FREE</span><span className="text-sm">{riskFreeRate}%</span></div>
                            </div>
                            <div className="pt-2 border-t border-border">
                                <div className="text-xs text-[var(--dim)] mb-2 font-mono">{surfaceMode.toUpperCase()} SCALE</div>
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
                    <span>X: SPY% | Z: BND% | Y: {surfaceMode}</span>
                </div>
            </div>
        </div>
    );
}
