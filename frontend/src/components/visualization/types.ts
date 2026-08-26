import * as THREE from 'three';

export interface SimulationParams {
  initialPrice: number;
  drift: number;
  volatility: number;
  timeHorizon: number;
  numSimulations: number;
}

export interface PathData {
  points: THREE.Vector3[];
  color: string;
  finalValue: number;
}

export interface ColorScheme {
  id: string;
  name: string;
  colors: string[];
  getColor: (value: number, min: number, max: number) => string;
}

// Color schemes, restyled to the terminal's zinc idiom (the ported
// website palettes read as neon slop next to the terminal chrome).
// Ids and array positions are load-bearing: components pick COLOR_SCHEMES[n]
// by index and persisted selections match on id, so only the swatches change.
// Teal/rose anchors are the terminal's own --up/--down; everything else is a
// desaturated ramp.
function rampColor(colors: string[]) {
  return (value: number, min: number, max: number) => {
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const idx = t * (colors.length - 1);
    const i = Math.floor(idx);
    const f = idx - i;
    if (i >= colors.length - 1) return colors[colors.length - 1];
    return lerpColor(colors[i], colors[i + 1], f);
  };
}

const RAMPS: Record<string, string[]> = {
  emerald: ['#25322c', '#31473d', '#41604f', '#5c8370', '#87ab97'],
  slate: ['#26282b', '#35383c', '#484c51', '#64696f', '#8f9499'],
  teal: ['#1d3330', '#1f4c46', '#20776d', '#21b3a4', '#7ccec3'],
  blue: ['#262b33', '#343d49', '#475366', '#65748c', '#93a0b4'],
  zinc: ['#27272a', '#3f3f46', '#52525b', '#71717a', '#a1a1aa'],
  pnl: ['#8f2c44', '#f0426c', '#71717a', '#21b3a4', '#177d72'],
};

export const COLOR_SCHEMES: ColorScheme[] = [
  { id: 'emerald', name: 'Emerald', colors: RAMPS.emerald, getColor: rampColor(RAMPS.emerald) },
  { id: 'slate', name: 'Slate', colors: RAMPS.slate, getColor: rampColor(RAMPS.slate) },
  { id: 'teal', name: 'Teal', colors: RAMPS.teal, getColor: rampColor(RAMPS.teal) },
  { id: 'blue', name: 'Steel', colors: RAMPS.blue, getColor: rampColor(RAMPS.blue) },
  { id: 'zinc', name: 'Zinc', colors: RAMPS.zinc, getColor: rampColor(RAMPS.zinc) },
  { id: 'pnl', name: 'P&L', colors: RAMPS.pnl, getColor: rampColor(RAMPS.pnl) },
];

// Helper to interpolate between two hex colors
function lerpColor(c1: string, c2: string, t: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export interface VolatilitySurfaceParams {
  spotPrice: number;
  riskFreeRate: number;
  atmVol: number;
  skew: number;
  kurtosis: number;
  termStructure: number;
}

export interface VaRSurfaceParams {
  lookbackPeriods: number;
  confidenceLevels: number;
  tailExponent: number;
  clusterIntensity: number;
}

export interface HestonParams {
  spotPrice: number;
  v0: number;           // Initial variance
  kappa: number;        // Mean reversion speed
  theta: number;        // Long-term variance
  sigma: number;        // Vol of vol
  rho: number;          // Correlation
  T: number;            // Time horizon
  numPaths: number;
}
