// Mapping between frontend ChartSettings and API format
// Frontend uses different key names than the API schema

import { ChartSettings } from '@/components/chart/ChartSettingsDialog';
import { PRICE_TAG_NEUTRAL } from '@/components/chart/core/types';

// API format (matches PostgreSQL schema)
export interface APIChartSettings {
  chartAppearance: {
    candle: {
      bodyUp: string;
      bodyDown: string;
      borderUp: string;
      borderDown: string;
      wickUp: string;
      wickDown: string;
    };
    background: string;
    backgroundOpacity: number;
    grid: string;
    gridOpacity: number;
    axisLabel: string;
    axisLine: string;
    priceTickerBullish?: string;
    priceTickerBearish?: string;
    // Crosshair never persisted originally (edits silently reverted on
    // reload); optional so old workspace files
    // without them still parse.
    crosshair?: string;
    crosshairLabelBg?: string;
  };
  chartSettings: {
    timezone: string;
    zoomSpeed: number;
  };
  alerts: {
    linesVisible: boolean;
    linesColor: string;
    onlyActive: boolean;
    volume: boolean;
    volumeLevel: number;
    autoHideToasts: boolean;
  };
  events: {
    ideas: boolean;
    ideasFilter: string;
    sessionBreaks: boolean;
    sessionBreaksColor: string;
    economicEvents: boolean;
    onlyFutureEvents: boolean;
    eventsBreaks: boolean;
    eventsBreaksColor: string;
    latestNews: boolean;
    newsNotification: boolean;
  };
  trading?: {
    slColor: string;
    slOpacity: number;
    tpColor: string;
    tpOpacity: number;
  };
  watchlist?: string[];
  settingsTemplates?: Array<{
    name: string;
    settings: APIChartSettings;
  }>;
}

// Convert frontend ChartSettings to API format
export function toAPIFormat(settings: ChartSettings): APIChartSettings {
  return {
    chartAppearance: {
      candle: {
        bodyUp: settings.candles.bodyBullish,
        bodyDown: settings.candles.bodyBearish,
        borderUp: settings.candles.bordersBullish,
        borderDown: settings.candles.bordersBearish,
        wickUp: settings.candles.wickBullish,
        wickDown: settings.candles.wickBearish,
      },
      background: settings.chart.backgroundColor,
      backgroundOpacity: settings.chart.backgroundOpacity,
      grid: settings.chart.gridColor,
      gridOpacity: settings.chart.gridOpacity,
      axisLabel: settings.chart.axisLabelColor,
      axisLine: settings.chart.axisLineColor,
      priceTickerBullish: settings.chart.priceTickerBullish,
      priceTickerBearish: settings.chart.priceTickerBearish,
      crosshair: settings.chart.crosshairColor,
      crosshairLabelBg: settings.chart.crosshairLabelBg,
    },
    chartSettings: {
      timezone: settings.data.timezone,
      zoomSpeed: settings.chart.scrollSensitivity,
    },
    alerts: {
      linesVisible: settings.alerts.alertLinesVisible,
      linesColor: settings.alerts.alertLinesColor,
      onlyActive: settings.alerts.onlyActiveAlerts,
      volume: settings.alerts.alertVolume,
      volumeLevel: settings.alerts.alertVolumeLevel,
      autoHideToasts: settings.alerts.autoHideToasts,
    },
    events: {
      ideas: settings.events.ideas,
      ideasFilter: settings.events.ideasFilter,
      sessionBreaks: settings.events.sessionBreaks,
      sessionBreaksColor: settings.events.sessionBreaksColor,
      economicEvents: settings.events.economicEvents,
      onlyFutureEvents: settings.events.onlyFutureEvents,
      eventsBreaks: settings.events.eventsBreaks,
      eventsBreaksColor: settings.events.eventsBreaksColor,
      latestNews: settings.events.latestNews,
      newsNotification: settings.events.newsNotification,
    },
    // Trading colors (SL/TP lines on chart)
    trading: (settings as any).trading ? {
      slColor: (settings as any).trading.slColor,
      slOpacity: (settings as any).trading.slOpacity,
      tpColor: (settings as any).trading.tpColor,
      tpOpacity: (settings as any).trading.tpOpacity,
    } : undefined,
  };
}

// Convert API format to frontend ChartSettings
export function fromAPIFormat(apiSettings: APIChartSettings): ChartSettings {
  return {
    candles: {
      bodyBullish: apiSettings.chartAppearance.candle.bodyUp,
      bodyBearish: apiSettings.chartAppearance.candle.bodyDown,
      bordersBullish: apiSettings.chartAppearance.candle.borderUp,
      bordersBearish: apiSettings.chartAppearance.candle.borderDown,
      wickBullish: apiSettings.chartAppearance.candle.wickUp,
      wickBearish: apiSettings.chartAppearance.candle.wickDown,
    },
    chart: {
      backgroundColor: apiSettings.chartAppearance.background,
      backgroundOpacity: apiSettings.chartAppearance.backgroundOpacity,
      gridColor: apiSettings.chartAppearance.grid,
      gridOpacity: apiSettings.chartAppearance.gridOpacity,
      // Fields below were added to ChartSettings.chart after the API mapper
      // was first written; mergeWithDefaults patches platform defaults under
      // the returned object so these are always populated even when the API
      // row doesn't carry them.
      gridHorizontalLines: 45,
      gridVerticalLines: 16,
      scrollSensitivity: apiSettings.chartSettings.zoomSpeed,
      axisLabelColor: apiSettings.chartAppearance.axisLabel || '#787b86',
      axisLineColor: apiSettings.chartAppearance.axisLine || '#666666',
      priceTickerBullish: apiSettings.chartAppearance.priceTickerBullish || PRICE_TAG_NEUTRAL,
      priceTickerBearish: apiSettings.chartAppearance.priceTickerBearish || PRICE_TAG_NEUTRAL,
      crosshairColor: apiSettings.chartAppearance.crosshair || '#6b7280',
      crosshairLabelBg: apiSettings.chartAppearance.crosshairLabelBg || '#131722',
    },
    data: {
      timezone: apiSettings.chartSettings.timezone,
    },
    alerts: {
      alertLinesVisible: apiSettings.alerts.linesVisible,
      alertLinesColor: apiSettings.alerts.linesColor,
      onlyActiveAlerts: apiSettings.alerts.onlyActive,
      alertVolume: apiSettings.alerts.volume,
      alertVolumeLevel: apiSettings.alerts.volumeLevel,
      autoHideToasts: apiSettings.alerts.autoHideToasts,
    },
    events: {
      ideas: apiSettings.events.ideas,
      ideasFilter: apiSettings.events.ideasFilter,
      sessionBreaks: apiSettings.events.sessionBreaks,
      sessionBreaksColor: apiSettings.events.sessionBreaksColor,
      economicEvents: apiSettings.events.economicEvents,
      onlyFutureEvents: apiSettings.events.onlyFutureEvents,
      eventsBreaks: apiSettings.events.eventsBreaks,
      eventsBreaksColor: apiSettings.events.eventsBreaksColor,
      latestNews: apiSettings.events.latestNews,
      newsNotification: apiSettings.events.newsNotification,
    },
    // trading isn't in APIChartSettings (added to the frontend after the mapper).
    // Default it here so the returned ChartSettings type is satisfied.
    trading: {
      slColor: '#dc2626',
      slOpacity: 70,
      tpColor: '#16a34a',
      tpOpacity: 70,
    },
  };
}

// Merge partial API settings with defaults
export function mergeWithDefaults(
  apiSettings: Partial<APIChartSettings> | null,
  defaultSettings: ChartSettings
): ChartSettings {
  if (!apiSettings) return defaultSettings;
  
  try {
    const converted = fromAPIFormat(apiSettings as APIChartSettings);
    return {
      candles: { ...defaultSettings.candles, ...converted.candles },
      chart: { ...defaultSettings.chart, ...converted.chart },
      data: { ...defaultSettings.data, ...converted.data },
      alerts: { ...defaultSettings.alerts, ...converted.alerts },
      trading: defaultSettings.trading,
      events: { ...defaultSettings.events, ...converted.events },
    };
  } catch {
    console.warn('Failed to parse API settings, using defaults');
    return defaultSettings;
  }
}
