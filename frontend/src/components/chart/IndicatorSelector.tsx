import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import LoginModal from "@/components/auth/LoginModal";
import MiniBrueEditor from "./MiniBrueEditor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
    Search,
    X,
    Check,
    Settings2,
    Star,
    TrendingUp,
    Activity,
    BarChart3,
    Waves,
    Target,
    ChevronDown,
    ChevronUp,
    Zap,
    Code2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IndicatorConfig } from "./IndicatorSettings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUserPref } from '@/hooks/useUserPref';

// Indicator category definitions
type IndicatorCategory = 'favorites' | 'my_scripts' | 'trend' | 'oscillators' | 'volatility' | 'volume' | 'support' | 'statistics';

interface IndicatorMeta {
    key: string;
    name: string;
    shortName: string;
    category: IndicatorCategory;
    description: string;
}

const INDICATORS: IndicatorMeta[] = [
    // Trend (11 + 16 new = 27)
    { key: 'movingAverages', name: 'Moving Averages', shortName: 'MA', category: 'trend', description: 'SMA, EMA, SMMA overlays' },
    { key: 'vwap', name: 'VWAP', shortName: 'VWAP', category: 'trend', description: 'Volume Weighted Average Price' },
    { key: 'ichimoku', name: 'Ichimoku Cloud', shortName: 'Ichimoku', category: 'trend', description: 'Trend, momentum & support/resistance' },
    { key: 'parabolicSAR', name: 'Parabolic SAR', shortName: 'SAR', category: 'trend', description: 'Stop and reversal dots' },
    { key: 'supertrend', name: 'Supertrend', shortName: 'ST', category: 'trend', description: 'ATR-based trend follower' },
    { key: 'donchian', name: 'Donchian Channels', shortName: 'DC', category: 'trend', description: 'Breakout channels (high/low)' },
    { key: 'aroon', name: 'Aroon', shortName: 'Aroon', category: 'trend', description: 'Measures time since high/low' },
    { key: 'envelopes', name: 'Envelopes', shortName: 'ENV', category: 'trend', description: 'Percentage bands around MA' },
    { key: 'dema', name: 'DEMA', shortName: 'DEMA', category: 'trend', description: 'Double Exponential MA' },
    { key: 'tema', name: 'TEMA', shortName: 'TEMA', category: 'trend', description: 'Triple Exponential MA' },
    { key: 'hma', name: 'HMA', shortName: 'HMA', category: 'trend', description: 'Hull Moving Average' },
    // New trend indicators
    { key: 'alma', name: 'ALMA', shortName: 'ALMA', category: 'trend', description: 'Arnaud Legoux Moving Average' },
    { key: 'kama', name: 'KAMA', shortName: 'KAMA', category: 'trend', description: 'Kaufman Adaptive Moving Average' },
    { key: 'zlema', name: 'ZLEMA', shortName: 'ZLEMA', category: 'trend', description: 'Zero Lag EMA' },
    { key: 't3', name: 'T3', shortName: 'T3', category: 'trend', description: 'Tillson T3 Moving Average' },
    { key: 'lsma', name: 'LSMA', shortName: 'LSMA', category: 'trend', description: 'Least Squares Moving Average' },
    { key: 'mcginley', name: 'McGinley Dynamic', shortName: 'McGin', category: 'trend', description: 'Self-adjusting moving average' },
    { key: 'wma', name: 'WMA', shortName: 'WMA', category: 'trend', description: 'Weighted Moving Average' },
    { key: 'smmaOverlay', name: 'SMMA', shortName: 'SMMA', category: 'trend', description: 'Smoothed Moving Average (standalone)' },
    { key: 'alligator', name: 'Alligator', shortName: 'Gator', category: 'trend', description: 'Bill Williams Alligator (3 SMAs)' },
    { key: 'vortex', name: 'Vortex', shortName: 'VTX', category: 'trend', description: 'Vortex Indicator (VI+/VI-)' },
    { key: 'choppiness', name: 'Choppiness Index', shortName: 'CHOP', category: 'trend', description: 'Trending vs ranging market' },
    { key: 'elderRay', name: 'Elder Ray', shortName: 'Elder', category: 'trend', description: 'Bull Power + Bear Power' },
    { key: 'massIndex', name: 'Mass Index', shortName: 'Mass', category: 'trend', description: 'Trend reversal via range narrowing' },
    { key: 'chandeKroll', name: 'Chande Kroll Stop', shortName: 'CKS', category: 'trend', description: 'Volatility-based trend stops' },
    { key: 'linRegSlope', name: 'LR Slope', shortName: 'LRS', category: 'trend', description: 'Linear Regression Slope' },
    { key: 'priceChannel', name: 'Price Channel', shortName: 'PC', category: 'trend', description: 'High/low price channel' },

    // Oscillators (16 + 14 new = 30)
    { key: 'rsi', name: 'RSI', shortName: 'RSI', category: 'oscillators', description: 'Relative Strength Index (14)' },
    { key: 'macd', name: 'MACD', shortName: 'MACD', category: 'oscillators', description: 'Moving Average Convergence Divergence' },
    { key: 'stochastic', name: 'Stochastic', shortName: 'Stoch', category: 'oscillators', description: 'Stochastic oscillator %K/%D' },
    { key: 'williamsR', name: 'Williams %R', shortName: '%R', category: 'oscillators', description: 'Williams Percent Range' },
    { key: 'cci', name: 'CCI', shortName: 'CCI', category: 'oscillators', description: 'Commodity Channel Index' },
    { key: 'roc', name: 'ROC', shortName: 'ROC', category: 'oscillators', description: 'Rate of Change' },
    { key: 'adx', name: 'ADX', shortName: 'ADX', category: 'oscillators', description: 'Average Directional Index' },
    { key: 'momentum', name: 'Momentum', shortName: 'MOM', category: 'oscillators', description: 'Price change over N periods' },
    { key: 'ao', name: 'Awesome Oscillator', shortName: 'AO', category: 'oscillators', description: 'Median price SMA 5/34 difference' },
    { key: 'mfi', name: 'MFI', shortName: 'MFI', category: 'oscillators', description: 'Money Flow Index (RSI + volume)' },
    { key: 'tsi', name: 'TSI', shortName: 'TSI', category: 'oscillators', description: 'True Strength Index' },
    { key: 'trix', name: 'TRIX', shortName: 'TRIX', category: 'oscillators', description: 'Triple EMA rate of change' },
    { key: 'ultimateOsc', name: 'Ultimate Oscillator', shortName: 'UO', category: 'oscillators', description: 'Multi-period momentum' },
    { key: 'dpo', name: 'DPO', shortName: 'DPO', category: 'oscillators', description: 'Detrended Price Oscillator' },
    { key: 'kst', name: 'KST', shortName: 'KST', category: 'oscillators', description: 'Know Sure Thing' },
    { key: 'stochRsi', name: 'Stochastic RSI', shortName: 'StochRSI', category: 'oscillators', description: 'Stochastic applied to RSI' },
    // New oscillators
    { key: 'ppo', name: 'PPO', shortName: 'PPO', category: 'oscillators', description: 'Percentage Price Oscillator' },
    { key: 'pvo', name: 'PVO', shortName: 'PVO', category: 'oscillators', description: 'Percentage Volume Oscillator' },
    { key: 'cmo', name: 'CMO', shortName: 'CMO', category: 'oscillators', description: 'Chande Momentum Oscillator' },
    { key: 'fisher', name: 'Fisher Transform', shortName: 'Fisher', category: 'oscillators', description: 'Normalized Gaussian oscillator' },
    { key: 'stc', name: 'Schaff Trend Cycle', shortName: 'STC', category: 'oscillators', description: 'MACD + Stochastic hybrid' },
    { key: 'rviOsc', name: 'Relative Vigor', shortName: 'RVI', category: 'oscillators', description: 'Close-Open vs High-Low energy' },
    { key: 'klinger', name: 'Klinger Volume', shortName: 'KVO', category: 'oscillators', description: 'Volume-based trend oscillator' },
    { key: 'connorsRsi', name: 'Connors RSI', shortName: 'CRSI', category: 'oscillators', description: 'RSI + Streak + Rank composite' },
    { key: 'apo', name: 'APO', shortName: 'APO', category: 'oscillators', description: 'Absolute Price Oscillator' },
    { key: 'qstick', name: 'Qstick', shortName: 'QStk', category: 'oscillators', description: 'Mean of close-open diff' },
    { key: 'bop', name: 'Balance of Power', shortName: 'BOP', category: 'oscillators', description: 'Buyer/seller strength' },
    { key: 'psychLine', name: 'Psychological Line', shortName: 'PL', category: 'oscillators', description: 'Percentage of up days' },
    { key: 'pfe', name: 'PFE', shortName: 'PFE', category: 'oscillators', description: 'Polarized Fractal Efficiency' },
    { key: 'smi', name: 'SMI', shortName: 'SMI', category: 'oscillators', description: 'Stochastic Momentum Index' },

    // Volatility (8 + 8 new = 16)
    { key: 'bollinger', name: 'Bollinger Bands', shortName: 'BB', category: 'volatility', description: 'Standard deviation bands' },
    { key: 'atr', name: 'ATR', shortName: 'ATR', category: 'volatility', description: 'Average True Range' },
    { key: 'keltner', name: 'Keltner Channels', shortName: 'Keltner', category: 'volatility', description: 'EMA-based volatility bands' },
    { key: 'bbPercent', name: 'BB %B', shortName: '%B', category: 'volatility', description: 'Where price sits in Bollinger Bands' },
    { key: 'bbWidth', name: 'BB Width', shortName: 'BBW', category: 'volatility', description: 'Bollinger bandwidth (squeeze)' },
    { key: 'histVol', name: 'Historical Volatility', shortName: 'HV', category: 'volatility', description: 'Annualized std dev of returns' },
    { key: 'chaikinVol', name: 'Chaikin Volatility', shortName: 'CV', category: 'volatility', description: 'EMA of high-low range change' },
    { key: 'stdDev', name: 'Standard Deviation', shortName: 'SD', category: 'volatility', description: 'Price standard deviation' },
    // New volatility
    { key: 'ulcerIndex', name: 'Ulcer Index', shortName: 'UI', category: 'volatility', description: 'Drawdown-based volatility' },
    { key: 'natr', name: 'NATR', shortName: 'NATR', category: 'volatility', description: 'Normalized ATR (percentage)' },
    { key: 'trueRange', name: 'True Range', shortName: 'TR', category: 'volatility', description: 'Raw True Range (not averaged)' },
    { key: 'squeeze', name: 'Squeeze Momentum', shortName: 'SQZ', category: 'volatility', description: 'Bollinger inside Keltner squeeze' },
    { key: 'chandelierExit', name: 'Chandelier Exit', shortName: 'CE', category: 'volatility', description: 'ATR-based trailing stops' },
    { key: 'relVolIndex', name: 'Rel Volatility Index', shortName: 'RVol', category: 'volatility', description: 'RSI applied to std deviation' },
    { key: 'vhf', name: 'VHF', shortName: 'VHF', category: 'volatility', description: 'Vertical Horizontal Filter' },
    { key: 'accBands', name: 'Acceleration Bands', shortName: 'AB', category: 'volatility', description: 'ATR-based acceleration bands' },

    // Volume (8 + 8 new = 16)
    { key: 'volume', name: 'Volume', shortName: 'Vol', category: 'volume', description: 'Trading volume bars' },
    { key: 'volumeProfile', name: 'Volume Profile', shortName: 'VP', category: 'volume', description: 'Price distribution by volume' },
    { key: 'obv', name: 'OBV', shortName: 'OBV', category: 'volume', description: 'On Balance Volume' },
    { key: 'cmf', name: 'CMF', shortName: 'CMF', category: 'volume', description: 'Chaikin Money Flow' },
    { key: 'adl', name: 'A/D Line', shortName: 'ADL', category: 'volume', description: 'Accumulation/Distribution' },
    { key: 'forceIndex', name: 'Force Index', shortName: 'FI', category: 'volume', description: 'Price change × volume' },
    { key: 'eom', name: 'Ease of Movement', shortName: 'EOM', category: 'volume', description: 'Volume-adjusted price change' },
    { key: 'volumeSma', name: 'Volume SMA', shortName: 'VSMA', category: 'volume', description: 'Volume moving average' },
    // New volume
    { key: 'vwma', name: 'VWMA', shortName: 'VWMA', category: 'volume', description: 'Volume Weighted Moving Average' },
    { key: 'volumeOsc', name: 'Volume Oscillator', shortName: 'VO', category: 'volume', description: 'Short vs long volume MA' },
    { key: 'nvi', name: 'NVI', shortName: 'NVI', category: 'volume', description: 'Negative Volume Index' },
    { key: 'pvi', name: 'PVI', shortName: 'PVI', category: 'volume', description: 'Positive Volume Index' },
    { key: 'pvt', name: 'PVT', shortName: 'PVT', category: 'volume', description: 'Price Volume Trend' },
    { key: 'vroc', name: 'VROC', shortName: 'VROC', category: 'volume', description: 'Volume Rate of Change' },
    { key: 'netVolume', name: 'Net Volume', shortName: 'NV', category: 'volume', description: 'Up volume minus down volume' },
    { key: 'twiggsMF', name: 'Twiggs Money Flow', shortName: 'TMF', category: 'volume', description: 'Improved Chaikin Money Flow' },

    // Support/Resistance (4 + 2 new = 6)
    { key: 'pivotPoints', name: 'Pivot Points', shortName: 'Pivot', category: 'support', description: 'Daily pivot, R1-R3, S1-S3' },
    { key: 'fibRetracement', name: 'Fibonacci Retracement', shortName: 'Fib', category: 'support', description: 'Auto Fibonacci levels' },
    { key: 'camarillaPivots', name: 'Camarilla Pivots', shortName: 'Cam', category: 'support', description: '8-level S/R system' },
    { key: 'woodiePivots', name: "Woodie's Pivots", shortName: 'Wood', category: 'support', description: 'Alternative pivot formula' },
    // New support
    { key: 'demarkPivots', name: 'DeMark Pivots', shortName: 'DM', category: 'support', description: 'DeMark-style pivot levels' },
    { key: 'zigzag', name: 'Zig Zag', shortName: 'ZZ', category: 'support', description: 'Trend reversal detector' },
    { key: 'fractals', name: 'Fractals', shortName: 'Frac', category: 'support', description: 'Williams fractal arrows' },

    // Statistics (3 + 5 new = 8)
    { key: 'correlation', name: 'Correlation', shortName: 'Corr', category: 'statistics', description: 'Correlation coefficient' },
    { key: 'linearReg', name: 'Linear Regression', shortName: 'LR', category: 'statistics', description: 'Regression channel' },
    { key: 'coppock', name: 'Coppock Curve', shortName: 'Copp', category: 'statistics', description: 'Long-term momentum' },
    // New statistics
    { key: 'linRegRSquared', name: 'R-Squared', shortName: 'R²', category: 'statistics', description: 'Regression goodness of fit' },
    { key: 'medianPrice', name: 'Median Price', shortName: 'MedP', category: 'statistics', description: '(High + Low) / 2 overlay' },
    { key: 'typicalPrice', name: 'Typical Price', shortName: 'TypP', category: 'statistics', description: '(H + L + C) / 3 overlay' },
    { key: 'weightedClose', name: 'Weighted Close', shortName: 'WtCl', category: 'statistics', description: '(H + L + 2C) / 4 overlay' },
    { key: 'gator', name: 'Gator Oscillator', shortName: 'Gator', category: 'statistics', description: 'Alligator jaw histogram' },
];

const CATEGORY_CONFIG: Record<IndicatorCategory, { label: string; icon: React.ElementType; color: string; bgColor: string }> = {
    favorites: { label: 'Favorites', icon: Star, color: 'text-yellow-500', bgColor: 'bg-yellow-500' },
    my_scripts: { label: 'My Scripts', icon: Code2, color: 'text-indigo-500', bgColor: 'bg-indigo-500' },
    trend: { label: 'Trend', icon: TrendingUp, color: 'text-emerald-500', bgColor: 'bg-emerald-500' },
    oscillators: { label: 'Oscillators', icon: Activity, color: 'text-blue-500', bgColor: 'bg-blue-500' },
    volatility: { label: 'Volatility', icon: Waves, color: 'text-purple-500', bgColor: 'bg-purple-500' },
    volume: { label: 'Volume', icon: BarChart3, color: 'text-orange-500', bgColor: 'bg-orange-500' },
    support: { label: 'Support/R...', icon: Target, color: 'text-cyan-400', bgColor: 'bg-cyan-400' },
    statistics: { label: 'Statistics', icon: Zap, color: 'text-rose-400', bgColor: 'bg-rose-400' },
};

// Stable top-level component; must NOT be defined inside render functions
// or React will unmount/remount it on every parent re-render, killing pointer capture.
function SettingRow({ label, value, onChange, min, max, step = 1 }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min: number;
    max: number;
    step?: number;
}) {
    const [localVal, setLocalVal] = React.useState(String(value));
    const prevValue = React.useRef(value);
    // Sync local state when value changes externally (e.g. slider drag)
    if (prevValue.current !== value) {
        prevValue.current = value;
        if (document.activeElement?.tagName !== 'INPUT' || localVal !== '') {
            if (Number(localVal) !== value) setLocalVal(String(value));
        }
    }
    const commit = () => {
        const n = Number(localVal);
        if (!isNaN(n) && localVal.trim() !== '') {
            const clamped = Math.min(max, Math.max(min, n));
            onChange(clamped);
            setLocalVal(String(clamped));
        } else {
            setLocalVal(String(value));
        }
    };
    return (
        <div className="flex items-center gap-3">
            <Label className="text-xs text-gray-500 w-16 sm:w-24 shrink-0">{label}</Label>
            <Slider
                value={[value]}
                onValueChange={([v]) => { onChange(v); setLocalVal(String(v)); }}
                min={min}
                max={max}
                step={step}
                className="flex-1"
            />
            <Input
                type="text"
                inputMode="numeric"
                value={localVal}
                onChange={(e) => setLocalVal(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
                onFocus={(e) => (e.target as HTMLInputElement).select()}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                className="w-12 sm:w-16 h-7 text-xs bg-white border-gray-200 text-gray-900 text-center px-1"
            />
        </div>
    );
}

interface IndicatorSelectorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    config: IndicatorConfig;
    onConfigChange: (config: IndicatorConfig) => void;
    onOpenSettings?: (indicatorKey: keyof IndicatorConfig) => void;
    onOpenCustomEditor?: () => void;
}

export default function IndicatorSelector({
    open,
    onOpenChange,
    config,
    onConfigChange,
    onOpenSettings,
    onOpenCustomEditor,
}: IndicatorSelectorProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [activeCategory, setActiveCategory] = useState<IndicatorCategory | 'all'>('all');
    const [expandedSettings, setExpandedSettings] = useState<string | null>(null);
    const settingsPanelRef = useRef<HTMLDivElement>(null);
    // Underlying type is string[] (jsonb-serialisable). favorites Set is
    // derived via useMemo below for O(1) .has lookups. Persisted in
    // chart_settings.settings.preferences.indicatorFavorites.
    const [favoritesArray, setFavoritesArray] = useUserPref<string[]>('preferences.indicatorFavorites', []);
    const favorites = useMemo(() => new Set(favoritesArray), [favoritesArray]);
    const [showLoginForFavorites, setShowLoginForFavorites] = useState(false);
    const [miniEditorOpen, setMiniEditorOpen] = useState(false);
    const { user } = useAuth();
    const [brueScripts, setBrueScripts] = useState<{ id: string; name: string; code: string }[]>([]);

    // Fetch custom Brue scripts on open
    const loadBrueScripts = useCallback(() => {
        if (user) {
            api.getBrueScripts().then(scripts => {
                setBrueScripts(scripts.map(s => ({
                    id: s.id,
                    name: s.name,
                    code: s.script_code
                })));
            }).catch(e => console.error("Failed to load brue scripts:", e));
        }
    }, [user]);

    useEffect(() => {
        if (open) {
            loadBrueScripts();
        }
    }, [open, loadBrueScripts]);

    // Save favorites to localStorage
    // Persistence is handled by useUserPref above; no manual sync needed.

    // Reset search when dialog closes
    useEffect(() => {
        if (!open) {
            setSearchQuery("");
        }
    }, [open]);

    // Auto-scroll expanded settings into view
    useEffect(() => {
        if (expandedSettings && settingsPanelRef.current) {
            setTimeout(() => {
                settingsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 50);
        }
    }, [expandedSettings]);

    // Check if indicator is enabled
    const isEnabled = useCallback((key: string): boolean => {
        if (key.startsWith('brue_')) {
            const scriptId = key.replace('brue_', '');
            return !!config.customBrueScripts?.[scriptId]?.enabled;
        }
        const indicator = config[key as keyof IndicatorConfig];
        if (!indicator) return false;
        if (typeof indicator === 'object' && 'enabled' in indicator) {
            return Boolean(indicator.enabled);
        }
        return false;
    }, [config]);

    // Toggle indicator on/off (instant apply); max 20 per chart
    const MAX_INDICATORS = 20;
    const toggleIndicator = useCallback((key: string) => {
        if (key.startsWith('brue_')) {
            const scriptId = key.replace('brue_', '');
            const scriptData = brueScripts.find(s => s.id === scriptId);
            if (!scriptData) return;
            
            const currentScripts = config.customBrueScripts || {};
            const isCurrentlyEnabled = !!currentScripts[scriptId]?.enabled;
            
            // Enforce max indicator limit
            if (!isCurrentlyEnabled) {
                const activeCount = Object.values(config).filter(
                    (v: any) => v && typeof v === 'object' && 'enabled' in v && v.enabled
                ).length + Object.values(currentScripts).filter(s => s.enabled).length;
                if (activeCount >= MAX_INDICATORS) return;
            }
            
            const newConfig = {
                ...config,
                customBrueScripts: {
                    ...currentScripts,
                    [scriptId]: {
                        ...currentScripts[scriptId],
                        enabled: !isCurrentlyEnabled,
                        name: scriptData.name,
                        code: scriptData.code
                    }
                }
            };
            onConfigChange(newConfig);
            return;
        }

        const indicator = config[key as keyof IndicatorConfig];
        if (indicator && typeof indicator === 'object' && 'enabled' in indicator) {
            // Enforce max indicator limit when enabling
            if (!indicator.enabled) {
                const activeCount = Object.values(config).filter(
                    (v: any) => v && typeof v === 'object' && 'enabled' in v && v.enabled
                ).length + Object.values(config.customBrueScripts || {}).filter(s => s.enabled).length;
                if (activeCount >= MAX_INDICATORS) return;
            }
            const newConfig = {
                ...config,
                [key]: {
                    ...indicator,
                    enabled: !indicator.enabled,
                    // When enabling Moving Averages with an empty lines array (e.g. after
                    // "Remove all indicators"), restore the default EMA 20 line so the user
                    // sees something immediately instead of an enabled-but-invisible indicator
                    ...(key === 'movingAverages' && !indicator.enabled && (!(indicator as any).lines || (indicator as any).lines.length === 0)
                        ? { lines: [{ type: 'EMA', period: 20, color: '#2962FF' }] }
                        : {})
                }
            };
            onConfigChange(newConfig);
        }
    }, [config, onConfigChange, brueScripts]);

    // Update a specific parameter for an indicator
    const updateIndicatorParam = useCallback((key: string, param: string, value: number) => {
        if (key.startsWith('brue_')) return; // No custom params for Brue scripts yet in UI
        const indicator = config[key as keyof IndicatorConfig];
        if (indicator && typeof indicator === 'object') {
            const newConfig = {
                ...config,
                [key]: { ...indicator, [param]: value }
            };
            onConfigChange(newConfig);
        }
    }, [config, onConfigChange]);

    // Toggle favorite (auth-gated)
    const toggleFavorite = useCallback((key: string) => {
        if (!user) {
            setShowLoginForFavorites(true);
            return;
        }
        setFavoritesArray(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return [...next];
        });
    }, [user]);

    // All combined indicators list
    const allIndicators = useMemo(() => {
        const custom: IndicatorMeta[] = brueScripts.map(s => ({
            key: `brue_${s.id}`,
            name: s.name,
            shortName: s.name.substring(0, 4),
            category: 'my_scripts',
            description: 'Custom Brue Script'
        }));
        return [...custom, ...INDICATORS];
    }, [brueScripts]);

    // Filter indicators
    const filteredIndicators = useMemo(() => {
        let filtered = allIndicators;

        // Apply search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(ind =>
                ind.name.toLowerCase().includes(query) ||
                ind.shortName.toLowerCase().includes(query) ||
                ind.description.toLowerCase().includes(query)
            );
        }

        // Apply category filter
        if (activeCategory === 'favorites') {
            filtered = filtered.filter(ind => favorites.has(ind.key));
        } else if (activeCategory !== 'all') {
            filtered = filtered.filter(ind => ind.category === activeCategory);
        }

        return filtered;
    }, [searchQuery, activeCategory, favorites, allIndicators]);

    // Count active indicators
    const activeCount = useMemo(() => {
        return allIndicators.filter(ind => isEnabled(ind.key)).length;
    }, [isEnabled, allIndicators]);

    // Count per category
    const categoryCount = useCallback((category: IndicatorCategory): number => {
        if (category === 'favorites') {
            return favorites.size;
        }
        return allIndicators.filter(ind => ind.category === category).length;
    }, [favorites, allIndicators]);

    // Categories to show (only show favorites if there are any).
    // my_scripts goes at the bottom of the sidebar: built-in categories first, then user scripts.
    const visibleCategories = useMemo(() => {
        const categories: (IndicatorCategory | 'all')[] = ['all'];
        if (favorites.size > 0) categories.push('favorites');
        categories.push('trend', 'oscillators', 'volatility', 'volume', 'support', 'statistics');
        if (user && brueScripts.length > 0) categories.push('my_scripts');
        return categories;
    }, [favorites.size, user, brueScripts.length]);

    // Render inline settings for an indicator
    const renderInlineSettings = (key: string) => {
        if (key.startsWith('brue_')) return null; // No UI parameters yet for Brue scripts
        const indicator = config[key as keyof IndicatorConfig];
        if (!indicator || typeof indicator !== 'object') return null;

        const ind = indicator as Record<string, any>;

        switch (key) {
            // ===== OSCILLATORS =====
            case 'rsi':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 14} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={2} max={50} />
                        <SettingRow label="Overbought" value={ind.overbought ?? 70} onChange={(v) => updateIndicatorParam(key, 'overbought', v)} min={50} max={100} />
                        <SettingRow label="Oversold" value={ind.oversold ?? 30} onChange={(v) => updateIndicatorParam(key, 'oversold', v)} min={0} max={50} />
                    </div>
                );
            case 'macd':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Fast EMA" value={ind.fast ?? 12} onChange={(v) => updateIndicatorParam(key, 'fast', v)} min={2} max={50} />
                        <SettingRow label="Slow EMA" value={ind.slow ?? 26} onChange={(v) => updateIndicatorParam(key, 'slow', v)} min={5} max={100} />
                        <SettingRow label="Signal Line" value={ind.signal ?? 9} onChange={(v) => updateIndicatorParam(key, 'signal', v)} min={2} max={50} />
                    </div>
                );
            case 'stochastic':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="%K Period" value={ind.kPeriod ?? 14} onChange={(v) => updateIndicatorParam(key, 'kPeriod', v)} min={1} max={50} />
                        <SettingRow label="%D Smooth" value={ind.dPeriod ?? 3} onChange={(v) => updateIndicatorParam(key, 'dPeriod', v)} min={1} max={20} />
                        <SettingRow label="Overbought" value={ind.overbought ?? 80} onChange={(v) => updateIndicatorParam(key, 'overbought', v)} min={50} max={100} />
                        <SettingRow label="Oversold" value={ind.oversold ?? 20} onChange={(v) => updateIndicatorParam(key, 'oversold', v)} min={0} max={50} />
                    </div>
                );
            case 'williamsR':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 14} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={2} max={50} />
                        <SettingRow label="Overbought" value={ind.overbought ?? -20} onChange={(v) => updateIndicatorParam(key, 'overbought', v)} min={-50} max={0} />
                        <SettingRow label="Oversold" value={ind.oversold ?? -80} onChange={(v) => updateIndicatorParam(key, 'oversold', v)} min={-100} max={-50} />
                    </div>
                );
            case 'cci':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 20} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={100} />
                        <SettingRow label="Overbought" value={ind.overbought ?? 100} onChange={(v) => updateIndicatorParam(key, 'overbought', v)} min={50} max={300} />
                        <SettingRow label="Oversold" value={ind.oversold ?? -100} onChange={(v) => updateIndicatorParam(key, 'oversold', v)} min={-300} max={-50} />
                    </div>
                );
            case 'roc':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 12} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={1} max={50} />
                    </div>
                );
            case 'adx':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 14} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={50} />
                    </div>
                );
            case 'momentum':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 10} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={1} max={50} />
                    </div>
                );
            case 'ao':
                return (<p className="text-xs text-gray-400">Fixed 5/34 period median price SMA difference.</p>);
            case 'mfi':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 14} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={2} max={50} />
                        <SettingRow label="Overbought" value={ind.overbought ?? 80} onChange={(v) => updateIndicatorParam(key, 'overbought', v)} min={50} max={100} />
                        <SettingRow label="Oversold" value={ind.oversold ?? 20} onChange={(v) => updateIndicatorParam(key, 'oversold', v)} min={0} max={50} />
                    </div>
                );
            case 'tsi':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Long Period" value={ind.longPeriod ?? 25} onChange={(v) => updateIndicatorParam(key, 'longPeriod', v)} min={5} max={50} />
                        <SettingRow label="Short Period" value={ind.shortPeriod ?? 13} onChange={(v) => updateIndicatorParam(key, 'shortPeriod', v)} min={2} max={30} />
                        <SettingRow label="Signal" value={ind.signalPeriod ?? 13} onChange={(v) => updateIndicatorParam(key, 'signalPeriod', v)} min={2} max={30} />
                    </div>
                );
            case 'trix':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 15} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={50} />
                        <SettingRow label="Signal" value={ind.signalPeriod ?? 9} onChange={(v) => updateIndicatorParam(key, 'signalPeriod', v)} min={2} max={30} />
                    </div>
                );
            case 'ultimateOsc':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Fast" value={ind.fast ?? 7} onChange={(v) => updateIndicatorParam(key, 'fast', v)} min={2} max={20} />
                        <SettingRow label="Medium" value={ind.med ?? 14} onChange={(v) => updateIndicatorParam(key, 'med', v)} min={5} max={30} />
                        <SettingRow label="Slow" value={ind.slow ?? 28} onChange={(v) => updateIndicatorParam(key, 'slow', v)} min={10} max={60} />
                    </div>
                );
            case 'dpo':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 21} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={50} />
                    </div>
                );
            case 'kst':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Signal" value={ind.signalPeriod ?? 9} onChange={(v) => updateIndicatorParam(key, 'signalPeriod', v)} min={2} max={30} />
                    </div>
                );
            case 'stochRsi':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="RSI Period" value={ind.rsiPeriod ?? 14} onChange={(v) => updateIndicatorParam(key, 'rsiPeriod', v)} min={2} max={50} />
                        <SettingRow label="%K Period" value={ind.kPeriod ?? 14} onChange={(v) => updateIndicatorParam(key, 'kPeriod', v)} min={2} max={50} />
                        <SettingRow label="%D Period" value={ind.dPeriod ?? 3} onChange={(v) => updateIndicatorParam(key, 'dPeriod', v)} min={1} max={20} />
                        <SettingRow label="Overbought" value={ind.overbought ?? 80} onChange={(v) => updateIndicatorParam(key, 'overbought', v)} min={50} max={100} />
                        <SettingRow label="Oversold" value={ind.oversold ?? 20} onChange={(v) => updateIndicatorParam(key, 'oversold', v)} min={0} max={50} />
                    </div>
                );

            // ===== TREND =====
            case 'movingAverages':
                const maLines = ind.lines?.length ?? 3;
                return (
                    <div className="space-y-3">
                        <SettingRow label="Line Count" value={maLines} onChange={(v) => {
                            const currentLines = ind.lines || [];
                            const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#95E1D3', '#F38181'];
                            const defaultPeriods = [9, 21, 50, 100, 200];
                            if (v > currentLines.length) {
                                const newLines = [...currentLines];
                                for (let i = currentLines.length; i < v; i++) {
                                    newLines.push({ type: 'EMA', period: defaultPeriods[i] || 20, color: colors[i % colors.length] });
                                }
                                const newConfig = { ...config, [key]: { ...ind, enabled: ind.enabled ?? true, lines: newLines } };
                                onConfigChange(newConfig);
                            } else if (v < currentLines.length) {
                                const newConfig = { ...config, [key]: { ...ind, enabled: ind.enabled ?? true, lines: currentLines.slice(0, v) } };
                                onConfigChange(newConfig);
                            }
                        }} min={1} max={5} />
                        
                        <div className="space-y-2.5">
                            {Array.from({ length: maLines }).map((_, i) => {
                                const defaultColors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#95E1D3', '#F38181'];
                                const defaultPeriods = [9, 21, 50, 100, 200];
                                const line = ind.lines?.[i] || { type: 'EMA', period: defaultPeriods[i] || 20, color: defaultColors[i % defaultColors.length] };
                                
                                return (
                                    <div key={i} className="flex items-center gap-2 bg-black/20 p-2 rounded-md ml-[4rem] sm:ml-[6rem]">
                                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: line.color }} />
                                        
                                        <Select
                                            value={line.type}
                                            onValueChange={(val) => {
                                                const currentLines = [...(ind.lines || Array.from({ length: maLines }).map((_, idx) => ({ type: 'EMA', period: defaultPeriods[idx] || 20, color: defaultColors[idx % defaultColors.length] })))];
                                                if (currentLines[i]) currentLines[i] = { ...currentLines[i], type: val as any };
                                                onConfigChange({ ...config, [key]: { ...ind, lines: currentLines } as any });
                                            }}
                                        >
                                            <SelectTrigger className="w-[80px] h-7 text-xs text-white bg-[#0f0f12] border-[#2a2a35] px-2 shadow-none focus:ring-0">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="SMA">SMA</SelectItem>
                                                <SelectItem value="EMA">EMA</SelectItem>
                                                <SelectItem value="SMMA">SMMA</SelectItem>
                                            </SelectContent>
                                        </Select>

                                        <Label className="text-xs text-gray-400 shrink-0 ml-1">Period</Label>
                                        <Input
                                            type="text"
                                            inputMode="numeric"
                                            defaultValue={line.period}
                                            key={`${i}-${line.period}`}
                                            onBlur={(e) => {
                                                const val = Number(e.target.value);
                                                if (!isNaN(val) && e.target.value.trim() !== '') {
                                                    const clamped = Math.min(200, Math.max(1, val));
                                                    const currentLines = [...(ind.lines || Array.from({ length: maLines }).map((_, idx) => ({ type: 'EMA', period: defaultPeriods[idx] || 20, color: defaultColors[idx % defaultColors.length] })))];
                                                    if (currentLines[i]) currentLines[i] = { ...currentLines[i], period: clamped };
                                                    onConfigChange({ ...config, [key]: { ...ind, lines: currentLines } as any });
                                                }
                                            }}
                                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                            onFocus={(e) => (e.target as HTMLInputElement).select()}
                                            className="w-16 h-7 text-xs bg-white border-gray-200 text-gray-900 text-center px-1 shrink-0"
                                        />
                                    </div>
                                );
                            })}
                        </div>
                        <SettingRow label="Line Width" value={ind.lineWidth ?? 2} onChange={(v) => updateIndicatorParam(key, 'lineWidth', v)} min={1} max={5} />
                    </div>
                );
            case 'ichimoku':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Tenkan" value={ind.tenkanPeriod ?? 9} onChange={(v) => updateIndicatorParam(key, 'tenkanPeriod', v)} min={5} max={30} />
                        <SettingRow label="Kijun" value={ind.kijunPeriod ?? 26} onChange={(v) => updateIndicatorParam(key, 'kijunPeriod', v)} min={10} max={60} />
                        <SettingRow label="Senkou B" value={ind.senkouBPeriod ?? 52} onChange={(v) => updateIndicatorParam(key, 'senkouBPeriod', v)} min={20} max={120} />
                        <SettingRow label="Displacement" value={ind.displacement ?? 26} onChange={(v) => updateIndicatorParam(key, 'displacement', v)} min={10} max={60} />
                    </div>
                );
            case 'parabolicSAR':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="AF Start" value={ind.afStart ?? 0.02} onChange={(v) => updateIndicatorParam(key, 'afStart', v)} min={0.01} max={0.1} step={0.01} />
                        <SettingRow label="AF Step" value={ind.afStep ?? 0.02} onChange={(v) => updateIndicatorParam(key, 'afStep', v)} min={0.01} max={0.1} step={0.01} />
                        <SettingRow label="AF Max" value={ind.afMax ?? 0.2} onChange={(v) => updateIndicatorParam(key, 'afMax', v)} min={0.1} max={0.5} step={0.05} />
                    </div>
                );
            case 'supertrend':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 10} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={50} />
                        <SettingRow label="Multiplier" value={ind.multiplier ?? 3} onChange={(v) => updateIndicatorParam(key, 'multiplier', v)} min={1} max={10} step={0.5} />
                    </div>
                );
            case 'donchian':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 20} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={100} />
                    </div>
                );
            case 'aroon':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 25} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={50} />
                    </div>
                );
            case 'envelopes':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 20} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={100} />
                        <SettingRow label="Percent" value={ind.percent ?? 2.5} onChange={(v) => updateIndicatorParam(key, 'percent', v)} min={0.5} max={10} step={0.5} />
                    </div>
                );
            case 'dema':
            case 'tema':
            case 'hma':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? (key === 'hma' ? 9 : 21)} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={2} max={200} />
                    </div>
                );
            case 'vwap':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Line Width" value={ind.lineWidth ?? 2} onChange={(v) => updateIndicatorParam(key, 'lineWidth', v)} min={1} max={5} />
                    </div>
                );

            // ===== VOLATILITY =====
            case 'bollinger':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 20} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={100} />
                        <SettingRow label="Std Dev" value={ind.stdDev ?? 2} onChange={(v) => updateIndicatorParam(key, 'stdDev', v)} min={0.5} max={5} step={0.5} />
                        <SettingRow label="Line Width" value={ind.lineWidth ?? 1} onChange={(v) => updateIndicatorParam(key, 'lineWidth', v)} min={1} max={5} />
                    </div>
                );
            case 'atr':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 14} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={2} max={50} />
                    </div>
                );
            case 'keltner':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="EMA Period" value={ind.emaPeriod ?? 20} onChange={(v) => updateIndicatorParam(key, 'emaPeriod', v)} min={5} max={50} />
                        <SettingRow label="ATR Period" value={ind.atrPeriod ?? 10} onChange={(v) => updateIndicatorParam(key, 'atrPeriod', v)} min={5} max={30} />
                        <SettingRow label="Multiplier" value={ind.multiplier ?? 2} onChange={(v) => updateIndicatorParam(key, 'multiplier', v)} min={0.5} max={5} step={0.5} />
                    </div>
                );
            case 'bbPercent':
            case 'bbWidth':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 20} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={100} />
                        <SettingRow label="Std Dev" value={ind.stdDev ?? 2} onChange={(v) => updateIndicatorParam(key, 'stdDev', v)} min={0.5} max={5} step={0.5} />
                    </div>
                );
            case 'histVol':
            case 'stdDev':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 20} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={100} />
                    </div>
                );
            case 'chaikinVol':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="EMA Period" value={ind.emaPeriod ?? 10} onChange={(v) => updateIndicatorParam(key, 'emaPeriod', v)} min={5} max={50} />
                        <SettingRow label="ROC Period" value={ind.rocPeriod ?? 10} onChange={(v) => updateIndicatorParam(key, 'rocPeriod', v)} min={5} max={50} />
                    </div>
                );

            // ===== VOLUME =====
            case 'volume':
                return (<p className="text-xs text-gray-400">Volume bars display buy/sell pressure with color coding.</p>);
            case 'obv':
            case 'adl':
                return (<p className="text-xs text-gray-400">Cumulative volume-based indicator. No configurable parameters.</p>);
            case 'cmf':
            case 'forceIndex':
            case 'eom':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? (key === 'cmf' ? 20 : key === 'forceIndex' ? 13 : 14)} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={2} max={50} />
                    </div>
                );
            case 'volumeSma':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 20} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={100} />
                    </div>
                );

            // ===== SUPPORT/RESISTANCE =====
            case 'pivotPoints':
            case 'camarillaPivots':
            case 'woodiePivots':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Line Width" value={ind.lineWidth ?? 1} onChange={(v) => updateIndicatorParam(key, 'lineWidth', v)} min={1} max={5} />
                    </div>
                );
            case 'fibRetracement':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Lookback" value={ind.lookback ?? 100} onChange={(v) => updateIndicatorParam(key, 'lookback', v)} min={20} max={500} />
                    </div>
                );

            // ===== STATISTICS =====
            case 'correlation':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 20} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={5} max={100} />
                    </div>
                );
            case 'linearReg':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Period" value={ind.period ?? 100} onChange={(v) => updateIndicatorParam(key, 'period', v)} min={10} max={500} />
                        <SettingRow label="Deviations" value={ind.deviations ?? 2} onChange={(v) => updateIndicatorParam(key, 'deviations', v)} min={0.5} max={5} step={0.5} />
                    </div>
                );
            case 'coppock':
                return (
                    <div className="space-y-2.5">
                        <SettingRow label="Long ROC" value={ind.longROC ?? 14} onChange={(v) => updateIndicatorParam(key, 'longROC', v)} min={5} max={30} />
                        <SettingRow label="Short ROC" value={ind.shortROC ?? 11} onChange={(v) => updateIndicatorParam(key, 'shortROC', v)} min={5} max={30} />
                        <SettingRow label="WMA Period" value={ind.wmaPeriod ?? 10} onChange={(v) => updateIndicatorParam(key, 'wmaPeriod', v)} min={5} max={30} />
                    </div>
                );

            default:
                return (
                    <p className="text-xs text-gray-500 italic">Enable indicator to apply</p>
                );
        }
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                {/* sm:h-[520px] caps the dialog at a compact fixed height on desktop so the
                   indicator list scrolls instead of the dialog growing to fit all items.
                   Mobile uses 80vh for full-screen feel. */}
                {/* TradingView-inspired clean light dialog. Larger, more spacious, with a
                   white background and subtle gray borders for a professional feel. */}
                <DialogContent className="w-[calc(100vw-0.5rem)] sm:w-[calc(100vw-1rem)] max-w-[680px] h-[70vh] sm:h-[600px] p-0 gap-0 bg-white border border-gray-200 overflow-hidden shadow-2xl flex flex-col [&>.absolute]:hidden rounded-xl">
                    {/* Header with title and close button. Mobile uses a short title and tighter
                       padding so the heading stays on one line; desktop keeps the long phrasing. */}
                    <div className="flex items-center justify-between px-3 py-2.5 sm:px-5 sm:py-4 border-b border-gray-200 gap-2">
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                            <h2 className="text-sm sm:text-lg font-semibold text-gray-900 truncate">
                                <span className="sm:hidden">Indicators</span>
                                <span className="hidden sm:inline">Indicators, metrics, and strategies</span>
                            </h2>
                            {activeCount > 0 && (
                                <span className="px-2 py-0.5 text-[10px] sm:text-xs font-medium bg-blue-50 text-blue-600 rounded-full shrink-0">
                                    {activeCount} active
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 sm:h-8 sm:w-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"
                                onClick={() => onOpenChange(false)}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Search bar */}
                    <div className="px-3 py-2 sm:px-5 sm:py-3 border-b border-gray-200">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="Search"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9 sm:h-10 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-blue-300 focus:ring-1 focus:ring-blue-200 rounded-lg"
                            />
                            {searchQuery && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-gray-400 hover:text-gray-600"
                                    onClick={() => setSearchQuery("")}
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Main content: sidebar + indicator list */}
                    <div className="flex flex-1 min-h-0">
                        {/* Categories sidebar with TradingView-style section headers.
                           Narrower on mobile (94px) so the indicator list gets more room; the
                           tighter horizontal padding keeps category labels readable. */}
                        <div className="w-[94px] sm:w-[160px] border-r border-gray-200 bg-gray-50/50 flex-shrink-0 flex flex-col min-h-0 h-full overflow-y-auto">
                            <div className="py-2 sm:py-3">
                            {/* Section label for categories */}
                            <div className="px-2.5 sm:px-4 pb-1.5 pt-1">
                                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Built-in</span>
                            </div>
                            {visibleCategories.map((cat) => {
                                const isAll = cat === 'all';
                                const catConfig = isAll ? null : CATEGORY_CONFIG[cat as IndicatorCategory];
                                const count = isAll ? allIndicators.length : categoryCount(cat as IndicatorCategory);

                                return (
                                    <button
                                        key={cat}
                                        onClick={() => setActiveCategory(cat)}
                                        className={cn(
                                            "w-full flex items-center gap-1.5 sm:gap-2.5 px-2.5 sm:px-4 py-2 sm:py-2.5 text-sm transition-colors",
                                            activeCategory === cat
                                                ? "bg-white text-gray-900 font-medium shadow-sm"
                                                : "text-gray-600 hover:text-gray-900 hover:bg-white/60"
                                        )}
                                    >
                                        {!isAll && catConfig && (
                                            <span className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0", catConfig.bgColor)} />
                                        )}
                                        <span className="flex-1 text-left truncate text-[11px] sm:text-sm">
                                            {isAll ? 'All' : catConfig?.label}
                                        </span>
                                        <span className="text-[10px] sm:text-[11px] text-gray-400">{count}</span>
                                    </button>
                                );
                            })}
                            </div>
                        </div>

                        {/* Indicator list: clean light rows like TradingView */}
                        <div
                            className="flex-1 flex flex-col bg-white min-h-0 h-full overflow-y-auto overscroll-contain"
                            style={{ WebkitOverflowScrolling: 'touch' }}
                            onWheel={(e) => e.stopPropagation()}
                            onTouchMove={(e) => e.stopPropagation()}
                        >
                            {/* Column header like TradingView. Hidden on mobile to save vertical
                               space; the section is self-evident on small screens. */}
                            <div className="hidden sm:block px-5 py-2 border-b border-gray-100 sticky top-0 bg-white z-10">
                                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Script Name</span>
                            </div>
                            <div className="px-1.5 sm:px-3 pb-4 sm:pb-6">
                                {filteredIndicators.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-[300px] text-gray-400">
                                        <Search className="h-10 w-10 mb-3 opacity-30" />
                                        <p className="text-sm">No indicators found</p>
                                        {searchQuery && (
                                            <p className="text-xs mt-1 text-gray-400">Try a different search term</p>
                                        )}
                                    </div>
                                ) : (
                                    filteredIndicators.map((indicator) => {
                                        const enabled = isEnabled(indicator.key);
                                        const isFavorite = favorites.has(indicator.key);
                                        const catConfig = CATEGORY_CONFIG[indicator.category];
                                        const isExpanded = expandedSettings === indicator.key;

                                        return (
                                            <div key={indicator.key}>
                                                {/* Indicator row. Tighter padding on mobile so more
                                                   rows are visible per screen height. */}
                                                <div
                                                    className={cn(
                                                        "group flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-1.5 sm:py-3 transition-all cursor-pointer border-b border-gray-50",
                                                        enabled
                                                            ? "bg-blue-50/50 hover:bg-blue-50"
                                                            : "hover:bg-gray-50"
                                                    )}
                                                    onClick={() => toggleIndicator(indicator.key)}
                                                >
                                                    {/* Check indicator */}
                                                    <div className={cn(
                                                        "flex items-center justify-center w-4 h-4 sm:w-5 sm:h-5 rounded transition-colors shrink-0",
                                                        enabled
                                                            ? "bg-blue-500 text-white"
                                                            : "border border-gray-300"
                                                    )}>
                                                        {enabled && <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5 stroke-[3]" />}
                                                    </div>

                                                    {/* Name and description */}
                                                    <div className="flex-1 min-w-0">
                                                        <span className={cn(
                                                            "text-[13px] sm:text-sm truncate block",
                                                            enabled ? "text-gray-900 font-medium" : "text-gray-700"
                                                        )}>
                                                            {indicator.name}
                                                        </span>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex items-center gap-0.5 shrink-0">
                                                        {/* Settings button */}
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className={cn(
                                                                "h-6 w-6 sm:h-7 sm:w-7 transition-colors rounded-full",
                                                                isExpanded
                                                                    ? "text-blue-600 bg-blue-50"
                                                                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                                                            )}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setExpandedSettings(isExpanded ? null : indicator.key);
                                                            }}
                                                            title="Configure parameters"
                                                        >
                                                            {isExpanded ? (
                                                                <ChevronUp className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                                                            ) : (
                                                                <Settings2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                                                            )}
                                                        </Button>

                                                        {/* Favorite button - appears on hover */}
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className={cn(
                                                                "h-7 w-7 transition-opacity hidden sm:flex",
                                                                isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                                            )}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleFavorite(indicator.key);
                                                            }}
                                                        >
                                                            <Star className={cn(
                                                                "h-3.5 w-3.5",
                                                                isFavorite ? "fill-yellow-500 text-yellow-500" : "text-gray-500 hover:text-yellow-500"
                                                            )} />
                                                        </Button>
                                                    </div>
                                                </div>

                                                {/* Inline Settings Panel */}
                                                {isExpanded && (
                                                    <div
                                                        ref={settingsPanelRef}
                                                        className="ml-2 sm:ml-9 mr-2 mb-2 p-3 bg-gray-50 rounded-lg border border-gray-200"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <div className="flex items-center justify-between mb-3">
                                                            <span className="text-xs font-medium text-gray-500">Parameters</span>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                                onClick={() => {
                                                                    if (!enabled) toggleIndicator(indicator.key);
                                                                    setExpandedSettings(null);
                                                                }}
                                                            >
                                                                {enabled ? 'Done' : 'Add to Chart'}
                                                            </Button>
                                                        </div>
                                                        {renderInlineSettings(indicator.key)}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-2 sm:p-3 border-t border-gray-200 bg-gray-50/50 flex justify-end">
                        <Button
                            onClick={() => onOpenChange(false)}
                            className="bg-blue-500 hover:bg-blue-600 text-white h-8 sm:h-9 text-sm px-5 sm:px-6 font-medium rounded-lg"
                        >
                            Done
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
            <LoginModal
                open={showLoginForFavorites}
                onOpenChange={setShowLoginForFavorites}
                message="Sign in to save your favorite indicators and sync them across devices."
            />
            <MiniBrueEditor
                open={miniEditorOpen}
                onOpenChange={setMiniEditorOpen}
                config={config}
                onConfigChange={onConfigChange}
                onSaved={loadBrueScripts}
                savedScripts={brueScripts}
            />
        </>
    );
}
