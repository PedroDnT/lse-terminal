// ============================================================================
// EconomicCalendar.tsx - the terminal's economic calendar view.
//
// Reached from MY DATA. A classic pro-terminal two-pane screen: a day-grouped
// release table on the left (region / impact / date-range / text filters),
// and, for the selected event, its full release history charted on the right
// (actual vs consensus vs previous, bar/line/area, beat-miss coloring).
//
// Data comes from the engine's /api/economic-calendar proxy of the LSE feed;
// values arrive as the feed's display strings ("57K", "3.5%") and are parsed
// to numbers here because the suffix decides the axis unit. View preferences
// persist to the workspace file (section "econcal"), same as chart settings,
// so a user's setup survives reinstalls the way the rest of the terminal does.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
// echarts is driven directly (init/setOption/ResizeObserver) instead of via
// echarts-for-react: inside this IIFE library bundle the wrapper applied the
// option with an empty series list (verified against a live instance where a
// direct setOption of the same series rendered fine), so the wrapper is
// bypassed on purpose. Do not "simplify" back to <ReactECharts>.
import * as echarts from 'echarts';
import { getEventImpact } from '@/lib/eventImpact';

type EconEvent = {
  id: number;
  date: string;            // YYYY-MM-DD
  time: string | null;     // "12:30 PM"
  datetime: string | null; // ISO
  region_code: string;
  event: string;
  period_hint: string | null;
  actual: string | null;
  previous: string | null;
  consensus: string | null;
  forecast: string | null;
  actual_revised?: number;
  previous_revised?: number;
  consensus_revised?: number;
};

// Terminal chrome tokens, read from the shell's style.css variables so the
// calendar follows the terminal's light/dark class. Module-init read is safe:
// the theme boot script settles the html class before any bundle runs, and a
// theme switch reloads the page (see app.js), so the values never go stale.
const cssVar = (name: string, fallback: string): string =>
  (typeof document !== 'undefined' &&
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;
const C = {
  bg: cssVar('--bg', '#0d0e10'), panel: cssVar('--panel', '#151619'),
  edge: cssVar('--edge', '#26282c'), active: cssVar('--active', '#1b1d20'),
  text: cssVar('--text', '#e6e8ea'), dim: cssVar('--dim', '#8b8e94'),
  up: cssVar('--up', '#21b3a4'), down: cssVar('--down', '#f0426c'),
  // Series colors validated (dataviz six checks) against the dark surface:
  // marks also differ (bar / dashed / dotted) so identity never rides on
  // color alone.
  actual: '#5b8def', consensus: '#c58435', previous: '#9575dd',
};

// Region -> ISO 3166-1 alpha-2 for flagcdn.com (the same source the chart
// engine's flagImageCache uses). IF/WL have no flag and render code-only.
const FLAG_ISO: Record<string, string> = {
  AR: 'ar', AU: 'au', BR: 'br', CA: 'ca', CN: 'cn', DE: 'de', EA: 'eu',
  ES: 'es', EU: 'eu', FR: 'fr', GB: 'gb', ID: 'id', IN: 'in', IT: 'it',
  JP: 'jp', KR: 'kr', MX: 'mx', RU: 'ru', SA: 'sa', SG: 'sg', TR: 'tr',
  UK: 'gb', US: 'us', ZA: 'za',
};

// Real flag images instead of flag emoji: Windows has no emoji flag glyphs
// and falls back to bare letter pairs, so every row read "CN CN" (the broken
// emoji plus the region code). On load failure (offline machine) the image
// collapses to nothing and the region code alone identifies the row.
// Codes that are real regions but have no national flag: they render
// code-only rather than requesting a 404 from the flag CDN.
const NO_FLAG = new Set(['IF', 'WL', 'XX']);

function Flag({ code, size = 12 }: { code: string; size?: number }) {
  const [ok, setOk] = useState(true);
  const cc = (code || '').toUpperCase();
  // FLAG_ISO covers the calendar's ~26 region codes and their aliases (UK->gb,
  // EA->eu). The macro catalog spans 205 countries as plain ISO 3166-1 alpha-2,
  // which flagcdn serves lowercased, so any unmapped two-letter code falls
  // through to that instead of losing its flag.
  const iso = FLAG_ISO[cc] ||
    (/^[A-Z]{2}$/.test(cc) && !NO_FLAG.has(cc) ? cc.toLowerCase() : '');
  if (!iso || !ok) return null;
  return (
    <img
      src={`https://flagcdn.com/w20/${iso}.png`}
      srcSet={`https://flagcdn.com/w40/${iso}.png 2x`}
      width={Math.round(size * 4 / 3)} height={size}
      style={{ display: 'inline-block', verticalAlign: '-1px', borderRadius: 1 }}
      onError={() => setOk(false)} alt=""
    />
  );
}

const REGIONS: Record<string, { name: string; flag: string }> = {
  AR: { name: 'Argentina', flag: '🇦🇷' }, AU: { name: 'Australia', flag: '🇦🇺' },
  BR: { name: 'Brazil', flag: '🇧🇷' }, CA: { name: 'Canada', flag: '🇨🇦' },
  CN: { name: 'China', flag: '🇨🇳' }, DE: { name: 'Germany', flag: '🇩🇪' },
  EA: { name: 'Euro Area', flag: '🇪🇺' }, ES: { name: 'Spain', flag: '🇪🇸' },
  EU: { name: 'European Union', flag: '🇪🇺' }, FR: { name: 'France', flag: '🇫🇷' },
  GB: { name: 'United Kingdom', flag: '🇬🇧' }, ID: { name: 'Indonesia', flag: '🇮🇩' },
  IF: { name: 'International', flag: '🌐' }, IN: { name: 'India', flag: '🇮🇳' },
  IT: { name: 'Italy', flag: '🇮🇹' }, JP: { name: 'Japan', flag: '🇯🇵' },
  KR: { name: 'South Korea', flag: '🇰🇷' }, MX: { name: 'Mexico', flag: '🇲🇽' },
  RU: { name: 'Russia', flag: '🇷🇺' }, SA: { name: 'Saudi Arabia', flag: '🇸🇦' },
  SG: { name: 'Singapore', flag: '🇸🇬' }, TR: { name: 'Türkiye', flag: '🇹🇷' },
  UK: { name: 'United Kingdom', flag: '🇬🇧' }, US: { name: 'United States', flag: '🇺🇸' },
  WL: { name: 'World', flag: '🌐' }, ZA: { name: 'South Africa', flag: '🇿🇦' },
};
const MAJORS = ['US', 'EA', 'GB', 'JP', 'DE', 'CN', 'CA', 'AU'];

// "57K" / "3.5%" / "-92K" / "1,234.5M" -> number. Null when the cell isn't
// numeric (speech entries, letter ratings): those events list but don't chart.
function parseNum(raw?: string | null): number | null {
  if (raw == null || raw === '') return null;
  const m = String(raw).replace(/,/g, '').trim()
    .match(/^(-?\d*\.?\d+)\s*([KMBT])?\s*%?$/i);
  if (!m) return null;
  const mult = ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 } as Record<string, number>)[
    (m[2] || '').toUpperCase()] ?? 1;
  return parseFloat(m[1]) * mult;
}
function unitOf(raw?: string | null): string {
  if (!raw) return '';
  return String(raw).includes('%') ? '%' : '';
}
function fmtVal(v: number | null, unit: string): string {
  if (v == null) return '—';
  if (unit === '%') return `${+v.toFixed(3)}%`;
  const a = Math.abs(v);
  if (a >= 1e12) return `${+(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${+(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return `${+v.toFixed(3)}`;
}

// Until ~2025-09 the feed embedded the reference period in the event name
// ("Inflation Rate YoY OCT", "GDP Growth Rate QoQ Q1", "API Crude Oil Stock
// Change JUL/17"); newer rows use a clean name plus period_hint. One indicator
// is therefore many name variants, and history must group by the base name or
// a series shows only the post-2025 rows.
const PERIOD_SUFFIX =
  /\s+((JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\/\d{1,2})?|Q[1-4]|(19|20)\d{2})$/;
// Some feed rows glue the period straight onto the name with no space
// ("Jobless Claims 4-week AverageJAN/10" is a real DB row);
// only the dated month form and years are stripped gluelessly, so a real
// word ending in a month abbreviation can never be mangled.
const GLUED_SUFFIX =
  /([a-z])((JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\/\d{1,2}|(19|20)\d{2})$/;
function baseName(event: string): string {
  let out = event.trim();
  // Loop: a name can carry two tokens ("... MAY 2026").
  for (let i = 0; i < 3 && PERIOD_SUFFIX.test(out); i++) out = out.replace(PERIOD_SUFFIX, '');
  out = out.replace(GLUED_SUFFIX, '$1');
  return out;
}
// Grouping key: the feed's casing drifts release to release ("4-Week" vs
// "4-week"), which used to split one indicator into two series. Group
// case-insensitively; display whichever casing the newest release used.
function seriesKey(event: string): string { return baseName(event).toLowerCase(); }

function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return out;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d); out.setDate(d.getDate() + n); return out;
}

type RangeKey = 'today' | 'week' | 'nextweek' | 'month' | 'past-month' | 'custom';
function rangeFor(key: RangeKey, custom: { start: string; end: string }): { start: string; end: string } {
  const now = new Date();
  switch (key) {
    case 'today': return { start: isoDay(now), end: isoDay(now) };
    case 'week': { const m = mondayOf(now); return { start: isoDay(m), end: isoDay(addDays(m, 6)) }; }
    case 'nextweek': { const m = addDays(mondayOf(now), 7); return { start: isoDay(m), end: isoDay(addDays(m, 6)) }; }
    case 'month': return { start: isoDay(now), end: isoDay(addDays(now, 31)) };
    case 'past-month': return { start: isoDay(addDays(now, -31)), end: isoDay(now) };
    case 'custom': return custom;
  }
}

// View preferences persisted in the workspace file. Read once on mount,
// written (debounced) on change; failures are silent like every other
// workspace write - persistence must never break the view.
type Prefs = {
  regions: string[]; impact: 'all' | 'high' | 'medium' | 'low';
  range: RangeKey; customStart: string; customEnd: string;
  chartType: 'bar' | 'line' | 'area'; chartRange: '1y' | '3y' | '5y' | 'all';
  showConsensus: boolean; showPrevious: boolean; surpriseColors: boolean;
  // COUNTRIES mode (pro-terminal-style country monitor): which top-level
  // view is active and which country's indicator grid is open.
  view: 'calendar' | 'countries' | 'indicators' | 'yields' | 'banks';
  country: string;
  // The three macro views keep their own selections: they browse a different
  // universe (205 countries of macro series) than the calendar's ~26 feed
  // regions, so sharing `country` would leave one of them on a code the other
  // has no data for.
  indCountry: string; indCategory: string;
  bondCountry: string; bankCountry: string;
  macroRange: '1y' | '5y' | '10y' | 'all';
};
const DEFAULT_PREFS: Prefs = {
  regions: MAJORS, impact: 'all', range: 'week',
  customStart: isoDay(new Date()), customEnd: isoDay(addDays(new Date(), 7)),
  chartType: 'bar', chartRange: '3y',
  showConsensus: true, showPrevious: false, surpriseColors: true,
  view: 'calendar', country: 'US',
  indCountry: 'US', indCategory: '', bondCountry: 'US', bankCountry: 'US',
  macroRange: '10y',
};

// Countries the feed served when the strip's live probe cannot run (probe
// failure only; the strip normally derives from the feed itself). Taken
// from the live feed: 22 distinct region codes over 80 days.
const FALLBACK_COUNTRIES = ['US', 'EU', 'UK', 'JP', 'DE', 'CN', 'CA', 'AU',
  'FR', 'BR', 'IN', 'ES', 'IT', 'MX', 'TR', 'SG', 'ZA', 'KR', 'RU', 'ID',
  'SA', 'AR'];

async function fetchCalendar(params: Record<string, string>): Promise<EconEvent[]> {
  const url = new URL('/api/economic-calendar', window.location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (res.status === 409) throw new Error('no-key');
  if (!res.ok) throw new Error(`calendar fetch failed: ${res.status}`);
  return res.json();
}

// ── macro datasets (INDICATORS / BOND YIELDS / CENTRAL BANKS) ──────────────
// The calendar above is release-shaped (actual vs consensus per event). These
// three views read the vault's series-shaped macro data instead: one national
// statistic or one bond tenor per symbol, with its whole history. The catalog
// carries each series' last print, so all three tables render from ONE request
// and a series is only pulled when the user opens it.

type MacroRow = {
  dataset: 'economics' | 'bonds';
  symbol: string; name: string; category: string;
  country: string; country_name: string;
  unit: string; source: string; frequency: string;
  obs: number | null; first: string; last: string;
  last_value: number | null; change_pct: number | null; change_1y: number | null;
};
type SeriesPoint = { date: string; value: number };

// Module-level so switching between the three macro views (or leaving the page
// and coming back) never re-requests the catalog inside one session; the
// engine caches it for an hour on its side too.
let macroCatalogCache: Promise<MacroRow[]> | null = null;

function fetchMacroCatalog(): Promise<MacroRow[]> {
  if (!macroCatalogCache) {
    macroCatalogCache = fetch('/api/macro/catalog').then((res) => {
      if (res.status === 409) throw new Error('no-key');
      if (!res.ok) throw new Error(`macro catalog failed: ${res.status}`);
      return res.json();
    }).catch((e) => { macroCatalogCache = null; throw e; });
  }
  return macroCatalogCache;
}

async function fetchMacroSeries(symbol: string, dataset: string,
                                start?: string): Promise<SeriesPoint[]> {
  const url = new URL('/api/macro/series', window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('dataset', dataset);
  if (start) url.searchParams.set('start', start);
  url.searchParams.set('limit', '5000');
  const res = await fetch(url.toString());
  if (res.status === 409) throw new Error('no-key');
  if (!res.ok) throw new Error(`series failed: ${res.status}`);
  const rows = await res.json();
  return (rows as any[])
    .map((r) => ({ date: String(r.date).slice(0, 10), value: Number(r.value) }))
    .filter((r) => Number.isFinite(r.value));
}

// Macro values arrive as real numbers with a separate unit string, unlike the
// calendar's display strings, so formatting is unit-driven: percent inline,
// everything else scaled with its unit kept as a caption.
function fmtMacro(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const u = (unit || '').toLowerCase();
  if (u === 'percent' || u === '%') {
    return `${Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2)}%`;
  }
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 100) return v.toFixed(1);
  return v.toFixed(abs >= 1 ? 2 : 3);
}
// Percent-shaped units are already a rate, so a change in them is points, not
// another percentage. Everything else reports its change as a percentage.
const isPct = (unit: string) => ['percent', '%'].includes((unit || '').toLowerCase());

// Catalog series names lead with the country code ("US Interest Rate") which
// is redundant once a country is selected.
function shortName(row: MacroRow): string {
  const cc = (row.country || '').toUpperCase();
  return cc && row.name.toUpperCase().startsWith(cc + ' ')
    ? row.name.slice(cc.length + 1) : row.name;
}

// The catalog's year-on-year change is a percentage of the previous value, so
// a series that crosses zero (any net flow: ADP employment change, stock
// draws, trade balances) produces four-digit readings that are arithmetically
// right and unreadable. They clamp for display and keep the exact figure in
// the cell's tooltip rather than being hidden or silently dropped.
function fmtChange1y(v: number | null): { text: string; title: string } {
  if (v == null) return { text: '', title: '' };
  const title = `${v > 0 ? '+' : ''}${v}% vs a year ago`;
  if (Math.abs(v) >= 1000) return { text: `${v > 0 ? '>+' : '<-'}999%`, title };
  return { text: `${v > 0 ? '+' : ''}${v.toFixed(1)}%`, title };
}

// Yield curve order. Bond symbols carry a maturity label ("10Y", "5Y TIPS");
// sorting on days keeps 3M left of 1Y and never string-sorts 10Y before 2Y.
const TENOR_DAYS: Record<string, number> = {
  '1M': 30, '2M': 60, '3M': 90, '6M': 180, '1Y': 365, '2Y': 730, '3Y': 1095,
  '4Y': 1460, '5Y': 1825, '6Y': 2190, '7Y': 2555, '8Y': 2920, '9Y': 3285,
  '10Y': 3650, '15Y': 5475, '20Y': 7300, '25Y': 9125, '30Y': 10950, '40Y': 14600,
  '50Y': 18250,
};
// "United States 10Y yield" / "US10Y" -> "10Y". The catalog has no maturity
// column, so the tenor is read off the symbol's tail (the country prefix is
// letters, the tenor is digits + Y/M, TIPS-style suffixes are kept).
function tenorOf(row: MacroRow): string {
  const m = row.symbol.match(/(\d+[YM])(TIPS|IL|IND)?$/i);
  if (!m) return row.symbol;
  return m[1].toUpperCase() + (m[2] ? ` ${m[2].toUpperCase()}` : '');
}
function tenorDays(t: string): number {
  const base = t.split(' ')[0];
  return TENOR_DAYS[base] ?? 99999;
}

// Reserve-currency and G10 banks, in the order a rates board leads with them.
const BANK_MAJORS = ['US', 'EA', 'GB', 'JP', 'CH', 'CN', 'CA', 'AU', 'NZ', 'SE', 'NO'];

// The statistics a central bank owns, in board order. Everything else in a
// country's economics set belongs to INDICATORS, not to the bank.
const CB_CATEGORIES = [
  'Interest Rate', 'Deposit Interest Rate', 'Lending Rate', 'Bank Lending Rate',
  'Interbank Rate', 'Cash Reserve Ratio', 'Reverse Repo Rate',
  'Central Bank Balance Sheet', 'Money Supply M0', 'Money Supply M1',
  'Money Supply M2', 'Money Supply M3', 'Foreign Exchange Reserves',
  'Gold Reserves', 'Banks Balance Sheet', 'Loan Growth', 'Loans to Private Sector',
];

// ── small UI atoms (shell-styled, not the chart's Tailwind theme) ──────────

function Seg({ options, value, onChange }: {
  options: { key: string; label: string }[]; value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 4 }}>
      {options.map((o) => (
        <button key={o.key} onClick={() => onChange(o.key)}
          style={{
            padding: '4px 10px', fontSize: 11, letterSpacing: '.04em', border: 'none',
            cursor: 'pointer', borderRadius: 3,
            background: value === o.key ? C.edge : 'transparent',
            color: value === o.key ? C.text : C.dim,
          }}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ label, color, checked, onChange }: {
  label: string; color?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: checked ? C.text : C.dim, cursor: 'pointer', userSelect: 'none' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: color || C.actual }} />
      {color && <span style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: checked ? 1 : 0.35 }} />}
      {label}
    </label>
  );
}

// ── COUNTRIES mode atoms ────────────────────────────────────────────────────

type CountryIndicator = {
  name: string; series: number[]; dates: string[]; latest: EconEvent;
  prevVal: number | null; next: EconEvent | null; unit: string; count: number;
  impact: string;
};

// Inline SVG sparkline. Deliberately NOT echarts: the country monitor renders
// hundreds of these at once and an echarts instance per row is a memory
// hog; the full interactive chart is one click away in the detail pane.
function Spark({ values, height = 20 }: { values: number[]; height?: number }) {
  const w = 100, h = 30;
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const y = (v: number) => h - 3 - ((v - min) / (max - min)) * (h - 6);
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={C.actual} strokeWidth={1.1}
        vectorEffect="non-scaling-stroke" />
      <circle cx={w} cy={y(values[values.length - 1])} r={1.8} fill={C.actual} />
    </svg>
  );
}

// One of the five key-indicator charts across the top of the country
// monitor, Workspace "Key Economic Indicators" style: blue title, quiet
// gridlines, min/max scale labels, first/last year on the x axis, source
// caption. The line is SVG (stretched viewBox, non-scaling stroke); the
// labels are HTML overlays so text never distorts with the panel width.
function HeadlineChart({ title, ind, sel, onOpen }: {
  title: string; ind: CountryIndicator; sel: boolean; onOpen: () => void;
}) {
  const vals = ind.series;
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const w = 100, h = 100;
  const step = vals.length > 1 ? w / (vals.length - 1) : w;
  const y = (v: number) => h - ((v - min) / (max - min)) * h;
  const pts = vals.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`);
  const label = { color: C.dim, fontSize: 9, fontVariantNumeric: 'tabular-nums' as const };
  return (
    <div onClick={onOpen}
      style={{ background: C.panel, border: `1px solid ${sel ? C.actual : C.edge}`,
               padding: '8px 10px 6px', cursor: 'pointer', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
        <span style={{ color: C.actual, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                       overflow: 'hidden', textOverflow: 'ellipsis' }} title={ind.name}>{title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12.5, fontFamily: 'ui-monospace, Consolas, monospace',
                       fontVariantNumeric: 'tabular-nums', color: C.text }}>
          {fmtVal(vals[vals.length - 1], ind.unit)}
        </span>
      </div>
      <div style={{ position: 'relative', height: 96, margin: '4px 0 2px' }}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={w} y1={h * f} y2={h * f}
              stroke={C.edge} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <polyline points={pts.join(' ')} fill="none" stroke={C.actual} strokeWidth={1.4}
            vectorEffect="non-scaling-stroke" />
        </svg>
        <span style={{ ...label, position: 'absolute', top: -3, right: 0 }}>{fmtVal(max, ind.unit)}</span>
        <span style={{ ...label, position: 'absolute', bottom: -3, right: 0 }}>{fmtVal(min, ind.unit)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={label}>{(ind.dates[0] || '').slice(0, 4)}</span>
        <span style={label}>{(ind.dates[ind.dates.length - 1] || '').slice(0, 4)}</span>
      </div>
      <div style={{ ...label, textAlign: 'right', marginTop: 3 }}>Source: London Strategic Edge</div>
    </div>
  );
}

// Which series lead the headline row: first matching slot wins, five shown.
// Names are the feed's; the regexes tolerate country variants ("Fed Interest
// Rate Decision", "BoE Interest Rate Decision").
const HEADLINE_PICKS: [string, RegExp][] = [
  ['GDP Growth', /^GDP Growth Rate (YoY|QoQ)$/i],
  ['Inflation', /^Inflation Rate YoY$/i],
  ['Unemployment', /^Unemployment Rate$/i],
  ['Interest Rate', /Interest Rate Decision/i],
  ['Manufacturing PMI', /Manufacturing PMI/i],
  ['Consumer Sentiment', /Consumer (Sentiment|Confidence)/i],
  ['Retail Sales', /^Retail Sales (YoY|MoM)$/i],
  ['Balance of Trade', /Balance of Trade|Trade Balance/i],
];

// Category shelves for the indicator table, Workspace-style ("Surveys &
// Cyclical Indexes", "National Accounts", ...). First match wins, so order
// matters: Prices sits before Trade (PPI Ex Food, Energy and Trade),
// Growth before Rates (Atlanta Fed GDPNow), Housing before Surveys (NAHB
// Housing Market Index).
const CATEGORIES: [string, RegExp][] = [
  ['Growth & National Accounts', /GDP|Gross Domestic|Recession/i],
  ['Prices & Inflation', /CPI|PPI|Inflation|PCE|Price|Deflator/i],
  ['Labour Market', /Jobless|Employment|Payroll|Unemploy|Wage|Labor|Labour|Participation|JOLT|Challenger|Quits/i],
  ['Housing & Construction', /Housing|Home|Building|Mortgage|Construction|Case.?Shiller/i],
  ['Consumer & Retail', /Consumer|Michigan|Retail|Personal Income|Personal Spending|Credit|Vehicle|Redbook/i],
  ['Business & Surveys', /PMI|ISM|Business|Manufactur|Industrial|Factory|Durable|Capacity|Optimism|Sentiment|Confidence|Expectations|Leading|Barometer|Inventories|Orders/i],
  ['Trade & External', /Trade|Export|Import|Current Account|Capital Flows/i],
  ['Rates & Government', /Interest Rate|Fed|FOMC|Budget|Debt|Treasury|Auction|Government/i],
  ['Energy', /Oil|Gas|Crude|Gasoline|Distillate|Rig|Petroleum/i],
];
function categoryOf(name: string): string {
  for (const [cat, re] of CATEGORIES) if (re.test(name)) return cat;
  return 'Other';
}

const IMPACT_DOT: Record<string, string> = { high: C.down, medium: C.consensus, low: '#565a61' };

// ── main page ──────────────────────────────────────────────────────────────

export default function EconomicCalendarPage(
  { onBack, initialView }: { onBack?: () => void; initialView?: Prefs['view'] },
) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [events, setEvents] = useState<EconEvent[]>([]);
  const [listState, setListState] = useState<'loading' | 'ok' | 'no-key' | 'error'>('loading');
  const [search, setSearch] = useState('');
  const [regionOpen, setRegionOpen] = useState(false);
  const [selected, setSelected] = useState<{ region: string; event: string } | null>(null);
  const [history, setHistory] = useState<EconEvent[] | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // The native title bar mirrors what is on screen:
  // the open series when a detail pane is up ("United States GDP Price
  // Index QoQ Final"), else the country monitor or the calendar itself.
  // No restore on unmount: the shell rewrites the title on every rail
  // click and chart load, so a stale value can never outlive this page.
  useEffect(() => {
    const MACRO_TITLE: Partial<Record<Prefs['view'], string>> = {
      indicators: 'Indicators', yields: 'Bond Yields', banks: 'Central Banks',
    };
    const macro = MACRO_TITLE[prefs.view];
    if (macro) { document.title = `${macro} · Economic · LSE Terminal`; return; }
    const region = selected?.region || (prefs.view === 'countries' ? prefs.country : '');
    const country = region ? (REGIONS[region]?.name || region) : '';
    document.title = selected
      ? `${country} ${selected.event} · LSE Terminal`
      : country
        ? `${country} · Economic · LSE Terminal`
        : 'Economic Calendar · LSE Terminal';
  }, [selected, prefs.view, prefs.country]);

  // Live state for the terminal's AI screen map (app.js AI_REGIONS reads
  // window.__lseAiIslands.econ): which of the four economic views is up,
  // what is loaded, and what is selected. The yields/banks/indicators
  // subcomponents publish their own detail under __lseAiIslands.econ_detail.
  useEffect(() => {
    const w = window as unknown as { __lseAiIslands?: Record<string, unknown> };
    (w.__lseAiIslands ||= {}).econ = {
      view: prefs.view,
      calendar_events_loaded: events.length,
      search: search || null,
      selected_event: selected ? `${selected.region}: ${selected.event}` : null,
      status: listState,
    };
    return () => { if (w.__lseAiIslands) delete w.__lseAiIslands.econ; };
  }, [prefs.view, events.length, search, selected, listState]);

  // Hydrate prefs before the first fetch so a saved region set doesn't get
  // clobbered by one render of the defaults.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/workspace/econcal');
        const body = res.ok ? await res.json() : null;
        if (body?.value) setPrefs({ ...DEFAULT_PREFS, ...body.value });
      } catch { /* defaults are fine */ }
      // A sub-tab click (ECONOMIC > BOND YIELDS) names the view it wants, and
      // that beats the saved one: the user just asked for it. Applied after
      // hydration so it isn't overwritten by the stored value, and left
      // unsaved-until-changed so it doesn't rewrite prefs on every mount.
      if (initialView) setPrefs((p) => ({ ...p, view: initialView }));
      setPrefsLoaded(true);
    })();
    // initialView is read once per mount on purpose: the shell remounts the
    // island with a new value when another sub-tab is clicked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        fetch('/api/workspace/econcal', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        }).catch(() => { /* keep the session working regardless */ });
      }, 600);
      return next;
    });
  }, []);

  // Event list for the active window + regions. Calendar view only: the macro
  // views never read it, and it is a 5000-row pull per window change.
  useEffect(() => {
    if (!prefsLoaded || prefs.view !== 'calendar') return;
    const { start, end } = rangeFor(prefs.range, { start: prefs.customStart, end: prefs.customEnd });
    let dead = false;
    setListState('loading');
    fetchCalendar({ region: prefs.regions.join(','), start, end, order: 'asc', limit: '5000' })
      .then((rows) => { if (!dead) { setEvents(rows); setListState('ok'); } })
      .catch((e) => { if (!dead) setListState(e.message === 'no-key' ? 'no-key' : 'error'); });
    return () => { dead = true; };
  }, [prefsLoaded, prefs.view, prefs.regions, prefs.range, prefs.customStart, prefs.customEnd]);

  // Full history for the selected event. The server's event filter is a
  // contains-match (so it also returns the old period-suffixed name variants,
  // which is wanted); the exact grouping happens here by base name, so
  // "GDP Growth Rate" never charts "GDP Growth Rate Final" points but does
  // chart "GDP Growth Rate Q1" ones.
  useEffect(() => {
    if (!selected) { setHistory(null); return; }
    let dead = false;
    setHistLoading(true);
    // start is explicit because the feed defaults to "the last year" when
    // omitted; the history chart wants everything (the feed begins 2015).
    fetchCalendar({ region: selected.region, event: selected.event, start: '2015-01-01', order: 'asc', limit: '5000' })
      .then((rows) => {
        if (dead) return;
        const mine = rows.filter((r) => seriesKey(r.event) === selected.event.toLowerCase() && r.region_code === selected.region);
        // The name-scheme transition day can hold the same release under both
        // the suffixed and the clean name; keep one row per datetime,
        // preferring the one that carries an actual.
        const byTime = new Map<string, EconEvent>();
        for (const r of mine) {
          const k = r.datetime || `${r.date} ${r.time}`;
          const prev = byTime.get(k);
          if (!prev || (prev.actual == null && r.actual != null)) byTime.set(k, r);
        }
        setHistory([...byTime.values()]);
      })
      .catch(() => { if (!dead) setHistory([]); })
      .finally(() => { if (!dead) setHistLoading(false); });
    return () => { dead = true; };
  }, [selected]);

  // ── COUNTRIES mode data ───────────────────────────────────────────────────
  // Which countries actually have data: distinct region codes over a recent
  // window, so the strip tracks the feed instead of a hand-kept list. The
  // static list is a probe-failure fallback only.
  const [liveRegions, setLiveRegions] = useState<string[] | null>(null);
  const [countryRows, setCountryRows] = useState<EconEvent[]>([]);
  const [countryState, setCountryState] = useState<'loading' | 'ok' | 'no-key' | 'error'>('loading');
  useEffect(() => {
    if (!prefsLoaded || prefs.view !== 'countries' || liveRegions) return;
    const now = new Date();
    fetchCalendar({ start: isoDay(addDays(now, -60)), end: isoDay(addDays(now, 14)), order: 'asc', limit: '5000' })
      .then((rows) => {
        const codes = [...new Set(rows.map((r) => r.region_code))].filter((c) => REGIONS[c]);
        const rank = (c: string) => { const i = MAJORS.indexOf(c); return i === -1 ? 100 : i; };
        codes.sort((a, b) => rank(a) - rank(b) || REGIONS[a].name.localeCompare(REGIONS[b].name));
        setLiveRegions(codes.length ? codes : FALLBACK_COUNTRIES);
      })
      .catch(() => setLiveRegions(FALLBACK_COUNTRIES));
  }, [prefsLoaded, prefs.view, liveRegions]);

  // Per-country history for the overview grid: the newest 5000 rows within
  // ~3 years (desc, then reversed to ascending). Deep enough for the card
  // graphs; a card click still runs the existing full-history detail fetch.
  useEffect(() => {
    if (!prefsLoaded || prefs.view !== 'countries') return;
    let dead = false;
    setCountryState('loading');
    const now = new Date();
    fetchCalendar({ region: prefs.country, start: isoDay(addDays(now, -365 * 3)),
                    end: isoDay(addDays(now, 60)), order: 'desc', limit: '5000' })
      .then((rows) => { if (!dead) { setCountryRows(rows.reverse()); setCountryState('ok'); } })
      .catch((e) => { if (!dead) setCountryState(e.message === 'no-key' ? 'no-key' : 'error'); });
    return () => { dead = true; };
  }, [prefsLoaded, prefs.view, prefs.country]);

  const indicators = useMemo<CountryIndicator[]>(() => {
    if (prefs.view !== 'countries') return [];
    const groups = new Map<string, EconEvent[]>();
    for (const r of countryRows) {
      const k = seriesKey(r.event);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    const q = search.trim().toLowerCase();
    const today = isoDay(new Date());
    const out: CountryIndicator[] = [];
    for (const [key, rows] of groups) {
      if (q && !key.includes(q)) continue;
      // One row per release datetime, preferring the row that carries an
      // actual (same rule as the detail pane's history grouping).
      const byTime = new Map<string, EconEvent>();
      for (const r of rows) {
        const k = r.datetime || `${r.date} ${r.time}`;
        const prev = byTime.get(k);
        if (!prev || (prev.actual == null && r.actual != null)) byTime.set(k, r);
      }
      const seq = [...byTime.values()];
      const released = seq.filter((r) => parseNum(r.actual) != null);
      if (released.length < 4) continue; // speeches/auctions: no chartable series
      const latest = released[released.length - 1];
      const prev = released.length > 1 ? released[released.length - 2] : null;
      // Display name: whichever casing the newest release used ("4-Week"
      // over the older rows' "4-week"); the key keeps them one series.
      const name = baseName(latest.event);
      out.push({
        name,
        series: released.map((r) => parseNum(r.actual) as number),
        dates: released.map((r) => r.date),
        latest,
        prevVal: prev ? parseNum(prev.actual) : null,
        next: seq.find((r) => parseNum(r.actual) == null && r.date >= today) || null,
        unit: unitOf(latest.actual),
        count: released.length,
        impact: getEventImpact({ event: name, country: prefs.country }),
      });
    }
    // High-impact first (pro terminals lead with the market movers),
    // then by release depth so the dense monthly series precede one-offs.
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    out.sort((a, b) => (rank[a.impact] ?? 3) - (rank[b.impact] ?? 3) || b.count - a.count);
    return out;
  }, [prefs.view, prefs.country, countryRows, search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (q && !e.event.toLowerCase().includes(q)) return false;
      if (prefs.impact !== 'all' &&
          getEventImpact({ event: e.event, country: e.region_code }) !== prefs.impact) return false;
      return true;
    });
  }, [events, search, prefs.impact]);

  const byDay = useMemo(() => {
    const m = new Map<string, EconEvent[]>();
    for (const e of filtered) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date)!.push(e);
    }
    return [...m.entries()];
  }, [filtered]);

  const allRegions = Object.keys(REGIONS).sort();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text, fontSize: 12, minHeight: 0 }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: C.panel, borderBottom: `1px solid ${C.edge}`, flexWrap: 'wrap' }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'transparent', border: `1px solid ${C.edge}`, color: C.dim, borderRadius: 3, padding: '4px 8px', cursor: 'pointer' }}>
            ← My Data
          </button>
        )}
        <span style={{ fontWeight: 700, letterSpacing: '.12em', fontSize: 11, color: C.dim }}>ECONOMIC</span>
        <Seg value={prefs.view} onChange={(k) => update({ view: k as Prefs['view'] })}
          options={[{ key: 'calendar', label: 'Calendar' }, { key: 'countries', label: 'Countries' },
                    { key: 'indicators', label: 'Indicators' }, { key: 'yields', label: 'Bond Yields' },
                    { key: 'banks', label: 'Central Banks' }]} />
        {prefs.view === 'calendar' && (<>
        <Seg value={prefs.range} onChange={(k) => update({ range: k as RangeKey })}
          options={[{ key: 'today', label: 'Today' }, { key: 'week', label: 'This Week' },
                    { key: 'nextweek', label: 'Next Week' }, { key: 'month', label: 'Next Month' },
                    { key: 'past-month', label: 'Past Month' }, { key: 'custom', label: 'Custom' }]} />
        {prefs.range === 'custom' && (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="date" value={prefs.customStart} onChange={(e) => update({ customStart: e.target.value })}
              style={{ background: C.bg, color: C.text, border: `1px solid ${C.edge}`, borderRadius: 3, padding: '3px 6px', colorScheme: 'dark' }} />
            <span style={{ color: C.dim }}>→</span>
            <input type="date" value={prefs.customEnd} onChange={(e) => update({ customEnd: e.target.value })}
              style={{ background: C.bg, color: C.text, border: `1px solid ${C.edge}`, borderRadius: 3, padding: '3px 6px', colorScheme: 'dark' }} />
          </span>
        )}
        {/* region picker */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setRegionOpen((o) => !o)}
            style={{ background: C.bg, border: `1px solid ${C.edge}`, color: C.text, borderRadius: 3, padding: '4px 8px', cursor: 'pointer' }}>
            {prefs.regions.length === allRegions.length ? 'All regions'
              : prefs.regions.length <= 3 ? prefs.regions.join(', ')
              : `${prefs.regions.length} regions`} ▾
          </button>
          {regionOpen && (
            <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 30, background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 4, padding: 8, width: 230, maxHeight: 320, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <button onClick={() => update({ regions: MAJORS })} style={{ flex: 1, background: C.edge, border: 'none', color: C.text, borderRadius: 3, padding: '3px 0', cursor: 'pointer', fontSize: 11 }}>Majors</button>
                <button onClick={() => update({ regions: allRegions })} style={{ flex: 1, background: C.edge, border: 'none', color: C.text, borderRadius: 3, padding: '3px 0', cursor: 'pointer', fontSize: 11 }}>All</button>
                <button onClick={() => update({ regions: [] })} style={{ flex: 1, background: C.edge, border: 'none', color: C.dim, borderRadius: 3, padding: '3px 0', cursor: 'pointer', fontSize: 11 }}>None</button>
              </div>
              {allRegions.map((cc) => (
                <label key={cc} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px', cursor: 'pointer', color: prefs.regions.includes(cc) ? C.text : C.dim }}>
                  <input type="checkbox" checked={prefs.regions.includes(cc)}
                    onChange={(e) => update({ regions: e.target.checked ? [...prefs.regions, cc] : prefs.regions.filter((r) => r !== cc) })}
                    style={{ accentColor: C.actual }} />
                  <Flag code={cc} /><span style={{ width: 24 }}>{cc}</span>
                  <span style={{ fontSize: 11 }}>{REGIONS[cc].name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <Seg value={prefs.impact} onChange={(k) => update({ impact: k as Prefs['impact'] })}
          options={[{ key: 'all', label: 'All' }, { key: 'high', label: 'High' },
                    { key: 'medium', label: 'Med' }, { key: 'low', label: 'Low' }]} />
        </>)}
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={prefs.view === 'calendar' ? 'Filter events…'
            : prefs.view === 'yields' ? 'Filter countries…'
            : prefs.view === 'banks' ? 'Filter banks…' : 'Filter indicators…'}
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.edge}`, borderRadius: 3, padding: '4px 8px', width: 160, marginLeft: 'auto' }} />
      </div>

      {/* COUNTRIES header strip: every country the feed serves, flag + name,
          horizontally scrollable; the selected one drives the grid below. */}
      {prefs.view === 'countries' && (
        <div style={{ display: 'flex', gap: 2, padding: '5px 10px', background: C.panel,
                      borderBottom: `1px solid ${C.edge}`, overflowX: 'auto', flex: 'none' }}>
          {(liveRegions || FALLBACK_COUNTRIES).map((cc) => (
            <button key={cc} onClick={() => update({ country: cc })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px',
                       border: `1px solid ${prefs.country === cc ? C.edge : 'transparent'}`,
                       borderRadius: 2, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none',
                       background: prefs.country === cc ? C.active : 'transparent',
                       color: prefs.country === cc ? C.text : C.dim, fontSize: 11 }}>
              <Flag code={cc} /> {REGIONS[cc]?.name || cc}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }} onClick={() => regionOpen && setRegionOpen(false)}>
        {/* The three vault-backed macro views. Each owns its own data and its
            own detail pane; the calendar's `selected` event state is release
            data and does not apply to them. */}
        {prefs.view === 'indicators' && (
          <IndicatorsView prefs={prefs} update={update} search={search} />
        )}
        {prefs.view === 'yields' && (
          <YieldsView prefs={prefs} update={update} search={search} />
        )}
        {prefs.view === 'banks' && (
          <BanksView prefs={prefs} update={update} search={search} />
        )}

        {/* country monitor, Workspace "Key Economic Indicators" layout:
            headline chart row for the market movers, then a dense table
            grouped into category shelves. A row click opens the same
            full-history detail pane as the calendar view. */}
        {prefs.view === 'countries' && (
        <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
          {countryState === 'no-key' && (
            <div style={{ padding: 40, color: C.dim, textAlign: 'center', lineHeight: 1.8 }}>
              <div style={{ fontSize: 14, color: C.text }}>Connect your LSE API key to load the country monitor.</div>
              Get a free key at londonstrategicedge.com/data, then connect it from the key manager in the top-left corner.
            </div>
          )}
          {countryState === 'error' && <div style={{ padding: 40, color: C.down }}>Feed unavailable. Retry shortly.</div>}
          {countryState === 'loading' && <div style={{ padding: 40, color: C.dim }}>Loading {REGIONS[prefs.country]?.name || prefs.country}…</div>}
          {countryState === 'ok' && (() => {
            const isSel = (ind: CountryIndicator) =>
              selected?.region === prefs.country &&
              selected?.event.toLowerCase() === ind.name.toLowerCase();
            const open = (ind: CountryIndicator) =>
              setSelected({ region: prefs.country, event: ind.name });
            // Headline slots: first indicator matching each pick, five max,
            // no indicator used twice.
            const used = new Set<string>();
            const headline: { title: string; ind: CountryIndicator }[] = [];
            for (const [title, re] of HEADLINE_PICKS) {
              if (headline.length >= 5) break;
              const ind = indicators.find((i) => re.test(i.name) && !used.has(i.name));
              if (ind) { used.add(ind.name); headline.push({ title, ind }); }
            }
            const shelves = new Map<string, CountryIndicator[]>();
            for (const ind of indicators) {
              const cat = categoryOf(ind.name);
              if (!shelves.has(cat)) shelves.set(cat, []);
              shelves.get(cat)!.push(ind);
            }
            const shelfOrder = [...CATEGORIES.map(([c]) => c), 'Other']
              .filter((c) => shelves.has(c));
            const cols = 'minmax(220px, 1fr) 110px 90px 90px 80px 130px 60px';
            const cell = { fontVariantNumeric: 'tabular-nums' as const, textAlign: 'right' as const,
                           fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5 };
            return (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 12px 2px' }}>
                <Flag code={prefs.country} size={14} />
                <b style={{ fontSize: 13 }}>{REGIONS[prefs.country]?.name || prefs.country}</b>
                <span style={{ color: C.dim, fontSize: 11 }}>
                  Key economic indicators · {indicators.length} series from the release history · click a row for the full history
                </span>
              </div>
              {headline.length > 0 && (
                <div style={{ display: 'grid', gap: 8, padding: '8px 12px',
                              gridTemplateColumns: `repeat(${headline.length}, minmax(0, 1fr))` }}>
                  {headline.map(({ title, ind }) => (
                    <HeadlineChart key={ind.name} title={title} ind={ind}
                      sel={isSel(ind)} onOpen={() => open(ind)} />
                  ))}
                </div>
              )}
              {/* column header, sticky over the shelf tables */}
              <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center',
                            padding: '5px 12px', position: 'sticky', top: 0, zIndex: 10,
                            background: C.bg, borderBottom: `1px solid ${C.edge}`,
                            color: C.dim, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                <span>Indicator</span>
                <span>Trend</span>
                <span style={{ textAlign: 'right' }}>Latest</span>
                <span style={{ textAlign: 'right' }}>Chg</span>
                <span style={{ textAlign: 'right' }}>Period</span>
                <span style={{ textAlign: 'right' }}>Next release</span>
                <span style={{ textAlign: 'right' }}>Rel.</span>
              </div>
              {shelfOrder.map((cat) => (
                <div key={cat}>
                  <div style={{ padding: '8px 12px 4px', background: C.panel,
                                borderBottom: `1px solid ${C.edge}`, color: C.text,
                                fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em',
                                textTransform: 'uppercase' }}>
                    {cat}
                  </div>
                  {shelves.get(cat)!.map((ind) => {
                    const sel = isSel(ind);
                    const delta = parseNum(ind.latest.actual) != null && ind.prevVal != null
                      ? (parseNum(ind.latest.actual) as number) - ind.prevVal : null;
                    return (
                      <div key={ind.name} onClick={() => open(ind)}
                        style={{ display: 'grid', gridTemplateColumns: cols, gap: 8,
                                 alignItems: 'center', padding: '3px 12px', cursor: 'pointer',
                                 borderBottom: `1px solid ${C.edge}`,
                                 background: sel ? C.active : 'transparent',
                                 borderLeft: sel ? `2px solid ${C.actual}` : '2px solid transparent' }}
                        onMouseEnter={(ev) => { if (!sel) (ev.currentTarget as HTMLElement).style.background = C.edge; }}
                        onMouseLeave={(ev) => { if (!sel) (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                        <span style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis',
                                       whiteSpace: 'nowrap' }} title={ind.name}>{ind.name}</span>
                        <Spark values={ind.series} />
                        <span style={{ ...cell, color: C.text, fontSize: 12 }}>
                          {fmtVal(parseNum(ind.latest.actual), ind.unit)}
                        </span>
                        <span style={{ ...cell, color: delta == null || delta === 0 ? C.dim : delta > 0 ? C.up : C.down }}>
                          {delta == null ? '' : `${delta >= 0 ? '+' : ''}${fmtVal(delta, ind.unit)}`}
                        </span>
                        <span style={{ ...cell, color: C.dim, fontFamily: 'inherit' }}>
                          {ind.latest.period_hint || ind.latest.date}
                        </span>
                        <span style={{ ...cell, color: C.dim, fontFamily: 'inherit' }}>
                          {ind.next ? `${ind.next.date}${ind.next.consensus ? ` (${ind.next.consensus})` : ''}` : ''}
                        </span>
                        <span style={{ ...cell, color: C.dim }}>{ind.count}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              {indicators.length === 0 && (
                <div style={{ padding: 30, color: C.dim }}>No chartable indicators match the filter.</div>
              )}
            </>
            );
          })()}
        </div>
        )}

        {/* event table */}
        {prefs.view === 'calendar' && (
        <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
          {listState === 'no-key' && (
            <div style={{ padding: 40, color: C.dim, textAlign: 'center', lineHeight: 1.8 }}>
              <div style={{ fontSize: 14, color: C.text }}>Connect your LSE API key to load the economic calendar.</div>
              Get a free key at londonstrategicedge.com/data, then connect it from the key manager in the top-left corner.
            </div>
          )}
          {listState === 'error' && <div style={{ padding: 40, color: C.down }}>Calendar feed unavailable. Retry shortly.</div>}
          {listState === 'loading' && <div style={{ padding: 40, color: C.dim }}>Loading events…</div>}
          {listState === 'ok' && byDay.length === 0 && (
            <div style={{ padding: 40, color: C.dim }}>No events match the current filters.</div>
          )}
          {listState === 'ok' && byDay.map(([day, rows]) => (
            <div key={day}>
              <div style={{ padding: '5px 12px', background: C.panel, borderTop: `1px solid ${C.edge}`, borderBottom: `1px solid ${C.edge}`, color: C.dim, fontSize: 11, letterSpacing: '.05em', position: 'sticky', top: 0, zIndex: 10 }}>
                {new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
              </div>
              {rows.map((e) => {
                const impact = getEventImpact({ event: e.event, country: e.region_code });
                const sel = selected?.region === e.region_code &&
                  selected?.event.toLowerCase() === seriesKey(e.event);
                return (
                  <div key={e.id} onClick={() => setSelected({ region: e.region_code, event: baseName(e.event) })}
                    style={{
                      display: 'grid', gridTemplateColumns: '64px 60px 1fr 90px 90px 90px', gap: 8,
                      alignItems: 'center', padding: '4px 12px', cursor: 'pointer',
                      background: sel ? C.active : 'transparent',
                      borderLeft: sel ? `2px solid ${C.actual}` : '2px solid transparent',
                    }}
                    onMouseEnter={(ev) => { if (!sel) (ev.currentTarget as HTMLElement).style.background = C.edge; }}
                    onMouseLeave={(ev) => { if (!sel) (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                    <span style={{ color: C.dim, fontVariantNumeric: 'tabular-nums' }}>{e.time || '—'}</span>
                    <span title={REGIONS[e.region_code]?.name || e.region_code}>
                      <Flag code={e.region_code} /> <span style={{ color: C.dim }}>{e.region_code}</span>
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span title={`${impact} impact`} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: IMPACT_DOT[impact], marginRight: 7, verticalAlign: 'middle' }} />
                      {e.event}
                      {e.period_hint && <span style={{ color: C.dim, marginLeft: 6, fontSize: 10 }}>{e.period_hint}</span>}
                    </span>
                    <Num label="A" v={e.actual} revised={!!e.actual_revised} strong />
                    <Num label="C" v={e.consensus} revised={!!e.consensus_revised} />
                    <Num label="P" v={e.previous} revised={!!e.previous_revised} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        )}

        {/* detail pane: release history, so calendar/countries only (the macro
            views chart vault series and render their own pane). */}
        {selected && (prefs.view === 'calendar' || prefs.view === 'countries') && (
          <EventDetail selected={selected} history={history} loading={histLoading}
            prefs={prefs} update={update} onClose={() => setSelected(null)} />
        )}
      </div>
    </div>
  );
}

function Num({ label, v, revised, strong }: { label: string; v: string | null; revised: boolean; strong?: boolean }) {
  return (
    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: v ? (strong ? C.text : C.dim) : '#3a3d42' }}>
      <span style={{ fontSize: 9, color: '#565a61', marginRight: 4 }}>{label}</span>
      {v || '—'}
      {revised && <sup title="revised" style={{ color: C.consensus, fontSize: 9 }}> R</sup>}
    </span>
  );
}

// ── the per-event history chart pane ───────────────────────────────────────

function EventDetail({ selected, history, loading, prefs, update, onClose }: {
  selected: { region: string; event: string };
  history: EconEvent[] | null; loading: boolean;
  prefs: Prefs; update: (p: Partial<Prefs>) => void; onClose: () => void;
}) {
  const today = isoDay(new Date());
  const chartRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const inst = echarts.init(chartRef.current);
    instRef.current = inst;
    // The pane resizes with the window and with toolbar wrapping; echarts
    // only watches nothing by itself, so observe the container.
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(chartRef.current);
    return () => { ro.disconnect(); inst.dispose(); instRef.current = null; };
  }, []);

  const { rows, unit, nextRelease } = useMemo(() => {
    const all = (history || []).map((e) => ({
      ...e,
      a: parseNum(e.actual), c: parseNum(e.consensus ?? e.forecast), p: parseNum(e.previous),
    }));
    // Chartable = anything with at least one numeric value. Future releases
    // (consensus printed, actual pending) extend the consensus line past the
    // last actual, which is exactly what "what does the street expect next"
    // needs.
    const chartable = all.filter((r) => r.a != null || r.c != null || r.p != null);
    const firstNum = chartable.find((r) => r.actual || r.consensus || r.previous);
    const u = unitOf(firstNum?.actual ?? firstNum?.consensus ?? firstNum?.previous);
    const next = all.find((r) => r.date > today && r.a == null);
    return { rows: chartable, unit: u, nextRelease: next };
  }, [history, today]);

  const cut = useMemo(() => {
    if (prefs.chartRange === 'all') return rows;
    const years = { '1y': 1, '3y': 3, '5y': 5 }[prefs.chartRange];
    const min = isoDay(addDays(new Date(), -365 * years));
    return rows.filter((r) => r.date >= min);
  }, [rows, prefs.chartRange]);

  const latest = [...rows].reverse().find((r) => r.a != null);
  const surprise = latest && latest.a != null && latest.c != null ? latest.a - latest.c : null;

  const option = useMemo(() => {
    const x = cut.map((r) => r.date);
    const fmt = (v: number | null) => fmtVal(v, unit);
    const series: any[] = [];
    const actualData = cut.map((r) => r.a);
    if (prefs.chartType === 'bar') {
      series.push({
        name: 'Actual', type: 'bar', data: actualData.map((v, i) => ({
          value: v,
          itemStyle: prefs.surpriseColors && v != null && cut[i].c != null
            ? { color: v >= (cut[i].c as number) ? C.up : C.down, borderRadius: [2, 2, 0, 0] }
            : { color: C.actual, borderRadius: [2, 2, 0, 0] },
        })),
        barMaxWidth: 14, barCategoryGap: '30%',
      });
    } else {
      series.push({
        name: 'Actual', type: 'line', data: actualData, smooth: false,
        lineStyle: { color: C.actual, width: 2 }, itemStyle: { color: C.actual },
        symbol: 'circle', symbolSize: 5, showSymbol: cut.length <= 40, connectNulls: true,
        areaStyle: prefs.chartType === 'area' ? { color: C.actual + '26' } : undefined,
      });
    }
    if (prefs.showConsensus) {
      series.push({
        name: 'Consensus', type: 'line', data: cut.map((r) => r.c), connectNulls: true,
        lineStyle: { color: C.consensus, width: 2, type: 'dashed' },
        itemStyle: { color: C.consensus }, symbol: 'circle', symbolSize: 4, showSymbol: false,
      });
    }
    if (prefs.showPrevious) {
      series.push({
        name: 'Previous', type: 'line', data: cut.map((r) => r.p), connectNulls: true,
        lineStyle: { color: C.previous, width: 2, type: 'dotted' },
        itemStyle: { color: C.previous }, symbol: 'circle', symbolSize: 4, showSymbol: false,
      });
    }
    return {
      backgroundColor: 'transparent',
      animation: false,
      legend: {
        show: series.length > 1, top: 0, right: 8, icon: 'roundRect',
        itemWidth: 10, itemHeight: 4, textStyle: { color: C.dim, fontSize: 10 },
      },
      grid: { left: 8, right: 16, top: 26, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'cross', label: { backgroundColor: C.edge, color: C.text } },
        backgroundColor: 'rgba(21,22,25,.96)', borderColor: C.edge,
        textStyle: { color: C.text, fontSize: 11 },
        valueFormatter: (v: any) => (v == null ? '—' : fmt(v as number)),
      },
      xAxis: {
        type: 'category', data: x,
        axisLine: { lineStyle: { color: C.edge } }, axisTick: { show: false },
        axisLabel: { color: C.dim, fontSize: 10 },
      },
      yAxis: {
        type: 'value', scale: true,
        axisLabel: { color: C.dim, fontSize: 10, formatter: (v: number) => fmtVal(v, unit) },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)', type: 'dashed' } },
      },
      // Inside zoom only (wheel / drag). The slider mini-map bar that used to
      // sit under the chart was cut as visual clutter; don't reintroduce it.
      dataZoom: [{ type: 'inside' }],
      series,
    };
  }, [cut, unit, prefs.chartType, prefs.showConsensus, prefs.showPrevious, prefs.surpriseColors]);

  useEffect(() => {
    instRef.current?.setOption(option as echarts.EChartsOption, { notMerge: true });
  }, [option]);

  const hasNumbers = rows.some((r) => r.a != null || r.c != null);

  return (
    <div style={{ width: '46%', minWidth: 420, borderLeft: `1px solid ${C.edge}`, display: 'flex', flexDirection: 'column', minHeight: 0, background: C.bg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${C.edge}` }}>
        <Flag code={selected.region} size={15} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.event}</div>
          <div style={{ color: C.dim, fontSize: 10 }}>{REGIONS[selected.region]?.name || selected.region} · {rows.length} releases since {rows[0]?.date?.slice(0, 4) || '—'}</div>
        </div>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 15 }}>✕</button>
      </div>

      {/* headline tiles: text wears text tokens, the colored chip carries identity */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: C.edge, borderBottom: `1px solid ${C.edge}` }}>
        {[
          ['Latest actual', latest ? fmtVal(latest.a, unit) : '—', latest?.period_hint || latest?.date || ''],
          ['Consensus', latest ? fmtVal(latest.c, unit) : '—', ''],
          ['Surprise', surprise == null ? '—' : `${surprise >= 0 ? '+' : ''}${fmtVal(surprise, unit)}`,
            surprise == null ? '' : surprise >= 0 ? 'beat' : 'miss'],
          ['Next release', nextRelease?.date || '—', nextRelease?.c != null ? `exp ${fmtVal(nextRelease.c, unit)}` : ''],
        ].map(([t, v, s]) => (
          <div key={t as string} style={{ background: C.panel, padding: '7px 10px' }}>
            <div style={{ color: C.dim, fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase' }}>{t}</div>
            <div style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums', color: t === 'Surprise' && surprise != null ? (surprise >= 0 ? C.up : C.down) : C.text }}>{v}</div>
            <div style={{ color: C.dim, fontSize: 9 }}>{s}</div>
          </div>
        ))}
      </div>

      {/* chart customization */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: `1px solid ${C.edge}`, flexWrap: 'wrap' }}>
        <Seg value={prefs.chartType} onChange={(k) => update({ chartType: k as Prefs['chartType'] })}
          options={[{ key: 'bar', label: 'Bars' }, { key: 'line', label: 'Line' }, { key: 'area', label: 'Area' }]} />
        <Seg value={prefs.chartRange} onChange={(k) => update({ chartRange: k as Prefs['chartRange'] })}
          options={[{ key: '1y', label: '1Y' }, { key: '3y', label: '3Y' }, { key: '5y', label: '5Y' }, { key: 'all', label: 'All' }]} />
        <Toggle label="Consensus" color={C.consensus} checked={prefs.showConsensus} onChange={(v) => update({ showConsensus: v })} />
        <Toggle label="Previous" color={C.previous} checked={prefs.showPrevious} onChange={(v) => update({ showPrevious: v })} />
        {prefs.chartType === 'bar' && (
          <Toggle label="Beat / miss" checked={prefs.surpriseColors} onChange={(v) => update({ surpriseColors: v })} />
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '4px 4px 0 4px', position: 'relative' }}>
        {/* The chart div stays mounted through loading/empty states so the
            echarts instance and its ResizeObserver live exactly once. */}
        <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
        {(loading || !hasNumbers || cut.length === 0) && (
          <div style={{ position: 'absolute', inset: 0, padding: 30, color: C.dim, lineHeight: 1.7, background: C.bg }}>
            {loading ? 'Loading history…'
              : !hasNumbers && history
                ? 'This event has no numeric prints (speeches and auctions list results without a chartable series). Pick a data release to see its history.'
                : 'No releases inside this range. Widen it to All.'}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ECONOMIC > INDICATORS / BOND YIELDS / CENTRAL BANKS
//
// Three views over the vault's series-shaped macro data (see the MacroRow
// block above). Shared shape: the catalog fetch fills the table instantly from
// each series' last print, and clicking a row pulls that one series' history
// into the chart pane on the right.
// ═══════════════════════════════════════════════════════════════════════════

type MacroViewProps = {
  prefs: Prefs; update: (p: Partial<Prefs>) => void; search: string;
};

// One catalog load shared by the three views, with the page's three standard
// states (no key / error / loading) so each view renders the same hints the
// calendar does.
function useMacroCatalog() {
  const [rows, setRows] = useState<MacroRow[] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'no-key' | 'error'>('loading');
  useEffect(() => {
    let dead = false;
    fetchMacroCatalog()
      .then((r) => { if (!dead) { setRows(r); setState('ok'); } })
      .catch((e) => { if (!dead) setState(e.message === 'no-key' ? 'no-key' : 'error'); });
    return () => { dead = true; };
  }, []);
  return { rows, state };
}

// Shared empty/loading/no-key body, so a missing key reads identically in
// every macro view (and never as a broken table).
function MacroState({ state, what }: { state: string; what: string }) {
  if (state === 'no-key') {
    return (
      <div style={{ padding: 40, color: C.dim, textAlign: 'center', lineHeight: 1.8 }}>
        <div style={{ fontSize: 14, color: C.text }}>Connect your LSE API key to load {what}.</div>
        Get a free key at londonstrategicedge.com/data, then connect it from the key manager in the top-left corner.
      </div>
    );
  }
  if (state === 'error') return <div style={{ padding: 40, color: C.down }}>Macro feed unavailable. Retry shortly.</div>;
  return <div style={{ padding: 40, color: C.dim }}>Loading {what}…</div>;
}

// A country picker that scales to the catalog's 205 countries: a filterable
// popup list rather than the calendar's flat checkbox column.
function CountryPicker({ countries, value, onChange }: {
  countries: { code: string; name: string; count: number }[];
  value: string; onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = countries.find((c) => c.code === value);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? countries.filter((c) => c.name.toLowerCase().includes(s) ||
                                       c.code.toLowerCase().includes(s)) : countries;
  }, [countries, q]);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.bg,
                 border: `1px solid ${C.edge}`, color: C.text, borderRadius: 3,
                 padding: '4px 8px', cursor: 'pointer', minWidth: 150 }}>
        <Flag code={value} /> {current?.name || value} ▾
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 40, background: C.panel,
                      border: `1px solid ${C.edge}`, borderRadius: 4, padding: 6, width: 260,
                      maxHeight: 360, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search country…"
            style={{ width: '100%', background: C.bg, color: C.text, border: `1px solid ${C.edge}`,
                     borderRadius: 3, padding: '4px 6px', marginBottom: 6 }} />
          {shown.map((c) => (
            <div key={c.code} onClick={() => { onChange(c.code); setOpen(false); setQ(''); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', cursor: 'pointer',
                       color: c.code === value ? C.text : C.dim, background: c.code === value ? C.active : 'transparent' }}>
              <Flag code={c.code} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              <span style={{ fontSize: 10, color: C.dim, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
            </div>
          ))}
          {shown.length === 0 && <div style={{ padding: 8, color: C.dim }}>No match.</div>}
        </div>
      )}
    </div>
  );
}

// ── the shared series chart pane ───────────────────────────────────────────
// One echarts instance, mounted once and fed by setOption, for whichever
// series is open in any of the three views (same pattern as EventDetail: the
// chart div stays mounted through loading so the instance and its
// ResizeObserver live exactly once).
function SeriesPane({ title, subtitle, unit, points, loading, error, range, onRange,
                     onClose, extra }: {
  title: string; subtitle: string; unit: string;
  points: SeriesPoint[] | null; loading: boolean; error?: boolean;
  range: Prefs['macroRange']; onRange: (r: Prefs['macroRange']) => void;
  onClose: () => void; extra?: ReactNode;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const inst = echarts.init(chartRef.current);
    instRef.current = inst;
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(chartRef.current);
    return () => { ro.disconnect(); inst.dispose(); instRef.current = null; };
  }, []);

  const cut = useMemo(() => {
    const all = points || [];
    if (range === 'all') return all;
    const years = { '1y': 1, '5y': 5, '10y': 10 }[range];
    const min = isoDay(addDays(new Date(), -365 * years));
    return all.filter((p) => p.date >= min);
  }, [points, range]);

  const stats = useMemo(() => {
    if (!cut.length) return null;
    const vals = cut.map((p) => p.value);
    const last = cut[cut.length - 1];
    const first = cut[0];
    return {
      last, first, min: Math.min(...vals), max: Math.max(...vals),
      chg: last.value - first.value,
    };
  }, [cut]);

  useEffect(() => {
    const option = {
      backgroundColor: 'transparent',
      animation: false,
      grid: { left: 8, right: 16, top: 18, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'cross', label: { backgroundColor: C.edge, color: C.text } },
        backgroundColor: 'rgba(21,22,25,.96)', borderColor: C.edge,
        textStyle: { color: C.text, fontSize: 11 },
        valueFormatter: (v: any) => (v == null ? '—' : fmtMacro(v as number, unit)),
      },
      xAxis: {
        type: 'category', data: cut.map((p) => p.date),
        axisLine: { lineStyle: { color: C.edge } }, axisTick: { show: false },
        axisLabel: { color: C.dim, fontSize: 10 },
      },
      yAxis: {
        type: 'value', scale: true,
        axisLabel: { color: C.dim, fontSize: 10, formatter: (v: number) => fmtMacro(v, unit) },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)', type: 'dashed' } },
      },
      dataZoom: [{ type: 'inside' }],
      series: [{
        name: title, type: 'line', data: cut.map((p) => p.value), smooth: false,
        // Policy rates and reserve ratios hold flat between decisions; a
        // stepped line is what that actually is, and it stops a step change
        // reading as a gradual slope.
        step: isPct(unit) && cut.length < 400 ? 'end' : undefined,
        lineStyle: { color: C.actual, width: 1.8 }, itemStyle: { color: C.actual },
        symbol: 'circle', symbolSize: 4, showSymbol: cut.length <= 60,
        areaStyle: { color: C.actual + '1f' },
      }],
    };
    instRef.current?.setOption(option as echarts.EChartsOption, { notMerge: true });
  }, [cut, unit, title]);

  return (
    <div style={{ width: '44%', minWidth: 400, borderLeft: `1px solid ${C.edge}`, display: 'flex',
                  flexDirection: 'column', minHeight: 0, background: C.bg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${C.edge}` }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ color: C.dim, fontSize: 10 }}>{subtitle}</div>
        </div>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 15 }}>✕</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: C.edge, borderBottom: `1px solid ${C.edge}` }}>
        {[
          ['Latest', stats ? fmtMacro(stats.last.value, unit) : '—', stats?.last.date || ''],
          // pp, not %: a policy rate going 0.50 -> 3.75 moved 3.25 percentage
          // POINTS (it rose 650% in percentage terms), and "+3.25%" for that
          // is the classic misread.
          ['Change', stats
            ? (isPct(unit)
                ? `${stats.chg >= 0 ? '+' : ''}${stats.chg.toFixed(2)}pp`
                : `${stats.chg >= 0 ? '+' : ''}${fmtMacro(stats.chg, unit)}`)
            : '—',
            stats ? `since ${stats.first.date}` : ''],
          ['Range low', stats ? fmtMacro(stats.min, unit) : '—', ''],
          ['Range high', stats ? fmtMacro(stats.max, unit) : '—', ''],
        ].map(([t, v, s]) => (
          <div key={t as string} style={{ background: C.panel, padding: '7px 10px' }}>
            <div style={{ color: C.dim, fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase' }}>{t}</div>
            <div style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums',
                          color: t === 'Change' && stats ? (stats.chg >= 0 ? C.up : C.down) : C.text }}>{v}</div>
            <div style={{ color: C.dim, fontSize: 9 }}>{s}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: `1px solid ${C.edge}` }}>
        <Seg value={range} onChange={(k) => onRange(k as Prefs['macroRange'])}
          options={[{ key: '1y', label: '1Y' }, { key: '5y', label: '5Y' },
                    { key: '10y', label: '10Y' }, { key: 'all', label: 'All' }]} />
        {unit && <span style={{ color: C.dim, fontSize: 10 }}>{unit}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '4px 4px 0 4px', position: 'relative' }}>
        <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
        {(loading || error || cut.length === 0) && (
          <div style={{ position: 'absolute', inset: 0, padding: 30, color: error ? C.down : C.dim, lineHeight: 1.7, background: C.bg }}>
            {loading ? 'Loading history…'
              : error ? 'This series could not be loaded.'
              : 'No observations inside this range. Widen it to All.'}
          </div>
        )}
      </div>
      {extra}
    </div>
  );
}

// Fetch-on-open for whichever series a macro view has selected. Returns the
// points plus the same loading/error flags SeriesPane renders.
function useSeries(sel: { symbol: string; dataset: string } | null) {
  const [points, setPoints] = useState<SeriesPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!sel) { setPoints(null); return; }
    let dead = false;
    setLoading(true); setError(false);
    fetchMacroSeries(sel.symbol, sel.dataset)
      .then((p) => { if (!dead) setPoints(p); })
      .catch(() => { if (!dead) { setPoints([]); setError(true); } })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [sel?.symbol, sel?.dataset]);
  return { points, loading, error };
}

// ── ECONOMIC > INDICATORS ──────────────────────────────────────────────────
// The full national-statistics browser: every series the vault holds for a
// country, shelved by category, with its last print and history span. This is
// the superset of the COUNTRIES monitor, which only knows the statistics that
// happen to be scheduled calendar releases.
function IndicatorsView({ prefs, update, search }: MacroViewProps) {
  const { rows, state } = useMacroCatalog();
  const [sel, setSel] = useState<MacroRow | null>(null);
  const { points, loading, error } = useSeries(sel ? { symbol: sel.symbol, dataset: sel.dataset } : null);

  // Detail for the AI screen map (see EconomicCalendarPage's econ publisher).
  useEffect(() => {
    const w = window as unknown as { __lseAiIslands?: Record<string, unknown> };
    (w.__lseAiIslands ||= {}).econ_detail = {
      view: 'indicators', country: prefs.indCountry,
      category_filter: prefs.indCategory || null,
      series_in_catalog: (rows || []).length,
      open_series: sel ? `${sel.country_name} ${sel.name}` : null,
    };
    return () => { if (w.__lseAiIslands) delete w.__lseAiIslands.econ_detail; };
  }, [prefs.indCountry, prefs.indCategory, rows, sel]);

  const countries = useMemo(() => {
    const m = new Map<string, { code: string; name: string; count: number }>();
    for (const r of rows || []) {
      if (r.dataset !== 'economics' || !r.country) continue;
      const e = m.get(r.country);
      if (e) e.count++;
      else m.set(r.country, { code: r.country, name: r.country_name || r.country, count: 1 });
    }
    // Most-covered countries first: the depth of a country's series set is the
    // best available proxy for how likely it is to be the one wanted.
    return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [rows]);

  const mine = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || [])
      .filter((r) => r.dataset === 'economics' && r.country === prefs.indCountry)
      .filter((r) => !prefs.indCategory || r.category === prefs.indCategory)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [rows, prefs.indCountry, prefs.indCategory, search]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows || []) {
      if (r.dataset !== 'economics' || r.country !== prefs.indCountry) continue;
      m.set(r.category, (m.get(r.category) || 0) + 1);
    }
    return [...m.keys()].sort();
  }, [rows, prefs.indCountry]);

  if (state !== 'ok') return <div style={{ flex: 1 }}><MacroState state={state} what="the indicator catalog" /></div>;

  const cols = 'minmax(200px,1fr) minmax(120px,180px) 110px 90px 90px 80px 70px';
  const minW = 780;
  const cell = { fontVariantNumeric: 'tabular-nums' as const, textAlign: 'right' as const,
                 fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5 };
  const country = countries.find((c) => c.code === prefs.indCountry);

  return (
    <>
      <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 6px', flexWrap: 'wrap' }}>
          <CountryPicker countries={countries} value={prefs.indCountry}
            onChange={(code) => { update({ indCountry: code, indCategory: '' }); setSel(null); }} />
          <select value={prefs.indCategory} onChange={(e) => update({ indCategory: e.target.value })}
            style={{ background: C.bg, color: C.text, border: `1px solid ${C.edge}`, borderRadius: 3, padding: '4px 8px', maxWidth: 260 }}>
            <option value="">All categories ({categories.length})</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <span style={{ color: C.dim, fontSize: 11 }}>
            {mine.length} series · {country?.count || 0} for {country?.name || prefs.indCountry} · click a row for the full history
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', minWidth: minW,
                      padding: '5px 12px', position: 'sticky', top: 0, zIndex: 10,
                      background: C.bg, borderBottom: `1px solid ${C.edge}`,
                      color: C.dim, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {/* Source, not category: for most countries the category is 1:1 with
              the series name (338 categories over 338 US series), so it read
              as the same column twice. The category is still the filter. */}
          <span>Series</span><span>Source</span>
          <span style={{ textAlign: 'right' }}>Latest</span>
          <span style={{ textAlign: 'right' }}>1Y %</span>
          <span style={{ textAlign: 'right' }}>Last</span>
          <span style={{ textAlign: 'right' }}>Freq</span>
          <span style={{ textAlign: 'right' }}>Obs</span>
        </div>

        {mine.map((r) => {
          const on = sel?.symbol === r.symbol;
          return (
            <div key={r.symbol} onClick={() => setSel(r)} title={`${r.category} · ${r.symbol}`}
              style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', minWidth: minW,
                       padding: '3px 12px', cursor: 'pointer', borderBottom: `1px solid ${C.edge}`,
                       background: on ? C.active : 'transparent',
                       borderLeft: on ? `2px solid ${C.actual}` : '2px solid transparent' }}
              onMouseEnter={(ev) => { if (!on) (ev.currentTarget as HTMLElement).style.background = C.edge; }}
              onMouseLeave={(ev) => { if (!on) (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <span style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(r)}</span>
              <span style={{ fontSize: 11, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={r.source}>{r.source}</span>
              <span style={{ ...cell, color: C.text, fontSize: 12 }}>{fmtMacro(r.last_value, r.unit)}</span>
              <span style={{ ...cell, color: !r.change_1y ? C.dim : r.change_1y > 0 ? C.up : C.down }}
                title={fmtChange1y(r.change_1y).title}>{fmtChange1y(r.change_1y).text}</span>
              <span style={{ ...cell, color: C.dim, fontFamily: 'inherit' }}>{r.last}</span>
              <span style={{ ...cell, color: C.dim, fontFamily: 'inherit' }}>{r.frequency}</span>
              <span style={{ ...cell, color: C.dim }}>{r.obs ?? ''}</span>
            </div>
          );
        })}
        {mine.length === 0 && <div style={{ padding: 30, color: C.dim }}>No series match the filter.</div>}
      </div>

      {sel && (
        <SeriesPane title={sel.name}
          subtitle={`${sel.country_name} · ${sel.category} · ${sel.frequency}${sel.source ? ` · ${sel.source}` : ''}`}
          unit={sel.unit} points={points} loading={loading} error={error}
          range={prefs.macroRange} onRange={(r) => update({ macroRange: r })}
          onClose={() => setSel(null)} />
      )}
    </>
  );
}

// ── ECONOMIC > BOND YIELDS ─────────────────────────────────────────────────
// Two things a rates desk actually looks at: the selected country's whole
// curve (today against a month and a year ago, which is where steepening
// shows), and the cross-country board of one tenor. The curve needs history
// per tenor, so a country switch fetches its tenors in parallel; the board
// needs none (the catalog carries each symbol's last print and its changes).
function YieldsView({ prefs, update, search }: MacroViewProps) {
  const { rows, state } = useMacroCatalog();
  const [mode, setMode] = useState<'curve' | 'board'>('curve');
  const [boardTenor, setBoardTenor] = useState('10Y');
  const [sel, setSel] = useState<MacroRow | null>(null);
  const { points, loading, error } = useSeries(sel ? { symbol: sel.symbol, dataset: 'bonds' } : null);
  // symbol -> its last ~2 years of closes, for the historical curves and the
  // per-tenor change columns. Filled per country selection, kept for the
  // session (the engine caches the same requests for 10 minutes).
  const [hist, setHist] = useState<Record<string, SeriesPoint[]>>({});
  const [histLoading, setHistLoading] = useState(false);

  const bonds = useMemo(() => (rows || []).filter((r) => r.dataset === 'bonds'), [rows]);

  // Detail for the AI screen map (see EconomicCalendarPage's econ publisher).
  useEffect(() => {
    const w = window as unknown as { __lseAiIslands?: Record<string, unknown> };
    (w.__lseAiIslands ||= {}).econ_detail = {
      view: 'bond yields', mode,
      country: prefs.bondCountry,
      board_tenor: mode === 'board' ? boardTenor : null,
      bond_series_in_catalog: bonds.length,
      open_series: sel ? `${sel.country_name} ${sel.name}` : null,
    };
    return () => { if (w.__lseAiIslands) delete w.__lseAiIslands.econ_detail; };
  }, [mode, prefs.bondCountry, boardTenor, bonds.length, sel]);

  const countries = useMemo(() => {
    const m = new Map<string, { code: string; name: string; count: number }>();
    for (const r of bonds) {
      const e = m.get(r.country);
      if (e) e.count++;
      else m.set(r.country, { code: r.country, name: r.country_name || r.country, count: 1 });
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [bonds]);

  const tenors = useMemo(() => bonds
    .filter((r) => r.country === prefs.bondCountry)
    .map((r) => ({ row: r, tenor: tenorOf(r) }))
    .sort((a, b) => tenorDays(a.tenor) - tenorDays(b.tenor)), [bonds, prefs.bondCountry]);

  // Curve history: one request per tenor of the selected country (~15 for the
  // deepest curve, ~2 KB each). Deliberately not one bulk call: the vault's
  // series endpoint is single-symbol, and these cache well.
  useEffect(() => {
    if (mode !== 'curve' || !tenors.length) return;
    const want = tenors.map((t) => t.row.symbol).filter((s) => !(s in hist));
    if (!want.length) return;
    let dead = false;
    setHistLoading(true);
    const start = isoDay(addDays(new Date(), -400));
    Promise.all(want.map((sym) =>
      fetchMacroSeries(sym, 'bonds', start)
        .then((p) => [sym, p] as const)
        .catch(() => [sym, [] as SeriesPoint[]] as const)))
      .then((pairs) => {
        if (dead) return;
        setHist((h) => { const n = { ...h }; for (const [s, p] of pairs) n[s] = p; return n; });
      })
      .finally(() => { if (!dead) setHistLoading(false); });
    return () => { dead = true; };
  }, [mode, tenors, hist]);

  if (state !== 'ok') return <div style={{ flex: 1 }}><MacroState state={state} what="government bond yields" /></div>;

  // Value on or before a date, so "a month ago" means the last print that
  // existed then (bond series skip holidays and some tenors print thinly).
  const asOf = (pts: SeriesPoint[] | undefined, day: string): number | null => {
    if (!pts?.length) return null;
    let out: number | null = null;
    for (const p of pts) { if (p.date <= day) out = p.value; else break; }
    return out;
  };
  const monthAgo = isoDay(addDays(new Date(), -30));
  const yearAgo = isoDay(addDays(new Date(), -365));

  const curve = tenors.map(({ row, tenor }) => {
    const pts = hist[row.symbol];
    const last = pts?.length ? pts[pts.length - 1] : null;
    const prev = pts && pts.length > 1 ? pts[pts.length - 2].value : null;
    const now = last?.value ?? row.last_value;
    return {
      row, tenor, now, date: last?.date || row.last,
      d1: now != null && prev != null ? now - prev : null,
      m1: now != null ? (() => { const v = asOf(pts, monthAgo); return v == null ? null : now - v; })() : null,
      y1: now != null ? (() => { const v = asOf(pts, yearAgo); return v == null ? null : now - v; })() : null,
      mAgo: asOf(pts, monthAgo), yAgo: asOf(pts, yearAgo),
      spark: (pts || []).map((p) => p.value),
    };
  });
  // The chart is the NOMINAL curve. Inflation-linked tenors (TIPS and the
  // other linkers) quote a REAL yield ~2pp lower, so leaving them in sequence
  // made the line saw-tooth at every linked maturity; they plot as their own
  // series against the same maturity axis instead, which is also how the
  // breakeven (nominal minus real at a maturity) becomes readable. The table
  // below still lists every tenor.
  const isLinker = (t: string) => t.includes(' ');
  const curveAxis = curve.filter((c) => !isLinker(c.tenor));
  const realAt = (tenor: string) =>
    curve.find((c) => isLinker(c.tenor) && c.tenor.split(' ')[0] === tenor)?.now ?? null;
  const hasReal = curve.some((c) => isLinker(c.tenor));
  // The comparison curves only make sense over the same tenors that have a
  // reading then; a tenor missing history drops out of that line, not the chart.
  const curveOption = {
    backgroundColor: 'transparent', animation: false,
    legend: { top: 0, right: 8, icon: 'roundRect', itemWidth: 10, itemHeight: 4,
              textStyle: { color: C.dim, fontSize: 10 } },
    grid: { left: 8, right: 16, top: 26, bottom: 6, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(21,22,25,.96)', borderColor: C.edge,
               textStyle: { color: C.text, fontSize: 11 },
               valueFormatter: (v: any) => (v == null ? '—' : `${Number(v).toFixed(3)}%`) },
    xAxis: { type: 'category', data: curveAxis.map((c) => c.tenor),
             axisLine: { lineStyle: { color: C.edge } }, axisTick: { show: false },
             axisLabel: { color: C.dim, fontSize: 10 } },
    yAxis: { type: 'value', scale: true,
             axisLabel: { color: C.dim, fontSize: 10, formatter: (v: number) => `${v.toFixed(2)}%` },
             splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)', type: 'dashed' } } },
    series: [
      { name: 'Latest', type: 'line', data: curveAxis.map((c) => c.now), connectNulls: true,
        lineStyle: { color: C.actual, width: 2 }, itemStyle: { color: C.actual }, symbol: 'circle', symbolSize: 5 },
      { name: '1M ago', type: 'line', data: curveAxis.map((c) => c.mAgo), connectNulls: true,
        lineStyle: { color: C.consensus, width: 1.5, type: 'dashed' }, itemStyle: { color: C.consensus }, symbol: 'none' },
      { name: '1Y ago', type: 'line', data: curveAxis.map((c) => c.yAgo), connectNulls: true,
        lineStyle: { color: C.previous, width: 1.5, type: 'dotted' }, itemStyle: { color: C.previous }, symbol: 'none' },
      ...(hasReal ? [{
        name: 'Real (linked)', type: 'line', data: curveAxis.map((c) => realAt(c.tenor)),
        connectNulls: true, lineStyle: { color: C.up, width: 1.5 }, itemStyle: { color: C.up },
        symbol: 'circle', symbolSize: 4,
      }] : []),
    ],
  };

  // Cross-country board for one tenor, straight off the catalog.
  const q = search.trim().toLowerCase();
  const board = bonds
    .filter((r) => tenorOf(r) === boardTenor)
    .filter((r) => !q || (r.country_name || '').toLowerCase().includes(q))
    .sort((a, b) => (b.last_value ?? -99) - (a.last_value ?? -99));
  const boardTenors = [...new Set(bonds.map(tenorOf))].sort((a, b) => tenorDays(a) - tenorDays(b));

  const cell = { fontVariantNumeric: 'tabular-nums' as const, textAlign: 'right' as const,
                 fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5 };
  // Yield moves read in basis points. The sign follows the ROUNDED value, so a
  // -0.2bp move prints "0bp" in the neutral colour instead of a red "-0bp".
  const chg = (v: number | null) => {
    const bp = v == null ? null : Math.round(v * 100);
    return (
      <span style={{ ...cell, color: bp == null || bp === 0 ? C.dim : bp > 0 ? C.up : C.down }}>
        {bp == null ? '' : `${bp > 0 ? '+' : ''}${bp}bp`}
      </span>
    );
  };
  const cols = '90px minmax(120px,1fr) 100px 80px 80px 80px 90px';
  const minW = 640;

  return (
    <>
      <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 6px', flexWrap: 'wrap' }}>
          <Seg value={mode} onChange={(k) => { setMode(k as 'curve' | 'board'); setSel(null); }}
            options={[{ key: 'curve', label: 'Curve' }, { key: 'board', label: 'Cross-country' }]} />
          {mode === 'curve' ? (
            <CountryPicker countries={countries} value={prefs.bondCountry}
              onChange={(code) => { update({ bondCountry: code }); setSel(null); }} />
          ) : (
            <select value={boardTenor} onChange={(e) => setBoardTenor(e.target.value)}
              style={{ background: C.bg, color: C.text, border: `1px solid ${C.edge}`, borderRadius: 3, padding: '4px 8px' }}>
              {boardTenors.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <span style={{ color: C.dim, fontSize: 11 }}>
            {mode === 'curve'
              ? `${tenors.length} tenors · daily closes back to ${tenors[0]?.row.first?.slice(0, 4) || '—'}${histLoading ? ' · loading curve…' : ''}`
              : `${board.length} countries · ${boardTenor} government yield`}
          </span>
        </div>

        {mode === 'curve' && (
          <>
            <div style={{ padding: '0 12px 8px' }}>
              <div style={{ background: C.panel, border: `1px solid ${C.edge}` }}>
                <CurveChart option={curveOption} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center',
                          padding: '5px 12px', position: 'sticky', top: 0, zIndex: 10,
                          background: C.bg, borderBottom: `1px solid ${C.edge}`,
                          color: C.dim, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>
              <span>Tenor</span><span>Trend (1Y)</span>
              <span style={{ textAlign: 'right' }}>Yield</span>
              <span style={{ textAlign: 'right' }}>1D</span>
              <span style={{ textAlign: 'right' }}>1M</span>
              <span style={{ textAlign: 'right' }}>1Y</span>
              <span style={{ textAlign: 'right' }}>As of</span>
            </div>
            {curve.map((c) => {
              const on = sel?.symbol === c.row.symbol;
              return (
                <div key={c.row.symbol} onClick={() => setSel(c.row)}
                  style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', minWidth: minW,
                           padding: '3px 12px', cursor: 'pointer', borderBottom: `1px solid ${C.edge}`,
                           background: on ? C.active : 'transparent',
                           borderLeft: on ? `2px solid ${C.actual}` : '2px solid transparent' }}
                  onMouseEnter={(ev) => { if (!on) (ev.currentTarget as HTMLElement).style.background = C.edge; }}
                  onMouseLeave={(ev) => { if (!on) (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  <span style={{ fontSize: 11.5 }}>{c.tenor}</span>
                  {c.spark.length > 1 ? <Spark values={c.spark} /> : <span />}
                  <span style={{ ...cell, color: C.text, fontSize: 12 }}>{c.now == null ? '—' : `${c.now.toFixed(3)}%`}</span>
                  {chg(c.d1)}{chg(c.m1)}{chg(c.y1)}
                  <span style={{ ...cell, color: C.dim, fontFamily: 'inherit' }}>{c.date}</span>
                </div>
              );
            })}
            {tenors.length === 0 && <div style={{ padding: 30, color: C.dim }}>No yield curve for this country.</div>}
          </>
        )}

        {mode === 'board' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '170px 110px 90px 90px 110px', gap: 8, alignItems: 'center', minWidth: 600,
                          padding: '5px 12px', position: 'sticky', top: 0, zIndex: 10,
                          background: C.bg, borderBottom: `1px solid ${C.edge}`,
                          color: C.dim, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>
              <span>Country</span>
              <span style={{ textAlign: 'right' }}>Yield</span>
              <span style={{ textAlign: 'right' }}>1D %</span>
              <span style={{ textAlign: 'right' }}>1Y %</span>
              <span style={{ textAlign: 'right' }}>As of</span>
            </div>
            {board.map((r) => {
              const on = sel?.symbol === r.symbol;
              return (
                <div key={r.symbol} onClick={() => setSel(r)}
                  style={{ display: 'grid', gridTemplateColumns: '170px 110px 90px 90px 110px', gap: 8, alignItems: 'center', minWidth: 600,
                           padding: '3px 12px', cursor: 'pointer', borderBottom: `1px solid ${C.edge}`,
                           background: on ? C.active : 'transparent',
                           borderLeft: on ? `2px solid ${C.actual}` : '2px solid transparent' }}
                  onMouseEnter={(ev) => { if (!on) (ev.currentTarget as HTMLElement).style.background = C.edge; }}
                  onMouseLeave={(ev) => { if (!on) (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  <span style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <Flag code={r.country} /> {r.country_name}
                  </span>
                  <span style={{ ...cell, color: C.text, fontSize: 12 }}>{r.last_value == null ? '—' : `${r.last_value.toFixed(3)}%`}</span>
                  {/* The catalog's changes are percent moves in the yield, not
                      basis points, so they are labelled as percent here. */}
                  <span style={{ ...cell, color: !r.change_pct ? C.dim : r.change_pct > 0 ? C.up : C.down }}>
                    {r.change_pct == null ? '' : `${r.change_pct > 0 ? '+' : ''}${r.change_pct.toFixed(2)}%`}
                  </span>
                  <span style={{ ...cell, color: !r.change_1y ? C.dim : r.change_1y > 0 ? C.up : C.down }}>
                    {r.change_1y == null ? '' : `${r.change_1y > 0 ? '+' : ''}${r.change_1y.toFixed(1)}%`}
                  </span>
                  <span style={{ ...cell, color: C.dim, fontFamily: 'inherit' }}>{r.last}</span>
                </div>
              );
            })}
            {board.length === 0 && <div style={{ padding: 30, color: C.dim }}>No country carries this tenor.</div>}
          </>
        )}
      </div>

      {sel && (
        <SeriesPane title={`${sel.country_name} ${tenorOf(sel)}`}
          subtitle={`Government bond yield · daily close · ${sel.first} to ${sel.last}`}
          unit="percent" points={points} loading={loading} error={error}
          range={prefs.macroRange} onRange={(r) => update({ macroRange: r })}
          onClose={() => setSel(null)} />
      )}
    </>
  );
}

// The yield curve is the one chart here that is not a time series, so it gets
// its own small echarts host rather than reusing SeriesPane.
function CurveChart({ option }: { option: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const i = echarts.init(ref.current);
    inst.current = i;
    const ro = new ResizeObserver(() => i.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); i.dispose(); inst.current = null; };
  }, []);
  useEffect(() => { inst.current?.setOption(option, { notMerge: true }); }, [option]);
  return <div ref={ref} style={{ width: '100%', height: 230 }} />;
}

// ── ECONOMIC > CENTRAL BANKS ───────────────────────────────────────────────
// There is no "central banks" dataset; a central bank is what the policy-rate
// series' publisher field says it is. So the board is built from every
// Interest Rate series (145 countries), joined by country to the other
// statistics the bank owns (balance sheet, money supply, reserves) and to the
// calendar's rate decisions.
function BanksView({ prefs, update, search }: MacroViewProps) {
  const { rows, state } = useMacroCatalog();
  const [sel, setSel] = useState<MacroRow | null>(null);
  const { points, loading, error } = useSeries(sel ? { symbol: sel.symbol, dataset: 'economics' } : null);
  const [decisions, setDecisions] = useState<EconEvent[] | null>(null);

  // Detail for the AI screen map (see EconomicCalendarPage's econ publisher).
  useEffect(() => {
    const w = window as unknown as { __lseAiIslands?: Record<string, unknown> };
    (w.__lseAiIslands ||= {}).econ_detail = {
      view: 'central banks',
      open_series: sel ? `${sel.country_name} ${sel.name}` : null,
      rate_decisions_loaded: decisions ? decisions.length : null,
    };
    return () => { if (w.__lseAiIslands) delete w.__lseAiIslands.econ_detail; };
  }, [sel, decisions]);

  const eco = useMemo(() => (rows || []).filter((r) => r.dataset === 'economics'), [rows]);
  const byCountry = useMemo(() => {
    const m = new Map<string, MacroRow[]>();
    for (const r of eco) {
      if (!m.has(r.country)) m.set(r.country, []);
      m.get(r.country)!.push(r);
    }
    return m;
  }, [eco]);

  const pick = (cc: string, category: string) =>
    (byCountry.get(cc) || []).find((r) => r.category === category) || null;

  const banks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eco
      .filter((r) => r.category === 'Interest Rate')
      .map((r) => ({
        rate: r,
        bank: r.source || `${r.country_name} central bank`,
        sheet: pick(r.country, 'Central Bank Balance Sheet'),
        m2: pick(r.country, 'Money Supply M2'),
        fx: pick(r.country, 'Foreign Exchange Reserves'),
        cpi: pick(r.country, 'Inflation Rate'),
      }))
      .filter((b) => !q || b.bank.toLowerCase().includes(q) ||
                     (b.rate.country_name || '').toLowerCase().includes(q))
      // The banks whose decisions move every other market first, then the rest
      // alphabetically: a pure A-Z board opens on Albania and buries the Fed.
      .sort((x, y) => {
        const rank = (cc: string) => {
          const i = BANK_MAJORS.indexOf(cc);
          return i === -1 ? BANK_MAJORS.length : i;
        };
        return rank(x.rate.country) - rank(y.rate.country) ||
          (x.rate.country_name || '').localeCompare(y.rate.country_name || '');
      });
  }, [eco, byCountry, search]);

  // Rate decisions for the open bank, from the calendar feed. Best effort:
  // the calendar's region codes are its own (GB and UK both occur, the euro
  // area is EA), so a country with no matching code simply shows no schedule
  // rather than an error.
  const selCountry = sel?.country || '';
  useEffect(() => {
    if (!selCountry) { setDecisions(null); return; }
    let dead = false;
    setDecisions(null);
    const codes = selCountry === 'GB' ? ['GB', 'UK'] : [selCountry];
    fetchCalendar({ region: codes.join(','), event: 'Interest Rate Decision',
                    start: isoDay(addDays(new Date(), -365 * 2)),
                    end: isoDay(addDays(new Date(), 120)), order: 'asc', limit: '200' })
      .then((r) => { if (!dead) setDecisions(r); })
      .catch(() => { if (!dead) setDecisions([]); });
    return () => { dead = true; };
  }, [selCountry]);

  if (state !== 'ok') return <div style={{ flex: 1 }}><MacroState state={state} what="the central bank board" /></div>;

  const cell = { fontVariantNumeric: 'tabular-nums' as const, textAlign: 'right' as const,
                 fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5 };
  const cols = 'minmax(200px,1fr) 150px 90px 90px 110px 110px 100px';
  const minW = 860;
  const selBank = banks.find((b) => b.rate.symbol === sel?.symbol);

  const today = isoDay(new Date());
  const nextDecision = (decisions || []).find((d) => d.date >= today && !d.actual);
  const pastDecisions = (decisions || []).filter((d) => d.actual).slice(-6).reverse();

  return (
    <>
      <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 12px 6px' }}>
          <b style={{ fontSize: 13 }}>Policy rates</b>
          <span style={{ color: C.dim, fontSize: 11 }}>
            {banks.length} central banks · policy rate with the balance sheet, money supply and reserves each bank publishes · click a row for the rate history and its decision schedule
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', minWidth: minW,
                      padding: '5px 12px', position: 'sticky', top: 0, zIndex: 10,
                      background: C.bg, borderBottom: `1px solid ${C.edge}`,
                      color: C.dim, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          <span>Central bank</span><span>Country</span>
          <span style={{ textAlign: 'right' }}>Policy rate</span>
          <span style={{ textAlign: 'right' }}>Inflation</span>
          <span style={{ textAlign: 'right' }}>Balance sheet</span>
          <span style={{ textAlign: 'right' }}>Money supply M2</span>
          <span style={{ textAlign: 'right' }}>As of</span>
        </div>

        {banks.map((b) => {
          const on = sel?.symbol === b.rate.symbol;
          // Real rate: the policy rate minus headline inflation, the one
          // derived number a rates board is read for. Only shown when both
          // legs are percent-shaped.
          return (
            <div key={b.rate.symbol} onClick={() => setSel(b.rate)}
              title={b.sheet?.unit ? `Balance sheet in ${b.sheet.unit}` : undefined}
              style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', minWidth: minW,
                       padding: '3px 12px', cursor: 'pointer', borderBottom: `1px solid ${C.edge}`,
                       background: on ? C.active : 'transparent',
                       borderLeft: on ? `2px solid ${C.actual}` : '2px solid transparent' }}
              onMouseEnter={(ev) => { if (!on) (ev.currentTarget as HTMLElement).style.background = C.edge; }}
              onMouseLeave={(ev) => { if (!on) (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <span style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.bank}</span>
              <span style={{ fontSize: 11, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Flag code={b.rate.country} /> {b.rate.country_name}
              </span>
              <span style={{ ...cell, color: C.text, fontSize: 12 }}>{fmtMacro(b.rate.last_value, b.rate.unit)}</span>
              <span style={{ ...cell, color: C.dim }}>{b.cpi ? fmtMacro(b.cpi.last_value, b.cpi.unit) : ''}</span>
              {/* Balance sheet and money supply are quoted in each country's
                  own currency and scale (USD Million, GBP Million, ...), so the
                  unit rides on the cell rather than the column header, which
                  cannot be right for every row. */}
              <span style={{ ...cell, color: C.dim }} title={b.sheet?.unit || ''}>{b.sheet ? fmtMacro(b.sheet.last_value, b.sheet.unit) : ''}</span>
              <span style={{ ...cell, color: C.dim }} title={b.m2?.unit || ''}>{b.m2 ? fmtMacro(b.m2.last_value, b.m2.unit) : ''}</span>
              <span style={{ ...cell, color: C.dim, fontFamily: 'inherit' }}>{b.rate.last}</span>
            </div>
          );
        })}
        {banks.length === 0 && <div style={{ padding: 30, color: C.dim }}>No central bank matches the filter.</div>}
      </div>

      {sel && (
        <SeriesPane title={selBank?.bank || sel.name}
          subtitle={`${sel.country_name} policy rate · ${sel.first} to ${sel.last}`}
          unit={sel.unit} points={points} loading={loading} error={error}
          range={prefs.macroRange} onRange={(r) => update({ macroRange: r })}
          onClose={() => setSel(null)}
          extra={
            <div style={{ borderTop: `1px solid ${C.edge}`, maxHeight: '38%', overflowY: 'auto', flex: 'none' }}>
              {/* Decisions from the calendar feed, and the rest of the bank's
                  own statistics, each clickable into this same pane. */}
              <div style={{ padding: '6px 12px 2px', color: C.dim, fontSize: 9.5,
                            letterSpacing: '.06em', textTransform: 'uppercase' }}>Rate decisions</div>
              {decisions === null && <div style={{ padding: '2px 12px 6px', color: C.dim, fontSize: 11 }}>Loading schedule…</div>}
              {decisions !== null && !decisions.length && (
                <div style={{ padding: '2px 12px 6px', color: C.dim, fontSize: 11 }}>
                  The calendar feed carries no rate decisions for this country.
                </div>
              )}
              {nextDecision && (
                <div style={{ display: 'flex', gap: 8, padding: '2px 12px', fontSize: 11 }}>
                  <span style={{ color: C.consensus }}>Next</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{nextDecision.date}</span>
                  <span style={{ color: C.dim }}>{nextDecision.time || ''}</span>
                  {nextDecision.consensus && <span style={{ marginLeft: 'auto', color: C.dim }}>exp {nextDecision.consensus}</span>}
                </div>
              )}
              {pastDecisions.map((d) => (
                <div key={d.id} style={{ display: 'flex', gap: 8, padding: '2px 12px', fontSize: 11, color: C.dim }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{d.date}</span>
                  <span style={{ color: C.text }}>{d.actual}</span>
                  <span>was {d.previous || '—'}</span>
                </div>
              ))}
              <div style={{ padding: '8px 12px 2px', color: C.dim, fontSize: 9.5,
                            letterSpacing: '.06em', textTransform: 'uppercase' }}>Bank statistics</div>
              {(byCountry.get(sel.country) || [])
                .filter((r) => CB_CATEGORIES.includes(r.category) && r.symbol !== sel.symbol)
                .sort((a, b) => CB_CATEGORIES.indexOf(a.category) - CB_CATEGORIES.indexOf(b.category))
                .map((r) => (
                  <div key={r.symbol} onClick={() => setSel(r)}
                    style={{ display: 'flex', gap: 8, padding: '2px 12px', fontSize: 11, cursor: 'pointer' }}
                    onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = C.edge; }}
                    onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                    <span style={{ color: C.dim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.category}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMacro(r.last_value, r.unit)}</span>
                    <span style={{ color: C.dim, fontSize: 10 }}>{r.last}</span>
                  </div>
                ))}
            </div>
          } />
      )}
    </>
  );
}
