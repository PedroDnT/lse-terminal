import { ChartSettings } from "./ChartSettingsDialog";
import { ColorButton } from "./ColorButton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useChartSettings, useReplaceChartSettings } from "@/contexts/ChartSettingsContext";
import { ChevronLeft } from "lucide-react";

// Was useState + localStorage('chartSettings') + manual debounced
// api.upsertChartSettings. Now reads from the ChartSettingsContext (shared
// across all 4 InlineChartSettings panels; fixes a latent bug where each
// panel held its own snapshot and could go stale relative to siblings) and
// writes through useReplaceChartSettings which handles the debounced DB
// save inside the context. The chartSettingsChanged dispatch stays for now
// once useChartThemeColors moved to context. Single source of truth now.

export function useInlineSettings() {
  const settings = useChartSettings();
  const replace = useReplaceChartSettings();

  const update = (next: ChartSettings) => {
    replace(next);
  };

  return { settings, update };
}

function PanelShell({ onBack, title, children, hideHeader = false }: { onBack: () => void; title: string; children: React.ReactNode; hideHeader?: boolean }) {
  // hideHeader: the terminal wraps these panels in its own titled, draggable
  // card whose tabs already say Appearance/Chart, so the site's "< Back"
  // header row would show the same word twice. Default (site) is unchanged.
  return (
    <div>
      {!hideHeader && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <span className="text-sm font-medium text-foreground">{title}</span>
        </div>
      )}
      <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
        <div className="p-3 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">{label}</span>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-1 pb-0.5">{children}</div>;
}

function ColorPair({ bullColor, bearColor, onBull, onBear }: { bullColor: string; bearColor: string; onBull: (c: string) => void; onBear: (c: string) => void }) {
  return (
    <div className="flex gap-1.5">
      <ColorButton color={bullColor} onChange={onBull} label="Bullish" />
      <ColorButton color={bearColor} onChange={onBear} label="Bearish" />
    </div>
  );
}

export function AppearancePanel({ onBack, hideHeader }: { onBack: () => void; hideHeader?: boolean }) {
  const { settings, update } = useInlineSettings();
  const c = settings.candles;
  const ch = settings.chart;
  return (
    <PanelShell onBack={onBack} title="Appearance" hideHeader={hideHeader}>
      <SectionLabel>Candle Colors</SectionLabel>
      <Row label="Body">
        <ColorPair bullColor={c.bodyBullish} bearColor={c.bodyBearish}
          onBull={(v) => update({ ...settings, candles: { ...c, bodyBullish: v } })}
          onBear={(v) => update({ ...settings, candles: { ...c, bodyBearish: v } })} />
      </Row>
      <Row label="Borders">
        <ColorPair bullColor={c.bordersBullish} bearColor={c.bordersBearish}
          onBull={(v) => update({ ...settings, candles: { ...c, bordersBullish: v } })}
          onBear={(v) => update({ ...settings, candles: { ...c, bordersBearish: v } })} />
      </Row>
      <Row label="Wick">
        <ColorPair bullColor={c.wickBullish} bearColor={c.wickBearish}
          onBull={(v) => update({ ...settings, candles: { ...c, wickBullish: v } })}
          onBear={(v) => update({ ...settings, candles: { ...c, wickBearish: v } })} />
      </Row>
      <SectionLabel>Chart</SectionLabel>
      <Row label="Background">
        <ColorButton color={ch.backgroundColor} onChange={(v) => update({ ...settings, chart: { ...ch, backgroundColor: v } })} label="Background" />
      </Row>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-16 shrink-0">BG opacity</span>
        <Slider value={[ch.backgroundOpacity]} min={0} max={100} step={1} className="flex-1"
          onValueChange={([v]) => update({ ...settings, chart: { ...ch, backgroundOpacity: v } })} />
        <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">{ch.backgroundOpacity}%</span>
      </div>
      <Row label="Grid">
        <ColorButton color={ch.gridColor} onChange={(v) => update({ ...settings, chart: { ...ch, gridColor: v } })} label="Grid" />
      </Row>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-16 shrink-0">Grid opacity</span>
        <Slider value={[ch.gridOpacity]} min={0} max={100} step={1} className="flex-1"
          onValueChange={([v]) => update({ ...settings, chart: { ...ch, gridOpacity: v } })} />
        <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">{ch.gridOpacity}%</span>
      </div>
      <SectionLabel>Crosshair &amp; Axis</SectionLabel>
      <Row label="Crosshair">
        <ColorButton color={ch.crosshairColor} onChange={(v) => update({ ...settings, chart: { ...ch, crosshairColor: v } })} label="Crosshair" />
      </Row>
      <Row label="Axis label">
        <ColorButton color={ch.axisLabelColor} onChange={(v) => update({ ...settings, chart: { ...ch, axisLabelColor: v } })} label="Axis label" />
      </Row>
      <SectionLabel>Price Ticker</SectionLabel>
      <Row label="Price ticker">
        <ColorPair bullColor={ch.priceTickerBullish} bearColor={ch.priceTickerBearish}
          onBull={(v) => update({ ...settings, chart: { ...ch, priceTickerBullish: v } })}
          onBear={(v) => update({ ...settings, chart: { ...ch, priceTickerBearish: v } })} />
      </Row>
    </PanelShell>
  );
}

export function ChartSettingsPanel({ onBack, hideHeader }: { onBack: () => void; hideHeader?: boolean }) {
  const { settings, update } = useInlineSettings();
  const ch = settings.chart;
  return (
    <PanelShell onBack={onBack} title="Chart Settings" hideHeader={hideHeader}>
      <SectionLabel>Timezone</SectionLabel>
      <Select value={settings.data.timezone} onValueChange={(v) => update({ ...settings, data: { ...settings.data, timezone: v } })}>
        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="UTC">UTC</SelectItem>
          <SelectItem value="local">Local Time</SelectItem>
          <SelectItem value="America/New_York">New York (EST/EDT)</SelectItem>
          <SelectItem value="America/Chicago">Chicago (CST/CDT)</SelectItem>
          <SelectItem value="America/Los_Angeles">Los Angeles (PST/PDT)</SelectItem>
          <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
          <SelectItem value="Europe/Paris">Paris (CET/CEST)</SelectItem>
          <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
          <SelectItem value="Asia/Shanghai">Shanghai (CST)</SelectItem>
          <SelectItem value="Asia/Hong_Kong">Hong Kong (HKT)</SelectItem>
          <SelectItem value="Asia/Singapore">Singapore (SGT)</SelectItem>
          <SelectItem value="Australia/Sydney">Sydney (AEST/AEDT)</SelectItem>
        </SelectContent>
      </Select>
      <SectionLabel>Zoom Speed</SectionLabel>
      <div className="flex items-center gap-2">
        <Slider value={[ch.scrollSensitivity]} min={1} max={10} step={1} className="flex-1"
          onValueChange={([v]) => update({ ...settings, chart: { ...ch, scrollSensitivity: v } })} />
        <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{ch.scrollSensitivity}/10</span>
      </div>
    </PanelShell>
  );
}

export function AlertsPanel({ onBack }: { onBack: () => void }) {
  const { settings, update } = useInlineSettings();
  const a = settings.alerts;
  return (
    <PanelShell onBack={onBack} title="Alerts">
      <SectionLabel>Alert Lines</SectionLabel>
      <Row label="Show alert lines">
        <Switch checked={a.alertLinesVisible} onCheckedChange={(v) => update({ ...settings, alerts: { ...a, alertLinesVisible: v } })} />
      </Row>
      {a.alertLinesVisible && (
        <Row label="Line color">
          <ColorButton color={a.alertLinesColor} onChange={(v) => update({ ...settings, alerts: { ...a, alertLinesColor: v } })} label="Alert line color" />
        </Row>
      )}
      <Row label="Only active alerts">
        <Switch checked={a.onlyActiveAlerts} onCheckedChange={(v) => update({ ...settings, alerts: { ...a, onlyActiveAlerts: v } })} />
      </Row>
      <SectionLabel>Sound</SectionLabel>
      <Row label="Play sound">
        <Switch checked={a.alertVolume} onCheckedChange={(v) => update({ ...settings, alerts: { ...a, alertVolume: v } })} />
      </Row>
      {a.alertVolume && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-12 shrink-0">Volume</span>
          <Slider value={[a.alertVolumeLevel]} min={0} max={100} step={5} className="flex-1"
            onValueChange={([v]) => update({ ...settings, alerts: { ...a, alertVolumeLevel: v } })} />
          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{a.alertVolumeLevel}%</span>
        </div>
      )}
      <Row label="Auto-hide toasts">
        <Switch checked={a.autoHideToasts} onCheckedChange={(v) => update({ ...settings, alerts: { ...a, autoHideToasts: v } })} />
      </Row>
    </PanelShell>
  );
}

export function EventsPanel({ onBack }: { onBack: () => void }) {
  const { settings, update } = useInlineSettings();
  const e = settings.events;
  return (
    <PanelShell onBack={onBack} title="Events">
      <SectionLabel>Chart Events</SectionLabel>
      <Row label="Economic events">
        <Switch checked={e.economicEvents} onCheckedChange={(v) => update({ ...settings, events: { ...e, economicEvents: v } })} />
      </Row>
      {e.economicEvents && (
        <Row label="Only future events">
          <Switch checked={e.onlyFutureEvents} onCheckedChange={(v) => update({ ...settings, events: { ...e, onlyFutureEvents: v } })} />
        </Row>
      )}
      <Row label="Session breaks">
        <div className="flex items-center gap-1.5">
          {e.sessionBreaks && <ColorButton color={e.sessionBreaksColor} onChange={(v) => update({ ...settings, events: { ...e, sessionBreaksColor: v } })} label="Session breaks color" />}
          <Switch checked={e.sessionBreaks} onCheckedChange={(v) => update({ ...settings, events: { ...e, sessionBreaks: v } })} />
        </div>
      </Row>
      <Row label="Events breaks">
        <div className="flex items-center gap-1.5">
          {e.eventsBreaks && <ColorButton color={e.eventsBreaksColor} onChange={(v) => update({ ...settings, events: { ...e, eventsBreaksColor: v } })} label="Events breaks color" />}
          <Switch checked={e.eventsBreaks} onCheckedChange={(v) => update({ ...settings, events: { ...e, eventsBreaks: v } })} />
        </div>
      </Row>
      <Row label="Latest news">
        <Switch checked={e.latestNews} onCheckedChange={(v) => update({ ...settings, events: { ...e, latestNews: v } })} />
      </Row>
    </PanelShell>
  );
}
