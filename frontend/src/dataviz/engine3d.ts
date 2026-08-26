// ============================================================================
// dataviz/engine3d.ts - the terminal's own 3D chart renderer.
//
// Deliberately NOT a WebGL engine: the viz page caps data at 5000 rows, and
// at that scale a plain 2D canvas with orthographic projection and a painter's
// sort beats shipping a 640KB GL dependency (echarts-gl) for three chart
// forms. Everything is flat-shaded and matches the terminal's chrome; we own
// every pixel.
//
// Model: data is normalized into a [-1,1]^3 box, z up. The camera is a
// {yaw, pitch, zoom} orbit; projection is orthographic (no perspective
// distortion, which suits axis-read charts). Faces/points are depth-sorted
// per frame and drawn far to near. At <= ~5k elements the sort is
// sub-millisecond; rendering happens only on interaction, so idle cost is 0.
// ============================================================================

export type Chrome3D = {
  ink: string; dim: string; edge: string; panel: string;
  palette: string[]; seq: string[];
};

export type Spec3D =
  | { kind: 'scatter'; points: { x: number; y: number; z: number; size?: number; row?: any }[];
      xName: string; yName: string; zName: string }
  | { kind: 'bars'; xLabels: string[]; yLabels: string[]; z: (number | null)[][]; // z[yi][xi]
      xName: string; yName: string; zName: string }
  | { kind: 'surface'; xLabels: string[]; yLabels: string[]; z: (number | null)[][];
      xName: string; yName: string; zName: string };

type Cam = { yaw: number; pitch: number; zoom: number };
const CAM0: Cam = { yaw: -0.62, pitch: 0.46, zoom: 1 };

type Hover = { sx: number; sy: number; text: string } | null;

export class Engine3D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private chrome: Chrome3D;
  private spec: Spec3D | null = null;
  private cam: Cam = { ...CAM0 };
  private raf = 0;
  private dragging = false;
  private lastPt = { x: 0, y: 0 };
  private detach: (() => void)[] = [];
  onHover: (h: Hover) => void = () => {};

  constructor(canvas: HTMLCanvasElement, chrome: Chrome3D) {
    this.canvas = canvas;
    this.chrome = chrome;
    this.ctx = canvas.getContext('2d')!;
    const c = canvas;
    const down = (e: PointerEvent) => {
      this.dragging = true; this.lastPt = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (this.dragging) {
        this.cam.yaw += (e.clientX - this.lastPt.x) * 0.008;
        // Pitch clamps shy of top-down and below-horizon, where the axes
        // degenerate and the chart stops reading as 3D.
        this.cam.pitch = Math.min(1.35, Math.max(0.08, this.cam.pitch + (e.clientY - this.lastPt.y) * 0.008));
        this.lastPt = { x: e.clientX, y: e.clientY };
        this.onHover(null);
        this.requestRender();
      } else this.pick(e);
    };
    const up = () => { this.dragging = false; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.cam.zoom = Math.min(3, Math.max(0.4, this.cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
      this.requestRender();
    };
    const dbl = () => { this.cam = { ...CAM0 }; this.requestRender(); };
    const leave = () => this.onHover(null);
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('dblclick', dbl);
    c.addEventListener('pointerleave', leave);
    this.detach = [
      () => c.removeEventListener('pointerdown', down),
      () => c.removeEventListener('pointermove', move),
      () => c.removeEventListener('pointerup', up),
      () => c.removeEventListener('wheel', wheel),
      () => c.removeEventListener('dblclick', dbl),
      () => c.removeEventListener('pointerleave', leave),
    ];
  }

  setChrome(chrome: Chrome3D) { this.chrome = chrome; this.requestRender(); }
  setData(spec: Spec3D) { this.spec = spec; this.cam = { ...CAM0 }; this.requestRender(); }
  destroy() { cancelAnimationFrame(this.raf); this.detach.forEach((f) => f()); }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.requestRender();
  }

  requestRender() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.render());
  }

  // ── projection ────────────────────────────────────────────────────────────

  private project(p: [number, number, number]): [number, number, number] {
    const { yaw, pitch, zoom } = this.cam;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = p[0] * cy - p[1] * sy;
    const y1 = p[0] * sy + p[1] * cy;
    const depth = y1 * cp - p[2] * sp;    // toward the viewer is negative
    const v = y1 * sp + p[2] * cp;        // screen vertical
    const w = this.canvas.width, h = this.canvas.height;
    const s = Math.min(w, h) * 0.30 * zoom;
    return [w / 2 + x1 * s, h / 2 + h * 0.04 - v * s, depth];
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private render() {
    const { ctx, canvas, spec } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!spec) return;
    this.drawFrame();
    if (spec.kind === 'scatter') this.drawScatter(spec);
    else this.drawCells(spec);
    this.drawAxisNames();
  }

  // The bounding box + tick labels. Only the three back faces' edges draw, so
  // the frame never overplots the data; which faces are "back" follows the
  // camera each frame.
  private drawFrame() {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const E = 1.04; // frame sits just outside the data box
    const corners: [number, number, number][] = [];
    for (const zx of [-E, E]) for (const zy of [-E, E]) for (const zz of [-E, E]) corners.push([zx, zy, zz]);
    const edges: [number, number][] = [
      [0, 1], [0, 2], [0, 4], [3, 1], [3, 2], [3, 7], [5, 1], [5, 4], [5, 7], [6, 2], [6, 4], [6, 7]];
    const proj = corners.map((c) => this.project(c));
    ctx.strokeStyle = this.chrome.edge;
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([]);
    for (const [a, b] of edges) {
      // An edge is "back" when both its endpoints sit in the far half.
      if (proj[a][2] + proj[b][2] > 0) {
        ctx.beginPath();
        ctx.moveTo(proj[a][0], proj[a][1]);
        ctx.lineTo(proj[b][0], proj[b][1]);
        ctx.stroke();
      }
    }
  }

  private drawAxisNames() {
    const { ctx, spec } = this;
    if (!spec) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = this.chrome.dim;
    ctx.font = `${11 * dpr}px SF Mono, monospace`;
    ctx.textAlign = 'center';
    const put = (p: [number, number, number], s: string) => {
      const [sx, sy] = this.project(p);
      ctx.fillText(s, sx, sy);
    };
    // Axis names ride the lower front edges; z label stands at the top corner.
    put([0, -1.35, -1.1], spec.xName);
    put([-1.35, 0, -1.1], spec.yName);
    put([-1.2, -1.2, 1.15], spec.zName);
  }

  private drawScatter(spec: Extract<Spec3D, { kind: 'scatter' }>) {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const pts = spec.points
      .map((p) => ({ p, pr: this.project([p.x, p.y, p.z]) }))
      .sort((a, b) => b.pr[2] - a.pr[2]); // far first
    const seq = this.chrome.seq;
    for (const { p, pr } of pts) {
      // Height doubles as the color signal (sequential ramp), so identity
      // survives the flattening to 2D.
      const ci = Math.min(seq.length - 1, Math.max(0, Math.floor(((p.z + 1) / 2) * seq.length)));
      const r = (p.size ?? 4.5) * dpr;
      ctx.beginPath();
      ctx.arc(pr[0], pr[1], r, 0, Math.PI * 2);
      ctx.fillStyle = seq[ci];
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      // The 2px surface ring that keeps overlapping marks separable.
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = this.chrome.panel;
      ctx.stroke();
    }
  }

  // Bars and surface share cell geometry: a [yLabels x xLabels] grid of
  // heights. Bars extrude cuboids; surface stitches neighbouring cells into
  // quads.
  private drawCells(spec: Extract<Spec3D, { kind: 'bars' | 'surface' }>) {
    const nx = spec.xLabels.length, ny = spec.yLabels.length;
    const zs = spec.z.flat().filter((v): v is number => v !== null && !isNaN(v));
    if (!zs.length) return;
    const zmin = Math.min(...zs, 0), zmax = Math.max(...zs);
    const zn = (v: number) => -1 + 2 * ((v - zmin) / ((zmax - zmin) || 1));
    const xn = (i: number) => -1 + 2 * (nx === 1 ? 0.5 : i / (nx - 1));
    const yn = (j: number) => -1 + 2 * (ny === 1 ? 0.5 : j / (ny - 1));
    const seq = this.chrome.seq;
    const ramp = (v: number) =>
      seq[Math.min(seq.length - 1, Math.max(0, Math.floor(((v - zmin) / ((zmax - zmin) || 1)) * seq.length)))];

    type Face = { pts: [number, number, number][]; fill: string; stroke?: string; depth: number };
    const faces: Face[] = [];

    if (spec.kind === 'bars') {
      const hw = Math.min(0.8 / nx, 0.8 / ny); // half-width of a bar footprint
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = spec.z[j][i];
        if (v === null || isNaN(v)) continue;
        const cx = xn(i), cy = yn(j), top = zn(v), base = zn(Math.max(zmin, 0));
        const col = ramp(v);
        const quad = (pts: [number, number, number][], fill: string) => {
          const pr = pts.map((p) => this.project(p));
          faces.push({ pts, fill, depth: pr.reduce((s, p) => s + p[2], 0) / pr.length });
        };
        // Top face full color; the two side pairs step darker so depth reads
        // without a lighting model. All four sides are pushed; the painter's
        // sort hides the back pair.
        quad([[cx - hw, cy - hw, top], [cx + hw, cy - hw, top], [cx + hw, cy + hw, top], [cx - hw, cy + hw, top]], col);
        const dark1 = shade(col, 0.78), dark2 = shade(col, 0.62);
        quad([[cx - hw, cy - hw, base], [cx + hw, cy - hw, base], [cx + hw, cy - hw, top], [cx - hw, cy - hw, top]], dark1);
        quad([[cx - hw, cy + hw, base], [cx + hw, cy + hw, base], [cx + hw, cy + hw, top], [cx - hw, cy + hw, top]], dark1);
        quad([[cx - hw, cy - hw, base], [cx - hw, cy + hw, base], [cx - hw, cy + hw, top], [cx - hw, cy - hw, top]], dark2);
        quad([[cx + hw, cy - hw, base], [cx + hw, cy + hw, base], [cx + hw, cy + hw, top], [cx + hw, cy - hw, top]], dark2);
      }
    } else {
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const v00 = spec.z[j][i], v10 = spec.z[j][i + 1], v01 = spec.z[j + 1][i], v11 = spec.z[j + 1][i + 1];
        if ([v00, v10, v01, v11].some((v) => v === null || isNaN(v as number))) continue;
        const pts: [number, number, number][] = [
          [xn(i), yn(j), zn(v00 as number)], [xn(i + 1), yn(j), zn(v10 as number)],
          [xn(i + 1), yn(j + 1), zn(v11 as number)], [xn(i), yn(j + 1), zn(v01 as number)],
        ];
        const mean = ((v00 as number) + (v10 as number) + (v01 as number) + (v11 as number)) / 4;
        const pr = pts.map((p) => this.project(p));
        faces.push({
          pts, fill: ramp(mean), stroke: this.chrome.panel,
          depth: pr.reduce((s, p) => s + p[2], 0) / pr.length,
        });
      }
    }

    faces.sort((a, b) => b.depth - a.depth);
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    for (const f of faces) {
      ctx.beginPath();
      const pr = f.pts.map((p) => this.project(p));
      ctx.moveTo(pr[0][0], pr[0][1]);
      for (let i = 1; i < pr.length; i++) ctx.lineTo(pr[i][0], pr[i][1]);
      ctx.closePath();
      ctx.fillStyle = f.fill;
      ctx.fill();
      if (f.stroke) { // surface wireframe = the fill-gap idiom in 3D
        ctx.lineWidth = 1 * dpr;
        ctx.strokeStyle = f.stroke;
        ctx.stroke();
      }
    }
  }

  // ── hover picking (scatter + bars: nearest projected mark within reach) ──
  private pick(e: PointerEvent) {
    const spec = this.spec;
    if (!spec || spec.kind === 'surface') { this.onHover(null); return; }
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - r.left) * dpr, my = (e.clientY - r.top) * dpr;
    const reach = 14 * dpr;
    let best: { d: number; sx: number; sy: number; text: string } | null = null;
    const consider = (p: [number, number, number], text: string) => {
      const [sx, sy] = this.project(p);
      const d = Math.hypot(sx - mx, sy - my);
      if (d < reach && (!best || d < best.d)) best = { d, sx: sx / dpr, sy: sy / dpr, text };
    };
    if (spec.kind === 'scatter') {
      for (const p of spec.points) {
        consider([p.x, p.y, p.z], p.row
          ? `${spec.xName}: ${p.row.x}  ${spec.yName}: ${p.row.y}  ${spec.zName}: ${p.row.z}`
          : `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`);
      }
    } else {
      const nx = spec.xLabels.length, ny = spec.yLabels.length;
      const zs = spec.z.flat().filter((v): v is number => v !== null && !isNaN(v));
      if (!zs.length) return;
      const zmin = Math.min(...zs, 0), zmax = Math.max(...zs);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = spec.z[j][i];
        if (v === null || isNaN(v)) continue;
        consider([
          -1 + 2 * (nx === 1 ? 0.5 : i / (nx - 1)),
          -1 + 2 * (ny === 1 ? 0.5 : j / (ny - 1)),
          -1 + 2 * ((v - zmin) / ((zmax - zmin) || 1)),
        ], `${spec.xLabels[i]} / ${spec.yLabels[j]}: ${Number(v.toFixed(3))}`);
      }
    }
    this.onHover(best);
  }
}

// Darken a hex color by a factor; the flat-shading step for cuboid sides.
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * k);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ── table -> 3D spec ────────────────────────────────────────────────────────
// Grid forms (bars/surface) mean-aggregate repeated cells like the heatmap;
// numeric axes with many distinct values bin down to <=48 steps so the grid
// stays legible and the face count bounded.

import type { Table, Encoding } from './model';
import { asNum, axisValues } from './model';

export function spec3dFrom(t: Table, enc: Encoding, kind: 'bars' | 'surface' | 'scatter'): Spec3D | null {
  if (kind === 'scatter') {
    const [xc, yc, zc] = [enc.x, enc.group, enc.ys[0]];
    if (!xc || !yc || !zc) return null;
    const get = (c: string) => t.rows.map((r) => asNum(r[c]));
    const xs = get(xc), ys = get(yc), zs = get(zc);
    const norm = (arr: number[]) => {
      const ok = arr.filter((v) => !isNaN(v));
      const min = Math.min(...ok), max = Math.max(...ok);
      return (v: number) => -1 + 2 * ((v - min) / ((max - min) || 1));
    };
    const nX = norm(xs), nY = norm(ys), nZ = norm(zs);
    const sizes = enc.size ? t.rows.map((r) => asNum(r[enc.size!])) : null;
    const sOk = sizes?.filter((v) => !isNaN(v)) || [];
    const smin = Math.min(...sOk), smax = Math.max(...sOk);
    const points = t.rows.flatMap((r, i) => {
      if ([xs[i], ys[i], zs[i]].some(isNaN)) return [];
      return [{
        x: nX(xs[i]), y: nY(ys[i]), z: nZ(zs[i]),
        size: sizes && !isNaN(sizes[i]) ? 3 + 6 * ((sizes[i] - smin) / ((smax - smin) || 1)) : undefined,
        row: { x: xs[i], y: ys[i], z: zs[i] },
      }];
    });
    return points.length ? { kind: 'scatter', points, xName: xc, yName: yc, zName: zc } : null;
  }

  const [xc, yc, zc] = [enc.x, enc.group, enc.ys[0]];
  if (!xc || !yc || !zc) return null;
  const ax = axisValues(t, xc), ay = axisValues(t, yc);
  const sums: { s: number; n: number }[][] =
    ay.labels.map(() => ax.labels.map(() => ({ s: 0, n: 0 })));
  for (const r of t.rows) {
    const i = ax.index(r[xc]), j = ay.index(r[yc]), v = asNum(r[zc]);
    if (i < 0 || j < 0 || isNaN(v)) continue;
    sums[j][i].s += v; sums[j][i].n++;
  }
  const z = sums.map((row) => row.map((c) => (c.n ? c.s / c.n : null)));
  if (!z.flat().some((v) => v !== null)) return null;
  return { kind, xLabels: ax.labels, yLabels: ay.labels, z, xName: xc, yName: yc, zName: zc };
}
