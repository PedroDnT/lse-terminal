// ============================================================================
// sessionRenderer.ts - Trading session background boxes renderer
// Draws semi-transparent colored rectangles behind candles showing when major
// global markets are open (Tokyo, London, New York). Traders use these to
// visualize which session they are trading in and spot overlapping sessions.
// ============================================================================

// Each session is defined by its local open/close times and display color.
// Colors use very low opacity so they appear as subtle tints behind candles
// and naturally stack in overlap zones (e.g., London+NY overlap gets both colors).
const SESSIONS = [
  { name: "Tokyo",    timezone: "Asia/Tokyo",       openHour: 9,  openMin: 0,  closeHour: 15, closeMin: 0,  color: "rgba(59, 130, 246, 0.06)" },   // blue tint
  { name: "London",   timezone: "Europe/London",    openHour: 8,  openMin: 0,  closeHour: 16, closeMin: 30, color: "rgba(34, 197, 94, 0.06)" },    // green tint
  { name: "New York", timezone: "America/New_York", openHour: 9,  openMin: 30, closeHour: 16, closeMin: 0,  color: "rgba(249, 115, 22, 0.06)" },   // orange tint
];

// Context passed from ProChart.drawChart() containing everything needed to
// position session boxes correctly on the canvas. Pure data, no React state.
export interface SessionRenderContext {
  ctx: CanvasRenderingContext2D;
  chartWidth: number;             // pixel width of the main chart area (excludes price axis)
  mainChartHeight: number;        // pixel height of the main chart area (excludes subplots, time axis)
  candles: Array<{ time: number }>; // full candle array (all loaded candles, not just visible)
  visibleStartIndex: number;      // index of first visible candle in the candles array
  visibleEndIndex: number;        // index of last visible candle (exclusive)
  candleWidth: number;            // pixel width of one candle body
  indexToX: (index: number, startIndex: number) => number; // converts candle index to X pixel
  isDark: boolean;                // true when in dark theme, for label color adjustment
  timeframe: string;              // current timeframe string (e.g., "5m", "1H", "1D", "1W")
}

// ── UTC conversion cache ──
// Computing timezone offsets is relatively expensive (Intl.DateTimeFormat is slow).
// We cache the UTC timestamps per (date, session) so we only compute once per
// visible day per render cycle, not per frame.
const utcCache = new Map<string, number>();
const MAX_CACHE_SIZE = 500; // prevent unbounded growth when scrolling through months

/**
 * Converts a local time in a specific timezone to a UTC epoch millisecond timestamp.
 *
 * The approach: we "guess" the UTC equivalent by pretending the local time IS UTC,
 * then check what local time that guess maps to in the target timezone, compute the
 * offset from the discrepancy, and adjust. This correctly handles DST transitions
 * because we query the offset for the specific date in question.
 *
 * Example: localToUTC(2026, 3, 15, 9, 30, "America/New_York")
 *   - DST started March 8 in US, so NY is UTC-4
 *   - 9:30 AM EDT = 13:30 UTC
 * vs localToUTC(2026, 3, 1, 9, 30, "America/New_York")
 *   - Before DST, NY is UTC-5
 *   - 9:30 AM EST = 14:30 UTC
 */
function localToUTC(year: number, month: number, day: number, hour: number, min: number, tz: string): number {
  const cacheKey = `${year}-${month}-${day}-${hour}-${min}-${tz}`;
  const cached = utcCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Step 1: Create a "guess" UTC timestamp assuming the local time equals UTC
  const guessMs = Date.UTC(year, month - 1, day, hour, min, 0);

  // Step 2: Find what local time that guess corresponds to in the target timezone.
  // We use formatToParts to extract hour/minute/day in the target timezone.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(guessMs));

  const localDay = parseInt(parts.find(p => p.type === "day")!.value);
  const localHour = parseInt(parts.find(p => p.type === "hour")!.value);
  const localMin = parseInt(parts.find(p => p.type === "minute")!.value);

  // Step 3: The offset is the difference between what the timezone gives us
  // and what we asked for. If we asked for hour=9 and got localHour=14,
  // the timezone is UTC+5, so the actual UTC time is 9-5=4 UTC.
  let offsetMinutes = (localHour * 60 + localMin) - (hour * 60 + min);

  // Handle day boundary crossings (e.g., asking for 23:00 in UTC+10 means
  // the local day might be the next day)
  if (localDay !== day) {
    // Determine if we crossed forward or backward. Safe for month boundaries
    // because we only care about +/-1 day difference.
    offsetMinutes += (localDay > day || (day > 20 && localDay < 5) ? 1 : -1) * 24 * 60;
  }

  // Step 4: The real UTC time is our guess shifted by the negative of the offset
  const result = guessMs - offsetMinutes * 60 * 1000;

  // Keep cache bounded to prevent memory leaks during long sessions
  if (utcCache.size > MAX_CACHE_SIZE) {
    utcCache.clear();
  }
  utcCache.set(cacheKey, result);

  return result;
}

/**
 * Determines if a timeframe is too large for session boxes to be meaningful.
 * Sessions span ~6-8 hours, so they only make visual sense on intraday timeframes.
 * Weekly, monthly, or daily candles would have session boxes spanning the full chart
 * width, providing no useful information.
 */
function isTimeframeTooLarge(timeframe: string): boolean {
  const tf = timeframe.toUpperCase();
  // Weekly and monthly are always too large
  if (tf === "1W" || tf === "1M") return true;
  // Daily is borderline but skip it: one candle = one full day, session boxes
  // would just be fractional overlaps that look messy
  if (tf === "1D") return true;
  return false;
}

/**
 * Main render function. Called from ProChart.drawChart() after background clear
 * but BEFORE candle/indicator rendering, so session boxes appear behind everything.
 *
 * For each visible day on the chart, draws colored rectangles for Tokyo, London,
 * and New York sessions. Overlap zones (e.g., London+NY from 13:30-16:30 UTC in
 * summer) naturally appear as two transparent colors stacking.
 */
export function renderSessions(sctx: SessionRenderContext): void {
  const { ctx, chartWidth, mainChartHeight, candles, visibleStartIndex, visibleEndIndex,
          indexToX, isDark, timeframe } = sctx;

  // Skip rendering for timeframes where session boxes are not meaningful
  if (isTimeframeTooLarge(timeframe)) return;
  if (candles.length === 0) return;

  // Determine the date range of visible candles so we only compute sessions
  // for days that are actually on screen (performance optimization)
  const firstVisibleTime = candles[visibleStartIndex]?.time;
  const lastVisibleTime = candles[Math.min(visibleEndIndex, candles.length - 1)]?.time;
  if (!firstVisibleTime || !lastVisibleTime) return;

  const firstDate = new Date(firstVisibleTime);
  const lastDate = new Date(lastVisibleTime);

  // Extend range by one day on each side to catch sessions that started
  // the previous day or end the next day (e.g., Tokyo session when viewing
  // in a timezone where it spans midnight)
  const startDay = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), firstDate.getUTCDate() - 1));
  const endDay = new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth(), lastDate.getUTCDate() + 1));

  // Build a lookup from timestamp to candle index for fast X position resolution.
  // We only need visible candles plus a small buffer.
  const bufferStart = Math.max(0, visibleStartIndex - 5);
  const bufferEnd = Math.min(candles.length, visibleEndIndex + 5);

  // For each day in the visible range, for each session, compute the session
  // start/end as UTC timestamps, find the corresponding X positions, and draw.
  const currentDay = new Date(startDay);

  while (currentDay <= endDay) {
    const year = currentDay.getUTCFullYear();
    const month = currentDay.getUTCMonth() + 1; // 1-indexed for localToUTC
    const day = currentDay.getUTCDate();

    // Skip weekends (Saturday=6, Sunday=0) since major equity/forex markets are closed.
    // Crypto trades 24/7 but session boxes are about equity/forex session context.
    const dayOfWeek = currentDay.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      currentDay.setUTCDate(currentDay.getUTCDate() + 1);
      continue;
    }

    for (const session of SESSIONS) {
      // Convert session local open/close times to UTC for this specific date.
      // This correctly handles DST: e.g., NY opens at 9:30 AM ET, which is
      // 13:30 UTC in winter (EST, UTC-5) but 13:30 UTC in summer (EDT, UTC-4).
      const openUTC = localToUTC(year, month, day, session.openHour, session.openMin, session.timezone);
      const closeUTC = localToUTC(year, month, day, session.closeHour, session.closeMin, session.timezone);

      // Find candle indices closest to session open and close times.
      // We do a simple linear scan of the visible buffer since it is small.
      let openIdx = -1;
      let closeIdx = -1;

      for (let i = bufferStart; i < bufferEnd; i++) {
        const t = candles[i].time;
        // Find the first candle at or after session open
        if (openIdx === -1 && t >= openUTC) {
          openIdx = i;
        }
        // Find the last candle at or before session close
        if (t <= closeUTC) {
          closeIdx = i;
        }
        // Optimization: stop scanning once we are past the session close
        if (t > closeUTC && closeIdx !== -1) break;
      }

      // If no candles fall within this session (e.g., gap day, data hole), skip
      if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) continue;

      // Convert candle indices to pixel X positions
      const x1 = indexToX(openIdx, visibleStartIndex) - sctx.candleWidth / 2;
      const x2 = indexToX(closeIdx, visibleStartIndex) + sctx.candleWidth / 2;

      // Skip if the session box is entirely off-screen
      if (x2 < 0 || x1 > chartWidth) continue;

      // Clamp to chart bounds so we do not draw into the price axis area
      const clampedX1 = Math.max(0, x1);
      const clampedX2 = Math.min(chartWidth, x2);
      const boxWidth = clampedX2 - clampedX1;

      if (boxWidth < 2) continue; // too narrow to be visible

      // Draw the session background box
      ctx.fillStyle = session.color;
      ctx.fillRect(clampedX1, 0, boxWidth, mainChartHeight);

      // Draw session label at the top of the box, centered horizontally.
      // Only show the label if the box is wide enough to fit the text (>50px)
      // to avoid visual clutter when zoomed out.
      if (boxWidth > 50) {
        const label = session.name === "New York" ? "NY" : session.name;
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        // Use a slightly visible color for the label text
        ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.18)" : "rgba(0, 0, 0, 0.15)";
        ctx.fillText(label, clampedX1 + boxWidth / 2, 4);
      }
    }

    currentDay.setUTCDate(currentDay.getUTCDate() + 1);
  }
}
