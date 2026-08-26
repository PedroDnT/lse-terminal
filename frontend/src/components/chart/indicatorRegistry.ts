/**
 * Indicator Registry: data-driven config for all indicator settings panels.
 * To add a new indicator:
 *   1. Add its type to IndicatorType in IndicatorPanelSettings.tsx
 *   2. Add its config shape to IndicatorConfig in IndicatorSettings.tsx
 *   3. Add ONE entry here; the settings panel, title, and remove logic are auto-generated.
 */

export interface ParamDef {
    key: string;        // property name in indicator config (e.g. 'period')
    label: string;      // display label
    type: 'int' | 'float';
    default: number;
    min: number;
    max?: number;
    step?: number;
}

export interface ColorDef {
    key: string;        // property name (e.g. 'color', 'bullishColor')
    label: string;
    default: string;    // hex color
}

export interface SliderDef {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    default: number;
}

export interface IndicatorMeta {
    /** Config key in IndicatorConfig (e.g. 'cmf', 'supertrend') */
    configKey: string;
    /** Title template: use {param} placeholders, e.g. "CMF ({period})" */
    title: string;
    /** Optional description text */
    description?: string;
    /** Parameter inputs: layout is auto: 1=stack, 2=grid-2, 3=grid-3 */
    params?: ParamDef[];
    /** Color pickers */
    colors?: ColorDef[];
    /** Sliders (for overbought/oversold etc.) */
    sliders?: SliderDef[];
    /** Line width slider config, or true for default (0.5-4, step 0.5, default 1.5) */
    lineWidth?: { key: string; default: number } | true;
    /** Whether to render the panel style settings (background/opacity) */
    hasStyle?: boolean;
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const INDICATOR_REGISTRY: Record<string, IndicatorMeta> = {
    // ── Core (already had settings, now also in registry for title/remove) ──
    rsi: {
        configKey: 'rsi',
        title: 'RSI ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }],
        sliders: [
            { key: 'overbought', label: 'Overbought', min: 50, max: 100, step: 1, default: 70 },
            { key: 'oversold', label: 'Oversold', min: 0, max: 50, step: 1, default: 30 },
        ],
        colors: [
            { key: 'style.labelColor', label: 'Label Color', default: '#d1d5db' },
            { key: 'color', label: 'Line Color', default: '#E74C3C' },
        ],
        lineWidth: { key: 'style.lineWidth', default: 1.5 },
        hasStyle: true,
    },

    macd: {
        configKey: 'macd',
        title: 'MACD ({fast}, {slow}, {signal})',
        params: [
            { key: 'fast', label: 'Fast', type: 'int', default: 12, min: 1 },
            { key: 'slow', label: 'Slow', type: 'int', default: 26, min: 1 },
            { key: 'signal', label: 'Signal', type: 'int', default: 9, min: 1 },
        ],
        colors: [
            { key: 'style.labelColor', label: 'Label Color', default: '#666666' },
            { key: 'macdColor', label: 'MACD Line', default: '#3498DB' },
            { key: 'signalColor', label: 'Signal Line', default: '#E67E22' },
            { key: 'histogramUpColor', label: 'Histogram Up', default: '#26a69a' },
            { key: 'histogramDownColor', label: 'Histogram Down', default: '#ef5350' },
        ],
        hasStyle: true,
    },

    atr: {
        configKey: 'atr',
        title: 'ATR ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }],
        colors: [
            { key: 'style.labelColor', label: 'Label Color', default: '#666666' },
            { key: 'color', label: 'Line Color', default: '#17a2b8' },
        ],
        lineWidth: { key: 'style.lineWidth', default: 1.5 },
        hasStyle: true,
    },

    stochastic: {
        configKey: 'stochastic',
        title: 'Stochastic ({kPeriod}, {dPeriod})',
        params: [
            { key: 'kPeriod', label: '%K', type: 'int', default: 14, min: 1 },
            { key: 'dPeriod', label: '%D', type: 'int', default: 3, min: 1 },
            { key: 'smooth', label: 'Smooth', type: 'int', default: 3, min: 1 },
        ],
        sliders: [
            { key: 'overbought', label: 'Overbought', min: 50, max: 100, step: 1, default: 80 },
            { key: 'oversold', label: 'Oversold', min: 0, max: 50, step: 1, default: 20 },
        ],
        colors: [
            { key: 'style.labelColor', label: 'Label Color', default: '#666666' },
            { key: 'kColor', label: '%K Line', default: '#3498DB' },
            { key: 'dColor', label: '%D Line', default: '#E67E22' },
        ],
        hasStyle: true,
    },

    volume: {
        configKey: 'volume',
        title: 'Volume',
        description: 'Volume bars show trading activity.',
        colors: [
            { key: 'style.labelColor', label: 'Label Color', default: '#ffffff' },
            { key: 'upColor', label: 'Up Bars', default: '#26a69a' },
            { key: 'downColor', label: 'Down Bars', default: '#ef5350' },
        ],
        hasStyle: true,
    },

    bollinger: {
        configKey: 'bollinger',
        title: 'Bollinger Bands ({period}, {stdDev})',
        params: [
            { key: 'period', label: 'Period', type: 'int', default: 20, min: 1 },
            { key: 'stdDev', label: 'Std Dev', type: 'float', default: 2, min: 0.1, step: 0.1 },
        ],
        colors: [
            { key: 'upperColor', label: 'Upper Band', default: '#9B59B6' },
            { key: 'middleColor', label: 'Middle Band', default: '#9B59B6' },
            { key: 'lowerColor', label: 'Lower Band', default: '#9B59B6' },
        ],
        lineWidth: { key: 'lineWidth', default: 1 },
    },

    williamsR: {
        configKey: 'williamsR',
        title: 'Williams %R ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }],
        sliders: [
            { key: 'overbought', label: 'Overbought', min: -50, max: 0, step: 1, default: -20 },
            { key: 'oversold', label: 'Oversold', min: -100, max: -50, step: 1, default: -80 },
        ],
        colors: [
            { key: 'style.labelColor', label: 'Label Color', default: '#666666' },
            { key: 'color', label: 'Line Color', default: '#E91E63' },
        ],
        lineWidth: { key: 'style.lineWidth', default: 1.5 },
        hasStyle: true,
    },

    cci: {
        configKey: 'cci',
        title: 'CCI ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }],
        sliders: [
            { key: 'overbought', label: 'Overbought', min: 50, max: 300, step: 10, default: 100 },
            { key: 'oversold', label: 'Oversold', min: -300, max: -50, step: 10, default: -100 },
        ],
        colors: [
            { key: 'style.labelColor', label: 'Label Color', default: '#666666' },
            { key: 'color', label: 'Line Color', default: '#00BCD4' },
        ],
        lineWidth: { key: 'style.lineWidth', default: 1.5 },
        hasStyle: true,
    },

    adx: {
        configKey: 'adx',
        title: 'ADX ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }],
        colors: [
            { key: 'style.labelColor', label: 'Label Color', default: '#666666' },
            { key: 'adxColor', label: 'ADX Line', default: '#FFEB3B' },
            { key: 'plusDIColor', label: '+DI Line', default: '#22c55e' },
            { key: 'minusDIColor', label: '-DI Line', default: '#ef4444' },
        ],
        lineWidth: { key: 'style.lineWidth', default: 1.5 },
        hasStyle: true,
    },

    roc: {
        configKey: 'roc',
        title: 'ROC ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 12, min: 1 }],
        colors: [
            { key: 'style.labelColor', label: 'Label Color', default: '#666666' },
            { key: 'color', label: 'Line Color', default: '#9C27B0' },
        ],
        lineWidth: { key: 'style.lineWidth', default: 1.5 },
        hasStyle: true,
    },

    vwap: {
        configKey: 'vwap',
        title: 'VWAP',
        description: 'Volume Weighted Average Price resets daily.',
        colors: [{ key: 'color', label: 'Line Color', default: '#2196F3' }],
        lineWidth: { key: 'lineWidth', default: 1.5 },
    },

    ichimoku: {
        configKey: 'ichimoku',
        title: 'Ichimoku Cloud',
        params: [
            { key: 'tenkanPeriod', label: 'Tenkan', type: 'int', default: 9, min: 1 },
            { key: 'kijunPeriod', label: 'Kijun', type: 'int', default: 26, min: 1 },
            { key: 'senkouBPeriod', label: 'Senkou B', type: 'int', default: 52, min: 1 },
            { key: 'displacement', label: 'Displacement', type: 'int', default: 26, min: 1 },
        ],
        colors: [
            { key: 'tenkanColor', label: 'Tenkan Line', default: '#0496ff' },
            { key: 'kijunColor', label: 'Kijun Line', default: '#ff0000' },
        ],
        lineWidth: { key: 'lineWidth', default: 1.5 },
    },

    parabolicSAR: {
        configKey: 'parabolicSAR',
        title: 'Parabolic SAR',
        params: [
            { key: 'afStart', label: 'AF Start', type: 'float', default: 0.02, min: 0.01, step: 0.01 },
            { key: 'afStep', label: 'AF Step', type: 'float', default: 0.02, min: 0.01, step: 0.01 },
            { key: 'afMax', label: 'AF Max', type: 'float', default: 0.2, min: 0.01, step: 0.01 },
        ],
        colors: [
            { key: 'bullishColor', label: 'Bullish Dots', default: '#22c55e' },
            { key: 'bearishColor', label: 'Bearish Dots', default: '#ef4444' },
        ],
        sliders: [{ key: 'dotSize', label: 'Dot Size', min: 1, max: 6, step: 1, default: 3 }],
    },

    keltner: {
        configKey: 'keltner',
        title: 'Keltner Channels ({emaPeriod})',
        params: [
            { key: 'emaPeriod', label: 'EMA Period', type: 'int', default: 20, min: 1 },
            { key: 'atrPeriod', label: 'ATR Period', type: 'int', default: 10, min: 1 },
        ],
        sliders: [{ key: 'multiplier', label: 'Multiplier', min: 0.5, max: 5, step: 0.5, default: 2 }],
        colors: [
            { key: 'upperColor', label: 'Upper Band', default: '#26A69A' },
            { key: 'middleColor', label: 'Middle Band', default: '#26A69A' },
            { key: 'lowerColor', label: 'Lower Band', default: '#26A69A' },
        ],
        lineWidth: { key: 'lineWidth', default: 1.5 },
    },

    pivotPoints: {
        configKey: 'pivotPoints',
        title: 'Pivot Points',
        description: 'Daily pivot points with support and resistance levels.',
        colors: [
            { key: 'pivotColor', label: 'Pivot Line', default: '#FFEB3B' },
            { key: 'resistanceColor', label: 'Resistance Lines', default: '#ef4444' },
            { key: 'supportColor', label: 'Support Lines', default: '#22c55e' },
        ],
        lineWidth: { key: 'lineWidth', default: 1 },
    },

    // ── Trend ──
    supertrend: {
        configKey: 'supertrend',
        title: 'Supertrend ({period}, {multiplier})',
        params: [
            { key: 'period', label: 'Period', type: 'int', default: 10, min: 1 },
            { key: 'multiplier', label: 'Multiplier', type: 'float', default: 3, min: 0.1, step: 0.1 },
        ],
        colors: [
            { key: 'bullishColor', label: 'Bullish', default: '#22c55e' },
            { key: 'bearishColor', label: 'Bearish', default: '#ef4444' },
        ],
        lineWidth: { key: 'lineWidth', default: 2 },
    },

    donchian: {
        configKey: 'donchian',
        title: 'Donchian ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }],
        colors: [
            { key: 'upperColor', label: 'Upper Band', default: '#2962ff' },
            { key: 'middleColor', label: 'Middle Band', default: '#787b86' },
            { key: 'lowerColor', label: 'Lower Band', default: '#2962ff' },
        ],
        lineWidth: { key: 'lineWidth', default: 1.5 },
    },

    aroon: {
        configKey: 'aroon',
        title: 'Aroon ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }],
        colors: [
            { key: 'upColor', label: 'Aroon Up', default: '#22c55e' },
            { key: 'downColor', label: 'Aroon Down', default: '#ef4444' },
        ],
        hasStyle: true,
    },

    envelopes: {
        configKey: 'envelopes',
        title: 'Envelopes ({period}, {percent}%)',
        params: [
            { key: 'period', label: 'Period', type: 'int', default: 20, min: 1 },
            { key: 'percent', label: 'Percent %', type: 'float', default: 2.5, min: 0.1, step: 0.1 },
        ],
        colors: [
            { key: 'upperColor', label: 'Upper', default: '#2962ff' },
            { key: 'middleColor', label: 'Middle', default: '#787b86' },
            { key: 'lowerColor', label: 'Lower', default: '#2962ff' },
        ],
        lineWidth: { key: 'lineWidth', default: 1.5 },
    },

    dema: {
        configKey: 'dema',
        title: 'DEMA ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 21, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#ff9800' }],
        lineWidth: { key: 'lineWidth', default: 1.5 },
    },

    tema: {
        configKey: 'tema',
        title: 'TEMA ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 21, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#00bcd4' }],
        lineWidth: { key: 'lineWidth', default: 1.5 },
    },

    hma: {
        configKey: 'hma',
        title: 'HMA ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 9, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#e91e63' }],
        lineWidth: { key: 'lineWidth', default: 1.5 },
    },

    // ── Oscillators ──
    momentum: {
        configKey: 'momentum',
        title: 'Momentum ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 10, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#7c4dff' }],
        hasStyle: true,
    },

    ao: {
        configKey: 'ao',
        title: 'Awesome Oscillator',
        description: 'Awesome Oscillator (5, 34 SMA difference).',
        colors: [
            { key: 'bullishColor', label: 'Bullish Bars', default: '#22c55e' },
            { key: 'bearishColor', label: 'Bearish Bars', default: '#ef4444' },
        ],
        hasStyle: true,
    },

    mfi: {
        configKey: 'mfi',
        title: 'MFI ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }],
        sliders: [
            { key: 'overbought', label: 'Overbought', min: 50, max: 100, step: 1, default: 80 },
            { key: 'oversold', label: 'Oversold', min: 0, max: 50, step: 1, default: 20 },
        ],
        colors: [{ key: 'color', label: 'Line Color', default: '#ff9800' }],
        hasStyle: true,
    },

    tsi: {
        configKey: 'tsi',
        title: 'TSI ({longPeriod}, {shortPeriod})',
        params: [
            { key: 'longPeriod', label: 'Long', type: 'int', default: 25, min: 1 },
            { key: 'shortPeriod', label: 'Short', type: 'int', default: 13, min: 1 },
            { key: 'signalPeriod', label: 'Signal', type: 'int', default: 7, min: 1 },
        ],
        colors: [
            { key: 'tsiColor', label: 'TSI Line', default: '#2196f3' },
            { key: 'signalColor', label: 'Signal Line', default: '#ff5252' },
        ],
        hasStyle: true,
    },

    trix: {
        configKey: 'trix',
        title: 'TRIX ({period})',
        params: [
            { key: 'period', label: 'Period', type: 'int', default: 15, min: 1 },
            { key: 'signalPeriod', label: 'Signal', type: 'int', default: 9, min: 1 },
        ],
        colors: [
            { key: 'trixColor', label: 'TRIX Line', default: '#673ab7' },
            { key: 'signalColor', label: 'Signal Line', default: '#ff9800' },
        ],
        hasStyle: true,
    },

    ultimateOsc: {
        configKey: 'ultimateOsc',
        title: 'Ultimate Osc ({fast}, {med}, {slow})',
        params: [
            { key: 'fast', label: 'Fast', type: 'int', default: 7, min: 1 },
            { key: 'med', label: 'Medium', type: 'int', default: 14, min: 1 },
            { key: 'slow', label: 'Slow', type: 'int', default: 28, min: 1 },
        ],
        colors: [{ key: 'color', label: 'Line Color', default: '#00bcd4' }],
        hasStyle: true,
    },

    dpo: {
        configKey: 'dpo',
        title: 'DPO ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#9c27b0' }],
        hasStyle: true,
    },

    kst: {
        configKey: 'kst',
        title: 'KST',
        params: [{ key: 'signalPeriod', label: 'Signal Period', type: 'int', default: 9, min: 1 }],
        colors: [
            { key: 'color', label: 'KST Line', default: '#2196f3' },
            { key: 'signalColor', label: 'Signal Line', default: '#ff5252' },
        ],
        hasStyle: true,
    },

    stochRsi: {
        configKey: 'stochRsi',
        title: 'Stoch RSI ({rsiPeriod})',
        params: [
            { key: 'rsiPeriod', label: 'RSI', type: 'int', default: 14, min: 1 },
            { key: 'kPeriod', label: '%K', type: 'int', default: 3, min: 1 },
            { key: 'dPeriod', label: '%D', type: 'int', default: 3, min: 1 },
        ],
        sliders: [
            { key: 'overbought', label: 'Overbought', min: 50, max: 100, step: 1, default: 80 },
            { key: 'oversold', label: 'Oversold', min: 0, max: 50, step: 1, default: 20 },
        ],
        colors: [
            { key: 'kColor', label: '%K Line', default: '#2196f3' },
            { key: 'dColor', label: '%D Line', default: '#ff9800' },
        ],
        hasStyle: true,
    },

    // ── Volatility ──
    bbPercent: {
        configKey: 'bbPercent',
        title: 'BB %B ({period})',
        params: [
            { key: 'period', label: 'Period', type: 'int', default: 20, min: 1 },
            { key: 'stdDev', label: 'Std Dev', type: 'float', default: 2, min: 0.1, step: 0.1 },
        ],
        colors: [{ key: 'color', label: 'Line Color', default: '#9c27b0' }],
        hasStyle: true,
    },

    bbWidth: {
        configKey: 'bbWidth',
        title: 'BB Width ({period})',
        params: [
            { key: 'period', label: 'Period', type: 'int', default: 20, min: 1 },
            { key: 'stdDev', label: 'Std Dev', type: 'float', default: 2, min: 0.1, step: 0.1 },
        ],
        colors: [{ key: 'color', label: 'Line Color', default: '#673ab7' }],
        hasStyle: true,
    },

    histVol: {
        configKey: 'histVol',
        title: 'Hist Vol ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#ff9800' }],
        hasStyle: true,
    },

    chaikinVol: {
        configKey: 'chaikinVol',
        title: 'Chaikin Vol ({emaPeriod})',
        params: [
            { key: 'emaPeriod', label: 'EMA Period', type: 'int', default: 10, min: 1 },
            { key: 'rocPeriod', label: 'ROC Period', type: 'int', default: 10, min: 1 },
        ],
        colors: [{ key: 'color', label: 'Line Color', default: '#00bcd4' }],
        hasStyle: true,
    },

    stdDev: {
        configKey: 'stdDev',
        title: 'Std Dev ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#e91e63' }],
        hasStyle: true,
    },

    // ── Volume ──
    obv: {
        configKey: 'obv',
        title: 'OBV',
        description: 'On Balance Volume — cumulative volume flow.',
        colors: [{ key: 'color', label: 'Line Color', default: '#2196f3' }],
        hasStyle: true,
    },

    cmf: {
        configKey: 'cmf',
        title: 'CMF ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#089981' }],
        hasStyle: true,
    },

    adl: {
        configKey: 'adl',
        title: 'A/D Line',
        description: 'Accumulation/Distribution Line.',
        colors: [{ key: 'color', label: 'Line Color', default: '#ff6f00' }],
        hasStyle: true,
    },

    forceIndex: {
        configKey: 'forceIndex',
        title: 'Force Index ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 13, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#4caf50' }],
        hasStyle: true,
    },

    eom: {
        configKey: 'eom',
        title: 'EOM ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#795548' }],
        hasStyle: true,
    },

    volumeSma: {
        configKey: 'volumeSma',
        title: 'Vol SMA ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#ff9800' }],
    },

    // ── Support/Resistance ──
    fibRetracement: {
        configKey: 'fibRetracement',
        title: 'Fibonacci ({lookback})',
        params: [{ key: 'lookback', label: 'Lookback Bars', type: 'int', default: 100, min: 10 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#ffeb3b' }],
        lineWidth: { key: 'lineWidth', default: 1 },
    },

    camarillaPivots: {
        configKey: 'camarillaPivots',
        title: 'Camarilla Pivots',
        description: 'Camarilla pivot levels.',
        colors: [
            { key: 'resistanceColor', label: 'Resistance', default: '#ef4444' },
            { key: 'supportColor', label: 'Support', default: '#22c55e' },
        ],
        lineWidth: { key: 'lineWidth', default: 1 },
    },

    woodiePivots: {
        configKey: 'woodiePivots',
        title: "Woodie's Pivots",
        description: "Woodie's pivot point levels.",
        colors: [
            { key: 'pivotColor', label: 'Pivot', default: '#ffeb3b' },
            { key: 'resistanceColor', label: 'Resistance', default: '#ef4444' },
            { key: 'supportColor', label: 'Support', default: '#22c55e' },
        ],
        lineWidth: { key: 'lineWidth', default: 1 },
    },

    // ── Statistics ──
    correlation: {
        configKey: 'correlation',
        title: 'Correlation ({period})',
        params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }],
        colors: [{ key: 'color', label: 'Line Color', default: '#2196f3' }],
        hasStyle: true,
    },

    linearReg: {
        configKey: 'linearReg',
        title: 'Lin Reg ({period})',
        params: [
            { key: 'period', label: 'Period', type: 'int', default: 14, min: 1 },
            { key: 'deviations', label: 'Deviations', type: 'float', default: 2, min: 0.1, step: 0.1 },
        ],
        colors: [
            { key: 'upperColor', label: 'Upper', default: '#2962ff' },
            { key: 'middleColor', label: 'Middle', default: '#787b86' },
            { key: 'lowerColor', label: 'Lower', default: '#2962ff' },
        ],
        lineWidth: { key: 'lineWidth', default: 1.5 },
    },

    coppock: {
        configKey: 'coppock',
        title: 'Coppock ({longROC}, {shortROC})',
        params: [
            { key: 'longROC', label: 'Long ROC', type: 'int', default: 14, min: 1 },
            { key: 'shortROC', label: 'Short ROC', type: 'int', default: 11, min: 1 },
            { key: 'wmaPeriod', label: 'WMA', type: 'int', default: 10, min: 1 },
        ],
        colors: [{ key: 'color', label: 'Line Color', default: '#ff5722' }],
        hasStyle: true,
    },

    // ── Phase 2: New Trend Indicators ──
    alma: { configKey: 'alma', title: 'ALMA ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 9, min: 1 }, { key: 'offset', label: 'Offset', type: 'float', default: 0.85, min: 0, step: 0.05 }, { key: 'sigma', label: 'Sigma', type: 'float', default: 6, min: 1, step: 0.5 }], colors: [{ key: 'color', label: 'Line Color', default: '#ff6b6b' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    kama: { configKey: 'kama', title: 'KAMA ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 10, min: 1 }, { key: 'fastPeriod', label: 'Fast', type: 'int', default: 2, min: 1 }, { key: 'slowPeriod', label: 'Slow', type: 'int', default: 30, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#4ecdc4' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    zlema: { configKey: 'zlema', title: 'ZLEMA ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 21, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#a29bfe' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    t3: { configKey: 't3', title: 'T3 ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 5, min: 1 }, { key: 'vFactor', label: 'V-Factor', type: 'float', default: 0.7, min: 0, step: 0.05 }], colors: [{ key: 'color', label: 'Line Color', default: '#fd79a8' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    lsma: { configKey: 'lsma', title: 'LSMA ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 25, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#00cec9' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    mcginley: { configKey: 'mcginley', title: 'McGinley ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#6c5ce7' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    wma: { configKey: 'wma', title: 'WMA ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#ffeaa7' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    smmaOverlay: { configKey: 'smmaOverlay', title: 'SMMA ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 21, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#dfe6e9' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    vortex: { configKey: 'vortex', title: 'Vortex ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }], colors: [{ key: 'plusColor', label: 'VI+ Line', default: '#22c55e' }, { key: 'minusColor', label: 'VI- Line', default: '#ef4444' }], hasStyle: true },
    choppiness: { configKey: 'choppiness', title: 'CHOP ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#fdcb6e' }], hasStyle: true },
    elderRay: { configKey: 'elderRay', title: 'Elder Ray ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 13, min: 1 }], colors: [{ key: 'bullColor', label: 'Bull Power', default: '#22c55e' }, { key: 'bearColor', label: 'Bear Power', default: '#ef4444' }], hasStyle: true },
    massIndex: { configKey: 'massIndex', title: 'Mass Index ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 25, min: 5 }], colors: [{ key: 'color', label: 'Line Color', default: '#e17055' }], hasStyle: true },
    chandeKroll: { configKey: 'chandeKroll', title: 'Chande Kroll', params: [{ key: 'p', label: 'P', type: 'int', default: 10, min: 1 }, { key: 'q', label: 'Q', type: 'int', default: 9, min: 1 }, { key: 'x', label: 'X', type: 'float', default: 1, min: 0.1, step: 0.1 }], colors: [{ key: 'longColor', label: 'Long Stop', default: '#22c55e' }, { key: 'shortColor', label: 'Short Stop', default: '#ef4444' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    linRegSlope: { configKey: 'linRegSlope', title: 'LR Slope ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 2 }], colors: [{ key: 'color', label: 'Line Color', default: '#74b9ff' }], hasStyle: true },
    priceChannel: { configKey: 'priceChannel', title: 'Price Channel ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }], colors: [{ key: 'upperColor', label: 'Upper', default: '#0984e3' }, { key: 'middleColor', label: 'Middle', default: '#636e72' }, { key: 'lowerColor', label: 'Lower', default: '#0984e3' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    alligator: { configKey: 'alligator', title: 'Alligator', colors: [{ key: 'jawColor', label: 'Jaw (13)', default: '#0984e3' }, { key: 'teethColor', label: 'Teeth (8)', default: '#e17055' }, { key: 'lipsColor', label: 'Lips (5)', default: '#00b894' }], lineWidth: { key: 'lineWidth', default: 1.5 } },

    // ── Phase 2: New Oscillators ──
    ppo: { configKey: 'ppo', title: 'PPO ({fast}, {slow})', params: [{ key: 'fast', label: 'Fast', type: 'int', default: 12, min: 1 }, { key: 'slow', label: 'Slow', type: 'int', default: 26, min: 1 }, { key: 'signal', label: 'Signal', type: 'int', default: 9, min: 1 }], colors: [{ key: 'ppoColor', label: 'PPO Line', default: '#3498DB' }, { key: 'signalColor', label: 'Signal', default: '#E67E22' }], hasStyle: true },
    pvo: { configKey: 'pvo', title: 'PVO ({fast}, {slow})', params: [{ key: 'fast', label: 'Fast', type: 'int', default: 12, min: 1 }, { key: 'slow', label: 'Slow', type: 'int', default: 26, min: 1 }, { key: 'signal', label: 'Signal', type: 'int', default: 9, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#e056fd' }], hasStyle: true },
    cmo: { configKey: 'cmo', title: 'CMO ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 9, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#f9ca24' }], hasStyle: true },
    fisher: { configKey: 'fisher', title: 'Fisher ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 10, min: 1 }], colors: [{ key: 'fisherColor', label: 'Fisher', default: '#00b894' }, { key: 'triggerColor', label: 'Trigger', default: '#d63031' }], hasStyle: true },
    stc: { configKey: 'stc', title: 'STC ({fast}, {slow})', params: [{ key: 'fast', label: 'Fast', type: 'int', default: 23, min: 1 }, { key: 'slow', label: 'Slow', type: 'int', default: 50, min: 1 }, { key: 'cycle', label: 'Cycle', type: 'int', default: 10, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#e84393' }], hasStyle: true },
    rviOsc: { configKey: 'rviOsc', title: 'RVI ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 10, min: 1 }], colors: [{ key: 'rviColor', label: 'RVI', default: '#00cec9' }, { key: 'signalColor', label: 'Signal', default: '#fdcb6e' }], hasStyle: true },
    klinger: { configKey: 'klinger', title: 'Klinger ({fast}, {slow})', params: [{ key: 'fast', label: 'Fast', type: 'int', default: 34, min: 1 }, { key: 'slow', label: 'Slow', type: 'int', default: 55, min: 1 }, { key: 'signal', label: 'Signal', type: 'int', default: 13, min: 1 }], colors: [{ key: 'klingerColor', label: 'Klinger', default: '#6c5ce7' }, { key: 'signalColor', label: 'Signal', default: '#fd79a8' }], hasStyle: true },
    connorsRsi: { configKey: 'connorsRsi', title: 'CRSI ({rsiPeriod})', params: [{ key: 'rsiPeriod', label: 'RSI', type: 'int', default: 3, min: 1 }, { key: 'streakPeriod', label: 'Streak', type: 'int', default: 2, min: 1 }, { key: 'rankPeriod', label: 'Rank', type: 'int', default: 100, min: 10 }], colors: [{ key: 'color', label: 'Line Color', default: '#e17055' }], hasStyle: true },
    apo: { configKey: 'apo', title: 'APO ({fast}, {slow})', params: [{ key: 'fast', label: 'Fast', type: 'int', default: 12, min: 1 }, { key: 'slow', label: 'Slow', type: 'int', default: 26, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#0984e3' }], hasStyle: true },
    qstick: { configKey: 'qstick', title: 'Qstick ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 8, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#00b894' }], hasStyle: true },
    bop: { configKey: 'bop', title: 'BOP ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#636e72' }], hasStyle: true },
    psychLine: { configKey: 'psychLine', title: 'Psych Line ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 12, min: 2 }], colors: [{ key: 'color', label: 'Line Color', default: '#a29bfe' }], hasStyle: true },
    pfe: { configKey: 'pfe', title: 'PFE ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 10, min: 2 }, { key: 'smoothing', label: 'Smooth', type: 'int', default: 5, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#fab1a0' }], hasStyle: true },
    smi: { configKey: 'smi', title: 'SMI ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 13, min: 1 }, { key: 'smoothK', label: 'Smooth K', type: 'int', default: 25, min: 1 }, { key: 'smoothD', label: 'Smooth D', type: 'int', default: 2, min: 1 }], colors: [{ key: 'smiColor', label: 'SMI', default: '#0984e3' }, { key: 'signalColor', label: 'Signal', default: '#e17055' }], hasStyle: true },

    // ── Phase 2: New Volatility ──
    ulcerIndex: { configKey: 'ulcerIndex', title: 'Ulcer ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#d63031' }], hasStyle: true },
    natr: { configKey: 'natr', title: 'NATR ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#e84393' }], hasStyle: true },
    trueRange: { configKey: 'trueRange', title: 'True Range', colors: [{ key: 'color', label: 'Line Color', default: '#fdcb6e' }], hasStyle: true },
    squeeze: { configKey: 'squeeze', title: 'Squeeze', params: [{ key: 'bbPeriod', label: 'BB Period', type: 'int', default: 20, min: 1 }, { key: 'bbMult', label: 'BB Mult', type: 'float', default: 2, min: 0.5, step: 0.5 }, { key: 'kcPeriod', label: 'KC Period', type: 'int', default: 20, min: 1 }, { key: 'kcMult', label: 'KC Mult', type: 'float', default: 1.5, min: 0.5, step: 0.5 }], colors: [{ key: 'color', label: 'Line Color', default: '#00cec9' }], hasStyle: true },
    chandelierExit: { configKey: 'chandelierExit', title: 'Chandelier ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 22, min: 1 }, { key: 'multiplier', label: 'Multiplier', type: 'float', default: 3, min: 0.5, step: 0.5 }], colors: [{ key: 'longColor', label: 'Long Exit', default: '#22c55e' }, { key: 'shortColor', label: 'Short Exit', default: '#ef4444' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    relVolIndex: { configKey: 'relVolIndex', title: 'RVI ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 10, min: 1 }, { key: 'smoothing', label: 'Smooth', type: 'int', default: 14, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#6c5ce7' }], hasStyle: true },
    vhf: { configKey: 'vhf', title: 'VHF ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 28, min: 5 }], colors: [{ key: 'color', label: 'Line Color', default: '#fd79a8' }], hasStyle: true },
    accBands: { configKey: 'accBands', title: 'Acc Bands ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }], colors: [{ key: 'upperColor', label: 'Upper', default: '#74b9ff' }, { key: 'middleColor', label: 'Middle', default: '#636e72' }, { key: 'lowerColor', label: 'Lower', default: '#74b9ff' }], lineWidth: { key: 'lineWidth', default: 1.5 } },

    // ── Phase 2: New Volume ──
    vwma: { configKey: 'vwma', title: 'VWMA ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 20, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#e056fd' }], lineWidth: { key: 'lineWidth', default: 1.5 } },
    volumeOsc: { configKey: 'volumeOsc', title: 'Vol Osc ({fast}, {slow})', params: [{ key: 'fast', label: 'Fast', type: 'int', default: 5, min: 1 }, { key: 'slow', label: 'Slow', type: 'int', default: 10, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#f9ca24' }], hasStyle: true },
    nvi: { configKey: 'nvi', title: 'NVI', description: 'Negative Volume Index', colors: [{ key: 'color', label: 'Line Color', default: '#e17055' }], hasStyle: true },
    pvi: { configKey: 'pvi', title: 'PVI', description: 'Positive Volume Index', colors: [{ key: 'color', label: 'Line Color', default: '#00b894' }], hasStyle: true },
    pvt: { configKey: 'pvt', title: 'PVT', description: 'Price Volume Trend', colors: [{ key: 'color', label: 'Line Color', default: '#0984e3' }], hasStyle: true },
    vroc: { configKey: 'vroc', title: 'VROC ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#6c5ce7' }], hasStyle: true },
    netVolume: { configKey: 'netVolume', title: 'Net Vol ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#a29bfe' }], hasStyle: true },
    twiggsMF: { configKey: 'twiggsMF', title: 'Twiggs MF ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 21, min: 1 }], colors: [{ key: 'color', label: 'Line Color', default: '#fdcb6e' }], hasStyle: true },

    // ── Phase 2: New Statistics ──
    linRegRSquared: { configKey: 'linRegRSquared', title: 'R² ({period})', params: [{ key: 'period', label: 'Period', type: 'int', default: 14, min: 2 }], colors: [{ key: 'color', label: 'Line Color', default: '#74b9ff' }], hasStyle: true },
    medianPrice: { configKey: 'medianPrice', title: 'Median Price', description: '(High + Low) / 2', colors: [{ key: 'color', label: 'Line Color', default: '#dfe6e9' }], lineWidth: { key: 'lineWidth', default: 1 } },
    typicalPrice: { configKey: 'typicalPrice', title: 'Typical Price', description: '(H+L+C) / 3', colors: [{ key: 'color', label: 'Line Color', default: '#b2bec3' }], lineWidth: { key: 'lineWidth', default: 1 } },
    weightedClose: { configKey: 'weightedClose', title: 'Weighted Close', description: '(H+L+2C) / 4', colors: [{ key: 'color', label: 'Line Color', default: '#636e72' }], lineWidth: { key: 'lineWidth', default: 1 } },
    demarkPivots: { configKey: 'demarkPivots', title: 'DeMark Pivots', colors: [{ key: 'pivotColor', label: 'Pivot', default: '#ffeb3b' }, { key: 'resistanceColor', label: 'Resistance', default: '#ef4444' }, { key: 'supportColor', label: 'Support', default: '#22c55e' }], lineWidth: { key: 'lineWidth', default: 1 } },
    zigzag: { configKey: 'zigzag', title: 'Zig Zag ({deviation}%)', params: [{ key: 'deviation', label: 'Deviation %', type: 'float', default: 5, min: 1, step: 0.5 }], colors: [{ key: 'color', label: 'Line Color', default: '#e84393' }], lineWidth: { key: 'lineWidth', default: 2 } },
    fractals: { configKey: 'fractals', title: 'Fractals', description: 'Williams fractal arrows', colors: [{ key: 'upColor', label: 'Up Fractal', default: '#22c55e' }, { key: 'downColor', label: 'Down Fractal', default: '#ef4444' }] },
    gator: { configKey: 'gator', title: 'Gator Oscillator', colors: [{ key: 'upperColor', label: 'Upper Hist', default: '#22c55e' }, { key: 'lowerColor', label: 'Lower Hist', default: '#ef4444' }], hasStyle: true },
};

// ─── Helper: resolve title from template + config ──────────────────────────

export function resolveTitle(meta: IndicatorMeta, indicatorConfig: any): string {
    return meta.title.replace(/\{(\w+)\}/g, (_, key) => {
        const val = indicatorConfig?.[key];
        return val !== undefined ? String(val) : String(meta.params?.find(p => p.key === key)?.default ?? '?');
    });
}

// ─── Helper: get/set nested keys like 'style.lineWidth' ───────────────────

export function getNestedValue(obj: any, path: string, fallback: any): any {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return fallback;
        cur = cur[p];
    }
    return cur ?? fallback;
}

export function setNestedValue(obj: any, path: string, value: any): any {
    const parts = path.split('.');
    if (parts.length === 1) return { ...obj, [parts[0]]: value };
    return { ...obj, [parts[0]]: setNestedValue(obj?.[parts[0]] || {}, parts.slice(1).join('.'), value) };
}

// ─── Display registry (legend layer) ───────────────────────────────────────
// INDICATOR_REGISTRY above carries settings-panel metadata. INDICATOR_DISPLAY
// below carries legend-layer metadata: which pane the indicator draws in
// (overlay vs subplot) and what short label appears in the chart legend.
//
// Why a separate map: the existing settings-panel metadata never needed to
// know about the chart pane, and the title template ('Bollinger ({period})')
// is a different concept from the legend's short label ('BB'). Mutating 102
// existing entries to add display+legendTitle would be 102 lines of edit
// surface for a purely additive concern. A second map is cheaper to read,
// cheaper to audit, and easier to roll back.
//
// Coverage rule: every key in DEFAULT_INDICATOR_CONFIG (i.e. every legacy
// indicator that has an `enabled` toggle) MUST appear here, otherwise the
// legend renderer will silently skip it. The unit test in
// indicatorRegistry.test.ts enforces this; adding a new indicator without
// a display entry fails CI.
//
// hasLegendEntry=false is reserved for indicators that draw on the canvas
// but don't get a legend label (currently only optionsPdf, the heatmap).

export interface IndicatorDisplay {
    /** Which chart pane this indicator draws in. */
    readonly display: 'overlay' | 'subplot';
    /** Short label shown in the chart legend (e.g. 'BB' for Bollinger). */
    readonly legendTitle: string;
    /** Set to false for canvas-only overlays with no legend label. */
    readonly hasLegendEntry?: boolean;
}

export const INDICATOR_DISPLAY: Record<string, IndicatorDisplay> = {
    // ── Overlay indicators (drawn on the price pane) ──────────────────────
    bollinger:        { display: 'overlay', legendTitle: 'BB' },
    movingAverages:   { display: 'overlay', legendTitle: 'MA' },
    vwap:             { display: 'overlay', legendTitle: 'VWAP' },
    ichimoku:         { display: 'overlay', legendTitle: 'Ichimoku' },
    keltner:          { display: 'overlay', legendTitle: 'Keltner' },
    volumeProfile:    { display: 'overlay', legendTitle: 'Vol Profile' },
    volume:           { display: 'overlay', legendTitle: 'Volume' },
    supertrend:       { display: 'overlay', legendTitle: 'Supertrend' },
    donchian:         { display: 'overlay', legendTitle: 'Donchian' },
    envelopes:        { display: 'overlay', legendTitle: 'Envelopes' },
    dema:             { display: 'overlay', legendTitle: 'DEMA' },
    tema:             { display: 'overlay', legendTitle: 'TEMA' },
    hma:              { display: 'overlay', legendTitle: 'HMA' },
    linearReg:        { display: 'overlay', legendTitle: 'Lin Reg' },
    parabolicSAR:     { display: 'overlay', legendTitle: 'PSAR' },
    pivotPoints:      { display: 'overlay', legendTitle: 'Pivots' },
    fibRetracement:   { display: 'overlay', legendTitle: 'Fib' },
    camarillaPivots:  { display: 'overlay', legendTitle: 'Camarilla' },
    woodiePivots:     { display: 'overlay', legendTitle: "Woodie's" },
    volumeSma:        { display: 'overlay', legendTitle: 'Vol SMA' },
    alma:             { display: 'overlay', legendTitle: 'ALMA' },
    kama:             { display: 'overlay', legendTitle: 'KAMA' },
    zlema:            { display: 'overlay', legendTitle: 'ZLEMA' },
    t3:               { display: 'overlay', legendTitle: 'T3' },
    lsma:             { display: 'overlay', legendTitle: 'LSMA' },
    mcginley:         { display: 'overlay', legendTitle: 'McGinley' },
    wma:              { display: 'overlay', legendTitle: 'WMA' },
    smmaOverlay:      { display: 'overlay', legendTitle: 'SMMA' },
    vwma:             { display: 'overlay', legendTitle: 'VWMA' },
    medianPrice:      { display: 'overlay', legendTitle: 'Median' },
    typicalPrice:     { display: 'overlay', legendTitle: 'Typical' },
    weightedClose:    { display: 'overlay', legendTitle: 'WClose' },
    zigzag:           { display: 'overlay', legendTitle: 'ZigZag' },
    alligator:        { display: 'overlay', legendTitle: 'Alligator' },
    priceChannel:     { display: 'overlay', legendTitle: 'Price Ch' },
    chandeKroll:      { display: 'overlay', legendTitle: 'Chande Kroll' },
    chandelierExit:   { display: 'overlay', legendTitle: 'Chandelier' },
    accBands:         { display: 'overlay', legendTitle: 'Acc Bands' },
    demarkPivots:     { display: 'overlay', legendTitle: 'DeMark' },
    fractals:         { display: 'overlay', legendTitle: 'Fractals' },
    // optionsPdf is a heatmap drawn directly to canvas with no legend label;
    // it's controlled by a top-level prop (optionsPdfEnabled), not a legend
    // toolbar. Marked here so the registry is complete (the test that checks
    // every IndicatorType is registered would fail without it) but the
    // legend loop skips entries with hasLegendEntry=false.
    optionsPdf:       { display: 'overlay', legendTitle: 'Options PDF', hasLegendEntry: false },
    // ema is the legacy multi-period EMA toggle (kept for backwards compat
    // per IndicatorSettings.tsx:36). It renders to canvas via ProChart's
    // ema branch (line 1842) but was never given a legend label in the old
    // hardcoded overlayOrder array. Registered as hasLegendEntry: false to
    // preserve that behavior; flip it to true if you want to add a legend.
    ema:              { display: 'overlay', legendTitle: 'EMA', hasLegendEntry: false },

    // ── Subplot indicators (drawn in their own pane below the chart) ──────
    rsi:              { display: 'subplot', legendTitle: 'RSI' },
    macd:             { display: 'subplot', legendTitle: 'MACD' },
    atr:              { display: 'subplot', legendTitle: 'ATR' },
    stochastic:       { display: 'subplot', legendTitle: 'Stochastic' },
    williamsR:        { display: 'subplot', legendTitle: 'Williams %R' },
    cci:              { display: 'subplot', legendTitle: 'CCI' },
    adx:              { display: 'subplot', legendTitle: 'ADX' },
    roc:              { display: 'subplot', legendTitle: 'ROC' },
    aroon:            { display: 'subplot', legendTitle: 'Aroon' },
    momentum:         { display: 'subplot', legendTitle: 'Momentum' },
    ao:               { display: 'subplot', legendTitle: 'AO' },
    mfi:              { display: 'subplot', legendTitle: 'MFI' },
    tsi:              { display: 'subplot', legendTitle: 'TSI' },
    trix:             { display: 'subplot', legendTitle: 'TRIX' },
    ultimateOsc:      { display: 'subplot', legendTitle: 'Ultimate Osc' },
    dpo:              { display: 'subplot', legendTitle: 'DPO' },
    kst:              { display: 'subplot', legendTitle: 'KST' },
    stochRsi:         { display: 'subplot', legendTitle: 'Stoch RSI' },
    bbPercent:        { display: 'subplot', legendTitle: 'BB %B' },
    bbWidth:          { display: 'subplot', legendTitle: 'BB Width' },
    histVol:          { display: 'subplot', legendTitle: 'Hist Vol' },
    chaikinVol:       { display: 'subplot', legendTitle: 'Chaikin Vol' },
    stdDev:           { display: 'subplot', legendTitle: 'Std Dev' },
    obv:              { display: 'subplot', legendTitle: 'OBV' },
    cmf:              { display: 'subplot', legendTitle: 'CMF' },
    adl:              { display: 'subplot', legendTitle: 'A/D Line' },
    forceIndex:       { display: 'subplot', legendTitle: 'Force Index' },
    eom:              { display: 'subplot', legendTitle: 'EOM' },
    correlation:      { display: 'subplot', legendTitle: 'Correlation' },
    coppock:          { display: 'subplot', legendTitle: 'Coppock' },
    vortex:           { display: 'subplot', legendTitle: 'Vortex' },
    choppiness:       { display: 'subplot', legendTitle: 'CHOP' },
    elderRay:         { display: 'subplot', legendTitle: 'Elder Ray' },
    massIndex:        { display: 'subplot', legendTitle: 'Mass Index' },
    linRegSlope:      { display: 'subplot', legendTitle: 'LR Slope' },
    ppo:              { display: 'subplot', legendTitle: 'PPO' },
    pvo:              { display: 'subplot', legendTitle: 'PVO' },
    cmo:              { display: 'subplot', legendTitle: 'CMO' },
    fisher:           { display: 'subplot', legendTitle: 'Fisher' },
    stc:              { display: 'subplot', legendTitle: 'STC' },
    rviOsc:           { display: 'subplot', legendTitle: 'RVI' },
    klinger:          { display: 'subplot', legendTitle: 'Klinger' },
    connorsRsi:       { display: 'subplot', legendTitle: 'CRSI' },
    apo:              { display: 'subplot', legendTitle: 'APO' },
    qstick:           { display: 'subplot', legendTitle: 'Qstick' },
    bop:              { display: 'subplot', legendTitle: 'BOP' },
    psychLine:        { display: 'subplot', legendTitle: 'Psych Line' },
    pfe:              { display: 'subplot', legendTitle: 'PFE' },
    smi:              { display: 'subplot', legendTitle: 'SMI' },
    ulcerIndex:       { display: 'subplot', legendTitle: 'Ulcer' },
    natr:             { display: 'subplot', legendTitle: 'NATR' },
    trueRange:        { display: 'subplot', legendTitle: 'True Range' },
    squeeze:          { display: 'subplot', legendTitle: 'Squeeze' },
    relVolIndex:      { display: 'subplot', legendTitle: 'RVol' },
    vhf:              { display: 'subplot', legendTitle: 'VHF' },
    volumeOsc:        { display: 'subplot', legendTitle: 'Vol Osc' },
    nvi:              { display: 'subplot', legendTitle: 'NVI' },
    pvi:              { display: 'subplot', legendTitle: 'PVI' },
    pvt:              { display: 'subplot', legendTitle: 'PVT' },
    vroc:             { display: 'subplot', legendTitle: 'VROC' },
    netVolume:        { display: 'subplot', legendTitle: 'Net Vol' },
    twiggsMF:         { display: 'subplot', legendTitle: 'Twiggs MF' },
    linRegRSquared:   { display: 'subplot', legendTitle: 'R²' },
    gator:            { display: 'subplot', legendTitle: 'Gator' },
};

// ─── Display helpers ──────────────────────────────────────────────────────
// These replace the hardcoded `overlayOrder` and `allSubplots` arrays in
// ProChart.tsx and BTChart.tsx, plus the duplicated `subplotKeys` array in
// ChartPage.tsx (used for subplot height calculation). Drift between those
// four lists has caused real bugs; the registry is now the single source.

/** All overlay indicator IDs that should appear in the legend, in registry order. */
export function getOverlayIndicatorIds(): string[] {
    return Object.entries(INDICATOR_DISPLAY)
        .filter(([_, d]) => d.display === 'overlay' && d.hasLegendEntry !== false)
        .map(([id]) => id);
}

/** All subplot indicator IDs that should appear in the legend, in registry order. */
export function getSubplotIndicatorIds(): string[] {
    return Object.entries(INDICATOR_DISPLAY)
        .filter(([_, d]) => d.display === 'subplot' && d.hasLegendEntry !== false)
        .map(([id]) => id);
}

/** Legend title for an indicator id, or the id itself if not registered. */
export function getLegendTitle(id: string): string {
    return INDICATOR_DISPLAY[id]?.legendTitle ?? id;
}

/** Returns 'overlay', 'subplot', or undefined if the id is unknown. */
export function getIndicatorDisplay(id: string): 'overlay' | 'subplot' | undefined {
    return INDICATOR_DISPLAY[id]?.display;
}
