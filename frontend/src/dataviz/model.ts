// ============================================================================
// dataviz/model.ts - the data model of the DATA VISUALISATION page.
//
// Everything here is pure: parsing pasted text into a typed table, scoring
// which chart forms fit a table's column signature, picking default field
// encodings, and the small stats (histogram bins, box stats) some forms need.
// No DOM, no echarts - options.ts consumes this to build chart options and
// the page consumes it to drive the UI.
//
// The parsing/recommendation semantics are a port of the internal Data Studio
// tool (animations box), rewritten in TS for this bundle.
// ============================================================================

export type FieldType = 'number' | 'date' | 'category' | 'bool';
export type Field = { name: string; type: FieldType };
export type Row = Record<string, any>;

export type Table = {
  fields: Field[];
  rows: Row[];
  nrows: number;      // true row count before any cap
  truncated: boolean; // server capped the shipped rows
  source: string;     // where it came from, shown in the header ("pasted", a filename, a library symbol)
};

// ── pasted-text parsing (client-side; the server never sees pastes) ─────────

function detectDelim(text: string): string {
  const head = text.slice(0, 2000).split(/\r?\n/)[0] || '';
  // Most-frequent wins; comma breaks ties so "a,b" never parses as one column.
  return [',', '\t', ';', '|'].reduce((best, d) =>
    head.split(d).length > head.split(best).length ? d : best, ',');
}

// Quote-aware split: "a,""b"",c" is one field. A hand-rolled scanner instead
// of a regex because pasted spreadsheet data embeds newlines inside quotes.
function parseDelimited(text: string, delim: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c.trim() !== '')) out.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== '')) out.push(row);
  return out;
}

const NUM_RE = /^-?\$?[\d,]*\.?\d+%?$/;
const asNum = (v: any): number => {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/[$,%]/g, ''));
};

function inferType(values: any[]): FieldType {
  let num = 0, date = 0, bool = 0, seen = 0;
  for (const v of values) {
    if (v === null || v === undefined || String(v).trim() === '') continue;
    seen++;
    const s = String(v).trim();
    if (/^(true|false|yes|no)$/i.test(s)) bool++;
    else if (NUM_RE.test(s)) num++;
    // The separator requirement keeps plain integers ("2024") from typing a
    // year-like id column as dates.
    else if (!isNaN(Date.parse(s)) && /[-/:]/.test(s)) date++;
  }
  if (!seen) return 'category';
  if (bool / seen > 0.9) return 'bool';
  if (num / seen > 0.9) return 'number';
  if (date / seen > 0.9) return 'date';
  return 'category';
}

export function parsePasted(text: string): Table {
  const matrix = parseDelimited(text.trim(), detectDelim(text));
  if (matrix.length < 2) throw new Error('need a header row plus at least one data row');
  // First row is the header unless every cell in it parses as a number, in
  // which case the paste is headerless and columns get generated names.
  const headerless = matrix[0].every((c) => NUM_RE.test(c.trim()));
  const header = headerless
    ? matrix[0].map((_, i) => `col_${i + 1}`)
    : matrix[0].map((c, i) => c.trim() || `col_${i + 1}`);
  const body = headerless ? matrix : matrix.slice(1);
  const fields: Field[] = header.map((name, i) => ({
    name, type: inferType(body.map((r) => r[i])),
  }));
  const rows: Row[] = body.map((r) => {
    const o: Row = {};
    fields.forEach((f, i) => {
      const raw = (r[i] ?? '').trim();
      o[f.name] = f.type === 'number' ? (raw === '' ? null : asNum(raw)) : raw;
    });
    return o;
  });
  return { fields, rows, nrows: rows.length, truncated: false, source: 'pasted' };
}

// ── chart catalog ───────────────────────────────────────────────────────────

export type ChartType =
  | 'bar' | 'hbar' | 'groupbar' | 'line' | 'area' | 'candlestick'
  | 'scatter' | 'bubble' | 'pie' | 'donut' | 'histogram' | 'box'
  | 'heatmap' | 'radar' | 'treemap' | 'funnel' | 'gauge'
  | 'bar3d' | 'scatter3d' | 'surface';

export const CHART_LABELS: Record<ChartType, string> = {
  bar: 'Bar', hbar: 'Bar (horiz)', groupbar: 'Grouped bar', line: 'Line',
  area: 'Area', candlestick: 'Candlestick', scatter: 'Scatter',
  bubble: 'Bubble', pie: 'Pie', donut: 'Donut', histogram: 'Histogram',
  box: 'Box plot', heatmap: 'Heatmap', radar: 'Radar', treemap: 'Treemap',
  funnel: 'Funnel', gauge: 'Gauge', bar3d: '3D bars', scatter3d: '3D scatter',
  surface: '3D surface',
};

export const CHART_GROUPS: [string, ChartType[]][] = [
  ['Compare', ['bar', 'hbar', 'groupbar', 'radar']],
  ['Trend', ['line', 'area']],
  ['Financial', ['candlestick']],
  ['Distribution', ['histogram', 'box', 'heatmap']],
  ['Relationship', ['scatter', 'bubble']],
  ['Part of whole', ['pie', 'donut', 'treemap', 'funnel']],
  ['Single value', ['gauge']],
  ['3D', ['bar3d', 'scatter3d', 'surface']],
];

export const is3D = (t: ChartType) => t === 'bar3d' || t === 'scatter3d' || t === 'surface';

// Gallery tile glyphs: 24-box stroke icons (inner SVG markup), one per form,
// so the chart picker reads visually instead of as a wall of labels.
export const CHART_ICONS: Record<ChartType, string> = {
  bar: '<rect x="4" y="11" width="3" height="8"/><rect x="10" y="7" width="3" height="12"/><rect x="16" y="4" width="3" height="15"/>',
  hbar: '<rect x="4" y="4" width="12" height="3"/><rect x="4" y="10" width="8" height="3"/><rect x="4" y="16" width="15" height="3"/>',
  groupbar: '<rect x="4" y="9" width="2.4" height="10"/><rect x="7" y="6" width="2.4" height="13"/><rect x="13" y="11" width="2.4" height="8"/><rect x="16" y="7" width="2.4" height="12"/>',
  line: '<polyline points="3,17 8,10 13,13 20,4"/>',
  area: '<polyline points="3,17 8,10 13,13 20,5"/><path d="M3 17 8 10 13 13 20 5 20 19 3 19Z" fill="currentColor" opacity=".15" stroke="none"/>',
  scatter: '<circle cx="6" cy="15" r="1.6"/><circle cx="11" cy="9" r="1.6"/><circle cx="15" cy="13" r="1.6"/><circle cx="19" cy="6" r="1.6"/>',
  bubble: '<circle cx="7" cy="14" r="2.4"/><circle cx="13" cy="8" r="3.4"/><circle cx="18" cy="15" r="1.6"/>',
  pie: '<circle cx="12" cy="12" r="8"/><path d="M12 12 12 4 A8 8 0 0 1 19 15Z" fill="currentColor" stroke="none" opacity=".3"/>',
  donut: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.6"/>',
  histogram: '<rect x="3" y="12" width="3" height="7"/><rect x="7" y="8" width="3" height="11"/><rect x="11" y="5" width="3" height="14"/><rect x="15" y="9" width="3" height="10"/><rect x="19" y="14" width="2.5" height="5"/>',
  box: '<line x1="7" y1="4" x2="7" y2="19"/><rect x="4" y="8" width="6" height="7"/><line x1="17" y1="6" x2="17" y2="19"/><rect x="14" y="10" width="6" height="6"/>',
  heatmap: '<rect x="4" y="4" width="15" height="15"/><line x1="9" y1="4" x2="9" y2="19"/><line x1="14" y1="4" x2="14" y2="19"/><line x1="4" y1="9" x2="19" y2="9"/><line x1="4" y1="14" x2="19" y2="14"/>',
  radar: '<polygon points="12,3 20,9 17,19 7,19 4,9"/><polygon points="12,8 16,10.5 14.5,16 9.5,16 8,10.5"/>',
  treemap: '<rect x="3" y="3" width="10" height="11"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="11" width="7" height="10"/><rect x="3" y="15" width="10" height="6"/>',
  funnel: '<polygon points="3,4 21,4 16,11 8,11"/><polygon points="8,13 16,13 13,20 11,20"/>',
  gauge: '<path d="M4 16 A8 8 0 0 1 20 16"/><line x1="12" y1="16" x2="16" y2="10"/>',
  bar3d: '<path d="M6 18 L6 11 L10 8 L10 15Z"/><path d="M11 18 L11 7 L15 4 L15 15Z"/><path d="M6 18 L11 18 L15 15 L10 15Z"/>',
  scatter3d: '<path d="M4 16 L12 20 L20 16"/><path d="M12 20 L12 5"/><circle cx="9" cy="11" r="1.4"/><circle cx="15" cy="9" r="1.4"/><circle cx="12" cy="14" r="1.4"/>',
  surface: '<path d="M3 15 L9 9 L15 13 L21 6"/><path d="M3 19 L9 13 L15 17 L21 10"/><path d="M3 15 L3 19 M9 9 L9 13 M15 13 L15 17 M21 6 L21 10"/>',
  candlestick: '<line x1="7" y1="3" x2="7" y2="20"/><rect x="5" y="7" width="4" height="8" fill="currentColor" opacity=".18"/><line x1="16" y1="4" x2="16" y2="21"/><rect x="14" y="9" width="4" height="7"/>',
};

// ── column helpers ──────────────────────────────────────────────────────────

export const cols = (t: Table, type: FieldType) =>
  t.fields.filter((f) => f.type === type).map((f) => f.name);

export const uniqCount = (t: Table, name: string) =>
  new Set(t.rows.map((r) => r[name])).size;

// OHLC detection is by column NAME, not type: a table with open/high/low/close
// is candle data whatever else it carries.
export function ohlcCols(t: Table) {
  const find = (p: RegExp) => t.fields.find((f) => p.test(f.name.trim().toLowerCase()))?.name;
  return {
    t: find(/^(time|date|ts|timestamp|datetime)$/) || cols(t, 'date')[0],
    o: find(/^open$/), h: find(/^high$/), l: find(/^low$/), c: find(/^close$/),
    v: find(/^vol(ume)?$/),
  };
}
export const hasOHLC = (t: Table) => {
  const x = ohlcCols(t);
  return Boolean(x.o && x.h && x.l && x.c);
};

// ── recommendation: column signature -> ranked chart forms ─────────────────

export function recommend(t: Table): [ChartType, number][] {
  const num = cols(t, 'number'), cat = cols(t, 'category'), date = cols(t, 'date');
  const nNum = num.length, nCat = cat.length, nDate = date.length;
  const scores: Partial<Record<ChartType, number>> = {};
  const add = (k: ChartType, s: number) => { scores[k] = Math.max(scores[k] || 0, s); };

  if (hasOHLC(t)) { add('candlestick', 12); add('line', 7.5); }
  if (nNum === 1 && nCat === 0) { add('histogram', 10); add('box', 7); }
  if (nCat === 1 && nNum === 1) {
    const u = uniqCount(t, cat[0]);
    add('bar', 9); add('hbar', u > 7 ? 9.5 : 6);
    if (u <= 8) { add('pie', 8); add('donut', 7.5); }
    add('treemap', 6); add('funnel', 5);
  }
  if (nDate >= 1 && nNum >= 1) { add('line', 10); add('area', 8.5); }
  if (nCat === 1 && nNum >= 2) { add('bar', 9); add('groupbar', 9.5); add('radar', 7); add('line', 6); }
  if (nCat >= 2 && nNum >= 1) { add('heatmap', 9); add('bar3d', 8); add('groupbar', 7); }
  if (nNum === 2 && nCat <= 1) { add('scatter', 9); }
  if (nNum >= 3) { add('bubble', 8.5); add('scatter3d', 8); add('surface', 6.5); }
  if (!Object.keys(scores).length) {
    if (nNum >= 1) { add('bar', 7); add('line', 6); } else add('bar', 5);
  }
  return (Object.entries(scores) as [ChartType, number][]).sort((a, b) => b[1] - a[1]);
}

// ── encodings: which column plays which role ────────────────────────────────

export type Encoding = {
  x?: string;        // category/date axis (or numeric x for scatter)
  ys: string[];      // value series (1..n numeric columns)
  group?: string;    // series-splitting category (heatmap y, scatter color)
  size?: string;     // bubble/scatter3d size
};

// Per-form role spec drives the encoder dropdowns: label + which field types
// may fill the role. `multi` marks the ys role as multi-select.
export type RoleSpec = { role: keyof Encoding; label: string; types: FieldType[]; multi?: boolean; optional?: boolean };

export function rolesFor(type: ChartType): RoleSpec[] {
  switch (type) {
    case 'candlestick':
      return [{ role: 'x', label: 'Time', types: ['date', 'category'] }];
    case 'histogram':
    case 'box':
      return [{ role: 'ys', label: 'Values', types: ['number'], multi: type === 'box' }];
    case 'gauge':
      return [{ role: 'ys', label: 'Value', types: ['number'] }];
    case 'pie': case 'donut': case 'treemap': case 'funnel':
      return [
        { role: 'x', label: 'Slices', types: ['category', 'date', 'bool'] },
        { role: 'ys', label: 'Size', types: ['number'] },
      ];
    case 'scatter':
      return [
        { role: 'x', label: 'X', types: ['number', 'date'] },
        { role: 'ys', label: 'Y', types: ['number'] },
        { role: 'group', label: 'Color by', types: ['category', 'bool'], optional: true },
      ];
    case 'bubble':
      return [
        { role: 'x', label: 'X', types: ['number', 'date'] },
        { role: 'ys', label: 'Y', types: ['number'] },
        { role: 'size', label: 'Size', types: ['number'] },
        { role: 'group', label: 'Color by', types: ['category', 'bool'], optional: true },
      ];
    case 'heatmap':
      // Numeric axes are allowed and bin via axisValues, same as the 3D grid
      // forms, so all-numeric tables (x, y, value) heatmap naturally.
      return [
        { role: 'x', label: 'X', types: ['category', 'date', 'bool', 'number'] },
        { role: 'group', label: 'Y', types: ['category', 'bool', 'number'] },
        { role: 'ys', label: 'Value', types: ['number'] },
      ];
    case 'bar3d': case 'surface':
      return [
        { role: 'x', label: 'X', types: ['category', 'date', 'number'] },
        { role: 'group', label: 'Y', types: ['category', 'bool', 'number'] },
        { role: 'ys', label: 'Height', types: ['number'] },
      ];
    case 'scatter3d':
      return [
        { role: 'x', label: 'X', types: ['number'] },
        { role: 'group', label: 'Y', types: ['number'] },
        { role: 'ys', label: 'Z', types: ['number'] },
        { role: 'size', label: 'Size', types: ['number'], optional: true },
      ];
    default: // bar hbar groupbar line area radar
      return [
        { role: 'x', label: 'X', types: ['category', 'date', 'bool'] },
        { role: 'ys', label: 'Series', types: ['number'], multi: true },
      ];
  }
}

// A category column with few distinct values reads as series identity; one
// with hundreds is just labels. 12 matches the palette-fold limit.
function lowCardCat(t: Table): string | undefined {
  for (const n of cols(t, 'category')) {
    const u = uniqCount(t, n);
    if (u >= 2 && u <= 12) return n;
  }
  return undefined;
}

export function autoEncode(t: Table, type: ChartType): Encoding {
  const num = cols(t, 'number'), cat = cols(t, 'category'), date = cols(t, 'date');
  const firstAllowed = (spec: RoleSpec, taken: string[] = []): string | undefined =>
    t.fields.find((f) => spec.types.includes(f.type) && !taken.includes(f.name))?.name;
  const enc: Encoding = { ys: [] };
  if (type === 'candlestick') { enc.x = ohlcCols(t).t; return enc; }
  const specs = rolesFor(type);
  for (const spec of specs) {
    if (spec.role === 'ys') {
      const wanted = spec.multi ? Math.min(num.length, 4) : 1;
      enc.ys = num.filter((n) => n !== enc.x && n !== enc.group && n !== enc.size).slice(0, wanted);
    } else if (spec.role === 'x') {
      // Prefer date for trend forms, category for comparison forms.
      enc.x = (type === 'line' || type === 'area')
        ? (date[0] || cat[0] || firstAllowed(spec))
        : type === 'scatter' || type === 'bubble' || type === 'scatter3d'
          ? num[0]
          : (cat[0] || date[0] || firstAllowed(spec));
    } else if (spec.role === 'group') {
      if (type === 'heatmap' || type === 'bar3d' || type === 'surface') {
        enc.group = cat.find((c) => c !== enc.x) || firstAllowed(spec, [enc.x || '']);
      } else if (type === 'scatter3d') {
        enc.group = num[1];
      } else if (!spec.optional || lowCardCat(t)) {
        enc.group = lowCardCat(t);
      }
    } else if (spec.role === 'size') {
      enc.size = num.find((n) => n !== enc.x && n !== enc.group && !enc.ys.includes(n));
    }
  }
  if (type === 'scatter' || type === 'bubble') enc.ys = [num.find((n) => n !== enc.x) || num[0]].filter(Boolean) as string[];
  if (type === 'scatter3d') enc.ys = [num.find((n) => n !== enc.x && n !== enc.group) || num[0]].filter(Boolean) as string[];
  return enc;
}

// ── small stats some forms need ─────────────────────────────────────────────

export const numVals = (t: Table, name: string) =>
  t.rows.map((r) => asNum(r[name])).filter((v) => !isNaN(v));

// Grid axes (heatmap, 3D bars/surface) from any column: categoricals pass
// through in first-seen order; numeric columns with many distinct values bin
// down to <=cap steps so the grid stays legible and bounded.
export function axisValues(t: Table, col: string, cap = 48):
  { labels: string[]; index: (v: any) => number } {
  const field = t.fields.find((f) => f.name === col);
  const uniq = [...new Set(t.rows.map((r) => String(r[col] ?? '')))];
  if (field?.type !== 'number' || uniq.length <= cap) {
    const pos = new Map(uniq.map((u, i) => [u, i]));
    return { labels: uniq, index: (v) => pos.get(String(v ?? '')) ?? -1 };
  }
  const nums = t.rows.map((r) => asNum(r[col])).filter((v) => !isNaN(v));
  const min = Math.min(...nums), max = Math.max(...nums);
  const w = (max - min) / cap || 1;
  const labels = Array.from({ length: cap }, (_, i) => (min + (i + 0.5) * w).toPrecision(3));
  return { labels, index: (v) => {
    const n = asNum(v);
    return isNaN(n) ? -1 : Math.min(cap - 1, Math.floor((n - min) / w));
  } };
}

// Which required roles are still unassigned; the page renders a prompt
// instead of letting a builder chart undefined columns.
export function missingRoles(type: ChartType, enc: Encoding): string[] {
  return rolesFor(type)
    .filter((s) => !s.optional)
    .filter((s) => (s.role === 'ys' ? enc.ys.length === 0 : !enc[s.role]))
    .map((s) => s.label);
}

// Can this form render this table with zero manual assignment? Drives which
// gallery tiles offer a live hover preview (a tile that would only show the
// "assign columns" prompt previews nothing useful).
export function canAutoEncode(t: Table, type: ChartType): boolean {
  return missingRoles(type, autoEncode(t, type)).length === 0;
}

export function histogram(vals: number[]): { bins: string[]; counts: number[] } {
  if (!vals.length) return { bins: [], counts: [] };
  const min = Math.min(...vals), max = Math.max(...vals);
  const n = Math.max(5, Math.min(40, Math.ceil(Math.sqrt(vals.length))));
  const w = (max - min) / n || 1;
  const counts = new Array(n).fill(0);
  for (const v of vals) counts[Math.min(n - 1, Math.floor((v - min) / w))]++;
  const dp = w >= 10 ? 0 : w >= 1 ? 1 : 2;
  const bins = counts.map((_, i) => `${(min + i * w).toFixed(dp)}`);
  return { bins, counts };
}

export function boxStats(vals: number[]): number[] {
  // [min, q1, median, q3, max] - what echarts' boxplot series consumes.
  const s = [...vals].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = (s.length - 1) * p, lo = Math.floor(i);
    return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
  };
  return [s[0], q(0.25), q(0.5), q(0.75), s[s.length - 1]];
}

export { asNum };

// ── palettes ────────────────────────────────────────────────────────────────
// Categorical slots are ASSIGNED IN ORDER, never cycled: series 9+ folds into
// "Other" upstream of here. Both variants passed the six-check palette
// validator against the terminal's real panel surfaces (#ffffff / #1a1a1a).
// The light variant carries a contrast WARN on slots 3/4/5, which
// is why the page always ships tooltips, a legend and the table view.
export const PALETTES: { name: string; light: string[]; dark: string[] }[] = [
  {
    name: 'Terminal',
    light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  },
  {
    name: 'Muted',
    // The economic calendar's validated trio, extended with steps from the
    // same families.
    light: ['#3d6fce', '#b06e1d', '#7d5cc6', '#0d8a7d', '#c04a72', '#5c7a1e', '#8a5a44', '#456579'],
    dark: ['#5b8def', '#c58435', '#9575dd', '#21b3a4', '#e0608a', '#7fa032', '#b07a5e', '#6f93ab'],
  },
];

// Sequential ramps (heatmap cells, surface height): one hue, light-to-dark on
// a light surface and dark-to-light on a dark one, endpoints clamped to the
// >=2:1 contrast steps of the blue ramp.
export const SEQ_LIGHT = ['#86b6ef', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#104281'];
export const SEQ_DARK = ['#184f95', '#1c5cab', '#256abf', '#3987e5', '#5598e7', '#86b6ef', '#b7d3f6'];
