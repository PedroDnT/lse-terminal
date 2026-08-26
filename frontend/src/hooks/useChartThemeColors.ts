/**
 * useChartThemeColors.ts - Chart appearance persistence
 * =====================================================
 * Logged in:  reads/writes from chart_settings table in PostgreSQL.
 * Logged out: returns defaults. No persistence. Want to customize? Log in.
 *
 * The hook exposes colors that ProChart and other renderers consume.
 * ChartSettingsDialog writes to DB and dispatches 'chartSettingsChanged'
 * so all consumers re-render immediately.
 */

import { useState, useEffect, useMemo } from 'react';
import { useChartSettings } from '@/contexts/ChartSettingsContext';
import { PRICE_TAG_NEUTRAL } from '@/components/chart/core/types';

interface ChartColors {
  upColor: string;
  downColor: string;
  upBorderColor: string;
  downBorderColor: string;
  wickUpColor: string;
  wickDownColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  gridColor: string;
  gridOpacity: number;
  axisLabelColor: string;
  axisLineColor: string;
  priceTickerBullish: string;
  priceTickerBearish: string;
  slColor: string;
  slOpacity: number;
  tpColor: string;
  tpOpacity: number;
}

// Shape of chartAppearance stored in chart_settings.settings.chartAppearance
interface StoredAppearance {
  candle?: {
    bodyUp?: string;
    bodyDown?: string;
    borderUp?: string;
    borderDown?: string;
    wickUp?: string;
    wickDown?: string;
  };
  background?: string;
  backgroundOpacity?: number;
  grid?: string;
  gridOpacity?: number;
  axisLabel?: string;
  axisLine?: string;
  priceTickerBullish?: string;
  priceTickerBearish?: string;
}

interface StoredTrading {
  slColor?: string;
  slOpacity?: number;
  tpColor?: string;
  tpOpacity?: number;
}

// Default colors based on theme
const getThemeDefaults = (isDark: boolean): ChartColors => ({
  upColor: '#22c55e',
  downColor: '#ef5350',
  upBorderColor: '#000000',
  downBorderColor: '#000000',
  wickUpColor: '#000000',
  wickDownColor: '#000000',
  backgroundColor: '#ffffff',
  backgroundOpacity: 100,
  gridColor: '#9ca3af',
  gridOpacity: 20,
  axisLabelColor: isDark ? '#b2b5be' : '#000000',
  axisLineColor: isDark ? '#666666' : '#999999',
  // Neutral last-price tag by default; see PRICE_TAG_NEUTRAL.
  priceTickerBullish: PRICE_TAG_NEUTRAL,
  priceTickerBearish: PRICE_TAG_NEUTRAL,
  slColor: '#dc2626',
  slOpacity: 70,
  tpColor: '#16a34a',
  tpOpacity: 70,
});

// Parse the DB settings blob into ChartColors
function parseFromDB(
  appearance: StoredAppearance | undefined,
  trading: StoredTrading | undefined,
  isDark: boolean
): ChartColors {
  const defaults = getThemeDefaults(isDark);
  if (!appearance) return defaults;

  return {
    upColor: appearance.candle?.bodyUp || defaults.upColor,
    downColor: appearance.candle?.bodyDown || defaults.downColor,
    upBorderColor: appearance.candle?.borderUp || defaults.upBorderColor,
    downBorderColor: appearance.candle?.borderDown || defaults.downBorderColor,
    wickUpColor: appearance.candle?.wickUp || defaults.wickUpColor,
    wickDownColor: appearance.candle?.wickDown || defaults.wickDownColor,
    backgroundColor: appearance.background || defaults.backgroundColor,
    backgroundOpacity: appearance.backgroundOpacity ?? defaults.backgroundOpacity,
    gridColor: appearance.grid || defaults.gridColor,
    gridOpacity: appearance.gridOpacity ?? defaults.gridOpacity,
    // Ignore old hardcoded grey (#787b86) from before theme-aware update
    axisLabelColor: (appearance.axisLabel && appearance.axisLabel !== '#787b86')
      ? appearance.axisLabel
      : defaults.axisLabelColor,
    axisLineColor: appearance.axisLine || defaults.axisLineColor,
    priceTickerBullish: appearance.priceTickerBullish || defaults.priceTickerBullish,
    priceTickerBearish: appearance.priceTickerBearish || defaults.priceTickerBearish,
    slColor: trading?.slColor || defaults.slColor,
    slOpacity: trading?.slOpacity ?? defaults.slOpacity,
    tpColor: trading?.tpColor || defaults.tpColor,
    tpOpacity: trading?.tpOpacity ?? defaults.tpOpacity,
  };
}

export function useChartThemeColors(): ChartColors {
  // Rewritten to consume ChartSettingsContext instead of the
  // old "fetch DB on mount + listen for chartSettingsChanged event +
  // hold own copies of dbAppearance/dbTrading" pattern. Context is the
  // single source of truth; React re-renders this consumer whenever the
  // context state changes (sign-in load, dialog save, inline edits,
  // timezone picker, etc.). No more event plumbing, no more "did we load
  // the right user's settings" race.
  const settings = useChartSettings();

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'dark';
  });

  // Listen for theme changes (light/dark toggle) via the DOM-class
  // mutation observer. useTheme owns the class toggle, this just mirrors.
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          const isDark = document.documentElement.classList.contains('dark');
          setTheme(isDark ? 'dark' : 'light');
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  const colors = useMemo(() => {
    const isDark = theme === 'dark';
    // Map ChartSettings (frontend shape) into StoredAppearance/Trading
    // (the DB shape parseFromDB expects). Same field equivalences as
    // settingsMapper.toAPIFormat, inlined here so this hook doesn't
    // pull the whole mapper module just for these few keys.
    const appearance: StoredAppearance = {
      candle: {
        bodyUp:     settings.candles.bodyBullish,
        bodyDown:   settings.candles.bodyBearish,
        borderUp:   settings.candles.bordersBullish,
        borderDown: settings.candles.bordersBearish,
        wickUp:     settings.candles.wickBullish,
        wickDown:   settings.candles.wickBearish,
      },
      background:        settings.chart.backgroundColor,
      backgroundOpacity: settings.chart.backgroundOpacity,
      grid:              settings.chart.gridColor,
      gridOpacity:       settings.chart.gridOpacity,
      axisLabel:         settings.chart.axisLabelColor,
      axisLine:          settings.chart.axisLineColor,
      priceTickerBullish: settings.chart.priceTickerBullish,
      priceTickerBearish: settings.chart.priceTickerBearish,
    };
    return parseFromDB(appearance, settings.trading, isDark);
  }, [theme, settings]);

  return colors;
}
