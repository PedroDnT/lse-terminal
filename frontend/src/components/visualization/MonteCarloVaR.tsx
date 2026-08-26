import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Play, RotateCcw, Maximize2, Minimize2, Shield, TrendingDown, AlertTriangle, BarChart3 } from 'lucide-react';

/* ───────── RNG ───────── */
function boxMuller(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ───────── PRESETS ───────── */
const ASSETS = [
    { key: 'sp500', label: 'S&P 500', drift: 0.10, vol: 0.16, price: 5200 },
    { key: 'btc', label: 'Bitcoin', drift: 0.40, vol: 0.75, price: 97000 },
    { key: 'gold', label: 'Gold', drift: 0.06, vol: 0.15, price: 2900 },
    { key: 'nasdaq', label: 'NASDAQ', drift: 0.12, vol: 0.22, price: 18500 },
];

const CONF = [
    { pct: 90, label: '90 %' },
    { pct: 95, label: '95 %' },
    { pct: 99, label: '99 %' },
] as const;

const PERIODS = [
    { days: 1, label: '1 Day' },
    { days: 5, label: '1 Week' },
    { days: 10, label: '2 Weeks' },
    { days: 21, label: '1 Month' },
];

const N_SIM = 10_000;
const STEPS_PER_DAY = 50;   // intraday resolution -> smooth visible fan
const DISPLAY_PATHS = 300;   // render subset for perf

/* ───────── COMPONENT ───────── */
export default function MonteCarloVaR() {
    const [assetIdx, setAssetIdx] = useState(0);
    const [portfolio, setPortfolio] = useState(100_000);
    const [confIdx, setConfIdx] = useState(2);
    const [periodIdx, setPeriodIdx] = useState(0);
    const [hasRun, setHasRun] = useState(false);
    const [animProg, setAnimProg] = useState(0);    // 0->1
    const [isAnimating, setIsAnimating] = useState(false);
    const [isFS, setIsFS] = useState(false);

    const wrapRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number>(0);
    const progRef = useRef(0);

    const asset = ASSETS[assetIdx];
    const conf = CONF[confIdx];
    const period = PERIODS[periodIdx];

    /* ── fullscreen ── */
    const toggleFS = useCallback(() => {
        if (!document.fullscreenElement && wrapRef.current) {
            wrapRef.current.requestFullscreen().catch(() => { });
        } else if (document.fullscreenElement) {
            document.exitFullscreen();
        }
    }, []);
    useEffect(() => {
        const h = () => setIsFS(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', h);
        return () => document.removeEventListener('fullscreenchange', h);
    }, []);

    /* ── simulation ── */
    const sim = useMemo(() => {
        if (!hasRun) return null;

        const totalSteps = period.days * STEPS_PER_DAY;
        const dt = 1 / (252 * STEPS_PER_DAY);
        const mu = asset.drift;
        const sigma = asset.vol;
        const S0 = asset.price;
        const shares = portfolio / S0;

        const allFinal: number[] = [];
        // We store ALL path P&L values but only keep a subset for rendering
        const pathsForRender: number[][] = [];
        const sampleEvery = Math.max(1, Math.ceil(N_SIM / DISPLAY_PATHS));

        for (let s = 0; s < N_SIM; s++) {
            let price = S0;
            const keepPath = s % sampleEvery === 0;
            const pnl: number[] = keepPath ? [0] : [];

            for (let t = 0; t < totalSteps; t++) {
                const drift = (mu - 0.5 * sigma * sigma) * dt;
                price *= Math.exp(drift + sigma * Math.sqrt(dt) * boxMuller());
                if (keepPath) pnl.push((price - S0) * shares);
            }

            const finalPnl = (price - S0) * shares;
            allFinal.push(finalPnl);
            if (keepPath) pathsForRender.push(pnl);
        }

        const sorted = [...allFinal].sort((a, b) => a - b);
        const varIdx = Math.floor(N_SIM * (1 - conf.pct / 100));
        const varVal = -sorted[varIdx];
        const tail = sorted.slice(0, varIdx);
        const es = tail.length ? -(tail.reduce((a, b) => a + b, 0) / tail.length) : varVal;
        const probLoss = allFinal.filter(v => v < 0).length / N_SIM;
        const worstLoss = -sorted[0];
        const bestGain = sorted[sorted.length - 1];
        const meanPnl = allFinal.reduce((a, b) => a + b, 0) / N_SIM;

        /* percentile bands at every step for fan chart */
        const bands = { p1: [] as number[], p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[], p99: [] as number[] };
        for (let t = 0; t <= totalSteps; t++) {
            const vals = pathsForRender.map(p => p[t]).sort((a, b) => a - b);
            const n = vals.length;
            bands.p1.push(vals[Math.floor(n * 0.01)]);
            bands.p5.push(vals[Math.floor(n * 0.05)]);
            bands.p25.push(vals[Math.floor(n * 0.25)]);
            bands.p50.push(vals[Math.floor(n * 0.50)]);
            bands.p75.push(vals[Math.floor(n * 0.75)]);
            bands.p95.push(vals[Math.floor(n * 0.95)]);
            bands.p99.push(vals[Math.floor(n * 0.99)]);
        }

        /* histogram */
        const bins = 80;
        const hMin = sorted[0];
        const hMax = sorted[sorted.length - 1];
        const bSize = (hMax - hMin) / bins;
        const hist = new Array(bins).fill(0);
        allFinal.forEach(v => { hist[Math.min(Math.floor((v - hMin) / bSize), bins - 1)]++; });

        return { pathsForRender, bands, totalSteps, varVal, es, probLoss, worstLoss, bestGain, meanPnl, hist, hMin, hMax, varThreshold: -varVal };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasRun, assetIdx, portfolio, confIdx, periodIdx]);

    /* ── animation ── */
    const tick = useCallback(() => {
        progRef.current = Math.min(progRef.current + 0.008, 1);
        setAnimProg(progRef.current);
        if (progRef.current < 1) rafRef.current = requestAnimationFrame(tick);
        else setIsAnimating(false);
    }, []);

    const run = useCallback(() => {
        progRef.current = 0;
        setAnimProg(0);
        setHasRun(true);
        setIsAnimating(true);
        cancelAnimationFrame(rafRef.current);
        requestAnimationFrame(() => { rafRef.current = requestAnimationFrame(tick); });
    }, [tick]);

    const reset = useCallback(() => {
        cancelAnimationFrame(rafRef.current);
        setHasRun(false);
        setAnimProg(0);
        setIsAnimating(false);
    }, []);

    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    /* ── SVG geometry ── */
    const W = 1200, H = 600;
    const ml = 90, mr = 130, mt = 20, mb = 44;
    const cw = W - ml - mr, ch = H - mt - mb;

    const { xS, yS, yMin, yMax } = useMemo(() => {
        if (!sim) {
            return { xS: (_: number) => ml, yS: (_: number) => mt + ch / 2, yMin: -1, yMax: 1 };
        }
        // Use bands to determine range (much more stable than individual paths)
        const lo = Math.min(sim.bands.p1[sim.totalSteps], sim.hMin, 0) * 1.15;
        const hi = Math.max(sim.bands.p99[sim.totalSteps], sim.hMax, 0) * 1.15;
        return {
            xS: (t: number) => ml + (t / sim.totalSteps) * cw,
            yS: (v: number) => mt + ch - ((v - lo) / (hi - lo)) * ch,
            yMin: lo,
            yMax: hi,
        };
    }, [sim, cw, ch, ml, mt]);

    const vis = sim ? Math.floor(sim.totalSteps * animProg) : 0;
    const done = animProg >= 1;

    /* band path builder */
    const band = (upper: number[], lower: number[]) => {
        if (vis < 2) return '';
        // Sample points to keep SVG reasonable
        const step = Math.max(1, Math.floor(vis / 200));
        let d = `M${xS(0)},${yS(upper[0])}`;
        for (let t = step; t <= vis; t += step) d += `L${xS(t)},${yS(upper[t])}`;
        if (vis % step !== 0) d += `L${xS(vis)},${yS(upper[vis])}`;
        for (let t = vis; t >= 0; t -= step) d += `L${xS(t)},${yS(lower[t])}`;
        return d + 'Z';
    };

    /* y ticks */
    const yTicks = useMemo(() => {
        const range = yMax - yMin;
        if (range === 0) return [0];
        const raw = range / 6;
        const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
        const step = Math.ceil(raw / mag) * mag;
        const ticks: number[] = [];
        let v = Math.ceil(yMin / step) * step;
        while (v <= yMax && ticks.length < 10) { ticks.push(v); v += step; }
        return ticks;
    }, [yMin, yMax]);

    const fmtK = (v: number) => {
        const a = Math.abs(v);
        if (a >= 1e6) return `${v < 0 ? '-' : '+'}$${(a / 1e6).toFixed(1)}M`;
        if (a >= 1e3) return `${v < 0 ? '-' : '+'}$${(a / 1e3).toFixed(1)}k`;
        return `${v < 0 ? '-' : '+'}$${a.toFixed(0)}`;
    };

    const fmtAxis = (v: number) => {
        const a = Math.abs(v);
        const prefix = v < 0 ? '-' : v > 0 ? '+' : '';
        if (a >= 1e6) return `${prefix}$${(a / 1e6).toFixed(1)}M`;
        if (a >= 1e3) return `${prefix}$${(a / 1e3).toFixed(0)}k`;
        return `${prefix}$${a.toFixed(0)}`;
    };

    /* ── path colour ── */
    const pathColor = (finalPnl: number) => {
        if (!sim) return '#808080';
        if (finalPnl <= sim.varThreshold) return 'rgba(240,66,108,0.35)';
        /* plain losses use muted amber so VaR-breach paths (rose) stay distinguishable */
        if (finalPnl < 0) return 'rgba(197,132,53,0.18)';
        return 'rgba(33,179,164,0.18)';
    };

    return (
        <div
            ref={wrapRef}
            className="relative w-full rounded-xl overflow-hidden border border-white/[0.06] select-none"
            style={{
                height: isFS ? '100vh' : 'calc(100vh - 100px)',
                minHeight: 600,
                background: 'var(--bg, #1c1c1c)',
            }}
        >
            {/* ═══ TOP BAR ═══ */}
            <div className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-5 z-30">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1 rounded-md" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <Shield className="w-3.5 h-3.5 text-[#f0426c]" />
                        <span className="text-[13px] font-semibold tracking-wide text-white/90" style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
                            MONTE CARLO VaR
                        </span>
                    </div>
                    <span className="text-[11px] text-white/30 font-mono">{N_SIM.toLocaleString()} scenarios</span>
                </div>
                <div className="flex items-center gap-2">
                    {hasRun && (
                        <button onClick={reset}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono text-white/50 hover:text-white/80 transition-colors"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <RotateCcw className="w-3 h-3" /> Reset
                        </button>
                    )}
                    <button onClick={toggleFS}
                        className="p-1.5 rounded-md text-white/40 hover:text-white/80 transition-colors"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        {isFS ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </button>
                </div>
            </div>

            {/* ═══ LEFT PANEL ═══ */}
            <div className="absolute left-4 top-14 z-30 w-52" style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
                <div className="rounded-lg p-3.5 space-y-3 bg-card border border-border">
                    <p className="text-[9px] uppercase tracking-[0.2em] text-white/25">Parameters</p>

                    {/* Asset */}
                    <div>
                        <p className="text-[10px] text-white/35 mb-1">ASSET</p>
                        <div className="grid grid-cols-2 gap-1">
                            {ASSETS.map((a, i) => (
                                <button key={a.key} onClick={() => setAssetIdx(i)}
                                    className={`py-1.5 px-1 rounded text-[10px] font-medium transition-all ${assetIdx === i
                                            ? 'bg-white/10 text-white border border-white/20'
                                            : 'text-white/35 hover:text-white/60 border border-transparent'
                                        }`}>
                                    {a.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[9px] text-white/20 mt-1">σ = {(asset.vol * 100).toFixed(0)}% annual</p>
                    </div>

                    {/* Portfolio */}
                    <div>
                        <p className="text-[10px] text-white/35 mb-1">PORTFOLIO ($)</p>
                        <input
                            type="number"
                            value={portfolio}
                            onChange={e => setPortfolio(Math.max(1000, +e.target.value || 0))}
                            className="w-full h-7 px-2 rounded text-[11px] text-white/80 bg-white/[0.04] border border-white/[0.08] outline-none focus:border-white/20 transition-colors"
                        />
                    </div>

                    {/* Confidence */}
                    <div>
                        <p className="text-[10px] text-white/35 mb-1">CONFIDENCE</p>
                        <div className="flex gap-1">
                            {CONF.map((c, i) => (
                                <button key={c.pct} onClick={() => setConfIdx(i)}
                                    className={`flex-1 py-1.5 rounded text-[10px] font-semibold transition-all ${confIdx === i
                                            ? 'bg-[#343434] text-white'
                                            : 'text-white/30 hover:text-white/50 bg-white/[0.03]'
                                        }`}>
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Period */}
                    <div>
                        <p className="text-[10px] text-white/35 mb-1">HOLDING PERIOD</p>
                        <div className="grid grid-cols-2 gap-1">
                            {PERIODS.map((p, i) => (
                                <button key={p.days} onClick={() => setPeriodIdx(i)}
                                    className={`py-1.5 rounded text-[10px] font-medium transition-all ${periodIdx === i
                                            ? 'bg-white/10 text-white border border-white/20'
                                            : 'text-white/30 hover:text-white/50 border border-transparent'
                                        }`}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Run */}
                    <button onClick={run} disabled={isAnimating}
                        className="w-full py-2.5 rounded-lg font-semibold text-[11px] tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                        style={{
                            background: isAnimating
                                ? 'rgba(240,66,108,0.3)'
                                : 'var(--down, #f0426c)',
                            color: 'white',
                        }}>
                        <Play className="w-3.5 h-3.5" />
                        {isAnimating ? 'SIMULATING…' : 'RUN SIMULATION'}
                    </button>
                </div>
            </div>

            {/* ═══ SVG CHART (full bleed) ═══ */}
            <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
                <defs>
                    {/* fan fills by role: outer tail band = risk rose, mid = warning amber, inner = neutral price */}
                    <linearGradient id="b99" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f0426c" stopOpacity="0.06" />
                        <stop offset="100%" stopColor="#f0426c" stopOpacity="0.02" />
                    </linearGradient>
                    <linearGradient id="b75" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#c58435" stopOpacity="0.10" />
                        <stop offset="100%" stopColor="#c58435" stopOpacity="0.03" />
                    </linearGradient>
                    <linearGradient id="b50" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#e8e8e8" stopOpacity="0.14" />
                        <stop offset="100%" stopColor="#e8e8e8" stopOpacity="0.04" />
                    </linearGradient>
                    <clipPath id="cc"><rect x={ml} y={mt} width={cw} height={ch} /></clipPath>
                </defs>

                {/* Grid lines */}
                {yTicks.map((v, i) => (
                    <g key={i}>
                        <line x1={ml} y1={yS(v)} x2={ml + cw} y2={yS(v)} stroke="#2e2e2e" strokeWidth={1} />
                        <text x={ml - 10} y={yS(v) + 4} textAnchor="end" fill="#b0b0b0" fontSize={10} fontFamily="'JetBrains Mono', monospace">
                            {fmtAxis(v)}
                        </text>
                    </g>
                ))}

                {/* Day markers on x-axis */}
                {sim && Array.from({ length: period.days + 1 }, (_, d) => (
                    <g key={d}>
                        <line x1={xS(d * STEPS_PER_DAY)} y1={mt} x2={xS(d * STEPS_PER_DAY)} y2={mt + ch} stroke="#2e2e2e" strokeWidth={1} />
                        <text x={xS(d * STEPS_PER_DAY)} y={H - 12} textAnchor="middle" fill="#b0b0b0" fontSize={10} fontFamily="'JetBrains Mono', monospace">
                            {d === 0 ? 'Now' : `Day ${d}`}
                        </text>
                    </g>
                ))}

                <g clipPath="url(#cc)">
                    {/* Zero line */}
                    <line x1={ml} y1={yS(0)} x2={ml + cw} y2={yS(0)} stroke="#3a3a3a" strokeWidth={1} strokeDasharray="4,6" />

                    {/* Fan bands */}
                    {sim && vis > 1 && (
                        <>
                            <path d={band(sim.bands.p99, sim.bands.p1)} fill="url(#b99)" />
                            <path d={band(sim.bands.p95, sim.bands.p5)} fill="url(#b75)" />
                            <path d={band(sim.bands.p75, sim.bands.p25)} fill="url(#b50)" />
                        </>
                    )}

                    {/* Individual paths */}
                    {sim && sim.pathsForRender.map((pnl, i) => {
                        const n = Math.min(vis, pnl.length - 1);
                        if (n < 2) return null;
                        const step = Math.max(1, Math.floor(n / 120));
                        let d = `M${xS(0)},${yS(pnl[0])}`;
                        for (let t = step; t <= n; t += step) d += `L${xS(t)},${yS(pnl[t])}`;
                        if (n % step !== 0) d += `L${xS(n)},${yS(pnl[n])}`;
                        return <path key={i} d={d} fill="none" stroke={pathColor(pnl[pnl.length - 1])} strokeWidth={0.6} />;
                    })}

                    {/* Median */}
                    {sim && vis > 1 && (() => {
                        const step = Math.max(1, Math.floor(vis / 200));
                        let d = `M${xS(0)},${yS(sim.bands.p50[0])}`;
                        for (let t = step; t <= vis; t += step) d += `L${xS(t)},${yS(sim.bands.p50[t])}`;
                        if (vis % step !== 0) d += `L${xS(vis)},${yS(sim.bands.p50[vis])}`;
                        return <path d={d} fill="none" stroke="#e8e8e8" strokeWidth={2} />;
                    })()}

                    {/* VaR line */}
                    {sim && done && (
                        <>
                            <line x1={ml} y1={yS(sim.varThreshold)} x2={ml + cw} y2={yS(sim.varThreshold)}
                                stroke="#f0426c" strokeWidth={1.5} strokeDasharray="6,4" opacity={0.9} />
                            <text x={ml + cw + 6} y={yS(sim.varThreshold) + 4} fill="#f0426c" fontSize={10}
                                fontFamily="'JetBrains Mono', monospace" fontWeight="600">
                                VaR {conf.label}
                            </text>
                        </>
                    )}
                </g>

                {/* Right-side histogram */}
                {sim && done && (
                    <g transform={`translate(${ml + cw + 10}, ${mt})`}>
                        {sim.hist.map((count, i) => {
                            const binVal = sim.hMin + (i + 0.5) * ((sim.hMax - sim.hMin) / sim.hist.length);
                            const y = ((sim.hMax - binVal) / (sim.hMax - sim.hMin)) * ch;
                            const bw = (count / Math.max(...sim.hist)) * 80;
                            const inVaR = binVal <= sim.varThreshold;
                            return (
                                <rect key={i} x={0} y={y - 2.5} width={bw} height={5} rx={1}
                                    fill={inVaR ? '#f0426c' : binVal < 0 ? '#c58435' : '#21b3a4'}
                                    opacity={inVaR ? 0.85 : 0.5} />
                            );
                        })}
                    </g>
                )}

                {/* Idle state */}
                {!hasRun && (
                    <>
                        <text x={W / 2 + 30} y={H / 2 - 10} textAnchor="middle" fill="#808080" fontSize={14}
                            fontFamily="'JetBrains Mono', monospace" fontWeight="500">
                            Configure parameters & press
                        </text>
                        <text x={W / 2 + 30} y={H / 2 + 18} textAnchor="middle" fill="#f0426c" fontSize={16}
                            fontFamily="'JetBrains Mono', monospace" fontWeight="700" opacity={0.7}>
                            RUN SIMULATION
                        </text>
                    </>
                )}
            </svg>

            {/* ═══ RESULTS (bottom-right, glass) ═══ */}
            {sim && done && (
                <div className="absolute bottom-4 right-4 z-30 w-64 animate-in fade-in slide-in-from-bottom-4 duration-500"
                    style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
                    <div className="rounded-lg p-3.5 space-y-2.5 bg-card border border-border">
                        <p className="text-[9px] uppercase tracking-[0.2em] text-white/20 flex items-center gap-1.5">
                            <BarChart3 className="w-3 h-3" /> Results
                        </p>

                        {/* VaR */}
                        <div className="p-2.5 rounded-md" style={{ background: 'var(--bg2, #262626)', border: '1px solid var(--edge, #3a3a3a)' }}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <AlertTriangle className="w-3 h-3 text-[#f0426c]" />
                                <span className="text-[10px] text-[#f0426c]/80">Value at Risk ({conf.label})</span>
                            </div>
                            <p className="text-xl font-bold text-[#f0426c] leading-tight">
                                -${sim.varVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                            <p className="text-[9px] text-white/25 mt-0.5">{(sim.varVal / portfolio * 100).toFixed(2)}% of portfolio</p>
                        </div>

                        {/* ES */}
                        {/* ES was violet on the site; violet maps to neutral emphasis so only VaR carries the risk rose */}
                        <div className="p-2.5 rounded-md" style={{ background: 'var(--bg2, #262626)', border: '1px solid var(--edge, #3a3a3a)' }}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <TrendingDown className="w-3 h-3 text-[#b0b0b0]" />
                                <span className="text-[10px] text-[#b0b0b0]">Expected Shortfall</span>
                            </div>
                            <p className="text-lg font-bold text-[#e8e8e8] leading-tight">
                                -${sim.es.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                            <p className="text-[9px] text-white/25 mt-0.5">Avg loss beyond VaR</p>
                        </div>

                        {/* Grid stats */}
                        <div className="grid grid-cols-2 gap-1.5">
                            {[
                                { label: 'LOSS PROB', value: `${(sim.probLoss * 100).toFixed(1)}%`, color: 'text-[#c58435]' },
                                { label: 'WORST', value: `-$${sim.worstLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'text-[#f0426c]' },
                                { label: 'BEST', value: `+$${sim.bestGain.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'text-[#21b3a4]' },
                                { label: 'E[P&L]', value: fmtK(sim.meanPnl), color: sim.meanPnl >= 0 ? 'text-[#21b3a4]' : 'text-[#f0426c]' },
                            ].map(s => (
                                <div key={s.label} className="p-1.5 rounded text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                                    <p className="text-[8px] text-white/20 mb-0.5">{s.label}</p>
                                    <p className={`text-[11px] font-bold ${s.color}`}>{s.value}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ PROGRESS ═══ */}
            {isAnimating && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] z-40" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="h-full transition-none" style={{ width: `${animProg * 100}%`, background: 'var(--down, #f0426c)' }} />
                </div>
            )}
        </div>
    );
}
