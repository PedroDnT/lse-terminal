// ============================================================================
// engineIndicators.ts - render the local engine's Python indicators on the
// chart as first-class indicators.
//
// The terminal computes indicators in Python (built-ins plus whatever the user
// writes in the editor) and returns them from /api/candles as timestamped
// points. The chart computes its own indicators in TypeScript, so there
// was no obvious place for these to land.
//
// There is one, though, and it is the engine's own design rather than a bolt-on:
// ProChart's `customIndicators` accepts entries whose series are ALREADY
// computed elsewhere, identified by a prefix on `expression` so the formula
// evaluator leaves them alone (see the passthrough in ProChart's indicatorData
// memo). Upstream that exists for Brue-emitted plots; a Python indicator is the
// same shape of thing - an externally computed series - so it uses the same
// door with a "local:" prefix.
//
// The payoff is that Python indicators are not second-class: they draw as
// overlays on the price chart or as their own subplots, get legend entries,
// colours and line widths, and participate in the same show/hide and selection
// machinery as the built-in 105.
// ============================================================================

import type { Candle } from '@/components/chart/core/types';

// Shape returned by GET /api/candles for each computed indicator.
export interface EngineIndicatorPayload {
  [label: string]: {
    overlay: boolean;
    series: {
      [column: string]: {
        kind: string;              // "line" | "histogram" | ...
        points: [number, number][]; // [epoch seconds, value]
      };
    };
  };
}

// Distinct, colour-blind-safe-ish palette for engine indicators. Deliberately
// different from the chart's built-in indicator colours so a user can tell at a
// glance which system a line came from.
const PALETTE = ['#38bdf8', '#fbbf24', '#c084fc', '#34d399', '#fb7185', '#a3e635'];

export interface CustomIndicatorEntry {
  id: string;
  name: string;
  expression: string;
  enabled: boolean;
  display: 'overlay' | 'subplot';
  color: string;
  lineWidth: number;
  zeroLine: boolean;
  data: number[];
  // Render hint from the engine's indicator spec ("line" | "histogram").
  // Only the subplot renderer reads it; absent means line.
  kind?: string;
  // Series from the same engine indicator share a group so they draw in ONE
  // subplot pane (MACD line+signal+hist) instead of one pane per column.
  group?: string;
}

/**
 * Convert the engine's indicator payload into ProChart customIndicators.
 *
 * The critical detail is alignment: the chart indexes indicator data by CANDLE
 * INDEX, while the engine returns sparse [timestamp, value] pairs (it drops
 * leading NaNs during an indicator's warm-up period). Every series is therefore
 * re-expanded onto the candle array, with NaN where the engine had no value, so
 * index i of the data always corresponds to index i of the candles. Getting this
 * wrong would shift every indicator left by its warm-up length - a silent,
 * plausible-looking error rather than a visible break.
 */
export function toCustomIndicators(
  payload: EngineIndicatorPayload | undefined,
  candles: Candle[]
): CustomIndicatorEntry[] {
  if (!payload || !candles.length) return [];

  // Candle timestamps are milliseconds by the time they reach the chart; the
  // engine's points are in seconds.
  const indexByTime = new Map<number, number>();
  for (let i = 0; i < candles.length; i++) {
    indexByTime.set(Math.floor(candles[i].time / 1000), i);
  }

  const out: CustomIndicatorEntry[] = [];
  let colorIdx = 0;

  for (const [label, ind] of Object.entries(payload)) {
    for (const [column, series] of Object.entries(ind.series || {})) {
      const data = new Array<number>(candles.length).fill(NaN);
      let hit = 0;
      for (const [ts, value] of series.points || []) {
        const i = indexByTime.get(ts);
        if (i !== undefined) { data[i] = value; hit++; }
      }
      // A series that lands on no candle at all (timeframe mismatch, stale
      // response) would render as an empty line and look like a broken
      // indicator; skip it instead.
      if (!hit) continue;

      const columns = Object.keys(ind.series);
      // Single-column indicators read better as just their label ("RSI");
      // multi-column ones need the column to disambiguate ("MACD signal").
      const name = columns.length > 1 ? `${label} ${column}` : label;

      out.push({
        id: `local-${label}-${column}`,
        name,
        // The prefix is what tells ProChart's formula evaluator to leave this
        // series alone and draw the precomputed values.
        expression: `local:${label}:${column}`,
        enabled: true,
        display: ind.overlay ? 'overlay' : 'subplot',
        color: PALETTE[colorIdx++ % PALETTE.length],
        lineWidth: 2,
        zeroLine: false,
        data,
        kind: series.kind,
        // One pane per ENGINE INDICATOR, not per column: MACD's three series
        // must share a pane and a scale or the histogram is meaningless.
        group: label,
      });
    }
  }

  return out;
}
