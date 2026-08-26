import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { X, Trash2, Palette, ChevronDown } from "lucide-react";
import { IndicatorConfig, SubplotStyle } from "./IndicatorSettings";
import {
  INDICATOR_REGISTRY,
  resolveTitle,
  getNestedValue,
  setNestedValue,
  type IndicatorMeta,
} from "./indicatorRegistry";

export type IndicatorType = 'rsi' | 'macd' | 'atr' | 'stochastic' | 'volume' | 'bollinger' | 'movingAverages' | 'williamsR' | 'cci' | 'adx' | 'roc' | 'vwap' | 'ichimoku' | 'parabolicSAR' | 'keltner' | 'pivotPoints' | 'volumeProfile' | 'optionsPdf' | 'supertrend' | 'donchian' | 'aroon' | 'envelopes' | 'dema' | 'tema' | 'hma' | 'momentum' | 'ao' | 'mfi' | 'tsi' | 'trix' | 'ultimateOsc' | 'dpo' | 'kst' | 'stochRsi' | 'bbPercent' | 'bbWidth' | 'histVol' | 'chaikinVol' | 'stdDev' | 'obv' | 'cmf' | 'adl' | 'forceIndex' | 'eom' | 'volumeSma' | 'fibRetracement' | 'camarillaPivots' | 'woodiePivots' | 'correlation' | 'linearReg' | 'coppock' | 'alma' | 'kama' | 'zlema' | 't3' | 'lsma' | 'mcginley' | 'wma' | 'smmaOverlay' | 'vortex' | 'choppiness' | 'elderRay' | 'massIndex' | 'chandeKroll' | 'linRegSlope' | 'priceChannel' | 'alligator' | 'ppo' | 'pvo' | 'cmo' | 'fisher' | 'stc' | 'rviOsc' | 'klinger' | 'connorsRsi' | 'apo' | 'qstick' | 'bop' | 'psychLine' | 'pfe' | 'smi' | 'ulcerIndex' | 'natr' | 'trueRange' | 'squeeze' | 'chandelierExit' | 'relVolIndex' | 'vhf' | 'accBands' | 'vwma' | 'volumeOsc' | 'nvi' | 'pvi' | 'pvt' | 'vroc' | 'netVolume' | 'twiggsMF' | 'linRegRSquared' | 'medianPrice' | 'typicalPrice' | 'weightedClose' | 'demarkPivots' | 'zigzag' | 'fractals' | 'gator';

// TradingView-style full color palette (8 columns, organized by brightness and hue)
const COLOR_PALETTE = [
  ['#000000', '#434651', '#5d606b', '#787b86', '#9598a1', '#b2b5be', '#d1d4dc', '#ffffff'],
  ['#f23645', '#ff5252', '#ff5a5a', '#ff7070', '#ff8787', '#ffa0a0', '#ffb7b7', '#ffd5d5'],
  ['#ff9800', '#ff9100', '#ffab00', '#ffb74d', '#ffc107', '#ffd54f', '#ffe082', '#fff3e0'],
  ['#ffeb3b', '#ffee58', '#fff176', '#fff59d', '#fff9c4', '#fffde7', '#f5f5dc', '#f9fbe7'],
  ['#089981', '#4caf50', '#00c853', '#69f0ae', '#81c784', '#a5d6a7', '#c8e6c9', '#e8f5e9'],
  ['#00bcd4', '#26c6da', '#4dd0e1', '#80deea', '#b2ebf2', '#e0f7fa', '#84ffff', '#a7ffeb'],
  ['#2962ff', '#2196f3', '#42a5f5', '#64b5f6', '#90caf9', '#bbdefb', '#e3f2fd', '#e8eaf6'],
  ['#673ab7', '#7c4dff', '#9c27b0', '#ba68c8', '#ce93d8', '#e1bee7', '#f3e5f5', '#ede7f6'],
  ['#e91e63', '#f06292', '#f48fb1', '#f8bbd9', '#fce4ec', '#ff80ab', '#ff4081', '#f50057'],
  ['#795548', '#8d6e63', '#a1887f', '#bcaaa4', '#d7ccc8', '#efebe9', '#6d4c41', '#5d4037'],
];

interface IndicatorPanelSettingsProps {
  type: IndicatorType;
  config: IndicatorConfig;
  onConfigChange: (config: IndicatorConfig) => void;
  position: { x: number; y: number };
  onClose: () => void;
}

export default function IndicatorPanelSettings({
  type,
  config,
  onConfigChange,
  position,
  onClose,
}: IndicatorPanelSettingsProps) {
  const [localConfig, setLocalConfig] = useState(config);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleApply = () => {
    onConfigChange(localConfig);
    onClose();
  };

  // Generic remove: works for ANY indicator by setting enabled: false
  const handleRemove = () => {
    const key = type as string;
    const updatedConfig = { ...localConfig } as any;
    if (updatedConfig[key]) {
      updatedConfig[key] = { ...updatedConfig[key], enabled: false };
    }
    onConfigChange(updatedConfig);
    onClose();
  };

  // ─── Color Picker State ────────────────────────────────────────────────
  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);

  const renderColorPicker = (label: string, value: string, onChange: (color: string) => void) => {
    const pickerId = `${type}-${label.replace(/\s+/g, '-').toLowerCase()}`;
    const isOpen = activeColorPicker === pickerId;

    // Use a popover with the full TradingView-style color palette grid
    // instead of the native <input type="color"> which shows a basic
    // browser-dependent picker with limited colors
    return (
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Popover
          open={isOpen}
          onOpenChange={(open) => setActiveColorPicker(open ? pickerId : null)}
          modal={true}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-8 h-8 rounded cursor-pointer border border-border p-0.5 bg-background hover:border-primary transition-colors"
              style={{ backgroundColor: value }}
              title={label}
            />
          </PopoverTrigger>
          <PopoverContent
            className="w-auto p-2 z-[9999]"
            align="end"
            sideOffset={4}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <div className="grid gap-[2px]">
              {COLOR_PALETTE.map((row, rowIndex) => (
                <div key={rowIndex} className="flex gap-[2px]">
                  {row.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onChange(color);
                        setActiveColorPicker(null);
                      }}
                      className={`w-[18px] h-[18px] rounded-[3px] border transition-all flex-shrink-0 ${
                        value?.toLowerCase() === color.toLowerCase()
                          ? 'border-primary ring-1 ring-primary scale-105 z-10'
                          : 'border-transparent hover:border-muted-foreground hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  };

  const renderStyleSettings = (style: SubplotStyle, onChange: (style: SubplotStyle) => void, settingsId?: string) => {
    const bgPickerId = `${type}-${settingsId || 'style'}-background`;
    const isBgOpen = activeColorPicker === bgPickerId;

    return (
      <div className="space-y-2 pt-3 border-t border-border/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Palette className="h-3 w-3" />
          <span>Panel Styling</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground">Background</Label>
          <Popover
            open={isBgOpen}
            onOpenChange={(open) => setActiveColorPicker(open ? bgPickerId : null)}
            modal={true}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 h-7 px-2 rounded border border-border bg-background hover:bg-muted/50 transition-colors"
              >
                <div className="w-4 h-4 rounded border border-border/50" style={{ backgroundColor: style.backgroundColor || '#1a1a2e' }} />
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-2 z-[9999]"
              align="end"
              sideOffset={4}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <div className="grid gap-[2px]">
                {COLOR_PALETTE.map((row, rowIndex) => (
                  <div key={rowIndex} className="flex gap-[2px]">
                    {row.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          onChange({ ...style, backgroundColor: color });
                          setActiveColorPicker(null);
                        }}
                        className={`w-[18px] h-[18px] rounded-[3px] border transition-all flex-shrink-0 ${style.backgroundColor?.toLowerCase() === color.toLowerCase()
                          ? 'border-primary ring-1 ring-primary scale-105 z-10'
                          : 'border-transparent hover:border-muted-foreground hover:scale-105'
                          }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground flex-shrink-0">Opacity</Label>
          <Slider
            value={[(style.backgroundOpacity ?? 0.3) * 100]}
            onValueChange={([val]) => onChange({ ...style, backgroundOpacity: val / 100 })}
            min={0}
            max={100}
            step={5}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-8 text-right">{Math.round((style.backgroundOpacity ?? 0.3) * 100)}%</span>
        </div>
      </div>
    );
  };

  // ─── Generic Renderer (driven by INDICATOR_REGISTRY) ───────────────────

  /**
   * Update a nested property within the indicator's local config.
   * Handles dotted keys like 'style.lineWidth'.
   */
  const updateIndicator = (configKey: string, propPath: string, value: any) => {
    const current = (localConfig as any)[configKey] || {};
    const updated = setNestedValue(current, propPath, value);
    setLocalConfig({ ...localConfig, [configKey]: updated } as any);
  };

  const renderGenericSettings = (meta: IndicatorMeta) => {
    const indConfig = (localConfig as any)[meta.configKey] || {};

    // Determine grid class for params based on count
    const paramCount = meta.params?.length || 0;
    const gridClass = paramCount >= 3 ? 'grid grid-cols-3 gap-2' : paramCount === 2 ? 'grid grid-cols-2 gap-2' : '';

    return (
      <div className="space-y-3">
        {/* Description */}
        {meta.description && (
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        )}

        {/* Param inputs */}
        {meta.params && meta.params.length > 0 && (
          <div className={gridClass}>
            {meta.params.map((p) => (
              <div key={p.key}>
                <Label className="text-xs text-muted-foreground">{p.label}</Label>
                <Input
                  type="number"
                  value={indConfig[p.key] ?? p.default}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const val = p.type === 'float' ? parseFloat(raw) : parseInt(raw);
                    updateIndicator(meta.configKey, p.key, isNaN(val) ? p.default : val);
                  }}
                  className="mt-1 h-8 text-xs"
                  min={p.min}
                  max={p.max}
                  step={p.step ?? (p.type === 'float' ? 0.1 : 1)}
                />
              </div>
            ))}
          </div>
        )}

        {/* Sliders */}
        {meta.sliders?.map((s) => (
          <div key={s.key}>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">{s.label}</Label>
              <span className="text-xs text-muted-foreground">{indConfig[s.key] ?? s.default}</span>
            </div>
            <Slider
              value={[indConfig[s.key] ?? s.default]}
              onValueChange={([val]) => updateIndicator(meta.configKey, s.key, val)}
              min={s.min}
              max={s.max}
              step={s.step}
              className="mt-1"
            />
          </div>
        ))}

        {/* Color pickers */}
        {meta.colors?.map((c) => renderColorPicker(
          c.label,
          getNestedValue(indConfig, c.key, c.default),
          (color) => updateIndicator(meta.configKey, c.key, color),
        ))}

        {/* Line width slider */}
        {meta.lineWidth && (() => {
          const lw = meta.lineWidth === true
            ? { key: 'lineWidth', default: 1.5 }
            : meta.lineWidth;
          const currentVal = getNestedValue(indConfig, lw.key, lw.default);
          return (
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Line Width</Label>
                <span className="text-xs text-muted-foreground">{currentVal}</span>
              </div>
              <Slider
                value={[currentVal]}
                onValueChange={([val]) => updateIndicator(meta.configKey, lw.key, val)}
                min={0.5}
                max={4}
                step={0.5}
                className="mt-1"
              />
            </div>
          );
        })()}

        {/* Panel style settings */}
        {meta.hasStyle && renderStyleSettings(
          indConfig.style || {},
          (style) => updateIndicator(meta.configKey, 'style', style),
        )}
      </div>
    );
  };

  // ─── Settings Router ─────────────────────────────────────────────────────

  const renderSettings = () => {
    // Special-case: movingAverages has unique add/remove line UI
    if (type === 'movingAverages') {
      return renderMovingAveragesSettings();
    }
    // Special-case: volumeProfile has unique lookback/opacity/POC UI
    if (type === 'volumeProfile') {
      return renderVolumeProfileSettings();
    }
    // Special-case: optionsPdf has unique end spread/opacity UI
    if (type === 'optionsPdf') {
      return renderOptionsPdfSettings();
    }

    // Generic: use registry
    const meta = INDICATOR_REGISTRY[type];
    if (meta) {
      return renderGenericSettings(meta);
    }

    return null;
  };

  // ─── Special-case: Moving Averages ─────────────────────────────────────
  const MA_COLORS = ['#FFD700', '#FF6B6B', '#4ECDC4', '#95E1D3', '#F38181', '#9B59B6', '#3498DB', '#E67E22'];

  const renderMovingAveragesSettings = () => (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Configure moving average lines on the chart.</p>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Line Width</Label>
          <span className="text-xs text-muted-foreground">{localConfig.movingAverages.lineWidth ?? 1}px</span>
        </div>
        <Slider
          value={[localConfig.movingAverages.lineWidth ?? 1]}
          onValueChange={([val]) => setLocalConfig({
            ...localConfig,
            movingAverages: { ...localConfig.movingAverages, lineWidth: val }
          })}
          min={1} max={5} step={1} className="mt-1"
        />
      </div>
      <div className="border-t border-border/30 pt-3">
        {localConfig.movingAverages.lines.map((line, idx) => (
          <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded mb-2">
            <select
              value={line.type}
              onChange={(e) => {
                const newLines = [...localConfig.movingAverages.lines];
                newLines[idx] = { ...newLines[idx], type: e.target.value as 'SMA' | 'EMA' | 'SMMA' };
                setLocalConfig({ ...localConfig, movingAverages: { ...localConfig.movingAverages, lines: newLines } });
              }}
              className="h-7 text-xs bg-background border border-border rounded px-2"
            >
              <option value="EMA">EMA</option>
              <option value="SMA">SMA</option>
              <option value="SMMA">SMMA</option>
            </select>
            <Input
              type="number"
              value={line.period}
              onChange={(e) => {
                const newLines = [...localConfig.movingAverages.lines];
                newLines[idx] = { ...newLines[idx], period: parseInt(e.target.value) || 20 };
                setLocalConfig({ ...localConfig, movingAverages: { ...localConfig.movingAverages, lines: newLines } });
              }}
              className="h-7 w-16 text-xs" min={1}
            />
            {/* Color picker: popover with full TradingView palette grid */}
            <Popover
              open={activeColorPicker === `ma-line-${idx}`}
              onOpenChange={(open) => setActiveColorPicker(open ? `ma-line-${idx}` : null)}
              modal={true}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="w-8 h-8 rounded cursor-pointer border border-border p-0.5 bg-background hover:border-primary transition-colors flex-shrink-0"
                  style={{ backgroundColor: line.color }}
                  title="Pick colour"
                />
              </PopoverTrigger>
              <PopoverContent
                className="w-auto p-2 z-[9999]"
                align="end"
                sideOffset={4}
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <div className="grid gap-[2px]">
                  {COLOR_PALETTE.map((row, rowIndex) => (
                    <div key={rowIndex} className="flex gap-[2px]">
                      {row.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const newLines = [...localConfig.movingAverages.lines];
                            newLines[idx] = { ...newLines[idx], color };
                            setLocalConfig({ ...localConfig, movingAverages: { ...localConfig.movingAverages, lines: newLines } });
                            setActiveColorPicker(null);
                          }}
                          className={`w-[18px] h-[18px] rounded-[3px] border transition-all flex-shrink-0 ${
                            line.color?.toLowerCase() === color.toLowerCase()
                              ? 'border-primary ring-1 ring-primary scale-105 z-10'
                              : 'border-transparent hover:border-muted-foreground hover:scale-105'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <button
              onClick={() => {
                const newLines = localConfig.movingAverages.lines.filter((_, i) => i !== idx);
                setLocalConfig({ ...localConfig, movingAverages: { ...localConfig.movingAverages, lines: newLines } });
              }}
              className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
              title="Remove"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <Button
        size="sm" variant="outline"
        onClick={() => {
          const nextColor = MA_COLORS[localConfig.movingAverages.lines.length % MA_COLORS.length];
          setLocalConfig({
            ...localConfig,
            movingAverages: {
              ...localConfig.movingAverages,
              lines: [...localConfig.movingAverages.lines, { type: 'EMA', period: 20, color: nextColor }]
            }
          });
        }}
        className="w-full h-7 text-xs"
      >
        <span className="mr-1">+</span> Add Moving Average
      </Button>
    </div>
  );

  // ─── Special-case: Volume Profile ──────────────────────────────────────
  const renderVolumeProfileSettings = () => (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Volume distribution across price levels.</p>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Number of Rows</Label>
          <span className="text-xs text-muted-foreground">{localConfig.volumeProfile?.numberOfRows ?? 48}</span>
        </div>
        <Slider value={[localConfig.volumeProfile?.numberOfRows ?? 48]} onValueChange={([val]) => setLocalConfig({ ...localConfig, volumeProfile: { ...localConfig.volumeProfile, numberOfRows: val } })} min={12} max={200} step={1} className="mt-1" />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Row Width %</Label>
          <span className="text-xs text-muted-foreground">{localConfig.volumeProfile?.rowWidth ?? 15}%</span>
        </div>
        <Slider value={[localConfig.volumeProfile?.rowWidth ?? 15]} onValueChange={([val]) => setLocalConfig({ ...localConfig, volumeProfile: { ...localConfig.volumeProfile, rowWidth: val } })} min={5} max={50} step={1} className="mt-1" />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Lookback Bars</Label>
          <span className="text-xs text-muted-foreground">{localConfig.volumeProfile?.lookbackBars ?? 0}</span>
        </div>
        <Slider value={[localConfig.volumeProfile?.lookbackBars ?? 0]} onValueChange={([val]) => setLocalConfig({ ...localConfig, volumeProfile: { ...localConfig.volumeProfile, lookbackBars: val } })} min={0} max={500} step={10} className="mt-1" />
        <p className="text-xs text-muted-foreground mt-1">0 = All visible bars</p>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Opacity</Label>
          <span className="text-xs text-muted-foreground">{localConfig.volumeProfile?.opacity ?? 60}%</span>
        </div>
        <Slider value={[localConfig.volumeProfile?.opacity ?? 60]} onValueChange={([val]) => setLocalConfig({ ...localConfig, volumeProfile: { ...localConfig.volumeProfile, opacity: val } })} min={10} max={100} step={5} className="mt-1" />
      </div>
      {renderColorPicker("Up Bars", localConfig.volumeProfile?.upColor || '#D97706', (color) => setLocalConfig({ ...localConfig, volumeProfile: { ...localConfig.volumeProfile, upColor: color } }))}
      {renderColorPicker("Down Bars", localConfig.volumeProfile?.downColor || '#1E3A8A', (color) => setLocalConfig({ ...localConfig, volumeProfile: { ...localConfig.volumeProfile, downColor: color } }))}
      {renderColorPicker("POC Color", localConfig.volumeProfile?.pocColor || '#10B981', (color) => setLocalConfig({ ...localConfig, volumeProfile: { ...localConfig.volumeProfile, pocColor: color } }))}
    </div>
  );

  // ─── Special-case: Options PDF ─────────────────────────────────────────
  const renderOptionsPdfSettings = () => (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Options-implied probability distribution (fan cone).</p>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">End Spread %</Label>
          <span className="text-xs text-muted-foreground">{localConfig.optionsPdf?.endSpread ?? 7}%</span>
        </div>
        <Slider value={[localConfig.optionsPdf?.endSpread ?? 7]} onValueChange={([val]) => setLocalConfig({ ...localConfig, optionsPdf: { ...localConfig.optionsPdf, endSpread: val } })} min={3} max={20} step={1} className="mt-1" />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Opacity</Label>
          <span className="text-xs text-muted-foreground">{localConfig.optionsPdf?.opacity ?? 80}%</span>
        </div>
        <Slider value={[localConfig.optionsPdf?.opacity ?? 80]} onValueChange={([val]) => setLocalConfig({ ...localConfig, optionsPdf: { ...localConfig.optionsPdf, opacity: val } })} min={20} max={100} step={5} className="mt-1" />
      </div>
      {renderColorPicker("Probability Color", localConfig.optionsPdf?.color || '#00C8C8', (color) => setLocalConfig({ ...localConfig, optionsPdf: { ...localConfig.optionsPdf, color: color } }))}
    </div>
  );

  // ─── Title ────────────────────────────────────────────────────────────────

  const getTitle = () => {
    // Special cases
    if (type === 'movingAverages') return `Moving Averages (${config.movingAverages.lines.length})`;
    if (type === 'volumeProfile') return `Volume Profile (${config.volumeProfile?.numberOfRows ?? 48} rows)`;
    if (type === 'optionsPdf') return 'Options PDF';

    // Registry-driven
    const meta = INDICATOR_REGISTRY[type];
    if (meta) {
      return resolveTitle(meta, (config as any)[meta.configKey]);
    }
    return 'Settings';
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="absolute z-50 bg-card border border-border rounded-lg shadow-lg p-3 min-w-[220px] max-w-[280px]"
      style={{ left: 8, bottom: 60 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">{getTitle()}</span>
        <Button size="icon" variant="ghost" onClick={onClose} className="h-6 w-6">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {renderSettings()}

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30">
        <Button
          size="sm" variant="ghost" onClick={handleRemove}
          className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Remove
        </Button>
        <Button size="sm" onClick={handleApply} className="h-7 text-xs">
          Apply
        </Button>
      </div>
    </div>
  );
}
