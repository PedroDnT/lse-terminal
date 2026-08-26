import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";

export type MAType = 'SMA' | 'EMA' | 'SMMA';

export interface MAConfig {
  type: MAType;
  period: number;
  color: string;
  lineWidth?: number;
  /** Set when this MA was auto-registered by a Brue strategy (the
   *  ema()/sma()/etc calls in the script become real chart indicators).
   *  Lets the legend nest the line under the script's row instead of
   *  rendering it as a top-level entry. Stays unset for user-added MAs
   *  so existing manual EMAs are unaffected. */
  sourceScriptId?: string;
}

export interface SubplotStyle {
  backgroundColor?: string;
  backgroundOpacity?: number;
  showGrid?: boolean;
  gridColor?: string;
  lineWidth?: number;
  showZones?: boolean;
  overboughtZoneColor?: string;
  oversoldZoneColor?: string;
  zoneOpacity?: number;
  customLabel?: string;
  labelColor?: string; // Color for the indicator label text
}

// Optional `sourceScriptId` on each auto-registerable indicator config:
// when a Brue strategy enables this indicator (e.g. rsi(close, 14) inside
// the script body), mergeIndicatorRequests stamps the id of the calling
// script. Lets the legend nest the indicator under that strategy's row
// and lets handleRemoveBruePlot disable it cleanly on Trash. Stays unset
// when the user enables the indicator manually so user-owned ones are
// never claimed or deleted by a strategy's lifecycle.
export interface IndicatorConfig {
  rsi: { enabled: boolean; period: number; overbought: number; oversold: number; color?: string; style?: SubplotStyle; sourceScriptId?: string };
  macd: { enabled: boolean; fast: number; slow: number; signal: number; macdColor?: string; signalColor?: string; histogramUpColor?: string; histogramDownColor?: string; style?: SubplotStyle; sourceScriptId?: string };
  ema: { enabled: boolean; periods: number[] }; // Legacy - kept for compatibility
  bollinger: { enabled: boolean; period: number; stdDev: number; upperColor?: string; middleColor?: string; lowerColor?: string; lineWidth?: number; fillEnabled?: boolean; fillColor?: string; fillOpacity?: number; sourceScriptId?: string };
  movingAverages: { enabled: boolean; lines: MAConfig[]; lineWidth?: number };
  atr: { enabled: boolean; period: number; color?: string; style?: SubplotStyle; sourceScriptId?: string };
  stochastic: { enabled: boolean; kPeriod: number; dPeriod: number; smooth: number; overbought: number; oversold: number; kColor?: string; dColor?: string; style?: SubplotStyle; sourceScriptId?: string };
  volume: { enabled: boolean; upColor?: string; downColor?: string; style?: SubplotStyle };
  // New indicators
  williamsR: { enabled: boolean; period: number; overbought: number; oversold: number; color?: string; style?: SubplotStyle };
  cci: { enabled: boolean; period: number; overbought: number; oversold: number; color?: string; style?: SubplotStyle; sourceScriptId?: string };
  adx: { enabled: boolean; period: number; adxColor?: string; plusDIColor?: string; minusDIColor?: string; style?: SubplotStyle; sourceScriptId?: string };
  roc: { enabled: boolean; period: number; color?: string; style?: SubplotStyle; sourceScriptId?: string };
  vwap: { enabled: boolean; color?: string; lineWidth?: number; sourceScriptId?: string };
  ichimoku: { enabled: boolean; tenkanPeriod: number; kijunPeriod: number; senkouBPeriod: number; displacement: number; tenkanColor?: string; kijunColor?: string; cloudUpColor?: string; cloudDownColor?: string; chikouColor?: string; lineWidth?: number };
  parabolicSAR: { enabled: boolean; afStart: number; afStep: number; afMax: number; bullishColor?: string; bearishColor?: string; dotSize?: number };
  keltner: { enabled: boolean; emaPeriod: number; atrPeriod: number; multiplier: number; upperColor?: string; middleColor?: string; lowerColor?: string; lineWidth?: number };
  pivotPoints: { enabled: boolean; pivotColor?: string; resistanceColor?: string; supportColor?: string; lineWidth?: number };
  volumeProfile: { enabled: boolean; numberOfRows?: number; rowWidth?: number; lookbackBars?: number; upColor?: string; downColor?: string; pocColor?: string; opacity?: number };
  optionsPdf: { enabled: boolean; color?: string; endSpread?: number; opacity?: number };
  // ── Expanded Indicators (33 new) ──
  // Trend
  supertrend: { enabled: boolean; period: number; multiplier: number; bullishColor?: string; bearishColor?: string; lineWidth?: number };
  donchian: { enabled: boolean; period: number; upperColor?: string; middleColor?: string; lowerColor?: string; lineWidth?: number };
  aroon: { enabled: boolean; period: number; upColor?: string; downColor?: string; style?: SubplotStyle };
  envelopes: { enabled: boolean; period: number; percent: number; upperColor?: string; middleColor?: string; lowerColor?: string; lineWidth?: number };
  dema: { enabled: boolean; period: number; color?: string; lineWidth?: number };
  tema: { enabled: boolean; period: number; color?: string; lineWidth?: number };
  hma: { enabled: boolean; period: number; color?: string; lineWidth?: number };
  // Oscillators
  momentum: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  ao: { enabled: boolean; bullishColor?: string; bearishColor?: string; style?: SubplotStyle };
  mfi: { enabled: boolean; period: number; overbought: number; oversold: number; color?: string; style?: SubplotStyle };
  tsi: { enabled: boolean; longPeriod: number; shortPeriod: number; signalPeriod: number; tsiColor?: string; signalColor?: string; style?: SubplotStyle };
  trix: { enabled: boolean; period: number; signalPeriod: number; trixColor?: string; signalColor?: string; style?: SubplotStyle };
  ultimateOsc: { enabled: boolean; fast: number; med: number; slow: number; overbought?: number; oversold?: number; color?: string; style?: SubplotStyle };
  dpo: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  kst: { enabled: boolean; signalPeriod: number; color?: string; signalColor?: string; style?: SubplotStyle };
  stochRsi: { enabled: boolean; rsiPeriod: number; kPeriod: number; dPeriod: number; overbought: number; oversold: number; kColor?: string; dColor?: string; style?: SubplotStyle };
  // Volatility
  bbPercent: { enabled: boolean; period: number; stdDev: number; color?: string; style?: SubplotStyle };
  bbWidth: { enabled: boolean; period: number; stdDev: number; color?: string; style?: SubplotStyle };
  histVol: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  chaikinVol: { enabled: boolean; emaPeriod: number; rocPeriod: number; color?: string; style?: SubplotStyle };
  stdDev: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  // Volume
  obv: { enabled: boolean; color?: string; style?: SubplotStyle };
  cmf: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  adl: { enabled: boolean; color?: string; style?: SubplotStyle };
  forceIndex: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  eom: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  volumeSma: { enabled: boolean; period: number; color?: string };
  // Support/Resistance
  fibRetracement: { enabled: boolean; lookback: number; color?: string; lineWidth?: number };
  camarillaPivots: { enabled: boolean; resistanceColor?: string; supportColor?: string; lineWidth?: number };
  woodiePivots: { enabled: boolean; pivotColor?: string; resistanceColor?: string; supportColor?: string; lineWidth?: number };
  // Statistics
  correlation: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  linearReg: { enabled: boolean; period: number; deviations: number; upperColor?: string; middleColor?: string; lowerColor?: string; lineWidth?: number };
  coppock: { enabled: boolean; longROC: number; shortROC: number; wmaPeriod: number; color?: string; style?: SubplotStyle };
  // ── Phase 2: 100+ New Indicators ──
  // Trend (new)
  alma: { enabled: boolean; period: number; offset: number; sigma: number; color?: string; lineWidth?: number };
  kama: { enabled: boolean; period: number; fastPeriod: number; slowPeriod: number; color?: string; lineWidth?: number };
  zlema: { enabled: boolean; period: number; color?: string; lineWidth?: number };
  t3: { enabled: boolean; period: number; vFactor: number; color?: string; lineWidth?: number };
  lsma: { enabled: boolean; period: number; color?: string; lineWidth?: number };
  mcginley: { enabled: boolean; period: number; color?: string; lineWidth?: number };
  vortex: { enabled: boolean; period: number; plusColor?: string; minusColor?: string; style?: SubplotStyle };
  choppiness: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  elderRay: { enabled: boolean; period: number; bullColor?: string; bearColor?: string; style?: SubplotStyle };
  massIndex: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  chandeKroll: { enabled: boolean; p: number; q: number; x: number; longColor?: string; shortColor?: string; lineWidth?: number };
  linRegSlope: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  priceChannel: { enabled: boolean; period: number; upperColor?: string; middleColor?: string; lowerColor?: string; lineWidth?: number };
  wma: { enabled: boolean; period: number; color?: string; lineWidth?: number };
  smmaOverlay: { enabled: boolean; period: number; color?: string; lineWidth?: number };
  alligator: { enabled: boolean; jawColor?: string; teethColor?: string; lipsColor?: string; lineWidth?: number };
  // Oscillators (new)
  ppo: { enabled: boolean; fast: number; slow: number; signal: number; ppoColor?: string; signalColor?: string; histUpColor?: string; histDownColor?: string; style?: SubplotStyle };
  pvo: { enabled: boolean; fast: number; slow: number; signal: number; color?: string; style?: SubplotStyle };
  cmo: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  fisher: { enabled: boolean; period: number; fisherColor?: string; triggerColor?: string; style?: SubplotStyle };
  stc: { enabled: boolean; fast: number; slow: number; cycle: number; color?: string; style?: SubplotStyle };
  rviOsc: { enabled: boolean; period: number; rviColor?: string; signalColor?: string; style?: SubplotStyle };
  klinger: { enabled: boolean; fast: number; slow: number; signal: number; klingerColor?: string; signalColor?: string; style?: SubplotStyle };
  connorsRsi: { enabled: boolean; rsiPeriod: number; streakPeriod: number; rankPeriod: number; color?: string; style?: SubplotStyle };
  apo: { enabled: boolean; fast: number; slow: number; color?: string; style?: SubplotStyle };
  qstick: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  bop: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  psychLine: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  pfe: { enabled: boolean; period: number; smoothing: number; color?: string; style?: SubplotStyle };
  smi: { enabled: boolean; period: number; smoothK: number; smoothD: number; smiColor?: string; signalColor?: string; style?: SubplotStyle };
  // Volatility (new)
  ulcerIndex: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  natr: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  trueRange: { enabled: boolean; color?: string; style?: SubplotStyle };
  squeeze: { enabled: boolean; bbPeriod: number; bbMult: number; kcPeriod: number; kcMult: number; color?: string; style?: SubplotStyle };
  chandelierExit: { enabled: boolean; period: number; multiplier: number; longColor?: string; shortColor?: string; lineWidth?: number };
  relVolIndex: { enabled: boolean; period: number; smoothing: number; color?: string; style?: SubplotStyle };
  vhf: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  accBands: { enabled: boolean; period: number; upperColor?: string; middleColor?: string; lowerColor?: string; lineWidth?: number };
  // Volume (new)
  vwma: { enabled: boolean; period: number; color?: string; lineWidth?: number };
  volumeOsc: { enabled: boolean; fast: number; slow: number; color?: string; style?: SubplotStyle };
  nvi: { enabled: boolean; color?: string; style?: SubplotStyle };
  pvi: { enabled: boolean; color?: string; style?: SubplotStyle };
  pvt: { enabled: boolean; color?: string; style?: SubplotStyle };
  vroc: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  netVolume: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  twiggsMF: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  // Statistics (new)
  linRegRSquared: { enabled: boolean; period: number; color?: string; style?: SubplotStyle };
  medianPrice: { enabled: boolean; color?: string; lineWidth?: number };
  typicalPrice: { enabled: boolean; color?: string; lineWidth?: number };
  weightedClose: { enabled: boolean; color?: string; lineWidth?: number };
  demarkPivots: { enabled: boolean; pivotColor?: string; resistanceColor?: string; supportColor?: string; lineWidth?: number };
  zigzag: { enabled: boolean; deviation: number; color?: string; lineWidth?: number };
  fractals: { enabled: boolean; upColor?: string; downColor?: string };
  gator: { enabled: boolean; upperColor?: string; lowerColor?: string; style?: SubplotStyle };
  // Custom formula indicators
  customIndicators?: {
    id: string;
    name: string;
    expression: string;
    enabled: boolean;
    display: 'overlay' | 'subplot';
    color: string;
    lineWidth: number;
    zeroLine: boolean;
  }[];
  // Custom Brue Scripts. Each entry is a placed *instance* of a saved script,
  // not the script source itself. The recipe lives in brue_scripts (DB); this
  // record holds the per-chart-instance state: a cached copy of the source
  // (so headless rendering doesn't need a round-trip to fetch it), the
  // current input() override values, and any visual style overrides. `inputs`
  // maps input-id (first positional arg or id= kwarg of input()) to the value
  // the user picked from the settings dialog. Empty `inputs` means "use
  // defaults", which matches pre-instance behaviour and lets persisted records
  // upgrade in place without migration.
  customBrueScripts?: Record<string, {
    enabled: boolean;
    name: string;
    code: string;
    inputs?: Record<string, string | number | boolean>;
    style?: { color?: string; lineWidth?: number };
  }>;
}

/** Default indicator config with all 105 indicators initialized to disabled.
 *  Single source of truth so ChartView, BrokerChartView, Backtesting, etc.
 *  stay in sync. New indicators MUST be added here or they won't be toggleable
 *  (the IndicatorSelector checks config[key] and silently skips undefined keys). */
export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {
  // Core indicators
  rsi: { enabled: false, period: 14, overbought: 70, oversold: 30 },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
  ema: { enabled: false, periods: [20, 50] },
  bollinger: { enabled: false, period: 20, stdDev: 2 },
  // 20 EMA enabled by default so new users see a useful overlay on first chart load,
  // even without signing up. #2962FF is a clean blue that stands out on both light and dark
  // backgrounds without needing theme-adaptive color swapping.
  movingAverages: { enabled: true, lines: [{ type: 'EMA', period: 20, color: '#2962FF' }] },
  atr: { enabled: false, period: 14 },
  stochastic: { enabled: false, kPeriod: 14, dPeriod: 3, smooth: 3, overbought: 80, oversold: 20 },
  volume: { enabled: false },
  williamsR: { enabled: false, period: 14, overbought: -20, oversold: -80 },
  cci: { enabled: false, period: 20, overbought: 100, oversold: -100 },
  adx: { enabled: false, period: 14 },
  roc: { enabled: false, period: 12 },
  vwap: { enabled: false },
  ichimoku: { enabled: false, tenkanPeriod: 9, kijunPeriod: 26, senkouBPeriod: 52, displacement: 26 },
  parabolicSAR: { enabled: false, afStart: 0.02, afStep: 0.02, afMax: 0.2 },
  keltner: { enabled: false, emaPeriod: 20, atrPeriod: 10, multiplier: 2 },
  pivotPoints: { enabled: false },
  volumeProfile: { enabled: false, numberOfRows: 48, rowWidth: 15, opacity: 60 },
  optionsPdf: { enabled: false, color: '#00C8C8', endSpread: 7, opacity: 80 },
  // Phase 1 trend
  supertrend: { enabled: false, period: 10, multiplier: 3 },
  donchian: { enabled: false, period: 20 },
  aroon: { enabled: false, period: 14 },
  envelopes: { enabled: false, period: 20, percent: 2.5 },
  dema: { enabled: false, period: 21 },
  tema: { enabled: false, period: 21 },
  hma: { enabled: false, period: 9 },
  // Phase 1 oscillators
  momentum: { enabled: false, period: 10 },
  ao: { enabled: false },
  mfi: { enabled: false, period: 14, overbought: 80, oversold: 20 },
  tsi: { enabled: false, longPeriod: 25, shortPeriod: 13, signalPeriod: 13 },
  trix: { enabled: false, period: 15, signalPeriod: 9 },
  ultimateOsc: { enabled: false, fast: 7, med: 14, slow: 28 },
  dpo: { enabled: false, period: 20 },
  kst: { enabled: false, signalPeriod: 9 },
  stochRsi: { enabled: false, rsiPeriod: 14, kPeriod: 14, dPeriod: 3, overbought: 80, oversold: 20 },
  // Phase 1 volatility
  bbPercent: { enabled: false, period: 20, stdDev: 2 },
  bbWidth: { enabled: false, period: 20, stdDev: 2 },
  histVol: { enabled: false, period: 20 },
  chaikinVol: { enabled: false, emaPeriod: 10, rocPeriod: 10 },
  stdDev: { enabled: false, period: 20 },
  // Phase 1 volume
  obv: { enabled: false },
  cmf: { enabled: false, period: 20 },
  adl: { enabled: false },
  forceIndex: { enabled: false, period: 13 },
  eom: { enabled: false, period: 14 },
  volumeSma: { enabled: false, period: 20 },
  // Phase 1 support/resistance
  fibRetracement: { enabled: false, lookback: 100 },
  camarillaPivots: { enabled: false },
  woodiePivots: { enabled: false },
  // Phase 1 statistics
  correlation: { enabled: false, period: 20 },
  linearReg: { enabled: false, period: 14, deviations: 2 },
  coppock: { enabled: false, longROC: 14, shortROC: 11, wmaPeriod: 10 },
  // Phase 2 trend
  alma: { enabled: false, period: 9, offset: 0.85, sigma: 6 },
  kama: { enabled: false, period: 10, fastPeriod: 2, slowPeriod: 30 },
  zlema: { enabled: false, period: 21 },
  t3: { enabled: false, period: 5, vFactor: 0.7 },
  lsma: { enabled: false, period: 25 },
  mcginley: { enabled: false, period: 14 },
  wma: { enabled: false, period: 20 },
  smmaOverlay: { enabled: false, period: 21 },
  alligator: { enabled: false },
  vortex: { enabled: false, period: 14 },
  choppiness: { enabled: false, period: 14 },
  elderRay: { enabled: false, period: 13 },
  massIndex: { enabled: false, period: 25 },
  chandeKroll: { enabled: false, p: 10, q: 9, x: 1 },
  linRegSlope: { enabled: false, period: 14 },
  priceChannel: { enabled: false, period: 20 },
  // Phase 2 oscillators
  ppo: { enabled: false, fast: 12, slow: 26, signal: 9 },
  pvo: { enabled: false, fast: 12, slow: 26, signal: 9 },
  cmo: { enabled: false, period: 9 },
  fisher: { enabled: false, period: 10 },
  stc: { enabled: false, fast: 23, slow: 50, cycle: 10 },
  rviOsc: { enabled: false, period: 10 },
  klinger: { enabled: false, fast: 34, slow: 55, signal: 13 },
  connorsRsi: { enabled: false, rsiPeriod: 3, streakPeriod: 2, rankPeriod: 100 },
  apo: { enabled: false, fast: 12, slow: 26 },
  qstick: { enabled: false, period: 8 },
  bop: { enabled: false, period: 14 },
  psychLine: { enabled: false, period: 12 },
  pfe: { enabled: false, period: 10, smoothing: 5 },
  smi: { enabled: false, period: 13, smoothK: 25, smoothD: 2 },
  // Phase 2 volatility
  ulcerIndex: { enabled: false, period: 14 },
  natr: { enabled: false, period: 14 },
  trueRange: { enabled: false },
  squeeze: { enabled: false, bbPeriod: 20, bbMult: 2, kcPeriod: 20, kcMult: 1.5 },
  chandelierExit: { enabled: false, period: 22, multiplier: 3 },
  relVolIndex: { enabled: false, period: 10, smoothing: 14 },
  vhf: { enabled: false, period: 28 },
  accBands: { enabled: false, period: 20 },
  // Phase 2 volume
  vwma: { enabled: false, period: 20 },
  volumeOsc: { enabled: false, fast: 5, slow: 10 },
  nvi: { enabled: false },
  pvi: { enabled: false },
  pvt: { enabled: false },
  vroc: { enabled: false, period: 14 },
  netVolume: { enabled: false, period: 14 },
  twiggsMF: { enabled: false, period: 14 },
  // Phase 2 support/resistance
  demarkPivots: { enabled: false },
  zigzag: { enabled: false, deviation: 5 },
  fractals: { enabled: false },
  // Phase 2 statistics
  linRegRSquared: { enabled: false, period: 14 },
  medianPrice: { enabled: false },
  typicalPrice: { enabled: false },
  weightedClose: { enabled: false },
  gator: { enabled: false },
  customBrueScripts: {},
} as IndicatorConfig;

/** Config with ALL indicators disabled, including the default EMA 20.
 *  Used by the "Remove indicators" action so every indicator actually gets
 *  removed. Without this, clearing would reset to DEFAULT_INDICATOR_CONFIG
 *  which has movingAverages.enabled=true, making the EMA 20 impossible to
 *  remove via the bulk-clear button. */
export const CLEARED_INDICATOR_CONFIG: IndicatorConfig = {
  ...DEFAULT_INDICATOR_CONFIG,
  movingAverages: { enabled: false, lines: [] },
};

interface IndicatorSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: IndicatorConfig;
  onConfigChange: (config: IndicatorConfig) => void;
}

const MA_COLORS = ['#FFD700', '#FF6B6B', '#4ECDC4', '#95E1D3', '#F38181', '#9B59B6', '#3498DB', '#E67E22'];

export default function IndicatorSettings({
  open,
  onOpenChange,
  config,
  onConfigChange,
}: IndicatorSettingsProps) {
  const [localConfig, setLocalConfig] = useState(config);

  useEffect(() => {
    if (open) {
      setLocalConfig(config);
    }
  }, [config, open]);

  const handleSave = () => {
    onConfigChange(localConfig);
    onOpenChange(false);
  };

  const updateRSI = (updates: Partial<typeof localConfig.rsi>) => {
    setLocalConfig({ ...localConfig, rsi: { ...localConfig.rsi, ...updates } });
  };

  const updateMACD = (updates: Partial<typeof localConfig.macd>) => {
    setLocalConfig({ ...localConfig, macd: { ...localConfig.macd, ...updates } });
  };

  const updateBollinger = (updates: Partial<typeof localConfig.bollinger>) => {
    setLocalConfig({ ...localConfig, bollinger: { ...localConfig.bollinger, ...updates } });
  };

  const updateMA = (updates: Partial<typeof localConfig.movingAverages>) => {
    setLocalConfig({ ...localConfig, movingAverages: { ...localConfig.movingAverages, ...updates } });
  };

  const updateATR = (updates: Partial<typeof localConfig.atr>) => {
    setLocalConfig({ ...localConfig, atr: { ...localConfig.atr, ...updates } });
  };

  const updateStochastic = (updates: Partial<typeof localConfig.stochastic>) => {
    setLocalConfig({ ...localConfig, stochastic: { ...localConfig.stochastic, ...updates } });
  };

  const updateWilliamsR = (updates: Partial<typeof localConfig.williamsR>) => {
    setLocalConfig({ ...localConfig, williamsR: { ...(localConfig.williamsR || { enabled: false, period: 14, overbought: -20, oversold: -80 }), ...updates } });
  };

  const updateCCI = (updates: Partial<typeof localConfig.cci>) => {
    setLocalConfig({ ...localConfig, cci: { ...(localConfig.cci || { enabled: false, period: 20, overbought: 100, oversold: -100 }), ...updates } });
  };

  const updateADX = (updates: Partial<typeof localConfig.adx>) => {
    setLocalConfig({ ...localConfig, adx: { ...(localConfig.adx || { enabled: false, period: 14 }), ...updates } });
  };

  const updateROC = (updates: Partial<typeof localConfig.roc>) => {
    setLocalConfig({ ...localConfig, roc: { ...(localConfig.roc || { enabled: false, period: 12 }), ...updates } });
  };

  const updateVWAP = (updates: Partial<typeof localConfig.vwap>) => {
    setLocalConfig({ ...localConfig, vwap: { ...(localConfig.vwap || { enabled: false }), ...updates } });
  };

  const updateIchimoku = (updates: Partial<typeof localConfig.ichimoku>) => {
    setLocalConfig({ ...localConfig, ichimoku: { ...(localConfig.ichimoku || { enabled: false, tenkanPeriod: 9, kijunPeriod: 26, senkouBPeriod: 52, displacement: 26 }), ...updates } });
  };

  const updateParabolicSAR = (updates: Partial<typeof localConfig.parabolicSAR>) => {
    setLocalConfig({ ...localConfig, parabolicSAR: { ...(localConfig.parabolicSAR || { enabled: false, afStart: 0.02, afStep: 0.02, afMax: 0.2 }), ...updates } });
  };

  const updateKeltner = (updates: Partial<typeof localConfig.keltner>) => {
    setLocalConfig({ ...localConfig, keltner: { ...(localConfig.keltner || { enabled: false, emaPeriod: 20, atrPeriod: 10, multiplier: 2 }), ...updates } });
  };

  const updatePivotPoints = (updates: Partial<typeof localConfig.pivotPoints>) => {
    setLocalConfig({ ...localConfig, pivotPoints: { ...(localConfig.pivotPoints || { enabled: false }), ...updates } });
  };

  const updateVolumeProfile = (updates: Partial<typeof localConfig.volumeProfile>) => {
    setLocalConfig({ ...localConfig, volumeProfile: { ...(localConfig.volumeProfile || { enabled: false, numberOfRows: 24, rowWidth: 20, opacity: 50 }), ...updates } });
  };

  const addMALine = () => {
    const lines = localConfig.movingAverages.lines;
    const nextColor = MA_COLORS[lines.length % MA_COLORS.length];
    updateMA({ lines: [...lines, { type: 'EMA' as MAType, period: 20, color: nextColor, lineWidth: 1 }] });
  };

  const removeMALine = (index: number) => {
    updateMA({ lines: localConfig.movingAverages.lines.filter((_, i) => i !== index) });
  };

  const updateMALine = (index: number, updates: Partial<MAConfig>) => {
    const newLines = [...localConfig.movingAverages.lines];
    newLines[index] = { ...newLines[index], ...updates };
    updateMA({ lines: newLines });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/40 max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-medium">Indicators</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Moving Averages - Combined Section */}
          <IndicatorSection
            title="Moving Averages"
            enabled={localConfig.movingAverages.enabled}
            onToggle={() => updateMA({ enabled: !localConfig.movingAverages.enabled })}
          >
            <div className="space-y-3">
              {/* Global Line Width */}
              <div className="pb-2 border-b border-border/30">
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs text-muted-foreground">Line Width</Label>
                  <span className="text-xs text-muted-foreground">{localConfig.movingAverages.lineWidth ?? 1}px</span>
                </div>
                <Slider
                  value={[localConfig.movingAverages.lineWidth ?? 1]}
                  onValueChange={([val]) => updateMA({ lineWidth: val })}
                  min={1}
                  max={5}
                  step={1}
                  className="mt-1"
                />
              </div>

              {localConfig.movingAverages.lines.map((line, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Select
                    value={line.type}
                    onValueChange={(val) => updateMALine(index, { type: val as MAType })}
                  >
                    <SelectTrigger className="w-20 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SMA">SMA</SelectItem>
                      <SelectItem value="EMA">EMA</SelectItem>
                      <SelectItem value="SMMA">SMMA</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    value={line.period || ""}
                    onChange={(e) => updateMALine(index, { period: parseInt(e.target.value) || 0 })}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!val || val < 1) updateMALine(index, { period: 20 });
                    }}
                    className="h-8 w-20 text-xs"
                    min="1"
                    placeholder="Period"
                  />
                  <input
                    type="color"
                    value={line.color}
                    onChange={(e) => updateMALine(index, { color: e.target.value })}
                    className="w-8 h-8 rounded cursor-pointer border-0"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeMALine(index)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={addMALine}
                className="w-full h-8 text-xs"
              >
                <Plus className="h-3 w-3 mr-1" /> Add Line
              </Button>
            </div>
          </IndicatorSection>

          {/* Bollinger Bands */}
          <IndicatorSection
            title="Bollinger Bands"
            enabled={localConfig.bollinger.enabled}
            onToggle={() => updateBollinger({ enabled: !localConfig.bollinger.enabled })}
          >
            <div className="grid grid-cols-2 gap-3">
              <InputField
                label="Period"
                value={localConfig.bollinger.period}
                onChange={(val) => updateBollinger({ period: val })}
              />
              <InputField
                label="Std Dev"
                value={localConfig.bollinger.stdDev}
                onChange={(val) => updateBollinger({ stdDev: val })}
                step={0.1}
              />
            </div>
          </IndicatorSection>

          {/* RSI */}
          <IndicatorSection
            title="RSI"
            enabled={localConfig.rsi.enabled}
            onToggle={() => updateRSI({ enabled: !localConfig.rsi.enabled })}
          >
            <div className="space-y-3">
              <InputField
                label="Period"
                value={localConfig.rsi.period}
                onChange={(val) => updateRSI({ period: val })}
              />
              <SliderField
                label="Overbought"
                value={localConfig.rsi.overbought}
                onChange={(val) => updateRSI({ overbought: val })}
                min={50}
                max={100}
              />
              <SliderField
                label="Oversold"
                value={localConfig.rsi.oversold}
                onChange={(val) => updateRSI({ oversold: val })}
                min={0}
                max={50}
              />
            </div>
          </IndicatorSection>

          {/* MACD */}
          <IndicatorSection
            title="MACD"
            enabled={localConfig.macd.enabled}
            onToggle={() => updateMACD({ enabled: !localConfig.macd.enabled })}
          >
            <div className="grid grid-cols-3 gap-2">
              <InputField label="Fast" value={localConfig.macd.fast} onChange={(val) => updateMACD({ fast: val })} />
              <InputField label="Slow" value={localConfig.macd.slow} onChange={(val) => updateMACD({ slow: val })} />
              <InputField label="Signal" value={localConfig.macd.signal} onChange={(val) => updateMACD({ signal: val })} />
            </div>
          </IndicatorSection>

          {/* ATR */}
          <IndicatorSection
            title="ATR"
            enabled={localConfig.atr.enabled}
            onToggle={() => updateATR({ enabled: !localConfig.atr.enabled })}
          >
            <InputField
              label="Period"
              value={localConfig.atr.period}
              onChange={(val) => updateATR({ period: val })}
            />
          </IndicatorSection>

          {/* Stochastic */}
          <IndicatorSection
            title="Stochastic"
            enabled={localConfig.stochastic.enabled}
            onToggle={() => updateStochastic({ enabled: !localConfig.stochastic.enabled })}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <InputField label="%K" value={localConfig.stochastic.kPeriod} onChange={(val) => updateStochastic({ kPeriod: val })} />
                <InputField label="%D" value={localConfig.stochastic.dPeriod} onChange={(val) => updateStochastic({ dPeriod: val })} />
                <InputField label="Smooth" value={localConfig.stochastic.smooth} onChange={(val) => updateStochastic({ smooth: val })} />
              </div>
              <SliderField
                label="Overbought"
                value={localConfig.stochastic.overbought}
                onChange={(val) => updateStochastic({ overbought: val })}
                min={50}
                max={100}
              />
              <SliderField
                label="Oversold"
                value={localConfig.stochastic.oversold}
                onChange={(val) => updateStochastic({ oversold: val })}
                min={0}
                max={50}
              />
            </div>
          </IndicatorSection>

          {/* Volume */}
          <IndicatorSection
            title="Volume"
            enabled={localConfig.volume?.enabled ?? false}
            onToggle={() => setLocalConfig({
              ...localConfig,
              volume: { enabled: !(localConfig.volume?.enabled ?? false) }
            })}
          >
            <p className="text-xs text-muted-foreground">
              Displays trading volume as bars below the price chart.
            </p>
          </IndicatorSection>

          {/* Williams %R */}
          <IndicatorSection
            title="Williams %R"
            enabled={localConfig.williamsR?.enabled ?? false}
            onToggle={() => updateWilliamsR({ enabled: !(localConfig.williamsR?.enabled ?? false) })}
          >
            <div className="space-y-3">
              <InputField
                label="Period"
                value={localConfig.williamsR?.period ?? 14}
                onChange={(val) => updateWilliamsR({ period: val })}
              />
              <SliderField
                label="Overbought"
                value={localConfig.williamsR?.overbought ?? -20}
                onChange={(val) => updateWilliamsR({ overbought: val })}
                min={-50}
                max={0}
              />
              <SliderField
                label="Oversold"
                value={localConfig.williamsR?.oversold ?? -80}
                onChange={(val) => updateWilliamsR({ oversold: val })}
                min={-100}
                max={-50}
              />
            </div>
          </IndicatorSection>

          {/* CCI */}
          <IndicatorSection
            title="CCI (Commodity Channel Index)"
            enabled={localConfig.cci?.enabled ?? false}
            onToggle={() => updateCCI({ enabled: !(localConfig.cci?.enabled ?? false) })}
          >
            <div className="space-y-3">
              <InputField
                label="Period"
                value={localConfig.cci?.period ?? 20}
                onChange={(val) => updateCCI({ period: val })}
              />
              <InputField
                label="Overbought"
                value={localConfig.cci?.overbought ?? 100}
                onChange={(val) => updateCCI({ overbought: val })}
              />
              <InputField
                label="Oversold"
                value={localConfig.cci?.oversold ?? -100}
                onChange={(val) => updateCCI({ oversold: val })}
              />
            </div>
          </IndicatorSection>

          {/* ADX */}
          <IndicatorSection
            title="ADX (Average Directional Index)"
            enabled={localConfig.adx?.enabled ?? false}
            onToggle={() => updateADX({ enabled: !(localConfig.adx?.enabled ?? false) })}
          >
            <div className="space-y-2">
              <InputField
                label="Period"
                value={localConfig.adx?.period ?? 14}
                onChange={(val) => updateADX({ period: val })}
              />
              <p className="text-xs text-muted-foreground">
                Shows ADX line with +DI and -DI directional indicators.
              </p>
            </div>
          </IndicatorSection>

          {/* ROC */}
          <IndicatorSection
            title="ROC (Rate of Change)"
            enabled={localConfig.roc?.enabled ?? false}
            onToggle={() => updateROC({ enabled: !(localConfig.roc?.enabled ?? false) })}
          >
            <InputField
              label="Period"
              value={localConfig.roc?.period ?? 12}
              onChange={(val) => updateROC({ period: val })}
            />
          </IndicatorSection>

          {/* VWAP */}
          <IndicatorSection
            title="VWAP"
            enabled={localConfig.vwap?.enabled ?? false}
            onToggle={() => updateVWAP({ enabled: !(localConfig.vwap?.enabled ?? false) })}
          >
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Volume Weighted Average Price - resets each trading day.
              </p>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs text-muted-foreground">Line Width</Label>
                  <span className="text-xs text-muted-foreground">{localConfig.vwap?.lineWidth ?? 1}px</span>
                </div>
                <Slider
                  value={[localConfig.vwap?.lineWidth ?? 1]}
                  onValueChange={([val]) => updateVWAP({ lineWidth: val })}
                  min={1}
                  max={5}
                  step={1}
                  className="mt-1"
                />
              </div>
            </div>
          </IndicatorSection>

          {/* Ichimoku Cloud */}
          <IndicatorSection
            title="Ichimoku Cloud"
            enabled={localConfig.ichimoku?.enabled ?? false}
            onToggle={() => updateIchimoku({ enabled: !(localConfig.ichimoku?.enabled ?? false) })}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <InputField
                  label="Tenkan"
                  value={localConfig.ichimoku?.tenkanPeriod ?? 9}
                  onChange={(val) => updateIchimoku({ tenkanPeriod: val })}
                />
                <InputField
                  label="Kijun"
                  value={localConfig.ichimoku?.kijunPeriod ?? 26}
                  onChange={(val) => updateIchimoku({ kijunPeriod: val })}
                />
                <InputField
                  label="Senkou B"
                  value={localConfig.ichimoku?.senkouBPeriod ?? 52}
                  onChange={(val) => updateIchimoku({ senkouBPeriod: val })}
                />
                <InputField
                  label="Displacement"
                  value={localConfig.ichimoku?.displacement ?? 26}
                  onChange={(val) => updateIchimoku({ displacement: val })}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs text-muted-foreground">Line Width</Label>
                  <span className="text-xs text-muted-foreground">{localConfig.ichimoku?.lineWidth ?? 1}px</span>
                </div>
                <Slider
                  value={[localConfig.ichimoku?.lineWidth ?? 1]}
                  onValueChange={([val]) => updateIchimoku({ lineWidth: val })}
                  min={1}
                  max={5}
                  step={1}
                  className="mt-1"
                />
              </div>
            </div>
          </IndicatorSection>

          {/* Parabolic SAR */}
          <IndicatorSection
            title="Parabolic SAR"
            enabled={localConfig.parabolicSAR?.enabled ?? false}
            onToggle={() => updateParabolicSAR({ enabled: !(localConfig.parabolicSAR?.enabled ?? false) })}
          >
            <div className="grid grid-cols-3 gap-2">
              <InputField
                label="AF Start"
                value={localConfig.parabolicSAR?.afStart ?? 0.02}
                onChange={(val) => updateParabolicSAR({ afStart: val })}
                step={0.01}
              />
              <InputField
                label="AF Step"
                value={localConfig.parabolicSAR?.afStep ?? 0.02}
                onChange={(val) => updateParabolicSAR({ afStep: val })}
                step={0.01}
              />
              <InputField
                label="AF Max"
                value={localConfig.parabolicSAR?.afMax ?? 0.2}
                onChange={(val) => updateParabolicSAR({ afMax: val })}
                step={0.01}
              />
            </div>
          </IndicatorSection>

          {/* Keltner Channels */}
          <IndicatorSection
            title="Keltner Channels"
            enabled={localConfig.keltner?.enabled ?? false}
            onToggle={() => updateKeltner({ enabled: !(localConfig.keltner?.enabled ?? false) })}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <InputField
                  label="EMA Period"
                  value={localConfig.keltner?.emaPeriod ?? 20}
                  onChange={(val) => updateKeltner({ emaPeriod: val })}
                />
                <InputField
                  label="ATR Period"
                  value={localConfig.keltner?.atrPeriod ?? 10}
                  onChange={(val) => updateKeltner({ atrPeriod: val })}
                />
                <InputField
                  label="Multiplier"
                  value={localConfig.keltner?.multiplier ?? 2}
                  onChange={(val) => updateKeltner({ multiplier: val })}
                  step={0.5}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs text-muted-foreground">Line Width</Label>
                  <span className="text-xs text-muted-foreground">{localConfig.keltner?.lineWidth ?? 1}px</span>
                </div>
                <Slider
                  value={[localConfig.keltner?.lineWidth ?? 1]}
                  onValueChange={([val]) => updateKeltner({ lineWidth: val })}
                  min={1}
                  max={5}
                  step={1}
                  className="mt-1"
                />
              </div>
            </div>
          </IndicatorSection>

          {/* Pivot Points */}
          <IndicatorSection
            title="Pivot Points"
            enabled={localConfig.pivotPoints?.enabled ?? false}
            onToggle={() => updatePivotPoints({ enabled: !(localConfig.pivotPoints?.enabled ?? false) })}
          >
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Shows daily Pivot, R1-R3 resistance and S1-S3 support levels.
              </p>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs text-muted-foreground">Line Width</Label>
                  <span className="text-xs text-muted-foreground">{localConfig.pivotPoints?.lineWidth ?? 1}px</span>
                </div>
                <Slider
                  value={[localConfig.pivotPoints?.lineWidth ?? 1]}
                  onValueChange={([val]) => updatePivotPoints({ lineWidth: val })}
                  min={1}
                  max={5}
                  step={1}
                  className="mt-1"
                />
              </div>
            </div>
          </IndicatorSection>

          {/* Volume Profile */}
          <IndicatorSection
            title="Volume Profile"
            enabled={localConfig.volumeProfile?.enabled ?? false}
            onToggle={() => updateVolumeProfile({ enabled: !(localConfig.volumeProfile?.enabled ?? false) })}
          >
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Shows volume distribution at each price level as horizontal bars.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs text-muted-foreground">Price Rows</Label>
                    <span className="text-xs text-muted-foreground">{localConfig.volumeProfile?.numberOfRows ?? 48}</span>
                  </div>
                  <Slider
                    value={[localConfig.volumeProfile?.numberOfRows ?? 48]}
                    onValueChange={([val]) => updateVolumeProfile({ numberOfRows: val })}
                    min={24}
                    max={96}
                    step={8}
                    className="mt-1"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs text-muted-foreground">Bar Width %</Label>
                    <span className="text-xs text-muted-foreground">{localConfig.volumeProfile?.rowWidth ?? 15}%</span>
                  </div>
                  <Slider
                    value={[localConfig.volumeProfile?.rowWidth ?? 15]}
                    onValueChange={([val]) => updateVolumeProfile({ rowWidth: val })}
                    min={5}
                    max={30}
                    step={5}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs text-muted-foreground">Lookback Bars</Label>
                    <span className="text-xs text-muted-foreground">{localConfig.volumeProfile?.lookbackBars ?? 0}</span>
                  </div>
                  <Slider
                    value={[localConfig.volumeProfile?.lookbackBars ?? 0]}
                    onValueChange={([val]) => updateVolumeProfile({ lookbackBars: val })}
                    min={0}
                    max={500}
                    step={50}
                    className="mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">0 = all visible bars</p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs text-muted-foreground">Opacity</Label>
                    <span className="text-xs text-muted-foreground">{localConfig.volumeProfile?.opacity ?? 60}%</span>
                  </div>
                  <Slider
                    value={[localConfig.volumeProfile?.opacity ?? 60]}
                    onValueChange={([val]) => updateVolumeProfile({ opacity: val })}
                    min={20}
                    max={100}
                    step={10}
                    className="mt-1"
                  />
                </div>
              </div>
              {/* Color pickers */}
              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border/30">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Up Bars</Label>
                  <input
                    type="color"
                    value={localConfig.volumeProfile?.upColor ?? '#D97706'}
                    onChange={(e) => updateVolumeProfile({ upColor: e.target.value })}
                    className="w-full h-8 rounded cursor-pointer border border-border/50"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Down Bars</Label>
                  <input
                    type="color"
                    value={localConfig.volumeProfile?.downColor ?? '#1E3A8A'}
                    onChange={(e) => updateVolumeProfile({ downColor: e.target.value })}
                    className="w-full h-8 rounded cursor-pointer border border-border/50"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">POC Line</Label>
                  <input
                    type="color"
                    value={localConfig.volumeProfile?.pocColor ?? '#10B981'}
                    onChange={(e) => updateVolumeProfile({ pocColor: e.target.value })}
                    className="w-full h-8 rounded cursor-pointer border border-border/50"
                  />
                </div>
              </div>
            </div>
          </IndicatorSection>
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-border/30">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Reusable section component
function IndicatorSection({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg border border-border/30 bg-background/50">
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm font-medium">{title}</Label>
        <Button
          size="sm"
          variant={enabled ? "default" : "outline"}
          onClick={onToggle}
          className="h-6 text-xs px-3"
        >
          {enabled ? "ON" : "OFF"}
        </Button>
      </div>
      {enabled && <div className="mt-3">{children}</div>}
    </div>
  );
}

// Reusable input field
function InputField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  step?: number;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="mt-1 h-8 text-xs"
        step={step}
        min={step === 0.1 ? 0.1 : 1}
      />
    </div>
  );
}

// Reusable slider field
function SliderField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs text-muted-foreground">{value}</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([val]) => onChange(val)}
        min={min}
        max={max}
        step={1}
        className="mt-1"
      />
    </div>
  );
}