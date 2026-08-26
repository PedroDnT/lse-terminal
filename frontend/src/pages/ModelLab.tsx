// ============================================================================
// ModelLab.tsx - the `model` dict viewer (ModelView).
//
// This file is ONLY the renderer: it knows the model-dict shapes
// (surface / lines / scatter / heatmap / bars) and nothing about how they
// were computed. QUANT MODELS fit mode renders engine/quant_fit.py results
// through it. (It began as the Model Lab's right-hand pane; that page was
// removed, the viewer stayed for fit mode.)
//
// 3D surfaces use three.js (already bundled for QUANT MODELS); the 2D forms
// use echarts (already bundled for DATA VISUALISATION), driven imperatively
// for the same reason DataViz does it: the React wrapper mis-renders inside
// this IIFE bundle.
// ============================================================================

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as echarts from 'echarts';

export type ModelData = {
  kind: 'surface' | 'lines' | 'scatter' | 'heatmap' | 'bars';
  title?: string;
  x?: (number | null)[];
  y?: (number | null)[];
  z?: (number | null)[][];
  series?: { name: string; y: (number | null)[]; x?: (number | null)[] | null }[];
  x_label?: string;
  y_label?: string;
  z_label?: string;
  notes?: string[];
};

const cssVar = (name: string, fallback: string): string =>
  (typeof document !== 'undefined' &&
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

const isDark = () => document.documentElement.classList.contains('dark');

// One sequential ramp, low -> high. Sequential data gets ONE hue by design
// (a rainbow invents boundaries the numbers do not have); this is the same
// teal family the QUANT MODELS surfaces use, so the two pages read as one
// product.
const RAMP = ['#0b3b39', '#0f766e', '#14b8a6', '#5eead4', '#c7fff4'];

function rampColor(t: number, out: THREE.Color) {
  const c = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(c));
  return out.set(RAMP[i]).lerp(new THREE.Color(RAMP[i + 1]), c - i);
}

const R = 10;      // surface half-width in world units
const H = 6;       // surface height in world units

// ---------------------------------------------------------------------------
// 3D surface
// ---------------------------------------------------------------------------

function SurfaceMesh({ data }: { data: ModelData }) {
  const built = useMemo(() => {
    const z = data.z || [];
    const rows = z.length;
    const cols = rows ? z[0].length : 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of z) {
      for (const v of row) {
        if (v != null && isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-12) hi = lo + 1e-12;

    const pos = new Float32Array(rows * cols * 3);
    const col = new Float32Array(rows * cols * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const k = (i * cols + j) * 3;
        const v = z[i][j];
        const t = v == null || !isFinite(v) ? 0 : (v - lo) / (hi - lo);
        // x across columns, y (depth) across rows, value as height
        pos[k] = cols > 1 ? (j / (cols - 1)) * 2 * R - R : 0;
        pos[k + 1] = t * H;
        pos[k + 2] = rows > 1 ? (i / (rows - 1)) * 2 * R - R : 0;
        rampColor(t, tmp);
        col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
      }
    }
    // Two triangles per cell, skipping any cell touching a hole (null/NaN)
    // so a gap in the data reads as a gap, never as a spike to zero.
    const idx: number[] = [];
    const ok = (i: number, j: number) => {
      const v = z[i][j];
      return v != null && isFinite(v);
    };
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        if (!(ok(i, j) && ok(i + 1, j) && ok(i, j + 1) && ok(i + 1, j + 1))) continue;
        const a = i * cols + j;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return { geo, lo, hi };
  }, [data]);

  useEffect(() => () => built.geo.dispose(), [built]);

  return (
    <>
      <mesh geometry={built.geo}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh geometry={built.geo}>
        <meshBasicMaterial color={isDark() ? '#ffffff' : '#334155'} wireframe transparent opacity={0.06} />
      </mesh>
    </>
  );
}

// Axis frame with real end labels: a surface without numbers on its axes is
// decoration, not a model.
function AxisFrame({ data }: { data: ModelData }) {
  const ink = isDark() ? '#9ca3af' : '#475569';
  const line = isDark() ? '#6b7280' : '#94a3b8';
  const num = (v: number | null | undefined) => {
    if (v == null || !isFinite(v)) return '';
    const a = Math.abs(v);
    if (a >= 1000) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 0.01) return v.toFixed(2);
    return v.toExponential(1);
  };
  const xs = data.x || [];
  const ys = data.y || [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of data.z || []) {
    for (const v of row) {
      if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  const seg = (pts: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  };
  return (
    <group>
      <lineSegments geometry={seg([-R, 0, R, R, 0, R, -R, 0, R, -R, 0, -R, -R, 0, R, -R, H, R])}>
        <lineBasicMaterial color={line} />
      </lineSegments>
      {/* The two axes share the near-left corner, so their MIN labels are
          pushed apart deliberately (x's along its own edge, y's set back
          into the depth axis) instead of stacking on the same point. */}
      <Text position={[0, -0.9, R + 2.1]} fontSize={0.62} color={ink}>{data.x_label || 'x'}</Text>
      <Text position={[-R + 0.6, -0.9, R + 1.1]} fontSize={0.5} color={ink}>{num(xs[0] as number)}</Text>
      <Text position={[R, -0.9, R + 1.1]} fontSize={0.5} color={ink}>{num(xs[xs.length - 1] as number)}</Text>
      <Text position={[-R - 2.4, -0.9, 0]} fontSize={0.62} color={ink} rotation={[0, Math.PI / 2, 0]}>
        {data.y_label || 'y'}
      </Text>
      <Text position={[-R - 1.3, -0.9, R - 0.8]} fontSize={0.5} color={ink} rotation={[0, Math.PI / 2, 0]}>
        {num(ys[0] as number)}
      </Text>
      <Text position={[-R - 1.3, -0.9, -R]} fontSize={0.5} color={ink} rotation={[0, Math.PI / 2, 0]}>
        {num(ys[ys.length - 1] as number)}
      </Text>
      <Text position={[-R - 1.2, H + 0.7, R]} fontSize={0.62} color={ink}>{data.z_label || 'z'}</Text>
      <Text position={[-R - 1.2, H, R + 0.6]} fontSize={0.5} color={ink}>{num(hi)}</Text>
      <Text position={[-R - 1.2, 0.15, R + 0.6]} fontSize={0.5} color={ink}>{num(lo)}</Text>
    </group>
  );
}

// Frame the whole surface AND its axis labels, whatever shape the pane is.
// three.js `fov` is VERTICAL, so a tall narrow pane (this split view on a
// portrait-ish window) clips horizontally no matter how the position is
// hand-tuned: the first attempt at [26,19,29] still ran off both sides.
// Deriving the distance from the live aspect fixes it for every layout,
// including ultrawide monitors.
const FIT_TARGET = new THREE.Vector3(0, H * 0.35, 0);
const FIT_DIR = new THREE.Vector3(0.62, 0.44, 0.66).normalize();

function FitCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    // Half-extents to keep in frame: the surface is a 2R square, so its
    // diagonal governs the width, plus room for the labels sitting outside it.
    const halfWide = R * Math.SQRT2 + 2.4;
    const halfTall = (H + R * 0.5) / 2 + 1.6;
    const dist = Math.max(halfWide / Math.tan(hfov / 2),
                          halfTall / Math.tan(vfov / 2)) * 1.06;
    cam.position.copy(FIT_DIR).multiplyScalar(dist).add(FIT_TARGET);
    cam.lookAt(FIT_TARGET);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function Surface3D({ data }: { data: ModelData }) {
  return (
    <Canvas
      camera={{ position: [26, 19, 29], fov: 38 }}
      style={{
        background: isDark()
          ? 'radial-gradient(120% 120% at 50% 30%, #232323 0%, #1a1a1a 60%, #141414 100%)'
          : 'radial-gradient(120% 120% at 50% 30%, #ffffff 0%, #f2f4f7 60%, #e6e9ee 100%)',
      }}
    >
      <FitCamera />
      <ambientLight intensity={isDark() ? 0.55 : 0.9} />
      <directionalLight position={[12, 18, 8]} intensity={isDark() ? 0.7 : 0.5} />
      <SurfaceMesh data={data} />
      <AxisFrame data={data} />
      {/* Orbit about the surface's body, not the floor, so dragging feels
          like turning the object rather than swinging under it. */}
      <OrbitControls enablePan enableZoom enableRotate target={[0, H * 0.35, 0]} />
    </Canvas>
  );
}

// ---------------------------------------------------------------------------
// 2D forms (echarts)
// ---------------------------------------------------------------------------

function Chart2D({ data }: { data: ModelData }) {
  const host = useRef<HTMLDivElement | null>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!host.current) return;
    if (!inst.current) inst.current = echarts.init(host.current, undefined, { renderer: 'canvas' });
    const ink = cssVar('--text', '#e8e8e8');
    const dim = cssVar('--dim', '#b0b0b0');
    const edge = cssVar('--edge', '#3a3a3a');
    const panel = cssVar('--panel', '#2a2a2a');
    const chart = inst.current;
    const many = (data.series || []).length > 6;

    const axisCommon = {
      axisLine: { lineStyle: { color: edge } },
      axisLabel: { color: dim, fontSize: 10 },
      splitLine: { lineStyle: { color: edge, opacity: 0.45 } },
      nameTextStyle: { color: dim, fontSize: 11 },
    };

    // echarts' stock tooltip is a white card with black text, so every hover
    // in the dark terminal flashed a bright block over the model. Bind it to
    // the app's own panel/edge/text vars instead: correct in both themes,
    // including the axis-pointer label, which is a second white chip.
    const tooltipSkin = {
      backgroundColor: panel,
      borderColor: edge,
      borderWidth: 1,
      padding: [7, 10] as [number, number],
      textStyle: { color: ink, fontSize: 11 },
      extraCssText: 'border-radius:3px; box-shadow:0 6px 18px rgba(0,0,0,.35);',
      axisPointer: {
        lineStyle: { color: dim, width: 1 },
        crossStyle: { color: dim, width: 1 },
        label: { backgroundColor: panel, borderColor: edge, borderWidth: 1,
                 color: ink, fontSize: 10 },
      },
    };

    // Zoom, because a 4000-bar fit is unreadable at full extent: wheel over
    // the plot zooms x, shift+wheel zooms y, dragging pans, double-click
    // resets. filterMode 'none' clips the VIEW instead of dropping points
    // from the series, so a y-zoom never rescales the other axis under you.
    const zoom = [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none',
        zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false },
      { type: 'inside', yAxisIndex: 0, filterMode: 'none',
        zoomOnMouseWheel: 'shift', moveOnMouseMove: true, moveOnMouseWheel: false },
    ];
    const zr = chart.getZr();
    zr.off('dblclick');
    zr.on('dblclick', () => {
      for (const i of [0, 1]) chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: i, start: 0, end: 100 });
    });

    if (data.kind === 'heatmap') {
      const pts: [number, number, number][] = [];
      let lo = Infinity;
      let hi = -Infinity;
      (data.z || []).forEach((row, i) => row.forEach((v, j) => {
        if (v == null || !isFinite(v)) return;
        pts.push([j, i, v]);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }));
      chart.setOption({
        animation: false,
        grid: { left: 60, right: 70, top: 24, bottom: 46 },
        tooltip: { ...tooltipSkin },
        dataZoom: zoom,
        xAxis: { type: 'category', name: data.x_label, data: (data.x || []).map(String), ...axisCommon },
        yAxis: { type: 'category', name: data.y_label, data: (data.y || []).map(String), ...axisCommon },
        visualMap: { min: lo, max: hi, calculable: true, orient: 'vertical', right: 6, top: 'middle',
                     inRange: { color: RAMP }, textStyle: { color: dim } },
        series: [{ type: 'heatmap', data: pts, progressive: 4000 }],
      }, true);
    } else if (data.kind === 'bars') {
      const s0 = (data.series || [])[0] || { name: '', y: [] };
      const xs = s0.x || data.x || s0.y.map((_, k) => k);
      chart.setOption({
        animation: false,
        grid: { left: 64, right: 26, top: 26, bottom: 48 },
        tooltip: { trigger: 'axis', ...tooltipSkin },
        dataZoom: zoom,
        xAxis: { type: 'category', name: data.x_label, nameLocation: 'middle',
                 nameGap: 26,
                 data: xs.map((v) => (typeof v === 'number' ? v.toFixed(2) : String(v))),
                 ...axisCommon },
        yAxis: { type: 'value', name: data.y_label, nameLocation: 'middle',
                 nameGap: 46, ...axisCommon },
        textStyle: { color: ink },
        series: [{ type: 'bar', name: s0.name, data: s0.y,
                   itemStyle: { color: RAMP[2] }, barCategoryGap: '12%',
                   large: true }],
      }, true);
    } else {
      const isScatter = data.kind === 'scatter';
      const series = (data.series || []).map((s, i) => {
        const xs = s.x || data.x || s.y.map((_, k) => k);
        const pts = s.y.map((v, k) => [xs[k] as number, v as number]);
        // Many paths: one hue at low opacity reads as a distribution;
        // colour-coding 40 Monte Carlo paths would imply 40 identities.
        const color = many ? RAMP[2] : RAMP[Math.min(RAMP.length - 1, 1 + (i % 4))];
        return {
          name: s.name || `series ${i + 1}`,
          type: isScatter ? 'scatter' : 'line',
          data: pts,
          showSymbol: isScatter,
          symbolSize: isScatter ? (i === 0 ? 4 : 11) : 0,
          lineStyle: { width: many ? 1 : 1.8, opacity: many ? 0.5 : 1, color },
          itemStyle: { color, opacity: many ? 0.5 : 0.9 },
          large: true,
          largeThreshold: 2000,
          emphasis: { focus: 'series' },
        };
      });
      chart.setOption({
        animation: false,
        grid: { left: 64, right: 26, top: 26, bottom: 48 },
        tooltip: { trigger: isScatter ? 'item' : 'axis', ...tooltipSkin },
        dataZoom: zoom,
        legend: many ? { show: false }
          : { textStyle: { color: dim, fontSize: 10 }, top: 0, icon: 'roundRect' },
        xAxis: { type: 'value', name: data.x_label, nameLocation: 'middle', nameGap: 26, scale: true, ...axisCommon },
        yAxis: { type: 'value', name: data.y_label, nameLocation: 'middle', nameGap: 46, scale: true, ...axisCommon },
        textStyle: { color: ink },
        series,
      }, true);
    }
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(host.current);
    return () => { ro.disconnect(); zr.off('dblclick'); };
  }, [data]);

  useEffect(() => () => { inst.current?.dispose(); inst.current = null; }, []);

  return <div ref={host} style={{ width: '100%', height: '100%' }} />;
}

// ---------------------------------------------------------------------------

export function ModelView({ data }: { data: ModelData }) {
  const is3D = data.kind === 'surface';
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                  background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        {is3D ? <Surface3D data={data} /> : <Chart2D data={data} />}
      </div>
      {!!(data.notes || []).length && (
        <div style={{ flex: '0 0 auto', display: 'flex', gap: '18px', flexWrap: 'wrap',
                      padding: '7px 14px', borderTop: '1px solid var(--edge)',
                      fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--dim)' }}>
          {(data.notes || []).map((n, i) => <span key={i}>{n}</span>)}
        </div>
      )}
    </div>
  );
}

