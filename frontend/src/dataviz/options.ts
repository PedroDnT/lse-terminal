// ============================================================================
// dataviz/options.ts - table + encoding -> an echarts option, per chart form.
//
// Pure functions: the page owns the echarts instance (init/setOption, same
// direct-driving idiom as EconomicCalendar.tsx) and hands us the terminal's
// chrome colors read from the shell's css variables. Mark specs follow the
// dataviz standard: thin bars with rounded data-ends, 2px lines, >=8px
// markers, a surface-colored gap wherever fills touch, recessive grid, text
// in ink tokens never in series color.
// ============================================================================

import type { EChartsOption } from 'echarts';
import {
  Table, Encoding, ChartType, asNum, numVals, histogram, boxStats, ohlcCols,
  axisValues,
} from './model';

export type Chrome = {
  ink: string; dim: string; edge: string; panel: string;
  up: string; down: string;
  palette: string[]; seq: string[];
};

const MAX_SLOTS = 8; // categorical palette size; series beyond it fold to "Other"

// ── shared scaffolding ──────────────────────────────────────────────────────

const text = (c: Chrome) => ({
  color: c.ink,
  fontFamily: '-apple-system, SF Pro Display, Inter, system-ui, sans-serif',
});

function base(c: Chrome, withAxes: boolean): EChartsOption {
  const o: EChartsOption = {
    backgroundColor: 'transparent',
    textStyle: text(c),
    color: c.palette,
    tooltip: {
      confine: true,
      backgroundColor: c.panel,
      borderColor: c.edge,
      textStyle: { color: c.ink, fontSize: 12 },
    },
    animationDuration: 200,
  };
  if (withAxes) {
    o.grid = { left: 56, right: 20, top: 40, bottom: 44, containLabel: false };
    o.xAxis = {
      type: 'category',
      axisLine: { lineStyle: { color: c.edge } },
      axisTick: { show: false },
      axisLabel: { color: c.dim, fontFamily: 'SF Mono, monospace', hideOverlap: true },
      splitLine: { show: false },
    };
    o.yAxis = {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.dim, fontFamily: 'SF Mono, monospace' },
      splitLine: { lineStyle: { color: c.edge, opacity: 0.5, type: 'dashed' } },
    };
  }
  return o;
}

// Legend only when identity needs naming: one series is named by the header,
// two or more get the box.
function legend(o: EChartsOption, c: Chrome, count: number) {
  if (count >= 2) o.legend = { top: 6, textStyle: { color: c.dim, fontSize: 11 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10 };
}

// Group rows by a category column, keeping first-seen order so hues follow
// entities stably; groups past the palette fold into "Other".
function groupRows(t: Table, by: string): [string, typeof t.rows][] {
  const m = new Map<string, typeof t.rows>();
  for (const r of t.rows) {
    const k = String(r[by] ?? '');
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  const entries = [...m.entries()];
  if (entries.length <= MAX_SLOTS) return entries;
  const head = entries.slice(0, MAX_SLOTS - 1);
  const other = entries.slice(MAX_SLOTS - 1).flatMap(([, rows]) => rows);
  return [...head, ['Other', other]];
}

// Category axes aggregate (sum) repeated labels; a date axis keeps raw order.
function catSeries(t: Table, x: string, y: string): [string[], number[]] {
  const sums = new Map<string, number>();
  for (const r of t.rows) {
    const k = String(r[x] ?? '');
    sums.set(k, (sums.get(k) || 0) + (asNum(r[y]) || 0));
  }
  return [[...sums.keys()], [...sums.values()]];
}

const xIsCategory = (t: Table, x?: string) =>
  t.fields.find((f) => f.name === x)?.type !== 'date';

// ── the builders ────────────────────────────────────────────────────────────

export function buildOption(type: ChartType, t: Table, enc: Encoding, c: Chrome): EChartsOption {
  switch (type) {
    case 'bar': case 'hbar': case 'groupbar': return bars(type, t, enc, c);
    case 'line': case 'area': return lines(type, t, enc, c);
    case 'candlestick': return candles(t, c);
    case 'scatter': case 'bubble': return scatter(type, t, enc, c);
    case 'pie': case 'donut': return pie(type, t, enc, c);
    case 'histogram': return hist(t, enc, c);
    case 'box': return box(t, enc, c);
    case 'heatmap': return heatmap(t, enc, c);
    case 'radar': return radar(t, enc, c);
    case 'treemap': return treemap(t, enc, c);
    case 'funnel': return funnel(t, enc, c);
    case 'gauge': return gauge(t, enc, c);
    default: return base(c, false);
  }
}

function bars(type: 'bar' | 'hbar' | 'groupbar', t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, true);
  const x = enc.x!, ys = enc.ys.length ? enc.ys : [t.fields.find((f) => f.type === 'number')?.name || ''];
  const aggregate = xIsCategory(t, x);
  let labels: string[];
  const seriesData: Record<string, number[]> = {};
  if (aggregate) {
    labels = catSeries(t, x, ys[0])[0];
    for (const y of ys) {
      const m = new Map(zip(...catSeries(t, x, y)));
      seriesData[y] = labels.map((l) => m.get(l) || 0);
    }
  } else {
    labels = t.rows.map((r) => String(r[x] ?? ''));
    for (const y of ys) seriesData[y] = t.rows.map((r) => asNum(r[y]) || 0);
  }
  const horizontal = type === 'hbar';
  if (horizontal) {
    // Swap roles; long labels read better on the y axis.
    const xa = o.xAxis as any, ya = o.yAxis as any;
    o.xAxis = { ...ya, type: 'value' };
    o.yAxis = { ...xa, type: 'category', data: labels };
    (o.grid as any).left = 110;
  } else {
    (o.xAxis as any).data = labels;
  }
  o.series = ys.map((y) => ({
    name: y, type: 'bar', data: seriesData[y],
    barMaxWidth: 28, barGap: '25%',
    // Rounded data-end anchored at the baseline; the base corners stay square.
    itemStyle: { borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
  })) as any;
  legend(o, c, ys.length);
  (o.tooltip as any).trigger = 'axis';
  return o;
}

function lines(type: 'line' | 'area', t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, true);
  const x = enc.x!, ys = enc.ys;
  (o.xAxis as any).data = t.rows.map((r) => String(r[x] ?? ''));
  o.series = ys.map((y) => ({
    name: y, type: 'line', data: t.rows.map((r) => asNum(r[y])),
    showSymbol: false, lineStyle: { width: 2 },
    ...(type === 'area' ? { areaStyle: { opacity: 0.14 } } : {}),
  })) as any;
  legend(o, c, ys.length);
  (o.tooltip as any).trigger = 'axis';
  (o.tooltip as any).axisPointer = { type: 'cross', lineStyle: { color: c.dim, opacity: 0.5 } };
  return o;
}

function candles(t: Table, c: Chrome): EChartsOption {
  const o = base(c, true);
  const k = ohlcCols(t);
  (o.xAxis as any).data = t.rows.map((r) => String(r[k.t!] ?? ''));
  o.series = [{
    name: 'OHLC', type: 'candlestick',
    // echarts candle order is [open, close, low, high].
    data: t.rows.map((r) => [asNum(r[k.o!]), asNum(r[k.c!]), asNum(r[k.l!]), asNum(r[k.h!])]),
    itemStyle: { color: c.up, color0: c.down, borderColor: c.up, borderColor0: c.down },
  }] as any;
  (o.yAxis as any).scale = true;
  (o.tooltip as any).trigger = 'axis';
  // Inside zoom only; the slider mini-map bar is banned chrome here,
  // same as on the calendar's release chart.
  o.dataZoom = [{ type: 'inside' }];
  return o;
}

function scatter(type: 'scatter' | 'bubble', t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, true);
  const x = enc.x!, y = enc.ys[0]!, size = enc.size;
  (o.xAxis as any).type = 'value';
  (o.xAxis as any).scale = true;
  (o.yAxis as any).scale = true;
  const sizes = size ? numVals(t, size) : [];
  const smin = Math.min(...sizes), smax = Math.max(...sizes);
  const px = (v: number) => 8 + 24 * ((v - smin) / ((smax - smin) || 1)); // 8px floor per mark spec
  const mk = (rows: typeof t.rows) => rows
    .map((r) => size ? [asNum(r[x]), asNum(r[y]), asNum(r[size])] : [asNum(r[x]), asNum(r[y])])
    .filter((p) => !isNaN(p[0] as number) && !isNaN(p[1] as number));
  const groups = enc.group ? groupRows(t, enc.group) : null;
  const seriesOf = (name: string, rows: typeof t.rows) => ({
    name, type: 'scatter' as const, data: mk(rows),
    symbolSize: size ? (d: number[]) => px(d[2]) : 9,
    // 2px surface ring so overlapping marks stay separable.
    itemStyle: { opacity: 0.85, borderColor: c.panel, borderWidth: 2 },
  });
  o.series = (groups ? groups.map(([g, rows]) => seriesOf(g, rows)) : [seriesOf(y, t.rows)]) as any;
  legend(o, c, groups?.length || 1);
  (o.tooltip as any).formatter = (p: any) =>
    `${p.seriesName}<br/>${x}: ${p.value[0]}&nbsp;&nbsp;${y}: ${p.value[1]}` +
    (size ? `&nbsp;&nbsp;${size}: ${p.value[2]}` : '');
  return o;
}

// Slices sum by label; past 11 slices the tail folds into "Other" because a
// pie with dozens of slivers answers nothing.
function slices(t: Table, enc: Encoding): { name: string; value: number }[] {
  const [labels, vals] = catSeries(t, enc.x!, enc.ys[0]!);
  const all = labels.map((name, i) => ({ name, value: vals[i] })).sort((a, b) => b.value - a.value);
  if (all.length <= 12) return all;
  const head = all.slice(0, 11);
  return [...head, { name: 'Other', value: all.slice(11).reduce((s, d) => s + d.value, 0) }];
}

function pie(type: 'pie' | 'donut', t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, false);
  const data = slices(t, enc);
  o.series = [{
    type: 'pie',
    radius: type === 'donut' ? ['42%', '68%'] : '68%',
    data,
    // The surface gap between fills, done the pie way.
    itemStyle: { borderColor: c.panel, borderWidth: 2 },
    label: { color: c.ink, fontSize: 11 },
    labelLine: { lineStyle: { color: c.edge } },
  }] as any;
  legend(o, c, Math.min(data.length, 8));
  return o;
}

function hist(t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, true);
  const { bins, counts } = histogram(numVals(t, enc.ys[0]!));
  (o.xAxis as any).data = bins;
  o.series = [{
    name: enc.ys[0], type: 'bar', data: counts,
    barCategoryGap: '8%', // near-touching bars read as a distribution
    itemStyle: { borderRadius: [4, 4, 0, 0] },
  }] as any;
  (o.tooltip as any).trigger = 'axis';
  return o;
}

function box(t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, true);
  const ys = enc.ys.length ? enc.ys : [];
  (o.xAxis as any).data = ys;
  o.series = [{
    type: 'boxplot',
    data: ys.map((y) => boxStats(numVals(t, y))),
    itemStyle: { color: 'transparent', borderColor: c.palette[0], borderWidth: 2 },
  }] as any;
  (o.tooltip as any).formatter = (p: any) => {
    const [min, q1, med, q3, max] = p.value.slice(1);
    return `${p.name}<br/>max ${max}<br/>q3 ${q3}<br/>median ${med}<br/>q1 ${q1}<br/>min ${min}`;
  };
  return o;
}

function heatmap(t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, true);
  // axisValues passes categoricals through and bins numeric axes, so an
  // all-numeric (x, y, value) table heatmaps instead of degenerating.
  const ax = axisValues(t, enc.x!), ay = axisValues(t, enc.group!);
  const xs = ax.labels, gs = ay.labels;
  // Mean per cell: repeated (x, y) observations average rather than sum so a
  // denser category does not fake a hotter cell.
  const sum = new Map<string, { s: number; n: number }>();
  for (const r of t.rows) {
    const i = ax.index(r[enc.x!]), j = ay.index(r[enc.group!]);
    const v = asNum(r[enc.ys[0]!]);
    if (i < 0 || j < 0 || isNaN(v)) continue;
    const k = i + ':' + j;
    const cur = sum.get(k) || { s: 0, n: 0 };
    cur.s += v; cur.n++;
    sum.set(k, cur);
  }
  const data: [number, number, number][] = [];
  xs.forEach((_, i) => gs.forEach((__, j) => {
    const cell = sum.get(i + ':' + j);
    if (cell) data.push([i, j, cell.s / cell.n]);
  }));
  const vals = data.map((d) => d[2]);
  (o.xAxis as any).data = xs;
  o.yAxis = { ...(o.yAxis as any), type: 'category', data: gs, splitLine: { show: false } };
  o.visualMap = {
    min: Math.min(...vals), max: Math.max(...vals),
    calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
    inRange: { color: c.seq }, textStyle: { color: c.dim },
  };
  o.series = [{
    type: 'heatmap', data,
    // The 2px surface gap between fills, cell edition.
    itemStyle: { borderColor: c.panel, borderWidth: 2 },
    label: { show: data.length <= 80, color: c.ink, fontSize: 10, formatter: (p: any) => fmtShort(p.value[2]) },
  }] as any;
  (o.grid as any).bottom = 70;
  (o.tooltip as any).formatter = (p: any) =>
    `${xs[p.value[0]]} / ${gs[p.value[1]]}<br/>${enc.ys[0]}: ${fmtShort(p.value[2])}`;
  return o;
}

function radar(t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, false);
  const [labels] = catSeries(t, enc.x!, enc.ys[0]!);
  const indicators = labels.map((name) => ({ name }));
  o.radar = {
    indicator: indicators.length >= 3 ? indicators : [...indicators, ...Array(3 - indicators.length).fill({ name: '' })],
    axisName: { color: c.dim, fontSize: 11 },
    splitLine: { lineStyle: { color: c.edge, opacity: 0.6 } },
    splitArea: { show: false },
    axisLine: { lineStyle: { color: c.edge } },
  };
  o.series = [{
    type: 'radar',
    data: enc.ys.map((y) => ({ name: y, value: catSeries(t, enc.x!, y)[1] })),
    lineStyle: { width: 2 }, symbolSize: 5, areaStyle: { opacity: 0.1 },
  }] as any;
  legend(o, c, enc.ys.length);
  return o;
}

function treemap(t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, false);
  o.series = [{
    type: 'treemap', data: slices(t, enc), roam: false, nodeClick: false,
    breadcrumb: { show: false },
    itemStyle: { borderColor: c.panel, borderWidth: 2, gapWidth: 2 },
    label: { color: '#fff', fontSize: 11 },
  }] as any;
  return o;
}

function funnel(t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, false);
  const data = slices(t, enc);
  o.series = [{
    type: 'funnel', data, gap: 2, top: 30,
    itemStyle: { borderColor: c.panel, borderWidth: 2 },
    label: { color: c.ink, fontSize: 11 },
  }] as any;
  legend(o, c, Math.min(data.length, 8));
  return o;
}

function gauge(t: Table, enc: Encoding, c: Chrome): EChartsOption {
  const o = base(c, false);
  const vals = numVals(t, enc.ys[0]!);
  const last = vals[vals.length - 1] ?? 0;
  const max = Math.max(...vals, 0);
  o.series = [{
    type: 'gauge',
    min: Math.min(...vals, 0), max: max || 1,
    progress: { show: true, width: 12 },
    axisLine: { lineStyle: { width: 12, color: [[1, c.edge]] } },
    pointer: { show: false },
    axisTick: { show: false }, splitLine: { show: false },
    axisLabel: { color: c.dim, fontSize: 10, distance: 18 },
    // The number IS the chart here; ink token, not series color.
    detail: { color: c.ink, fontSize: 26, fontFamily: 'SF Mono, monospace', formatter: (v: number) => fmtShort(v) },
    title: { color: c.dim, fontSize: 12 },
    data: [{ value: last, name: enc.ys[0] }],
  }] as any;
  return o;
}

// ── tiny utils ──────────────────────────────────────────────────────────────

function zip(a: string[], b: number[]): [string, number][] {
  return a.map((k, i) => [k, b[i]]);
}

export function fmtShort(v: number): string {
  if (v === null || v === undefined || isNaN(v)) return '';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(1) + 'K';
  return a >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(2);
}
