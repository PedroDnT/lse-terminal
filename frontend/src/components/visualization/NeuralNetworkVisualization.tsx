import React, { useMemo, useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Sphere, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Brain, Info, ChevronDown, ChevronUp, Settings, Eye, RotateCcw, Play } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface NetworkConfig {
    inputNeurons: number;
    hiddenLayers: number[];
    outputNeurons: number;
    preset: string;
}

interface NeuronPosition {
    x: number;
    y: number;
    z: number;
    layer: number;
    index: number;
}

// Network architecture presets
const PRESETS: Record<string, NetworkConfig> = {
    'deep-trading': {
        inputNeurons: 12,
        hiddenLayers: [24, 20, 16, 12, 8],
        outputNeurons: 4,
        preset: 'deep-trading',
    },
    'price-predictor': {
        inputNeurons: 8,
        hiddenLayers: [16, 12, 8],
        outputNeurons: 3,
        preset: 'price-predictor',
    },
    'volatility-model': {
        inputNeurons: 6,
        hiddenLayers: [12, 8],
        outputNeurons: 2,
        preset: 'volatility-model',
    },
    'sentiment-classifier': {
        inputNeurons: 10,
        hiddenLayers: [20, 16, 12, 8],
        outputNeurons: 4,
        preset: 'sentiment-classifier',
    },
    'simple-mlp': {
        inputNeurons: 4,
        hiddenLayers: [6, 4],
        outputNeurons: 2,
        preset: 'simple-mlp',
    },
};

const INPUT_LABELS = ['Price', 'Volume', 'RSI', 'MACD', 'ATR', 'OBV', 'SMA', 'EMA', 'Momentum', 'Volatility'];
const OUTPUT_LABELS = ['Buy', 'Sell', 'Hold', 'Confidence'];

// Animated neuron sphere
function Neuron({
    position,
    isInput,
    isOutput,
    label,
    showLabels,
    pulsePhase,
}: {
    position: [number, number, number];
    isInput?: boolean;
    isOutput?: boolean;
    label?: string;
    showLabels: boolean;
    pulsePhase: number;
}) {
    // Static - no per-frame animation for performance

    // three.js materials cannot resolve CSS vars, so terminal hex fallbacks are used:
    // inputs teal (up), outputs amber (secondary dimension), hidden near-white
    const color = isInput ? '#21b3a4' : isOutput ? '#c58435' : '#e8e8e8';
    const emissive = isInput ? '#21b3a4' : isOutput ? '#c58435' : '#b0b0b0';

    return (
        <group position={position}>
            <Sphere args={[0.18, 16, 16]}>
                <meshStandardMaterial
                    color={color}
                    emissive={emissive}
                    emissiveIntensity={0.7}
                    roughness={0.3}
                    metalness={0.2}
                />
            </Sphere>
            {showLabels && label && (
                <Text
                    position={isInput ? [-0.8, 0, 0] : isOutput ? [0.8, 0, 0] : [0, 0.3, 0]}
                    fontSize={0.18}
                    color="#b0b0b0"
                    anchorX={isInput ? 'right' : isOutput ? 'left' : 'center'}
                    anchorY="middle"
                >
                    {label}
                </Text>
            )}
        </group>
    );
}

// Animated connection that pulses with wave effect
function AnimatedConnection({
    start,
    end,
    animating,
    connectionIndex,
    globalTime,
}: {
    start: [number, number, number];
    end: [number, number, number];
    animating: boolean;
    connectionIndex: number;
    globalTime: number;
}) {
    // Calculate wave opacity based on global time
    const wave = animating
        ? Math.sin(globalTime * 3 + connectionIndex * 0.015) * 0.5 + 0.5
        : 0.5;
    const opacity = animating ? 0.3 + wave * 0.5 : 0.55;

    return (
        <Line
            points={[start, end]}
            color={animating ? "#e8e8e8" : "#b0b0b0"}
            lineWidth={animating ? 1.0 : 0.7}
            transparent
            opacity={opacity}
        />
    );
}

// Layer info panel in 3D
function LayerInfo({
    position,
    layerIndex,
    neuronCount,
    isInput,
    isOutput,
}: {
    position: [number, number, number];
    layerIndex: number;
    neuronCount: number;
    isInput?: boolean;
    isOutput?: boolean;
}) {
    const label = isInput ? 'Inputs' : isOutput ? 'Outputs' : `HL ${layerIndex}`;
    const activation = isInput ? 'Raw Data' : isOutput ? 'Softmax' : 'ReLU';

    return (
        <group position={position}>
            <Text position={[0, 0, 0]} fontSize={0.2} color="#e8e8e8" anchorX="center">
                {label}
            </Text>
            <Text position={[0, -0.3, 0]} fontSize={0.12} color="#b0b0b0" anchorX="center">
                Neurons: {neuronCount}
            </Text>
            <Text position={[0, -0.5, 0]} fontSize={0.1} color="#808080" anchorX="center">
                Activation: {activation}
            </Text>
        </group>
    );
}

// Grid floor
function GridFloor({ show }: { show: boolean }) {
    if (!show) return null;
    return (
        <group>
            <gridHelper args={[20, 20, '#3a3a3a', '#2e2e2e']} position={[0, -5, 0]} />
        </group>
    );
}

// Main network scene
function NetworkScene({
    config,
    showConnections,
    showLabels,
    showLayerInfo,
    showGrid,
    animateFlow,
}: {
    config: NetworkConfig;
    showConnections: boolean;
    showLabels: boolean;
    showLayerInfo: boolean;
    showGrid: boolean;
    animateFlow: boolean;
}) {
    // Global time for wave animation - updated by single useFrame
    const [globalTime, setGlobalTime] = useState(0);

    // Single useFrame loop updates time - React batches the re-render
    useFrame(({ clock }) => {
        if (animateFlow) {
            // Update every 2 frames to reduce re-renders (still 30fps animation)
            if (Math.floor(clock.elapsedTime * 30) % 2 === 0) {
                setGlobalTime(clock.elapsedTime);
            }
        }
    });

    // Calculate neuron positions
    const { neurons, connections, layerPositions } = useMemo(() => {
        const allLayers = [config.inputNeurons, ...config.hiddenLayers, config.outputNeurons];
        const layerSpacing = 2.5;
        const totalWidth = (allLayers.length - 1) * layerSpacing;
        const startX = -totalWidth / 2;

        const neurons: NeuronPosition[] = [];
        const connections: { start: NeuronPosition; end: NeuronPosition; weight: number }[] = [];
        const layerPositions: { x: number; neuronCount: number; isInput: boolean; isOutput: boolean }[] = [];

        let neuronIdCounter = 0;

        // Create neurons for each layer
        allLayers.forEach((neuronCount, layerIndex) => {
            const x = startX + layerIndex * layerSpacing;
            const layerHeight = (neuronCount - 1) * 0.5;
            const startY = layerHeight / 2;

            layerPositions.push({
                x,
                neuronCount,
                isInput: layerIndex === 0,
                isOutput: layerIndex === allLayers.length - 1,
            });

            for (let i = 0; i < neuronCount; i++) {
                neurons.push({
                    x,
                    y: startY - i * 0.5,
                    z: 0,
                    layer: layerIndex,
                    index: neuronIdCounter++,
                });
            }
        });

        // Create connections between adjacent layers
        for (let l = 0; l < allLayers.length - 1; l++) {
            const currentLayerNeurons = neurons.filter(n => n.layer === l);
            const nextLayerNeurons = neurons.filter(n => n.layer === l + 1);

            currentLayerNeurons.forEach(startNeuron => {
                nextLayerNeurons.forEach(endNeuron => {
                    connections.push({
                        start: startNeuron,
                        end: endNeuron,
                        weight: Math.random() * 2 - 1, // Random weight for visualization
                    });
                });
            });
        }

        return { neurons, connections, layerPositions };
    }, [config]);

    return (
        <group>
            <GridFloor show={showGrid} />

            {/* Layer info panels */}
            {showLayerInfo && layerPositions.map((layer, i) => (
                <LayerInfo
                    key={i}
                    position={[layer.x, (layer.neuronCount - 1) * 0.25 + 1.2, 0]}
                    layerIndex={i}
                    neuronCount={layer.neuronCount}
                    isInput={layer.isInput}
                    isOutput={layer.isOutput}
                />
            ))}

            {/* Connections */}
            {showConnections && connections.map((conn, i) => (
                <AnimatedConnection
                    key={i}
                    start={[conn.start.x, conn.start.y, conn.start.z]}
                    end={[conn.end.x, conn.end.y, conn.end.z]}
                    animating={animateFlow}
                    connectionIndex={i}
                    globalTime={globalTime}
                />
            ))}

            {/* Neurons */}
            {neurons.map((neuron, i) => {
                const isInput = neuron.layer === 0;
                const isOutput = neuron.layer === layerPositions.length - 1;
                const neuronIndex = neurons.filter(n => n.layer === neuron.layer).indexOf(neuron);
                const label = isInput
                    ? INPUT_LABELS[neuronIndex] || `In ${neuronIndex + 1}`
                    : isOutput
                        ? OUTPUT_LABELS[neuronIndex] || `Out ${neuronIndex + 1}`
                        : undefined;

                return (
                    <Neuron
                        key={i}
                        position={[neuron.x, neuron.y, neuron.z]}
                        isInput={isInput}
                        isOutput={isOutput}
                        label={label}
                        showLabels={showLabels}
                        pulsePhase={i * 0.3}
                    />
                );
            })}
        </group>
    );
}

export default function NeuralNetworkVisualization() {
    const [config, setConfig] = useState<NetworkConfig>(PRESETS['price-predictor']);
    const [showConnections, setShowConnections] = useState(true);
    const [showLabels, setShowLabels] = useState(true);
    const [showLayerInfo, setShowLayerInfo] = useState(true);
    const [showGrid, setShowGrid] = useState(true);
    const [animateFlow, setAnimateFlow] = useState(false);
    const [autoRotate, setAutoRotate] = useState(false);
    const [rotateSpeed, setRotateSpeed] = useState(1);
    const [showParams, setShowParams] = useState(true);
    const [showVisuals, setShowVisuals] = useState(false);
    const [showStats, setShowStats] = useState(true);

    const controlsRef = useRef<any>(null);
    const resetCamera = () => controlsRef.current?.reset();

    const handlePresetChange = (preset: string) => {
        setConfig(PRESETS[preset] || PRESETS['price-predictor']);
    };

    // Calculate network statistics
    const stats = useMemo(() => {
        const allLayers = [config.inputNeurons, ...config.hiddenLayers, config.outputNeurons];
        const totalNeurons = allLayers.reduce((a, b) => a + b, 0);
        let totalConnections = 0;
        for (let i = 0; i < allLayers.length - 1; i++) {
            totalConnections += allLayers[i] * allLayers[i + 1];
        }
        const totalParams = totalConnections + totalNeurons; // weights + biases
        return {
            layers: allLayers.length,
            neurons: totalNeurons,
            connections: totalConnections,
            parameters: totalParams,
            architecture: allLayers.join(' → '),
        };
    }, [config]);

    return (
        <div className="relative w-full h-[calc(100vh-180px)] min-h-[600px] bg-[var(--bg)] rounded-lg overflow-hidden border border-border">
            <Canvas
                camera={{ position: [8, 4, 8], fov: 50 }}
                style={{ background: 'var(--bg, #1c1c1c)' }}
            >
                <ambientLight intensity={0.3} />
                <pointLight position={[10, 10, 10]} intensity={0.8} />
                <pointLight position={[-10, -10, -10]} intensity={0.3} />
                <directionalLight position={[5, 15, 5]} intensity={0.6} />

                <NetworkScene
                    config={config}
                    showConnections={showConnections}
                    showLabels={showLabels}
                    showLayerInfo={showLayerInfo}
                    showGrid={showGrid}
                    animateFlow={animateFlow}
                />

                <OrbitControls
                    ref={controlsRef}
                    enablePan
                    enableZoom
                    enableRotate
                    minDistance={5}
                    maxDistance={30}
                    autoRotate={autoRotate}
                    autoRotateSpeed={-rotateSpeed}
                />
            </Canvas>

            {/* Header */}
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
                <div className="flex items-center gap-3 pointer-events-auto">
                    <div className="bg-card text-[var(--text)] rounded-lg px-4 py-2 border border-border flex items-center gap-2">

                        <span className="font-semibold text-[var(--text)]">Neural Network Architecture</span>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-4 w-4 text-[var(--dim)] cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm">
                                    <p className="text-sm">Interactive 3D visualization of feedforward neural network architecture. Teal nodes are inputs (market features), amber nodes are outputs (trading signals).</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
                <div className="flex items-center gap-2 pointer-events-auto">
                    <Button
                        variant={animateFlow ? "default" : "outline"}
                        size="sm"
                        onClick={() => setAnimateFlow(!animateFlow)}
                        className={animateFlow ? "" : "bg-card text-[var(--text)]"}
                    >
                        <Play className="h-4 w-4 mr-1" />{animateFlow ? "Stop Simulation" : "Run Simulation"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={resetCamera} className="bg-card text-[var(--text)]">
                        <RotateCcw className="h-4 w-4 mr-1" />Reset View
                    </Button>
                </div>
            </div>

            {/* Left Panel - Parameters */}
            <div className="absolute left-4 top-20 w-72 space-y-2 pointer-events-auto">
                <Collapsible open={showParams} onOpenChange={setShowParams}>
                    <CollapsibleTrigger asChild>
                        <Button variant="outline" className="w-full justify-between bg-card text-[var(--text)]">
                            <span className="flex items-center gap-2"><Settings className="h-4 w-4" />Network Configuration</span>
                            {showParams ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-4 bg-card text-[var(--text)] border-border space-y-4">
                            <div className="space-y-2">
                                <Label className="text-xs text-[var(--dim)]">Network Preset</Label>
                                <Select value={config.preset} onValueChange={handlePresetChange}>
                                    <SelectTrigger className="h-8 bg-[var(--bg2)] border-[var(--edge)] text-[var(--text)]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-card border-border text-[var(--text)]">
                                        <SelectItem value="deep-trading" className="text-[var(--text)] focus:bg-[var(--hover)] focus:text-[var(--text)]">Deep Trading Network</SelectItem>
                                        <SelectItem value="price-predictor" className="text-[var(--text)] focus:bg-[var(--hover)] focus:text-[var(--text)]">Price Predictor</SelectItem>
                                        <SelectItem value="volatility-model" className="text-[var(--text)] focus:bg-[var(--hover)] focus:text-[var(--text)]">Volatility Model</SelectItem>
                                        <SelectItem value="sentiment-classifier" className="text-[var(--text)] focus:bg-[var(--hover)] focus:text-[var(--text)]">Sentiment Classifier</SelectItem>
                                        <SelectItem value="simple-mlp" className="text-[var(--text)] focus:bg-[var(--hover)] focus:text-[var(--text)]">Simple MLP</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <Label className="text-xs text-[var(--dim)]">Input Neurons</Label>
                                    <span className="text-xs font-medium text-[var(--text)]">{config.inputNeurons}</span>
                                </div>
                                <Slider
                                    value={[config.inputNeurons]}
                                    onValueChange={([v]) => setConfig(c => ({ ...c, inputNeurons: v }))}
                                    min={2}
                                    max={12}
                                    step={1}
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <Label className="text-xs text-[var(--dim)]">Output Neurons</Label>
                                    <span className="text-xs font-medium text-[var(--text)]">{config.outputNeurons}</span>
                                </div>
                                <Slider
                                    value={[config.outputNeurons]}
                                    onValueChange={([v]) => setConfig(c => ({ ...c, outputNeurons: v }))}
                                    min={1}
                                    max={6}
                                    step={1}
                                />
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
                        <Card className="mt-2 p-4 bg-card text-[var(--text)] border-border space-y-4">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs text-[var(--dim)]">Show Connections</Label>
                                <Switch checked={showConnections} onCheckedChange={setShowConnections} />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label className="text-xs text-[var(--dim)]">Show Labels</Label>
                                <Switch checked={showLabels} onCheckedChange={setShowLabels} />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label className="text-xs text-[var(--dim)]">Layer Info</Label>
                                <Switch checked={showLayerInfo} onCheckedChange={setShowLayerInfo} />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label className="text-xs text-[var(--dim)]">Grid Floor</Label>
                                <Switch checked={showGrid} onCheckedChange={setShowGrid} />
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
                            <span className="flex items-center gap-2"><Info className="h-4 w-4" />Network Stats</span>
                            {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <Card className="mt-2 p-3 bg-card text-[var(--text)] border-border space-y-3">
                            <div className="flex justify-between">
                                <span className="text-xs text-[var(--dim)]">Total Layers</span>
                                <span className="text-sm font-medium text-[var(--text)]">{stats.layers}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-xs text-[var(--dim)]">Total Neurons</span>
                                <span className="text-sm font-medium text-[var(--text)]">{stats.neurons}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-xs text-[var(--dim)]">Connections</span>
                                <span className="text-sm font-medium text-[var(--text)]">{stats.connections.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-xs text-[var(--dim)]">Parameters</span>
                                <span className="text-sm font-medium text-[var(--text)]">{stats.parameters.toLocaleString()}</span>
                            </div>
                            <div className="pt-2 border-t border-border">
                                <div className="text-xs text-[var(--dim)] mb-1">Architecture</div>
                                <div className="text-xs font-mono text-[var(--text)]">{stats.architecture}</div>
                            </div>
                        </Card>
                    </CollapsibleContent>
                </Collapsible>
            </div>

            {/* Bottom Controls */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
                <div className="bg-card text-[var(--text)] rounded-lg px-4 py-2 border border-border flex items-center gap-4 text-xs text-[var(--dim)]">
                    <span>Drag to rotate</span><span className="text-border">•</span>
                    <span>Scroll to zoom</span><span className="text-border">•</span>
                    <span>Right-click to pan</span>
                </div>
            </div>
        </div>
    );
}
