// ============================================================================
// DataViz.tsx - WORKSPACE > DATA VISUALISATION.
//
// A chart builder for arbitrary tabular data: pick a MY DATA dataset, paste
// rows, or drop a file anywhere on the page; the page types the columns,
// scores which chart forms fit (dataviz/model.ts), builds the chart (echarts
// for the 2D forms, dataviz/engine3d.ts - our own canvas renderer - for the
// 3D ones) and exports PNG/SVG. All data handling is client-side except two
// things the browser cannot do: reading parquet/xlsx/feather (POST
// /api/dataviz/parse) and reading a library dataset's stored CSV
// (GET /api/data/{symbol}/rows).
//
// Layout (goal: intuitive picking with a live preview):
// a left inspector holding data sources and an icon-tile chart gallery with
// LIVE HOVER PREVIEW (hovering a tile renders the current data in that form
// immediately; click commits), a slim encoding bar, and a canvas card. The
// empty state is a real landing card with a drop zone, never a bare page.
//
// echarts is driven directly (init/setOption/ResizeObserver), same as
// EconomicCalendar.tsx and for the same reason: the echarts-for-react wrapper
// mis-renders inside this IIFE bundle. Do not "simplify" to <ReactECharts>.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  Table, ChartType, Encoding, CHART_LABELS, CHART_GROUPS, CHART_ICONS, is3D,
  parsePasted, recommend, autoEncode, rolesFor, missingRoles, canAutoEncode,
  PALETTES, SEQ_LIGHT, SEQ_DARK,
} from '@/dataviz/model';
import { buildOption, Chrome } from '@/dataviz/options';
import { Engine3D, spec3dFrom } from '@/dataviz/engine3d';

// Terminal chrome tokens off the shell's css variables, read per render pass
// via a helper (not module init) because entering the page can follow a theme
// switch in the same session.
const cssVar = (name: string, fallback: string): string =>
  (typeof document !== 'undefined' &&
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

const isDark = () => document.documentElement.classList.contains('dark');

function chromeNow(paletteIdx: number): Chrome {
  const dark = isDark();
  const pal = PALETTES[paletteIdx] || PALETTES[0];
  return {
    ink: cssVar('--text', dark ? '#e8e8e8' : '#23262b'),
    dim: cssVar('--dim', dark ? '#b0b0b0' : '#43474e'),
    edge: cssVar('--edge', dark ? '#2e2e2e' : '#e3e5e9'),
    panel: cssVar('--panel', dark ? '#1a1a1a' : '#ffffff'),
    up: cssVar('--up', '#21b3a4'), down: cssVar('--down', '#f0426c'),
    palette: dark ? pal.dark : pal.light,
    seq: dark ? SEQ_DARK : SEQ_LIGHT,
  };
}

type LibEntry = { symbol: string; name: string; kind: string; rows: number; folder: string };

// The page's look lives in one scoped stylesheet (dv- prefix) instead of a
// hundred inline style objects: hover/active/focus states need real CSS, and
// the calm-surface look (soft radii, hairline borders, 120ms ease) has to be
// consistent across every control to read as one designed thing.
const CSS = `
#dataviz .dv-root { display:flex; height:100%; min-height:0; background:var(--bg); color:var(--text);
  -webkit-font-smoothing:antialiased; font-family:-apple-system,"SF Pro Display","SF Pro Text",Inter,system-ui,sans-serif; }
#dataviz .dv-side { width:288px; min-width:288px; display:flex; flex-direction:column; gap:10px;
  padding:12px 10px 12px 12px; overflow-y:auto; border-right:1px solid var(--edge); }
#dataviz .dv-card { background:var(--panel); border:1px solid var(--edge); border-radius:12px;
  box-shadow:0 1px 2px rgba(0,0,0,.14); }
#dataviz .dv-h { padding:10px 12px 6px; font-size:10.5px; letter-spacing:.09em; color:var(--dim);
  text-transform:uppercase; font-weight:600; }
#dataviz .dv-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px;
  background:var(--bg2); color:var(--text); border:1px solid var(--edge); border-radius:9px;
  padding:6px 12px; font-size:12px; cursor:pointer; transition:background .12s ease,border-color .12s ease,opacity .12s ease;
  font-family:inherit; }
#dataviz .dv-btn:hover:not(:disabled) { background:var(--active); border-color:var(--dim); }
#dataviz .dv-btn:disabled { opacity:.35; cursor:default; }
#dataviz .dv-btn.dv-primary { background:var(--accent-bar); border-color:var(--accent-bar); color:var(--bg); font-weight:600; }
#dataviz .dv-btn.dv-primary:hover:not(:disabled) { opacity:.88; background:var(--accent-bar); }
#dataviz .dv-select { background:var(--bg2); color:var(--text); border:1px solid var(--edge);
  border-radius:8px; padding:5px 8px; font-size:12px; max-width:150px; font-family:inherit; }
#dataviz .dv-select:hover { border-color:var(--dim); }
#dataviz .dv-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:4px; padding:6px 8px 10px; }
#dataviz .dv-tile { display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 2px 6px;
  border-radius:10px; border:1px solid transparent; background:transparent; color:var(--dim); cursor:pointer;
  transition:background .12s ease,color .12s ease,border-color .12s ease; font-family:inherit; }
#dataviz .dv-tile:hover { background:var(--active); color:var(--text); }
#dataviz .dv-tile.dv-on { background:var(--active); border-color:var(--accent-bar); color:var(--text); }
#dataviz .dv-tile svg { width:21px; height:21px; }
#dataviz .dv-tile .dv-lbl { font-size:9px; line-height:1.1; text-align:center; letter-spacing:.01em; }
#dataviz .dv-tile.dv-dis { opacity:.32; pointer-events:none; }
#dataviz .dv-dot { display:inline-block; width:5px; height:5px; border-radius:50%; background:var(--up); margin-left:4px; vertical-align:1px; }
#dataviz .dv-row { padding:6px 9px; border-radius:9px; cursor:pointer; font-size:12px; display:flex;
  justify-content:space-between; gap:8px; align-items:baseline; transition:background .12s ease; }
#dataviz .dv-row:hover { background:var(--active); }
#dataviz .dv-row.dv-on { background:var(--active); }
#dataviz .dv-send { font-size:9px; letter-spacing:.06em; color:var(--dim); background:transparent;
  border:1px solid var(--edge); border-radius:6px; padding:1px 6px; cursor:pointer; flex-shrink:0;
  opacity:0; transition:opacity .12s ease, color .12s ease; }
#dataviz .dv-row:hover .dv-send, #dataviz .dv-row.dv-on .dv-send { opacity:1; }
#dataviz .dv-send:hover { color:var(--text); border-color:var(--dim); }
#dataviz .dv-meta { color:var(--dim); font-size:10px; flex-shrink:0; font-family:"SF Mono",ui-monospace,monospace; }
#dataviz .dv-bar { display:flex; align-items:center; gap:8px; padding:9px 14px; border-bottom:1px solid var(--edge);
  flex-wrap:wrap; min-height:46px; }
#dataviz .dv-role { display:inline-flex; gap:5px; align-items:center; }
#dataviz .dv-role label { font-size:10.5px; color:var(--dim); text-transform:uppercase; letter-spacing:.05em; }
#dataviz .dv-canvas-wrap { flex:1; position:relative; min-height:0; margin:12px; }
#dataviz .dv-canvas-card { position:absolute; inset:0; background:var(--panel); border:1px solid var(--edge);
  border-radius:14px; box-shadow:0 1px 3px rgba(0,0,0,.16); overflow:hidden; }
#dataviz .dv-hero { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
#dataviz .dv-hero-card { text-align:center; max-width:430px; padding:36px 44px; border:1.5px dashed var(--edge);
  border-radius:16px; transition:border-color .15s ease,background .15s ease; }
#dataviz .dv-hero-card.dv-drag { border-color:var(--accent-bar); background:var(--active); }
#dataviz .dv-hero-t { font-size:15px; font-weight:600; margin-bottom:6px; }
#dataviz .dv-hero-s { font-size:12px; color:var(--dim); line-height:1.55; margin-bottom:18px; }
#dataviz .dv-err { margin:8px 14px 0; padding:7px 12px; border-radius:9px; background:color-mix(in srgb,var(--down) 12%,transparent);
  color:var(--down); font-size:12px; }
#dataviz .dv-cols { padding:0 12px 10px; font-size:11.5px; }
#dataviz .dv-col { display:flex; justify-content:space-between; gap:8px; padding:2.5px 0; }
#dataviz .dv-type { color:var(--dim); font-size:9.5px; font-family:"SF Mono",ui-monospace,monospace;
  border:1px solid var(--edge); border-radius:5px; padding:0 5px; align-self:center; }
#dataviz .dv-fade { animation:dvfade .18s ease; }
@keyframes dvfade { from { opacity:0; transform:translateY(3px);} to { opacity:1; transform:none;} }
#dataviz textarea.dv-paste { width:100%; background:var(--bg2); color:var(--text); border:1px solid var(--edge);
  border-radius:9px; font-size:11px; font-family:"SF Mono",ui-monospace,monospace; padding:8px; resize:vertical; }
#dataviz .dv-dropveil { position:absolute; inset:0; z-index:30; display:flex; align-items:center; justify-content:center;
  background:color-mix(in srgb,var(--bg) 55%,transparent); backdrop-filter:blur(2px); border-radius:14px;
  border:2px dashed var(--accent-bar); font-size:14px; font-weight:600; pointer-events:none; }
`;

// Tiles are the ONLY place a pictogram appears: chart-form glyphs carry real
// information there. Everything else (buttons, the landing card) is text-only,
// per the shell's standing rule that glyph prefixes read as decoration.
const Icon = ({ d, size = 21 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
    dangerouslySetInnerHTML={{ __html: d }} />
);

export default function DataVizPage() {
  const [table, setTable] = useState<Table | null>(null);
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [previewType, setPreviewType] = useState<ChartType | null>(null);
  const [enc, setEnc] = useState<Encoding>({ ys: [] });
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [library, setLibrary] = useState<LibEntry[]>([]);
  const [activeSymbol, setActiveSymbol] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [err, setErr] = useState('');
  const [hover, setHover] = useState<{ sx: number; sy: number; text: string } | null>(null);

  const chartRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);
  const eng3dRef = useRef<Engine3D | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const previewTimer = useRef<number>(0);

  const scored = useMemo(() => (table ? recommend(table) : []), [table]);
  const topPicks = useMemo(() => scored.slice(0, 3).map(([t]) => t), [scored]);

  // Live state for the terminal's AI screen map (app.js AI_REGIONS reads
  // window.__lseAiIslands.dataviz): what is loaded and being charted.
  useEffect(() => {
    const w = window as unknown as { __lseAiIslands?: Record<string, unknown> };
    (w.__lseAiIslands ||= {}).dataviz = {
      table: table ? table.source : null,
      rows: table ? table.nrows : null,
      chart_type: chartType,
      y_columns: enc.ys.length,
      library_tables: library.length,
    };
    return () => { if (w.__lseAiIslands) delete w.__lseAiIslands.dataviz; };
  }, [table, chartType, enc.ys.length, library.length]);

  // ── data intake ───────────────────────────────────────────────────────────

  const adopt = useCallback((t: Table) => {
    setErr('');
    setTable(t);
    setTableOpen(false);
    const best = recommend(t)[0]?.[0] || 'bar';
    setChartType(best);
    setEnc(autoEncode(t, best));
  }, []);

  const loadLibrary = useCallback(() => {
    fetch('/api/data').then((r) => r.json()).then(setLibrary).catch(() => {});
  }, []);
  useEffect(loadLibrary, [loadLibrary]);

  const openDataset = useCallback((symbol: string) => {
    setActiveSymbol(symbol);
    fetch('/api/data/' + encodeURIComponent(symbol) + '/rows')
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).detail || r.statusText); return r.json(); })
      .then((j) => adopt({ ...j, source: symbol }))
      .catch((e) => setErr('Could not load ' + symbol + ': ' + e.message));
  }, [adopt]);

  const uploadFile = useCallback((f: File) => {
    const fd = new FormData();
    fd.append('file', f);
    setErr('Reading ' + f.name + '…');
    fetch('/api/dataviz/parse', { method: 'POST', body: fd })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).detail || r.statusText); return r.json(); })
      .then((j) => { setActiveSymbol(''); adopt({ ...j, source: f.name }); })
      .catch((e) => setErr('Could not parse ' + f.name + ': ' + e.message));
  }, [adopt]);

  const loadPaste = useCallback(() => {
    try {
      const t = parsePasted(pasteRef.current?.value || '');
      setActiveSymbol('');
      adopt(t);
      setPasteOpen(false);
    } catch (e: any) { setErr(e.message); }
  }, [adopt]);

  // Drop a file anywhere on the page. stopPropagation matters: the shell has
  // a window-level drop handler that would steal the file into MY DATA.
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) uploadFile(f);
  }, [uploadFile]);

  // ── prefs: palette survives reinstalls with the workspace file ───────────
  useEffect(() => {
    fetch('/api/workspace/dataviz').then((r) => r.json()).then((j) => {
      if (typeof j?.value?.palette === 'number' && PALETTES[j.value.palette]) setPaletteIdx(j.value.palette);
    }).catch(() => {});
  }, []);
  const savePrefs = useCallback((palette: number) => {
    fetch('/api/workspace/dataviz', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ palette }),
    }).catch(() => {}); // hosted mode denies writes; prefs just stay session-local
  }, []);

  // ── render: one echarts instance and one 3D engine, each living exactly
  // once; which is visible follows the displayed form. ─────────────────────
  useEffect(() => {
    if (!chartRef.current || !canvasRef.current) return;
    const inst = echarts.init(chartRef.current);
    instRef.current = inst;
    const eng = new Engine3D(canvasRef.current, { ...chromeNow(0) });
    eng3dRef.current = eng;
    eng.onHover = setHover;
    const ro = new ResizeObserver(() => { inst.resize(); eng.resize(); });
    ro.observe(chartRef.current.parentElement!);
    eng.resize();
    return () => { ro.disconnect(); inst.dispose(); eng.destroy(); instRef.current = null; eng3dRef.current = null; };
  }, []);

  // The displayed form is the hover preview when one is live, else the
  // committed choice; previews render with their own auto encoding so the
  // committed encoding never mutates under the cursor.
  const displayType = previewType ?? chartType;
  const displayEnc = useMemo(
    () => (previewType && table ? autoEncode(table, previewType) : enc),
    [previewType, table, enc]);
  const missing = useMemo(
    () => (table ? missingRoles(displayType, displayEnc) : []),
    [table, displayType, displayEnc]);

  useEffect(() => {
    const c = chromeNow(paletteIdx);
    if (!table) return;
    // A form whose required roles are unassigned (no eligible column, or the
    // user removed one) renders a prompt, never a chart of undefined columns.
    if (missing.length) { instRef.current?.clear(); return; }
    if (is3D(displayType)) {
      const kind = displayType === 'bar3d' ? 'bars' : displayType === 'surface' ? 'surface' : 'scatter';
      const spec = spec3dFrom(table, displayEnc, kind);
      eng3dRef.current?.setChrome(c);
      if (spec) eng3dRef.current?.setData(spec);
      instRef.current?.clear();
    } else {
      try {
        instRef.current?.setOption(buildOption(displayType, table, displayEnc, c), { notMerge: true });
      } catch (e: any) {
        setErr('Chart failed: ' + e.message);
      }
      setHover(null);
    }
  }, [table, displayType, displayEnc, paletteIdx, missing]);

  const pick = useCallback((t: ChartType) => {
    setPreviewType(null);
    setChartType(t);
    if (table) setEnc(autoEncode(table, t));
  }, [table]);

  // Hover preview arms after a short beat so sweeping the grid does not
  // strobe; leave always disarms immediately.
  const previewIn = useCallback((t: ChartType) => {
    if (!table || !canAutoEncode(table, t)) return;
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => setPreviewType(t), 110);
  }, [table]);
  const previewOut = useCallback(() => {
    window.clearTimeout(previewTimer.current);
    setPreviewType(null);
  }, []);

  // ── export ────────────────────────────────────────────────────────────────
  const download = (uri: string, filename: string) => {
    const a = document.createElement('a');
    a.href = uri; a.download = filename; a.click();
  };
  const exportPng = useCallback(() => {
    if (!table) return;
    if (is3D(chartType)) { download(canvasRef.current!.toDataURL('image/png'), 'chart.png'); return; }
    const c = chromeNow(paletteIdx);
    download(instRef.current!.getDataURL({ pixelRatio: 2, backgroundColor: c.panel }), 'chart.png');
  }, [table, chartType, paletteIdx]);
  const exportSvg = useCallback(() => {
    if (!table) return;
    if (is3D(chartType)) { exportPng(); return; } // the canvas engine has no vector path
    // Vector export via an off-screen svg-renderer clone; the visible canvas
    // instance cannot emit SVG after init.
    const el = document.createElement('div');
    const r = chartRef.current!.getBoundingClientRect();
    el.style.cssText = 'position:fixed;left:-10000px;width:' + Math.max(r.width, 640) + 'px;height:' + Math.max(r.height, 420) + 'px';
    document.body.appendChild(el);
    const clone = echarts.init(el, undefined, { renderer: 'svg' });
    clone.setOption(buildOption(chartType, table, enc, chromeNow(paletteIdx)), { notMerge: true });
    download(clone.getDataURL({ backgroundColor: chromeNow(paletteIdx).panel }), 'chart.svg');
    clone.dispose(); el.remove();
  }, [table, chartType, enc, paletteIdx, exportPng]);

  // ── encoder dropdowns, driven by the committed form's role spec ──────────
  const roleControls = table ? rolesFor(chartType).map((spec) => {
    const eligible = table.fields.filter((f) => spec.types.includes(f.type));
    if (spec.role === 'ys' && spec.multi) {
      return (
        <span key="ys" className="dv-role">
          <label>{spec.label}</label>
          {enc.ys.map((y, i) => (
            <select key={i} className="dv-select" value={y} onChange={(e) => {
              const ys = [...enc.ys];
              if (e.target.value === '') ys.splice(i, 1); else ys[i] = e.target.value;
              setEnc({ ...enc, ys });
            }}>
              <option value="">(remove)</option>
              {eligible.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          ))}
          {enc.ys.length < Math.min(eligible.length, 8) && (
            <button className="dv-btn" style={{ padding: '4px 9px' }} title="Add a series" onClick={() => {
              const free = eligible.map((f) => f.name).find((n) => !enc.ys.includes(n));
              if (free) setEnc({ ...enc, ys: [...enc.ys, free] });
            }}>+</button>
          )}
        </span>
      );
    }
    const cur = spec.role === 'ys' ? enc.ys[0] || '' : (enc[spec.role] as string) || '';
    return (
      <span key={spec.role} className="dv-role">
        <label>{spec.label}</label>
        <select className="dv-select" value={cur} onChange={(e) => {
          const v = e.target.value || undefined;
          setEnc(spec.role === 'ys'
            ? { ...enc, ys: v ? [v] : [] }
            : { ...enc, [spec.role]: v });
        }}>
          {spec.optional && <option value="">(none)</option>}
          {eligible.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
        </select>
      </span>
    );
  }) : null;

  const show3d = table && !missing.length && is3D(displayType);
  const suggested = new Set(topPicks);

  const tile = (tp: ChartType) => (
    <button key={tp}
      className={'dv-tile' + (tp === chartType ? ' dv-on' : '') + (!table ? ' dv-dis' : '')}
      title={CHART_LABELS[tp] + (suggested.has(tp) ? ' · suggested for this data' : '')}
      onClick={() => pick(tp)}
      onMouseEnter={() => previewIn(tp)}
      onMouseLeave={previewOut}>
      <Icon d={CHART_ICONS[tp]} />
      <span className="dv-lbl">{CHART_LABELS[tp]}{suggested.has(tp) && table ? <span className="dv-dot" /> : null}</span>
    </button>
  );

  return (
    <div className="dv-root"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}>
      <style>{CSS}</style>

      {/* ── left inspector: data in, chart form ─────────────────────────── */}
      <div className="dv-side">
        <div className="dv-card">
          <div className="dv-h">Data</div>
          <div style={{ display: 'flex', gap: 6, padding: '0 12px 12px' }}>
            <button className="dv-btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
              Open file
            </button>
            <button className="dv-btn" style={{ flex: 1 }} onClick={() => setPasteOpen(!pasteOpen)}>
              Paste
            </button>
            <input ref={fileRef} type="file" style={{ display: 'none' }}
              accept=".csv,.tsv,.txt,.parquet,.pq,.feather,.xlsx,.xls,.json,.ndjson"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }} />
          </div>
          {pasteOpen && (
            <div className="dv-fade" style={{ padding: '0 12px 12px' }}>
              <textarea ref={pasteRef} className="dv-paste" rows={7}
                placeholder={'symbol,return\nAAPL,12.4\nMSFT,9.1'} />
              <button className="dv-btn dv-primary" style={{ width: '100%', marginTop: 8 }} onClick={loadPaste}>
                Chart it
              </button>
            </div>
          )}
          {library.length > 0 && (
            <>
              <div className="dv-h" style={{ paddingTop: 0 }}>My Data library</div>
              <div style={{ padding: '0 6px 8px' }}>
                {library.map((d) => (
                  <div key={d.symbol}
                    className={'dv-row' + (d.symbol === activeSymbol ? ' dv-on' : '')}
                    onClick={() => openDataset(d.symbol)}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || d.symbol}</span>
                    {/* RESEARCH > QUANT MODELS handoff. Gated at 41 rows
                        because the diffusion fitter refuses under 40 returns;
                        a button that always errors is worse than no button.
                        openResearch is an app.js global (classic script). */}
                    {d.rows > 40 && (
                      <button className="dv-send"
                        title="Fit the diffusion simulator to this dataset (RESEARCH > QUANT MODELS)"
                        onClick={(e) => {
                          e.stopPropagation();
                          const w = window as unknown as {
                            __lseQmPending?: { model: string; symbol: string };
                            openResearch?: (v: string) => void };
                          w.__lseQmPending = { model: 'diffusion', symbol: d.symbol };
                          w.openResearch?.('models');
                          window.dispatchEvent(new Event('lse-qm-open'));
                        }}>→ MODEL</button>
                    )}
                    <span className="dv-meta">{d.rows.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="dv-card">
          <div className="dv-h">Chart{table ? '' : ' · load data first'}</div>
          {table && topPicks.length > 0 && (
            <div style={{ display: 'flex', gap: 4, padding: '0 8px 2px', flexWrap: 'wrap' }}>
              {topPicks.map((tp) => (
                <button key={tp} className={'dv-btn' + (tp === chartType ? ' dv-primary' : '')}
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onMouseEnter={() => previewIn(tp)} onMouseLeave={previewOut}
                  onClick={() => pick(tp)}>
                  {CHART_LABELS[tp]}
                </button>
              ))}
            </div>
          )}
          {CHART_GROUPS.map(([group, types]) => (
            <div key={group}>
              <div className="dv-h" style={{ padding: '8px 12px 2px', fontSize: 9.5 }}>{group}</div>
              <div className="dv-grid" style={{ padding: '0 8px 4px' }}>
                {types.map(tile)}
              </div>
            </div>
          ))}
          <div style={{ height: 6 }} />
        </div>

        {table && (
          <div className="dv-card">
            <div className="dv-h">Columns</div>
            <div className="dv-cols">
              <div style={{ color: 'var(--dim)', marginBottom: 6, fontSize: 11 }}>
                {table.source} · {table.nrows.toLocaleString()} rows
                {table.truncated ? ' (showing ' + table.rows.length.toLocaleString() + ')' : ''}
              </div>
              {table.fields.map((f) => (
                <div key={f.name} className="dv-col">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <span className="dv-type">{f.type}</span>
                </div>
              ))}
              <button className="dv-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setTableOpen(!tableOpen)}>
                {tableOpen ? 'Hide table' : 'View as table'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── right: encoding bar + the canvas card ───────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="dv-bar">
          {roleControls}
          <span style={{ flex: 1 }} />
          <select className="dv-select" title="Colour palette" value={paletteIdx}
            onChange={(e) => { const i = Number(e.target.value); setPaletteIdx(i); savePrefs(i); }}>
            {PALETTES.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
          </select>
          <button className="dv-btn" onClick={exportSvg} disabled={!table} title="Download as vector SVG">
            SVG
          </button>
          <button className="dv-btn" onClick={exportPng} disabled={!table} title="Download as high-res PNG">
            PNG
          </button>
        </div>
        {err && <div className="dv-err dv-fade">{err}</div>}

        <div className="dv-canvas-wrap">
          <div className="dv-canvas-card">
            {!table && (
              <div className="dv-hero">
                <div className={'dv-hero-card' + (dragging ? ' dv-drag' : '')}>
                  <div className="dv-hero-t">Drop a file to chart it</div>
                  <div className="dv-hero-s">csv · parquet · xlsx · feather · json</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button className="dv-btn" onClick={() => fileRef.current?.click()}>
                      Open a file
                    </button>
                    <button className="dv-btn" onClick={() => setPasteOpen(true)}>
                      Paste rows
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div ref={chartRef} style={{ position: 'absolute', inset: 8, visibility: show3d || !table || missing.length ? 'hidden' : 'visible' }} />
            <canvas ref={canvasRef}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', visibility: show3d ? 'visible' : 'hidden', cursor: 'grab', touchAction: 'none' }} />
            {table && missing.length > 0 && (
              <div className="dv-hero">
                <div className="dv-hero-card" style={{ borderStyle: 'solid' }}>
                  <div className="dv-hero-t">{CHART_LABELS[displayType]} needs: {missing.join(', ')}</div>
                  <div className="dv-hero-s">Assign columns in the bar above, or pick another chart type.</div>
                </div>
              </div>
            )}
            {previewType && previewType !== chartType && !missing.length && (
              <div style={{ position: 'absolute', top: 10, left: 12, fontSize: 11, color: 'var(--dim)', pointerEvents: 'none' }}>
                Previewing {CHART_LABELS[previewType]} — click to keep
              </div>
            )}
            {show3d && hover && (
              <div style={{
                position: 'absolute', left: hover.sx + 12, top: hover.sy + 12, pointerEvents: 'none',
                background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 8,
                padding: '5px 9px', fontSize: 11, fontFamily: 'SF Mono, ui-monospace, monospace', whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,.25)',
              }}>{hover.text}</div>
            )}
            {show3d && (
              <div style={{ position: 'absolute', right: 12, bottom: 10, fontSize: 10, color: 'var(--dim)', pointerEvents: 'none' }}>
                drag rotate · wheel zoom · double-click reset
              </div>
            )}
            {dragging && table && <div className="dv-dropveil">Drop to chart this file</div>}
            {tableOpen && table && (
              <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: 'var(--panel)', padding: 12 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'SF Mono, ui-monospace, monospace' }}>
                  <thead>
                    <tr>{table.fields.map((f) => (
                      <th key={f.name} style={{ textAlign: 'left', padding: '4px 10px', borderBottom: '1px solid var(--edge)', color: 'var(--dim)', position: 'sticky', top: 0, background: 'var(--panel)' }}>{f.name}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {table.rows.slice(0, 500).map((r, i) => (
                      <tr key={i}>{table.fields.map((f) => (
                        <td key={f.name} style={{ padding: '2px 10px', borderBottom: '1px solid var(--edge)', whiteSpace: 'nowrap' }}>{String(r[f.name] ?? '')}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
                {table.rows.length > 500 && <div style={{ color: 'var(--dim)', fontSize: 11, padding: 8 }}>first 500 rows shown</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
