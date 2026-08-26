// Technical indicator calculations

export function calculateRSI(closes: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  if (closes.length < period + 1) return rsi;

  let gains = 0;
  let losses = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = 0; i < period; i++) rsi.push(NaN);
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  // Smoothed RS
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return rsi;
}

export function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  if (data.length === 0) return ema;

  const multiplier = 2 / (period + 1);
  let emaValue = data[0];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      ema.push(NaN);
    } else if (i === period - 1) {
      emaValue = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
      ema.push(emaValue);
    } else {
      emaValue = (data[i] - emaValue) * multiplier + emaValue;
      ema.push(emaValue);
    }
  }

  return ema;
}

export function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  if (data.length === 0) return sma;
  
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    
    if (i >= period) {
      sum -= data[i - period];
    }
    
    if (i < period - 1) {
      sma.push(NaN);
    } else {
      sma.push(sum / period);
    }
  }
  return sma;
}

export function calculateSMMA(data: number[], period: number): number[] {
  const smma: number[] = [];
  if (data.length === 0) return smma;

  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sum += data[i];
      smma.push(NaN);
    } else if (i === period - 1) {
      // First SMMA is just the SMA
      sum += data[i];
      smma.push(sum / period);
    } else {
      // SMMA = (Previous SMMA * (period - 1) + Current Price) / period
      const prevSmma = smma[i - 1];
      smma.push((prevSmma * (period - 1) + data[i]) / period);
    }
  }
  return smma;
}

export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  const macdLine = fastEMA.map((fast, i) => fast - slowEMA[i]);
  const signalLine = calculateEMA(macdLine.filter((v) => !isNaN(v)), signalPeriod);

  // Pad signal line to match macd length
  const paddedSignal: number[] = [];
  let signalIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (isNaN(macdLine[i]) || signalIdx >= signalLine.length) {
      paddedSignal.push(NaN);
    } else {
      paddedSignal.push(signalLine[signalIdx++]);
    }
  }

  const histogram = macdLine.map((m, i) => m - paddedSignal[i]);

  return { macd: macdLine, signal: paddedSignal, histogram };
}

export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calculateSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      const mean = middle[i];
      let sumSquares = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumSquares += Math.pow(closes[j] - mean, 2);
      }
      const variance = sumSquares / period;
      const std = Math.sqrt(variance);

      upper.push(mean + stdDev * std);
      lower.push(mean - stdDev * std);
    }
  }

  return { upper, middle, lower };
}

export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number[] {
  const atr: number[] = [];
  if (highs.length < 2) return atr;

  const trueRanges: number[] = [];

  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      trueRanges.push(highs[i] - lows[i]);
    } else {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trueRanges.push(tr);
    }
  }

  // Calculate ATR using smoothed moving average
  let sum = 0;
  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period - 1) {
      sum += trueRanges[i];
      atr.push(NaN);
    } else if (i === period - 1) {
      sum += trueRanges[i];
      atr.push(sum / period);
    } else {
      const prevAtr = atr[i - 1];
      atr.push((prevAtr * (period - 1) + trueRanges[i]) / period);
    }
  }

  return atr;
}

export function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number = 14,
  dPeriod: number = 3,
  smooth: number = 3
): { k: number[]; d: number[] } {
  const rawK: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) {
      rawK.push(NaN);
    } else {
      let highestHigh = -Infinity;
      let lowestLow = Infinity;
      for (let j = i - kPeriod + 1; j <= i; j++) {
        if (highs[j] > highestHigh) highestHigh = highs[j];
        if (lows[j] < lowestLow) lowestLow = lows[j];
      }
      const range = highestHigh - lowestLow;
      rawK.push(range === 0 ? 50 : ((closes[i] - lowestLow) / range) * 100);
    }
  }

  // Smooth %K. rawK starts with kPeriod-1 NaN warmup values, and
  // calculateSMA's running sum never recovers from a NaN, so smoothing the
  // raw array returned 100% NaN for ANY input (every consumer got a
  // fully-NaN %K/%D). Smooth only the valid tail and pad
  // the warmup back on.
  const kFirstValid = rawK.findIndex(v => !isNaN(v));
  const k = kFirstValid < 0
    ? rawK.slice()
    : new Array(kFirstValid).fill(NaN).concat(calculateSMA(rawK.slice(kFirstValid), smooth));
  // %D is SMA of %K, same warmup treatment.
  const dFirstValid = k.findIndex(v => !isNaN(v));
  const d = dFirstValid < 0
    ? k.slice()
    : new Array(dFirstValid).fill(NaN).concat(calculateSMA(k.slice(dFirstValid), dPeriod));

  return { k, d };
}

// ============================================================================
// NEW INDICATORS - TradingView-style additions
// ============================================================================

/**
 * Williams %R - Momentum oscillator (0 to -100 range)
 * Similar to Stochastic but inverted
 */
export function calculateWilliamsR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number[] {
  const williamsR: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      williamsR.push(NaN);
    } else {
      let highestHigh = -Infinity;
      let lowestLow = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (highs[j] > highestHigh) highestHigh = highs[j];
        if (lows[j] < lowestLow) lowestLow = lows[j];
      }
      const range = highestHigh - lowestLow;

      // Williams %R formula: ((Highest High - Close) / (Highest High - Lowest Low)) * -100
      williamsR.push(range === 0 ? -50 : ((highestHigh - closes[i]) / range) * -100);
    }
  }

  return williamsR;
}

/**
 * CCI - Commodity Channel Index
 * Measures price deviation from average
 */
export function calculateCCI(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 20
): number[] {
  const cci: number[] = [];
  const typicalPrices = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);

  for (let i = 0; i < typicalPrices.length; i++) {
    if (i < period - 1) {
      cci.push(NaN);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += typicalPrices[j];
      }
      const sma = sum / period;

      // Mean Deviation
      let mdSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        mdSum += Math.abs(typicalPrices[j] - sma);
      }
      const meanDeviation = mdSum / period;

      // CCI = (Typical Price - SMA) / (0.015 * Mean Deviation)
      cci.push(meanDeviation === 0 ? 0 : (typicalPrices[i] - sma) / (0.015 * meanDeviation));
    }
  }

  return cci;
}

/**
 * ADX - Average Directional Index (with +DI and -DI)
 * Measures trend strength (0-100)
 */
export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const adx: number[] = [];
  const plusDI: number[] = [];
  const minusDI: number[] = [];

  if (highs.length < period + 1) {
    return { adx: [], plusDI: [], minusDI: [] };
  }

  // Calculate True Range, +DM and -DM
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i]);
      plusDM.push(0);
      minusDM.push(0);
    } else {
      // True Range
      tr.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ));

      // +DM and -DM
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];

      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
  }

  // Smooth using Wilder's smoothing (SMMA)
  const smoothedTR = calculateSMMA(tr, period);
  const smoothedPlusDM = calculateSMMA(plusDM, period);
  const smoothedMinusDM = calculateSMMA(minusDM, period);

  // Calculate +DI and -DI
  const rawPlusDI: number[] = [];
  const rawMinusDI: number[] = [];
  const dx: number[] = [];

  for (let i = 0; i < highs.length; i++) {
    if (isNaN(smoothedTR[i]) || smoothedTR[i] === 0) {
      rawPlusDI.push(NaN);
      rawMinusDI.push(NaN);
      dx.push(NaN);
    } else {
      const pDI = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
      const mDI = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
      rawPlusDI.push(pDI);
      rawMinusDI.push(mDI);

      // DX = |+DI - -DI| / (+DI + -DI) * 100
      const diSum = pDI + mDI;
      dx.push(diSum === 0 ? 0 : (Math.abs(pDI - mDI) / diSum) * 100);
    }
  }

  // ADX is smoothed DX
  const smoothedADX = calculateSMMA(dx.filter(v => !isNaN(v)), period);

  // Pad ADX to match length
  let adxIdx = 0;
  for (let i = 0; i < highs.length; i++) {
    if (isNaN(dx[i])) {
      adx.push(NaN);
    } else if (adxIdx < smoothedADX.length) {
      adx.push(smoothedADX[adxIdx++]);
    } else {
      adx.push(NaN);
    }
    plusDI.push(rawPlusDI[i]);
    minusDI.push(rawMinusDI[i]);
  }

  return { adx, plusDI, minusDI };
}

/**
 * ROC - Rate of Change (percentage change over period)
 */
export function calculateROC(
  closes: number[],
  period: number = 12
): number[] {
  const roc: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      roc.push(NaN);
    } else {
      const prevClose = closes[i - period];
      roc.push(prevClose === 0 ? 0 : ((closes[i] - prevClose) / prevClose) * 100);
    }
  }

  return roc;
}

/**
 * VWAP - Volume Weighted Average Price
 * Typically resets each day, but this is a running calculation
 */
export function calculateVWAP(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  timestamps?: number[]
): number[] {
  const vwap: number[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let currentDay = -1;

  for (let i = 0; i < closes.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    const volume = volumes[i] || 0;

    // Reset at start of new day if timestamps provided
    if (timestamps) {
      const date = new Date(timestamps[i]);
      const day = date.getUTCDate();
      if (day !== currentDay) {
        currentDay = day;
        cumulativeTPV = 0;
        cumulativeVolume = 0;
      }
    }

    cumulativeTPV += typicalPrice * volume;
    cumulativeVolume += volume;

    vwap.push(cumulativeVolume === 0 ? closes[i] : cumulativeTPV / cumulativeVolume);
  }

  return vwap;
}

/**
 * Ichimoku Cloud - Japanese trend indicator
 * Returns all 5 lines: Tenkan-sen, Kijun-sen, Senkou Span A, Senkou Span B, Chikou Span
 */
export function calculateIchimoku(
  highs: number[],
  lows: number[],
  closes: number[],
  tenkanPeriod: number = 9,
  kijunPeriod: number = 26,
  senkouBPeriod: number = 52,
  displacement: number = 26
): {
  tenkan: number[];
  kijun: number[];
  senkouA: number[];
  senkouB: number[];
  chikou: number[];
} {
  const len = closes.length;
  const tenkan: number[] = [];
  const kijun: number[] = [];
  const senkouA: number[] = [];
  const senkouB: number[] = [];
  const chikou: number[] = [];

  // Helper to get mid-point of highest high and lowest low
  const getMidPoint = (h: number[], l: number[], start: number, period: number): number => {
    if (start + period > h.length) return NaN;
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = start; j < start + period; j++) {
      if (h[j] > highest) highest = h[j];
      if (l[j] < lowest) lowest = l[j];
    }
    return (highest + lowest) / 2;
  };

  for (let i = 0; i < len; i++) {
    // Tenkan-sen (Conversion Line) - 9-period midpoint
    tenkan.push(i >= tenkanPeriod - 1 ? getMidPoint(highs, lows, i - tenkanPeriod + 1, tenkanPeriod) : NaN);

    // Kijun-sen (Base Line) - 26-period midpoint
    kijun.push(i >= kijunPeriod - 1 ? getMidPoint(highs, lows, i - kijunPeriod + 1, kijunPeriod) : NaN);

    // Chikou Span (Lagging Span) - Close shifted back 26 periods
    chikou.push(closes[i]); // Will be plotted displaced backward
  }

  // Senkou Span A & B - shifted forward by displacement
  for (let i = 0; i < len + displacement; i++) {
    if (i < displacement) {
      senkouA.push(NaN);
      senkouB.push(NaN);
    } else {
      const srcIdx = i - displacement;
      // Senkou A = (Tenkan + Kijun) / 2
      const t = tenkan[srcIdx];
      const k = kijun[srcIdx];
      senkouA.push(isNaN(t) || isNaN(k) ? NaN : (t + k) / 2);

      // Senkou B = 52-period midpoint
      senkouB.push(srcIdx >= senkouBPeriod - 1 ? getMidPoint(highs, lows, srcIdx - senkouBPeriod + 1, senkouBPeriod) : NaN);
    }
  }

  return { tenkan, kijun, senkouA, senkouB, chikou };
}

/**
 * Parabolic SAR - Stop and Reverse indicator
 * Returns SAR values and direction (1 = bullish, -1 = bearish)
 */
export function calculateParabolicSAR(
  highs: number[],
  lows: number[],
  afStart: number = 0.02,
  afStep: number = 0.02,
  afMax: number = 0.2
): { sar: number[]; direction: number[] } {
  const sar: number[] = [];
  const direction: number[] = [];

  if (highs.length < 2) return { sar: [], direction: [] };

  let isLong = highs[1] > highs[0]; // Initial trend
  let af = afStart;
  let ep = isLong ? highs[0] : lows[0]; // Extreme point
  let sarValue = isLong ? lows[0] : highs[0];

  for (let i = 0; i < highs.length; i++) {
    if (i < 2) {
      sar.push(sarValue);
      direction.push(isLong ? 1 : -1);
      continue;
    }

    const prevSar = sarValue;

    // Update SAR
    sarValue = prevSar + af * (ep - prevSar);

    // Make sure SAR is within bounds
    if (isLong) {
      sarValue = Math.min(sarValue, lows[i - 1], lows[i - 2]);

      // Check for reversal
      if (lows[i] < sarValue) {
        isLong = false;
        sarValue = ep;
        ep = lows[i];
        af = afStart;
      } else {
        // Update EP and AF
        if (highs[i] > ep) {
          ep = highs[i];
          af = Math.min(af + afStep, afMax);
        }
      }
    } else {
      sarValue = Math.max(sarValue, highs[i - 1], highs[i - 2]);

      // Check for reversal
      if (highs[i] > sarValue) {
        isLong = true;
        sarValue = ep;
        ep = highs[i];
        af = afStart;
      } else {
        // Update EP and AF
        if (lows[i] < ep) {
          ep = lows[i];
          af = Math.min(af + afStep, afMax);
        }
      }
    }

    sar.push(sarValue);
    direction.push(isLong ? 1 : -1);
  }

  return { sar, direction };
}

/**
 * Keltner Channels - ATR-based bands around EMA
 */
export function calculateKeltnerChannels(
  highs: number[],
  lows: number[],
  closes: number[],
  emaPeriod: number = 20,
  atrPeriod: number = 10,
  multiplier: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calculateEMA(closes, emaPeriod);
  const atr = calculateATR(highs, lows, closes, atrPeriod);

  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (isNaN(middle[i]) || isNaN(atr[i])) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      upper.push(middle[i] + multiplier * atr[i]);
      lower.push(middle[i] - multiplier * atr[i]);
    }
  }

  return { upper, middle, lower };
}

/**
 * Pivot Points - Classic support/resistance levels
 * Calculates for the current period based on previous period's high, low, close
 */
export function calculatePivotPoints(
  high: number,
  low: number,
  close: number
): {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
} {
  const pivot = (high + low + close) / 3;
  const range = high - low;

  return {
    pivot,
    r1: 2 * pivot - low,
    r2: pivot + range,
    r3: high + 2 * (pivot - low),
    s1: 2 * pivot - high,
    s2: pivot - range,
    s3: low - 2 * (high - pivot),
  };
}

/**
 * Calculate daily pivot points for a series of candles
 * Returns arrays of pivot levels aligned with candle indices
 */
export function calculateDailyPivots(
  timestamps: number[],
  highs: number[],
  lows: number[],
  closes: number[]
): {
  pivot: number[];
  r1: number[];
  r2: number[];
  r3: number[];
  s1: number[];
  s2: number[];
  s3: number[];
} {
  const result = {
    pivot: [] as number[],
    r1: [] as number[],
    r2: [] as number[],
    r3: [] as number[],
    s1: [] as number[],
    s2: [] as number[],
    s3: [] as number[],
  };

  let currentDay = -1;
  let dayHigh = 0;
  let dayLow = Infinity;
  let dayClose = 0;
  let currentPivots = { pivot: NaN, r1: NaN, r2: NaN, r3: NaN, s1: NaN, s2: NaN, s3: NaN };

  for (let i = 0; i < timestamps.length; i++) {
    const date = new Date(timestamps[i]);
    const day = date.getUTCDate();

    if (day !== currentDay) {
      // New day - calculate pivots from previous day
      if (currentDay !== -1) {
        currentPivots = calculatePivotPoints(dayHigh, dayLow, dayClose);
      }
      currentDay = day;
      dayHigh = highs[i];
      dayLow = lows[i];
    } else {
      dayHigh = Math.max(dayHigh, highs[i]);
      dayLow = Math.min(dayLow, lows[i]);
    }
    dayClose = closes[i];

    result.pivot.push(currentPivots.pivot);
    result.r1.push(currentPivots.r1);
    result.r2.push(currentPivots.r2);
    result.r3.push(currentPivots.r3);
    result.s1.push(currentPivots.s1);
    result.s2.push(currentPivots.s2);
    result.s3.push(currentPivots.s3);
  }

  return result;
}

// ============================================================================
// EXPANDED INDICATORS - Institutional 50-Indicator Package
// ============================================================================

// ─── TREND ──────────────────────────────────────────────────────────────────

/** Supertrend - ATR-based trend follower */
export function calculateSupertrend(
  highs: number[], lows: number[], closes: number[],
  period: number = 10, multiplier: number = 3
): { supertrend: number[]; direction: number[] } {
  const atr = calculateATR(highs, lows, closes, period);
  const st: number[] = [];
  const dir: number[] = [];
  let upperBand = 0, lowerBand = 0, prevUpper = 0, prevLower = 0;

  for (let i = 0; i < closes.length; i++) {
    if (isNaN(atr[i])) { st.push(NaN); dir.push(1); continue; }
    const hl2 = (highs[i] + lows[i]) / 2;
    upperBand = hl2 + multiplier * atr[i];
    lowerBand = hl2 - multiplier * atr[i];
    if (i > 0) {
      upperBand = upperBand < prevUpper || closes[i - 1] > prevUpper ? upperBand : prevUpper;
      lowerBand = lowerBand > prevLower || closes[i - 1] < prevLower ? lowerBand : prevLower;
    }
    const prevDir = i > 0 ? dir[i - 1] : 1;
    let d: number;
    if (prevDir === -1 && closes[i] > prevUpper) d = 1;
    else if (prevDir === 1 && closes[i] < prevLower) d = -1;
    else d = prevDir;
    st.push(d === 1 ? lowerBand : upperBand);
    dir.push(d);
    prevUpper = upperBand;
    prevLower = lowerBand;
  }
  return { supertrend: st, direction: dir };
}

/** Donchian Channels - Breakout channels */
export function calculateDonchian(
  highs: number[], lows: number[], period: number = 20
): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [], middle: number[] = [], lower: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (i < period - 1) { upper.push(NaN); middle.push(NaN); lower.push(NaN); continue; }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    upper.push(hh); lower.push(ll); middle.push((hh + ll) / 2);
  }
  return { upper, middle, lower };
}

/** Aroon - Measures time since highest high / lowest low */
export function calculateAroon(
  highs: number[], lows: number[], period: number = 25
): { up: number[]; down: number[]; oscillator: number[] } {
  const up: number[] = [], down: number[] = [], osc: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (i < period) { up.push(NaN); down.push(NaN); osc.push(NaN); continue; }
    const hSlice = highs.slice(i - period, i + 1);
    const lSlice = lows.slice(i - period, i + 1);
    let highIdx = 0, lowIdx = 0;
    for (let j = 0; j <= period; j++) {
      if (hSlice[j] >= hSlice[highIdx]) highIdx = j;
      if (lSlice[j] <= lSlice[lowIdx]) lowIdx = j;
    }
    const u = (highIdx / period) * 100;
    const d = (lowIdx / period) * 100;
    up.push(u); down.push(d); osc.push(u - d);
  }
  return { up, down, oscillator: osc };
}

/** Envelopes - Percentage bands around MA */
export function calculateEnvelopes(
  closes: number[], period: number = 20, percent: number = 2.5
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calculateSMA(closes, period);
  const factor = percent / 100;
  const upper = middle.map(v => isNaN(v) ? NaN : v * (1 + factor));
  const lower = middle.map(v => isNaN(v) ? NaN : v * (1 - factor));
  return { upper, middle, lower };
}

/** DEMA - Double Exponential Moving Average */
export function calculateDEMA(data: number[], period: number = 21): number[] {
  const ema1 = calculateEMA(data, period);
  const ema2 = calculateEMA(ema1.filter(v => !isNaN(v)), period);
  const result: number[] = [];
  let e2i = 0;
  for (let i = 0; i < data.length; i++) {
    if (isNaN(ema1[i]) || e2i >= ema2.length || isNaN(ema2[e2i])) {
      result.push(NaN);
      if (!isNaN(ema1[i])) e2i++;
    } else {
      result.push(2 * ema1[i] - ema2[e2i++]);
    }
  }
  return result;
}

/** TEMA - Triple Exponential Moving Average */
export function calculateTEMA(data: number[], period: number = 21): number[] {
  const ema1 = calculateEMA(data, period);
  const valid1 = ema1.filter(v => !isNaN(v));
  const ema2 = calculateEMA(valid1, period);
  const valid2 = ema2.filter(v => !isNaN(v));
  const ema3 = calculateEMA(valid2, period);

  const result: number[] = new Array(data.length).fill(NaN);
  const offset1 = ema1.findIndex(v => !isNaN(v));
  const offset2 = offset1 + ema2.findIndex(v => !isNaN(v));
  const offset3 = offset2 + ema3.findIndex(v => !isNaN(v));

  for (let i = 0; i < ema3.length; i++) {
    if (!isNaN(ema3[i])) {
      const idx = offset3 + i;
      if (idx < data.length) {
        const e1 = ema1[idx];
        const e2 = ema2[idx - offset1];
        const e3 = ema3[i];
        if (!isNaN(e1) && !isNaN(e2) && !isNaN(e3)) {
          result[idx] = 3 * e1 - 3 * e2 + e3;
        }
      }
    }
  }
  return result;
}

/** HMA - Hull Moving Average */
export function calculateHMA(data: number[], period: number = 9): number[] {
  const halfPeriod = Math.floor(period / 2);
  const sqrtPeriod = Math.floor(Math.sqrt(period));
  const wma1 = calculateWMA(data, halfPeriod);
  const wma2 = calculateWMA(data, period);
  const diff: number[] = [];
  for (let i = 0; i < data.length; i++) {
    diff.push(isNaN(wma1[i]) || isNaN(wma2[i]) ? NaN : 2 * wma1[i] - wma2[i]);
  }
  return calculateWMA(diff, sqrtPeriod);
}

/** WMA - Weighted Moving Average (helper for HMA) */
export function calculateWMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const denom = (period * (period + 1)) / 2;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    let valid = true;
    for (let j = 0; j < period; j++) {
      const val = data[i - period + 1 + j];
      if (isNaN(val)) { valid = false; break; }
      sum += val * (j + 1);
    }
    result.push(valid ? sum / denom : NaN);
  }
  return result;
}

// ─── OSCILLATORS ────────────────────────────────────────────────────────────

/** Momentum - Simple price change over N periods */
export function calculateMomentum(closes: number[], period: number = 10): number[] {
  return closes.map((c, i) => i < period ? NaN : c - closes[i - period]);
}

/** Awesome Oscillator - Difference of 5 and 34 period median price SMAs */
export function calculateAwesomeOscillator(
  highs: number[], lows: number[]
): number[] {
  const medianPrice = highs.map((h, i) => (h + lows[i]) / 2);
  const sma5 = calculateSMA(medianPrice, 5);
  const sma34 = calculateSMA(medianPrice, 34);
  return sma5.map((v, i) => isNaN(v) || isNaN(sma34[i]) ? NaN : v - sma34[i]);
}

/** MFI - Money Flow Index (RSI with volume) */
export function calculateMFI(
  highs: number[], lows: number[], closes: number[], volumes: number[],
  period: number = 14
): number[] {
  const mfi: number[] = [];
  const tp = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { mfi.push(NaN); continue; }
    let posFlow = 0, negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const rawMF = tp[j] * (volumes[j] || 0);
      if (tp[j] > tp[j - 1]) posFlow += rawMF;
      else if (tp[j] < tp[j - 1]) negFlow += rawMF;
    }
    mfi.push(negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow));
  }
  return mfi;
}

/** TSI - True Strength Index */
export function calculateTSI(
  closes: number[], longPeriod: number = 25, shortPeriod: number = 13, signalPeriod: number = 13
): { tsi: number[]; signal: number[] } {
  const momArr: number[] = [];
  const absMom: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { momArr.push(0); absMom.push(0); continue; }
    const m = closes[i] - closes[i - 1];
    momArr.push(m);
    absMom.push(Math.abs(m));
  }
  // Chained EMAs: the inner pass emits longPeriod-1 NaN warmup values and
  // calculateEMA seeds from index 0, so the outer pass returned 100% NaN
  // for any input (same class as the stochastic %K bug).
  // Re-smooth from the first valid value and pad the warmup back on.
  const emaNaNSafe = (data: number[], period: number): number[] => {
    const first = data.findIndex(v => !isNaN(v));
    if (first < 0) return data.slice();
    return new Array<number>(first).fill(NaN).concat(calculateEMA(data.slice(first), period));
  };
  const ds = emaNaNSafe(calculateEMA(momArr, longPeriod), shortPeriod);
  const ads = emaNaNSafe(calculateEMA(absMom, longPeriod), shortPeriod);
  const tsiVals: number[] = ds.map((v, i) =>
    isNaN(v) || isNaN(ads[i]) || ads[i] === 0 ? NaN : (v / ads[i]) * 100
  );
  const sig = calculateEMA(tsiVals.filter(v => !isNaN(v)), signalPeriod);
  const signal: number[] = [];
  let si = 0;
  for (let i = 0; i < tsiVals.length; i++) {
    if (isNaN(tsiVals[i])) signal.push(NaN);
    else if (si < sig.length) signal.push(sig[si++]);
    else signal.push(NaN);
  }
  return { tsi: tsiVals, signal };
}

/** TRIX - Triple EMA rate of change */
export function calculateTRIX(
  closes: number[], period: number = 15, signalPeriod: number = 9
): { trix: number[]; signal: number[] } {
  const ema1 = calculateEMA(closes, period);
  const ema2 = calculateEMA(ema1.filter(v => !isNaN(v)), period);
  const ema3 = calculateEMA(ema2.filter(v => !isNaN(v)), period);
  const trixVals: number[] = new Array(closes.length).fill(NaN);
  const startOffset = closes.length - ema3.length;
  for (let i = 1; i < ema3.length; i++) {
    if (!isNaN(ema3[i]) && !isNaN(ema3[i - 1]) && ema3[i - 1] !== 0) {
      trixVals[startOffset + i] = ((ema3[i] - ema3[i - 1]) / ema3[i - 1]) * 10000;
    }
  }
  const validTrix = trixVals.filter(v => !isNaN(v));
  const sigEma = calculateEMA(validTrix, signalPeriod);
  const signal: number[] = new Array(closes.length).fill(NaN);
  let si = 0;
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(trixVals[i])) {
      if (si < sigEma.length) signal[i] = sigEma[si++];
    }
  }
  return { trix: trixVals, signal };
}

/** Ultimate Oscillator - Multi-timeframe momentum */
export function calculateUltimateOscillator(
  highs: number[], lows: number[], closes: number[],
  fast: number = 7, med: number = 14, slow: number = 28
): number[] {
  const uo: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < slow) { uo.push(NaN); continue; }
    let bp7 = 0, tr7 = 0, bp14 = 0, tr14 = 0, bp28 = 0, tr28 = 0;
    for (let j = i - slow + 1; j <= i; j++) {
      const prevC = closes[j - 1];
      const bpVal = closes[j] - Math.min(lows[j], prevC);
      const trVal = Math.max(highs[j], prevC) - Math.min(lows[j], prevC);
      if (j > i - fast) { bp7 += bpVal; tr7 += trVal; }
      if (j > i - med) { bp14 += bpVal; tr14 += trVal; }
      bp28 += bpVal; tr28 += trVal;
    }
    const avg1 = tr7 === 0 ? 0 : bp7 / tr7;
    const avg2 = tr14 === 0 ? 0 : bp14 / tr14;
    const avg3 = tr28 === 0 ? 0 : bp28 / tr28;
    uo.push(((4 * avg1 + 2 * avg2 + avg3) / 7) * 100);
  }
  return uo;
}

/** DPO - Detrended Price Oscillator */
export function calculateDPO(closes: number[], period: number = 21): number[] {
  const sma = calculateSMA(closes, period);
  const shift = Math.floor(period / 2) + 1;
  return closes.map((c, i) => {
    const smaIdx = i + shift;
    return smaIdx < sma.length && !isNaN(sma[smaIdx]) ? c - sma[smaIdx] : NaN;
  });
}

/** KST - Know Sure Thing (weighted sum of multiple ROC smoothings) */
export function calculateKST(
  closes: number[],
  roc1: number = 10, roc2: number = 15, roc3: number = 20, roc4: number = 30,
  sma1: number = 10, sma2: number = 10, sma3: number = 10, sma4: number = 15,
  signalPeriod: number = 9
): { kst: number[]; signal: number[] } {
  // ROC emits `period` NaN warmup values and calculateSMA's running sum
  // never recovers from a NaN, so all four components (and therefore KST
  // itself) returned 100% NaN for any input (same class as the stochastic
  // %K bug). Smooth from the first valid value only.
  const smaNaNSafe = (data: number[], period: number): number[] => {
    const first = data.findIndex(v => !isNaN(v));
    if (first < 0) return data.slice();
    return new Array<number>(first).fill(NaN).concat(calculateSMA(data.slice(first), period));
  };
  const r1 = smaNaNSafe(calculateROC(closes, roc1), sma1);
  const r2 = smaNaNSafe(calculateROC(closes, roc2), sma2);
  const r3 = smaNaNSafe(calculateROC(closes, roc3), sma3);
  const r4 = smaNaNSafe(calculateROC(closes, roc4), sma4);
  const kstVals = r1.map((v, i) =>
    isNaN(v) || isNaN(r2[i]) || isNaN(r3[i]) || isNaN(r4[i])
      ? NaN : v * 1 + r2[i] * 2 + r3[i] * 3 + r4[i] * 4
  );
  const validKst = kstVals.filter(v => !isNaN(v));
  const sigSma = calculateSMA(validKst, signalPeriod);
  const signal: number[] = new Array(closes.length).fill(NaN);
  let si = 0;
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(kstVals[i])) {
      if (si < sigSma.length) signal[i] = sigSma[si++];
    }
  }
  return { kst: kstVals, signal };
}

/** Stochastic RSI - Stochastic applied to RSI values */
export function calculateStochRSI(
  closes: number[], rsiPeriod: number = 14, kPeriod: number = 14, dPeriod: number = 3
): { k: number[]; d: number[] } {
  const rsiVals = calculateRSI(closes, rsiPeriod);
  const k: number[] = [];
  for (let i = 0; i < rsiVals.length; i++) {
    if (isNaN(rsiVals[i]) || i < rsiPeriod + kPeriod - 1) { k.push(NaN); continue; }
    let validCount = 0;
    let max = -Infinity;
    let min = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (!isNaN(rsiVals[j])) {
        validCount++;
        if (rsiVals[j] > max) max = rsiVals[j];
        if (rsiVals[j] < min) min = rsiVals[j];
      }
    }
    if (validCount < kPeriod) { k.push(NaN); continue; }
    k.push(max === min ? 50 : ((rsiVals[i] - min) / (max - min)) * 100);
  }
  const d = calculateSMA(k, dPeriod);
  return { k, d };
}

// ─── VOLATILITY ─────────────────────────────────────────────────────────────

/** BB %B - Where price sits within Bollinger Bands (0 = lower, 1 = upper) */
export function calculateBBPercent(
  closes: number[], period: number = 20, stdDev: number = 2
): number[] {
  const bb = calculateBollingerBands(closes, period, stdDev);
  return closes.map((c, i) => {
    if (isNaN(bb.upper[i]) || isNaN(bb.lower[i])) return NaN;
    const range = bb.upper[i] - bb.lower[i];
    return range === 0 ? 0.5 : (c - bb.lower[i]) / range;
  });
}

/** BB Width - Bollinger Bandwidth (squeeze detector) */
export function calculateBBWidth(
  closes: number[], period: number = 20, stdDev: number = 2
): number[] {
  const bb = calculateBollingerBands(closes, period, stdDev);
  return bb.upper.map((u, i) => {
    if (isNaN(u) || isNaN(bb.lower[i]) || isNaN(bb.middle[i]) || bb.middle[i] === 0) return NaN;
    return ((u - bb.lower[i]) / bb.middle[i]) * 100;
  });
}

/** Historical Volatility - Annualized standard deviation of returns */
export function calculateHistoricalVolatility(
  closes: number[], period: number = 20
): number[] {
  const hv: number[] = [];
  const returns: number[] = [NaN];
  for (let i = 1; i < closes.length; i++) {
    returns.push(closes[i - 1] === 0 ? 0 : Math.log(closes[i] / closes[i - 1]));
  }
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { hv.push(NaN); continue; }
    let sum = 0;
    let validCount = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (!isNaN(returns[j])) {
        sum += returns[j];
        validCount++;
      }
    }
    if (validCount < 2) { hv.push(NaN); continue; }
    const mean = sum / validCount;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (!isNaN(returns[j])) sumSq += Math.pow(returns[j] - mean, 2);
    }
    const stdDev = Math.sqrt(sumSq / (validCount - 1));
    hv.push(stdDev * Math.sqrt(252) * 100);
  }
  return hv;
}

/** Chaikin Volatility - EMA of high-low range, then ROC of that */
export function calculateChaikinVolatility(
  highs: number[], lows: number[], emaPeriod: number = 10, rocPeriod: number = 10
): number[] {
  const hlRange = highs.map((h, i) => h - lows[i]);
  const ema = calculateEMA(hlRange, emaPeriod);
  return ema.map((v, i) => {
    if (isNaN(v) || i < rocPeriod || isNaN(ema[i - rocPeriod]) || ema[i - rocPeriod] === 0) return NaN;
    return ((v - ema[i - rocPeriod]) / ema[i - rocPeriod]) * 100;
  });
}

/** Standard Deviation */
export function calculateStdDev(closes: number[], period: number = 20): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mean) ** 2;
    result.push(Math.sqrt(variance / period));
  }
  return result;
}

// ─── VOLUME ─────────────────────────────────────────────────────────────────

/** OBV - On Balance Volume */
export function calculateOBV(closes: number[], volumes: number[]): number[] {
  const obv: number[] = [volumes[0] || 0];
  for (let i = 1; i < closes.length; i++) {
    const vol = volumes[i] || 0;
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + vol);
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - vol);
    else obv.push(obv[i - 1]);
  }
  return obv;
}

/** CMF - Chaikin Money Flow */
export function calculateCMF(
  highs: number[], lows: number[], closes: number[], volumes: number[],
  period: number = 20
): number[] {
  const cmf: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { cmf.push(NaN); continue; }
    let mfvSum = 0, volSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const hl = highs[j] - lows[j];
      const mfm = hl === 0 ? 0 : ((closes[j] - lows[j]) - (highs[j] - closes[j])) / hl;
      mfvSum += mfm * (volumes[j] || 0);
      volSum += volumes[j] || 0;
    }
    cmf.push(volSum === 0 ? 0 : mfvSum / volSum);
  }
  return cmf;
}

/** ADL - Accumulation/Distribution Line */
export function calculateADL(
  highs: number[], lows: number[], closes: number[], volumes: number[]
): number[] {
  const adl: number[] = [];
  let cum = 0;
  for (let i = 0; i < closes.length; i++) {
    const hl = highs[i] - lows[i];
    const mfm = hl === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / hl;
    cum += mfm * (volumes[i] || 0);
    adl.push(cum);
  }
  return adl;
}

/** Force Index - Price change × Volume, smoothed */
export function calculateForceIndex(
  closes: number[], volumes: number[], period: number = 13
): number[] {
  const raw: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    raw.push((closes[i] - closes[i - 1]) * (volumes[i] || 0));
  }
  return calculateEMA(raw, period);
}

/** EOM - Ease of Movement */
export function calculateEOM(
  highs: number[], lows: number[], volumes: number[], period: number = 14
): number[] {
  const raw: number[] = [0];
  for (let i = 1; i < highs.length; i++) {
    const dm = ((highs[i] + lows[i]) / 2) - ((highs[i - 1] + lows[i - 1]) / 2);
    const br = (volumes[i] || 1) / (highs[i] - lows[i] || 1);
    raw.push(dm / br);
  }
  return calculateSMA(raw, period);
}

/** Volume SMA - Simple moving average overlaid on volume */
export function calculateVolumeSMA(volumes: number[], period: number = 20): number[] {
  return calculateSMA(volumes, period);
}

// ─── SUPPORT / RESISTANCE ───────────────────────────────────────────────────

/** Fibonacci Retracement - Auto levels based on swing high/low */
export function calculateFibRetracement(
  highs: number[], lows: number[], lookback: number = 100
): { levels: number[]; high: number; low: number } {
  const start = Math.max(0, highs.length - lookback);
  let high = -Infinity, low = Infinity;
  for (let i = start; i < highs.length; i++) {
    if (highs[i] > high) high = highs[i];
    if (lows[i] < low) low = lows[i];
  }
  const diff = high - low;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const levels = ratios.map(r => high - diff * r);
  return { levels, high, low };
}

/** Camarilla Pivots - 8-level S/R system */
export function calculateCamarillaPivots(
  high: number, low: number, close: number
): { h4: number; h3: number; h2: number; h1: number; l1: number; l2: number; l3: number; l4: number } {
  const range = high - low;
  return {
    h4: close + range * 1.1 / 2,
    h3: close + range * 1.1 / 4,
    h2: close + range * 1.1 / 6,
    h1: close + range * 1.1 / 12,
    l1: close - range * 1.1 / 12,
    l2: close - range * 1.1 / 6,
    l3: close - range * 1.1 / 4,
    l4: close - range * 1.1 / 2,
  };
}

/** Woodie's Pivots - Alternative pivot calculation */
export function calculateWoodiePivots(
  high: number, low: number, close: number
): { pivot: number; r1: number; r2: number; s1: number; s2: number } {
  const pivot = (high + low + 2 * close) / 4;
  return {
    pivot,
    r1: 2 * pivot - low,
    r2: pivot + (high - low),
    s1: 2 * pivot - high,
    s2: pivot - (high - low),
  };
}

/** Daily Camarilla Pivots - array-based like dailyPivots */
export function calculateDailyCamarilla(
  timestamps: number[], highs: number[], lows: number[], closes: number[]
): { h4: number[]; h3: number[]; l3: number[]; l4: number[] } {
  const result = { h4: [] as number[], h3: [] as number[], l3: [] as number[], l4: [] as number[] };
  let currentDay = -1, dayHigh = 0, dayLow = Infinity, dayClose = 0;
  let cur = { h4: NaN, h3: NaN, l3: NaN, l4: NaN };
  for (let i = 0; i < timestamps.length; i++) {
    const day = new Date(timestamps[i]).getUTCDate();
    if (day !== currentDay) {
      if (currentDay !== -1) {
        const c = calculateCamarillaPivots(dayHigh, dayLow, dayClose);
        cur = { h4: c.h4, h3: c.h3, l3: c.l3, l4: c.l4 };
      }
      currentDay = day; dayHigh = highs[i]; dayLow = lows[i];
    } else {
      dayHigh = Math.max(dayHigh, highs[i]);
      dayLow = Math.min(dayLow, lows[i]);
    }
    dayClose = closes[i];
    result.h4.push(cur.h4); result.h3.push(cur.h3);
    result.l3.push(cur.l3); result.l4.push(cur.l4);
  }
  return result;
}

/** Daily Woodie Pivots - array-based */
export function calculateDailyWoodie(
  timestamps: number[], highs: number[], lows: number[], closes: number[]
): { pivot: number[]; r1: number[]; r2: number[]; s1: number[]; s2: number[] } {
  const result = { pivot: [] as number[], r1: [] as number[], r2: [] as number[], s1: [] as number[], s2: [] as number[] };
  let currentDay = -1, dayHigh = 0, dayLow = Infinity, dayClose = 0;
  let cur = { pivot: NaN, r1: NaN, r2: NaN, s1: NaN, s2: NaN };
  for (let i = 0; i < timestamps.length; i++) {
    const day = new Date(timestamps[i]).getUTCDate();
    if (day !== currentDay) {
      if (currentDay !== -1) cur = calculateWoodiePivots(dayHigh, dayLow, dayClose);
      currentDay = day; dayHigh = highs[i]; dayLow = lows[i];
    } else {
      dayHigh = Math.max(dayHigh, highs[i]);
      dayLow = Math.min(dayLow, lows[i]);
    }
    dayClose = closes[i];
    result.pivot.push(cur.pivot); result.r1.push(cur.r1); result.r2.push(cur.r2);
    result.s1.push(cur.s1); result.s2.push(cur.s2);
  }
  return result;
}

// ─── STATISTICS ─────────────────────────────────────────────────────────────

/** Correlation Coefficient */
export function calculateCorrelation(
  data1: number[], data2: number[], period: number = 20
): number[] {
  const result: number[] = [];
  for (let i = 0; i < data1.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    const x = data1.slice(i - period + 1, i + 1);
    const y = data2.slice(i - period + 1, i + 1);
    const mx = x.reduce((a, b) => a + b, 0) / period;
    const my = y.reduce((a, b) => a + b, 0) / period;
    let num = 0, dx = 0, dy = 0;
    for (let j = 0; j < period; j++) {
      num += (x[j] - mx) * (y[j] - my);
      dx += (x[j] - mx) ** 2;
      dy += (y[j] - my) ** 2;
    }
    const denom = Math.sqrt(dx * dy);
    result.push(denom === 0 ? 0 : num / denom);
  }
  return result;
}

/** Linear Regression Channel */
export function calculateLinearRegression(
  closes: number[], period: number = 100, deviations: number = 2
): { middle: number[]; upper: number[]; lower: number[] } {
  const middle: number[] = [], upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { middle.push(NaN); upper.push(NaN); lower.push(NaN); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      sumX += j; sumY += slice[j];
      sumXY += j * slice[j]; sumX2 += j * j;
    }
    const slope = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / period;
    const regValue = intercept + slope * (period - 1);
    let mse = 0;
    for (let j = 0; j < period; j++) {
      mse += (slice[j] - (intercept + slope * j)) ** 2;
    }
    const stdErr = Math.sqrt(mse / period);
    middle.push(regValue);
    upper.push(regValue + deviations * stdErr);
    lower.push(regValue - deviations * stdErr);
  }
  return { middle, upper, lower };
}

/** Coppock Curve - Long-term momentum oscillator */
export function calculateCoppock(
  closes: number[], longROC: number = 14, shortROC: number = 11, wmaPeriod: number = 10
): number[] {
  const roc1 = calculateROC(closes, longROC);
  const roc2 = calculateROC(closes, shortROC);
  const combined = roc1.map((v, i) => isNaN(v) || isNaN(roc2[i]) ? NaN : v + roc2[i]);
  return calculateWMA(combined, wmaPeriod);
}

// ============================================================================
// EXPANDED INDICATORS - Phase 2: 100+ New Indicators
// ============================================================================

// ─── TREND (New) ────────────────────────────────────────────────────────────

/** ALMA - Arnaud Legoux Moving Average */
export function calculateALMA(data: number[], period: number = 9, offset: number = 0.85, sigma: number = 6): number[] {
  const result: number[] = [];
  const m = offset * (period - 1);
  const s = period / sigma;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let norm = 0, sum = 0;
    for (let j = 0; j < period; j++) {
      const w = Math.exp(-((j - m) * (j - m)) / (2 * s * s));
      norm += w;
      sum += data[i - period + 1 + j] * w;
    }
    result.push(sum / norm);
  }
  return result;
}

/** KAMA - Kaufman Adaptive Moving Average */
export function calculateKAMA(data: number[], period: number = 10, fastPeriod: number = 2, slowPeriod: number = 30): number[] {
  const result: number[] = [];
  const fastSC = 2 / (fastPeriod + 1);
  const slowSC = 2 / (slowPeriod + 1);
  for (let i = 0; i < data.length; i++) {
    if (i < period) { result.push(NaN); continue; }
    const direction = Math.abs(data[i] - data[i - period]);
    let volatility = 0;
    for (let j = i - period + 1; j <= i; j++) volatility += Math.abs(data[j] - data[j - 1]);
    const er = volatility === 0 ? 0 : direction / volatility;
    const sc = Math.pow(er * (fastSC - slowSC) + slowSC, 2);
    const prev = isNaN(result[i - 1]) ? data[i] : result[i - 1];
    result.push(prev + sc * (data[i] - prev));
  }
  return result;
}

/** ZLEMA - Zero Lag EMA */
export function calculateZLEMA(data: number[], period: number = 21): number[] {
  const lag = Math.floor((period - 1) / 2);
  const adjusted: number[] = data.map((v, i) => i >= lag ? 2 * v - data[i - lag] : v);
  return calculateEMA(adjusted, period);
}

/** T3 - Tillson T3 Moving Average */
export function calculateT3(data: number[], period: number = 5, vFactor: number = 0.7): number[] {
  const e1 = calculateEMA(data, period);
  const e2 = calculateEMA(e1.map(v => isNaN(v) ? 0 : v), period);
  const e3 = calculateEMA(e2.map(v => isNaN(v) ? 0 : v), period);
  const e4 = calculateEMA(e3.map(v => isNaN(v) ? 0 : v), period);
  const e5 = calculateEMA(e4.map(v => isNaN(v) ? 0 : v), period);
  const e6 = calculateEMA(e5.map(v => isNaN(v) ? 0 : v), period);
  const c1 = -(vFactor ** 3);
  const c2 = 3 * vFactor * vFactor + 3 * vFactor ** 3;
  const c3 = -6 * vFactor * vFactor - 3 * vFactor - 3 * vFactor ** 3;
  const c4 = 1 + 3 * vFactor + vFactor ** 3 + 3 * vFactor * vFactor;
  return e3.map((_, i) => {
    if (i >= e6.length || isNaN(e6[i])) return NaN;
    return c1 * e6[i] + c2 * e5[i] + c3 * e4[i] + c4 * e3[i];
  });
}

/** LSMA - Least Squares Moving Average */
export function calculateLSMA(data: number[], period: number = 25): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      sumX += j; sumY += data[i - period + 1 + j];
      sumXY += j * data[i - period + 1 + j]; sumX2 += j * j;
    }
    const slope = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / period;
    result.push(intercept + slope * (period - 1));
  }
  return result;
}

/** McGinley Dynamic */
export function calculateMcGinley(data: number[], period: number = 14): number[] {
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    const prev = result[i - 1];
    if (isNaN(prev)) { result.push(data[i]); continue; }
    const ratio = data[i] / prev;
    result.push(prev + (data[i] - prev) / (period * Math.pow(ratio, 4)));
  }
  return result;
}

/** Vortex Indicator */
export function calculateVortex(highs: number[], lows: number[], closes: number[], period: number = 14): { viPlus: number[]; viMinus: number[] } {
  const viPlus: number[] = [], viMinus: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (i < period) { viPlus.push(NaN); viMinus.push(NaN); continue; }
    let vmPlus = 0, vmMinus = 0, tr = 0;
    for (let j = i - period + 1; j <= i; j++) {
      vmPlus += Math.abs(highs[j] - lows[j - 1]);
      vmMinus += Math.abs(lows[j] - highs[j - 1]);
      tr += Math.max(highs[j] - lows[j], Math.abs(highs[j] - closes[j - 1]), Math.abs(lows[j] - closes[j - 1]));
    }
    viPlus.push(tr === 0 ? 0 : vmPlus / tr);
    viMinus.push(tr === 0 ? 0 : vmMinus / tr);
  }
  return { viPlus, viMinus };
}

/** Choppiness Index */
export function calculateChoppiness(highs: number[], lows: number[], closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (i < period) { result.push(NaN); continue; }
    let atrSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      atrSum += Math.max(highs[j] - lows[j], Math.abs(highs[j] - closes[j - 1]), Math.abs(lows[j] - closes[j - 1]));
    }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    const range = hh - ll;
    result.push(range === 0 ? 50 : 100 * Math.log10(atrSum / range) / Math.log10(period));
  }
  return result;
}

/** Elder Ray - Bull Power & Bear Power */
export function calculateElderRay(highs: number[], lows: number[], closes: number[], period: number = 13): { bullPower: number[]; bearPower: number[] } {
  const ema = calculateEMA(closes, period);
  return {
    bullPower: highs.map((h, i) => isNaN(ema[i]) ? NaN : h - ema[i]),
    bearPower: lows.map((l, i) => isNaN(ema[i]) ? NaN : l - ema[i]),
  };
}

/** Mass Index */
export function calculateMassIndex(highs: number[], lows: number[], period: number = 25): number[] {
  const hlRange = highs.map((h, i) => h - lows[i]);
  const ema1 = calculateEMA(hlRange, 9);
  const ema2 = calculateEMA(ema1.map(v => isNaN(v) ? 0 : v), 9);
  const ratio = ema1.map((v, i) => isNaN(v) || isNaN(ema2[i]) || ema2[i] === 0 ? NaN : v / ema2[i]);
  const result: number[] = [];
  for (let i = 0; i < ratio.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0; let valid = true;
    for (let j = i - period + 1; j <= i; j++) { if (isNaN(ratio[j])) { valid = false; break; } sum += ratio[j]; }
    result.push(valid ? sum : NaN);
  }
  return result;
}

/** Chande Kroll Stop */
export function calculateChandeKrollStop(highs: number[], lows: number[], closes: number[], p: number = 10, q: number = 9, x: number = 1): { stopLong: number[]; stopShort: number[] } {
  const atr = calculateATR(highs, lows, closes, p);
  const firstHighStop: number[] = [], firstLowStop: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(atr[i])) { firstHighStop.push(NaN); firstLowStop.push(NaN); continue; }
    const start = Math.max(0, i - p + 1);
    firstHighStop.push(Math.max(...highs.slice(start, i + 1)) - x * atr[i]);
    firstLowStop.push(Math.min(...lows.slice(start, i + 1)) + x * atr[i]);
  }
  const stopLong: number[] = [], stopShort: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < q - 1 || isNaN(firstHighStop[i])) { stopLong.push(NaN); stopShort.push(NaN); continue; }
    const s = Math.max(0, i - q + 1);
    const validH = firstHighStop.slice(s, i + 1).filter(v => !isNaN(v));
    const validL = firstLowStop.slice(s, i + 1).filter(v => !isNaN(v));
    stopLong.push(validH.length > 0 ? Math.max(...validH) : NaN);
    stopShort.push(validL.length > 0 ? Math.min(...validL) : NaN);
  }
  return { stopLong, stopShort };
}

/** Linear Regression Slope */
export function calculateLinRegSlope(data: number[], period: number = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      sumX += j; sumY += data[i - period + 1 + j];
      sumXY += j * data[i - period + 1 + j]; sumX2 += j * j;
    }
    result.push((period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX));
  }
  return result;
}

/** Price Channel - High/Low channel */
export function calculatePriceChannel(highs: number[], lows: number[], period: number = 20): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [], middle: number[] = [], lower: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (i < period) { upper.push(NaN); middle.push(NaN); lower.push(NaN); continue; }
    const hh = Math.max(...highs.slice(i - period, i));
    const ll = Math.min(...lows.slice(i - period, i));
    upper.push(hh); lower.push(ll); middle.push((hh + ll) / 2);
  }
  return { upper, middle, lower };
}

// ─── OSCILLATORS (New) ──────────────────────────────────────────────────────

/** PPO - Percentage Price Oscillator */
export function calculatePPO(closes: number[], fast: number = 12, slow: number = 26, signal: number = 9): { ppo: number[]; signal: number[]; histogram: number[] } {
  const fastEMA = calculateEMA(closes, fast);
  const slowEMA = calculateEMA(closes, slow);
  const ppoLine = fastEMA.map((f, i) => isNaN(f) || isNaN(slowEMA[i]) || slowEMA[i] === 0 ? NaN : ((f - slowEMA[i]) / slowEMA[i]) * 100);
  const validPPO = ppoLine.filter(v => !isNaN(v));
  const sigEma = calculateEMA(validPPO, signal);
  const sigLine: number[] = new Array(closes.length).fill(NaN);
  let si = 0;
  for (let i = 0; i < closes.length; i++) { if (!isNaN(ppoLine[i])) { if (si < sigEma.length) sigLine[i] = sigEma[si++]; } }
  const hist = ppoLine.map((v, i) => isNaN(v) || isNaN(sigLine[i]) ? NaN : v - sigLine[i]);
  return { ppo: ppoLine, signal: sigLine, histogram: hist };
}

/** PVO - Percentage Volume Oscillator */
export function calculatePVO(volumes: number[], fast: number = 12, slow: number = 26, signal: number = 9): { pvo: number[]; signal: number[]; histogram: number[] } {
  const ppoResult = calculatePPO(volumes, fast, slow, signal);
  return { pvo: ppoResult.ppo, signal: ppoResult.signal, histogram: ppoResult.histogram };
}

/** CMO - Chande Momentum Oscillator */
export function calculateCMO(closes: number[], period: number = 9): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { result.push(NaN); continue; }
    let sumUp = 0, sumDown = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff > 0) sumUp += diff; else sumDown += Math.abs(diff);
    }
    const total = sumUp + sumDown;
    result.push(total === 0 ? 0 : ((sumUp - sumDown) / total) * 100);
  }
  return result;
}

/** Fisher Transform */
export function calculateFisher(highs: number[], lows: number[], period: number = 10): { fisher: number[]; trigger: number[] } {
  const fisher: number[] = [], trigger: number[] = [];
  let val = 0, prevFish = 0;
  for (let i = 0; i < highs.length; i++) {
    if (i < period - 1) { fisher.push(NaN); trigger.push(NaN); continue; }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    const mid = (highs[i] + lows[i]) / 2;
    const range = hh - ll;
    const raw = range === 0 ? 0 : 0.33 * 2 * ((mid - ll) / range - 0.5) + 0.67 * val;
    val = Math.max(-0.999, Math.min(0.999, raw));
    const fish = 0.5 * Math.log((1 + val) / (1 - val)) + 0.5 * prevFish;
    trigger.push(prevFish);
    fisher.push(fish);
    prevFish = fish;
  }
  return { fisher, trigger };
}

// Alias: ProChart.tsx imports this as calculateFisherTransform
export const calculateFisherTransform = calculateFisher;

/** Schaff Trend Cycle */
export function calculateSTC(closes: number[], fast: number = 23, slow: number = 50, cycle: number = 10, smoothing: number = 3): number[] {
  const macd = calculateEMA(closes, fast).map((f, i) => { const s = calculateEMA(closes, slow)[i]; return isNaN(f) || isNaN(s) ? NaN : f - s; });
  const stoch1 = (data: number[]) => {
    const r: number[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i < cycle - 1 || isNaN(data[i])) { r.push(NaN); continue; }
      const sl = data.slice(i - cycle + 1, i + 1).filter(v => !isNaN(v));
      if (sl.length < 2) { r.push(NaN); continue; }
      const max = Math.max(...sl), min = Math.min(...sl);
      r.push(max === min ? 50 : ((data[i] - min) / (max - min)) * 100);
    }
    return r;
  };
  let pf: number[] = stoch1(macd);
  for (let s = 0; s < smoothing; s++) { const e = calculateEMA(pf.filter(v => !isNaN(v)), smoothing); const mapped: number[] = new Array(closes.length).fill(NaN); let idx = 0; for (let i = 0; i < pf.length; i++) { if (!isNaN(pf[i]) && idx < e.length) mapped[i] = e[idx++]; } pf = mapped; }
  let pf2 = stoch1(pf);
  for (let s = 0; s < smoothing; s++) { const e = calculateEMA(pf2.filter(v => !isNaN(v)), smoothing); const mapped: number[] = new Array(closes.length).fill(NaN); let idx = 0; for (let i = 0; i < pf2.length; i++) { if (!isNaN(pf2[i]) && idx < e.length) mapped[i] = e[idx++]; } pf2 = mapped; }
  return pf2;
}

/** RVI - Relative Vigor Index */
export function calculateRVI(opens: number[], highs: number[], lows: number[], closes: number[], period: number = 10): { rvi: number[]; signal: number[] } {
  const num: number[] = [], den: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 3) { num.push(0); den.push(0); continue; }
    num.push(((closes[i] - opens[i]) + 2 * (closes[i-1] - opens[i-1]) + 2 * (closes[i-2] - opens[i-2]) + (closes[i-3] - opens[i-3])) / 6);
    den.push(((highs[i] - lows[i]) + 2 * (highs[i-1] - lows[i-1]) + 2 * (highs[i-2] - lows[i-2]) + (highs[i-3] - lows[i-3])) / 6);
  }
  const rvi: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period + 2) { rvi.push(NaN); continue; }
    let sn = 0, sd = 0;
    for (let j = i - period + 1; j <= i; j++) { sn += num[j]; sd += den[j]; }
    rvi.push(sd === 0 ? 0 : sn / sd);
  }
  const signal: number[] = [];
  for (let i = 0; i < rvi.length; i++) {
    if (i < 3 || isNaN(rvi[i])) { signal.push(NaN); continue; }
    signal.push((rvi[i] + 2 * rvi[i-1] + 2 * rvi[i-2] + rvi[i-3]) / 6);
  }
  return { rvi, signal };
}

/** Klinger Volume Oscillator */
export function calculateKlinger(highs: number[], lows: number[], closes: number[], volumes: number[], fast: number = 34, slow: number = 55, signal: number = 13): { klinger: number[]; signal: number[] } {
  const vf: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const hlc = highs[i] + lows[i] + closes[i];
    const prevHlc = highs[i-1] + lows[i-1] + closes[i-1];
    const trend = hlc > prevHlc ? 1 : -1;
    const dm = highs[i] - lows[i];
    const cm = i > 1 && (hlc > prevHlc) === (prevHlc > (highs[i-2]+lows[i-2]+closes[i-2])) ? (vf[i-1] !== 0 ? dm + Math.abs(dm) : dm) : dm;
    vf.push(cm === 0 ? 0 : (volumes[i] || 0) * Math.abs(2 * dm / cm - 1) * trend);
  }
  const fastEma = calculateEMA(vf, fast);
  const slowEma = calculateEMA(vf, slow);
  const kl = fastEma.map((f, i) => isNaN(f) || isNaN(slowEma[i]) ? NaN : f - slowEma[i]);
  const validKl = kl.filter(v => !isNaN(v));
  const sigEma = calculateEMA(validKl, signal);
  const sig: number[] = new Array(closes.length).fill(NaN);
  let si = 0;
  for (let i = 0; i < kl.length; i++) { if (!isNaN(kl[i]) && si < sigEma.length) sig[i] = sigEma[si++]; }
  return { klinger: kl, signal: sig };
}

/** Connors RSI - Composite of RSI + Streak RSI + Percentile Rank */
export function calculateConnorsRSI(closes: number[], rsiPeriod: number = 3, streakPeriod: number = 2, rankPeriod: number = 100): number[] {
  const rsi = calculateRSI(closes, rsiPeriod);
  // Streak
  const streak: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i-1]) streak.push(streak[i-1] > 0 ? streak[i-1] + 1 : 1);
    else if (closes[i] < closes[i-1]) streak.push(streak[i-1] < 0 ? streak[i-1] - 1 : -1);
    else streak.push(0);
  }
  const streakRsi = calculateRSI(streak, streakPeriod);
  // Percent rank
  const pctRank: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < rankPeriod) { pctRank.push(NaN); continue; }
    const change = closes[i] - closes[i-1];
    let count = 0;
    for (let j = i - rankPeriod; j < i; j++) { if (closes[j+1] - closes[j] < change) count++; }
    pctRank.push((count / rankPeriod) * 100);
  }
  return rsi.map((r, i) => isNaN(r) || isNaN(streakRsi[i]) || isNaN(pctRank[i]) ? NaN : (r + streakRsi[i] + pctRank[i]) / 3);
}

/** APO - Absolute Price Oscillator */
export function calculateAPO(closes: number[], fast: number = 12, slow: number = 26): number[] {
  const f = calculateEMA(closes, fast);
  const s = calculateEMA(closes, slow);
  return f.map((v, i) => isNaN(v) || isNaN(s[i]) ? NaN : v - s[i]);
}

/** Qstick - Mean of (Close - Open) */
export function calculateQstick(opens: number[], closes: number[], period: number = 8): number[] {
  const co = closes.map((c, i) => c - opens[i]);
  return calculateSMA(co, period);
}

/** Balance of Power */
export function calculateBOP(opens: number[], highs: number[], lows: number[], closes: number[], period: number = 14): number[] {
  const raw = closes.map((c, i) => {
    const hl = highs[i] - lows[i];
    return hl === 0 ? 0 : (c - opens[i]) / hl;
  });
  return calculateSMA(raw, period);
}

/** Psychological Line - % of up periods */
export function calculatePsychLine(closes: number[], period: number = 12): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { result.push(NaN); continue; }
    let ups = 0;
    for (let j = i - period + 1; j <= i; j++) { if (closes[j] > closes[j-1]) ups++; }
    result.push((ups / period) * 100);
  }
  return result;
}

/** Polarized Fractal Efficiency */
export function calculatePFE(closes: number[], period: number = 10, smoothing: number = 5): number[] {
  const raw: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { raw.push(NaN); continue; }
    const priceMove = Math.sqrt(Math.pow(closes[i] - closes[i - period], 2) + period * period);
    let pathLength = 0;
    for (let j = i - period + 1; j <= i; j++) pathLength += Math.sqrt(1 + Math.pow(closes[j] - closes[j-1], 2));
    const pfe = pathLength === 0 ? 0 : (priceMove / pathLength) * 100 * (closes[i] > closes[i - period] ? 1 : -1);
    raw.push(pfe);
  }
  // raw starts with `period` NaN warmup values; calculateEMA seeds from
  // raw[0] so the whole output was NaN for any input (same class as the
  // stochastic %K bug). Smooth the valid tail only.
  const firstValid = raw.findIndex(v => !isNaN(v));
  if (firstValid < 0) return raw;
  return new Array(firstValid).fill(NaN).concat(calculateEMA(raw.slice(firstValid), smoothing));
}

// ─── VOLATILITY (New) ───────────────────────────────────────────────────────

/** Ulcer Index - Drawdown-based volatility */
export function calculateUlcerIndex(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sumSq = 0;
    const maxClose = Math.max(...closes.slice(i - period + 1, i + 1));
    for (let j = i - period + 1; j <= i; j++) {
      const pctDd = ((closes[j] - maxClose) / maxClose) * 100;
      sumSq += pctDd * pctDd;
    }
    result.push(Math.sqrt(sumSq / period));
  }
  return result;
}

/** NATR - Normalized ATR (as percentage of close) */
export function calculateNATR(highs: number[], lows: number[], closes: number[], period: number = 14): number[] {
  const atr = calculateATR(highs, lows, closes, period);
  return atr.map((v, i) => isNaN(v) || closes[i] === 0 ? NaN : (v / closes[i]) * 100);
}

/** True Range (raw, not averaged) */
export function calculateTrueRange(highs: number[], lows: number[], closes: number[]): number[] {
  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < highs.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return tr;
}

/** Squeeze Momentum - Bollinger inside Keltner detection + momentum histogram */
export function calculateSqueeze(highs: number[], lows: number[], closes: number[], bbPeriod: number = 20, bbMult: number = 2, kcPeriod: number = 20, kcMult: number = 1.5): { squeeze: boolean[]; momentum: number[] } {
  const bb = calculateBollingerBands(closes, bbPeriod, bbMult);
  const kc = calculateKeltnerChannels(highs, lows, closes, kcPeriod, 10, kcMult);
  const squeeze = bb.upper.map((u, i) => !isNaN(u) && !isNaN(kc.upper[i]) && u < kc.upper[i] && bb.lower[i] > kc.lower[i]);
  // Momentum = linear regression of (close - midline of donchian/BB)
  const mid = closes.map((c, i) => {
    if (isNaN(bb.middle[i])) return NaN;
    const dc = calculateDonchian(highs, lows, bbPeriod);
    const dcMid = !isNaN(dc.middle[i]) ? dc.middle[i] : bb.middle[i];
    return c - (dcMid + bb.middle[i]) / 2;
  });
  return { squeeze, momentum: mid };
}

/** Chandelier Exit - ATR-based trailing stops */
export function calculateChandelierExit(highs: number[], lows: number[], closes: number[], period: number = 22, multiplier: number = 3): { exitLong: number[]; exitShort: number[] } {
  const atr = calculateATR(highs, lows, closes, period);
  const exitLong: number[] = [], exitShort: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1 || isNaN(atr[i])) { exitLong.push(NaN); exitShort.push(NaN); continue; }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    exitLong.push(hh - multiplier * atr[i]);
    exitShort.push(ll + multiplier * atr[i]);
  }
  return { exitLong, exitShort };
}

/** RVI - Relative Volatility Index (RSI of stddev) */
export function calculateRelativeVolIndex(closes: number[], period: number = 10, smoothing: number = 14): number[] {
  const sd = calculateStdDev(closes, period);
  const gains: number[] = [0], losses: number[] = [0];
  for (let i = 1; i < sd.length; i++) {
    if (isNaN(sd[i]) || isNaN(sd[i-1])) { gains.push(0); losses.push(0); continue; }
    const change = sd[i] - sd[i-1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  const avgGain = calculateEMA(gains, smoothing);
  const avgLoss = calculateEMA(losses, smoothing);
  return avgGain.map((g, i) => {
    if (isNaN(g) || isNaN(avgLoss[i])) return NaN;
    const total = g + avgLoss[i];
    return total === 0 ? 50 : (g / total) * 100;
  });
}

/** VHF - Vertical Horizontal Filter */
export function calculateVHF(closes: number[], period: number = 28): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { result.push(NaN); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const hc = Math.max(...slice), lc = Math.min(...slice);
    let sumChange = 0;
    for (let j = i - period + 2; j <= i; j++) sumChange += Math.abs(closes[j] - closes[j-1]);
    result.push(sumChange === 0 ? 0 : Math.abs(hc - lc) / sumChange);
  }
  return result;
}

/** Acceleration Bands */
export function calculateAccBands(highs: number[], lows: number[], closes: number[], period: number = 20): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calculateSMA(closes, period);
  const upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue; }
    let sumU = 0, sumL = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const hl = highs[j] - lows[j];
      const factor = hl === 0 ? 0 : hl / ((highs[j] + lows[j]) / 2);
      sumU += highs[j] * (1 + 2 * factor);
      sumL += lows[j] * (1 - 2 * factor);
    }
    upper.push(sumU / period);
    lower.push(sumL / period);
  }
  return { upper, middle, lower };
}

// ─── VOLUME (New) ───────────────────────────────────────────────────────────

/** VWMA - Volume Weighted Moving Average */
export function calculateVWMA(closes: number[], volumes: number[], period: number = 20): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sumPV = 0, sumV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumPV += closes[j] * (volumes[j] || 0);
      sumV += volumes[j] || 0;
    }
    result.push(sumV === 0 ? closes[i] : sumPV / sumV);
  }
  return result;
}

/** Volume Oscillator */
export function calculateVolumeOsc(volumes: number[], fast: number = 5, slow: number = 10): number[] {
  const fastMA = calculateEMA(volumes, fast);
  const slowMA = calculateEMA(volumes, slow);
  return fastMA.map((f, i) => isNaN(f) || isNaN(slowMA[i]) || slowMA[i] === 0 ? NaN : ((f - slowMA[i]) / slowMA[i]) * 100);
}

/** NVI - Negative Volume Index */
export function calculateNVI(closes: number[], volumes: number[]): number[] {
  const nvi: number[] = [1000];
  for (let i = 1; i < closes.length; i++) {
    if ((volumes[i] || 0) < (volumes[i-1] || 0)) {
      nvi.push(nvi[i-1] + (nvi[i-1] * (closes[i] - closes[i-1]) / closes[i-1]));
    } else {
      nvi.push(nvi[i-1]);
    }
  }
  return nvi;
}

/** PVI - Positive Volume Index */
export function calculatePVI(closes: number[], volumes: number[]): number[] {
  const pvi: number[] = [1000];
  for (let i = 1; i < closes.length; i++) {
    if ((volumes[i] || 0) > (volumes[i-1] || 0)) {
      pvi.push(pvi[i-1] + (pvi[i-1] * (closes[i] - closes[i-1]) / closes[i-1]));
    } else {
      pvi.push(pvi[i-1]);
    }
  }
  return pvi;
}

/** PVT - Price Volume Trend */
export function calculatePVT(closes: number[], volumes: number[]): number[] {
  const pvt: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const pctChange = closes[i-1] === 0 ? 0 : (closes[i] - closes[i-1]) / closes[i-1];
    pvt.push(pvt[i-1] + pctChange * (volumes[i] || 0));
  }
  return pvt;
}

/** VROC - Volume Rate of Change */
export function calculateVROC(volumes: number[], period: number = 14): number[] {
  return volumes.map((v, i) => i < period ? NaN : (volumes[i - period] === 0 ? 0 : ((v - volumes[i - period]) / volumes[i - period]) * 100));
}

/** Net Volume - Up volume minus down volume */
export function calculateNetVolume(closes: number[], volumes: number[], period: number = 14): number[] {
  const raw = closes.map((c, i) => i === 0 ? 0 : (c > closes[i-1] ? (volumes[i] || 0) : c < closes[i-1] ? -(volumes[i] || 0) : 0));
  return calculateSMA(raw, period);
}

/** Twiggs Money Flow - Improved CMF */
export function calculateTwiggsMF(highs: number[], lows: number[], closes: number[], volumes: number[], period: number = 21): number[] {
  const trh: number[] = [highs[0]], trl: number[] = [lows[0]];
  for (let i = 1; i < closes.length; i++) {
    trh.push(Math.max(highs[i], closes[i-1]));
    trl.push(Math.min(lows[i], closes[i-1]));
  }
  const adv: number[] = trh.map((h, i) => {
    const r = h - trl[i];
    return r === 0 ? 0 : ((closes[i] - trl[i]) / r * 2 - 1) * (volumes[i] || 0);
  });
  const emaAdv = calculateEMA(adv, period);
  const emaVol = calculateEMA(volumes, period);
  return emaAdv.map((a, i) => isNaN(a) || isNaN(emaVol[i]) || emaVol[i] === 0 ? NaN : a / emaVol[i]);
}

// ─── STATISTICS / MISC (New) ────────────────────────────────────────────────

/** Linear Regression R-Squared */
export function calculateLinRegRSquared(data: number[], period: number = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let j = 0; j < period; j++) {
      sumX += j; sumY += slice[j]; sumXY += j * slice[j]; sumX2 += j * j; sumY2 += slice[j] * slice[j];
    }
    const num = period * sumXY - sumX * sumY;
    const den = Math.sqrt((period * sumX2 - sumX * sumX) * (period * sumY2 - sumY * sumY));
    const r = den === 0 ? 0 : num / den;
    result.push(r * r);
  }
  return result;
}

/** Median Price - (H+L)/2 */
export function calculateMedianPrice(highs: number[], lows: number[]): number[] {
  return highs.map((h, i) => (h + lows[i]) / 2);
}

/** Typical Price - (H+L+C)/3 */
export function calculateTypicalPrice(highs: number[], lows: number[], closes: number[]): number[] {
  return highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
}

/** Weighted Close - (H+L+2C)/4 */
export function calculateWeightedClose(highs: number[], lows: number[], closes: number[]): number[] {
  return highs.map((h, i) => (h + lows[i] + 2 * closes[i]) / 4);
}

/** DeMark Pivot Points */
export function calculateDeMarkPivots(timestamps: number[], highs: number[], lows: number[], opens: number[], closes: number[]): { pivot: number[]; r1: number[]; s1: number[] } {
  const result = { pivot: [] as number[], r1: [] as number[], s1: [] as number[] };
  let curDay = -1, dH = 0, dL = Infinity, dO = 0, dC = 0;
  let cur = { pivot: NaN, r1: NaN, s1: NaN };
  for (let i = 0; i < timestamps.length; i++) {
    const day = new Date(timestamps[i]).getUTCDate();
    if (day !== curDay) {
      if (curDay !== -1) {
        let x: number;
        if (dC < dO) x = dH + 2 * dL + dC;
        else if (dC > dO) x = 2 * dH + dL + dC;
        else x = dH + dL + 2 * dC;
        const p = x / 4;
        cur = { pivot: p, r1: x / 2 - dL, s1: x / 2 - dH };
      }
      curDay = day; dH = highs[i]; dL = lows[i]; dO = opens[i];
    } else { dH = Math.max(dH, highs[i]); dL = Math.min(dL, lows[i]); }
    dC = closes[i];
    result.pivot.push(cur.pivot); result.r1.push(cur.r1); result.s1.push(cur.s1);
  }
  return result;
}

/** Zig Zag - Trend reversal detector */
export function calculateZigZag(highs: number[], lows: number[], closes: number[], deviation: number = 5): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < 2) return result;
  let trend = 1; // 1 = up, -1 = down
  let lastPivotIdx = 0;
  let lastPivotPrice = closes[0];
  result[0] = closes[0];
  for (let i = 1; i < closes.length; i++) {
    if (trend === 1) {
      if (highs[i] > lastPivotPrice) { lastPivotPrice = highs[i]; lastPivotIdx = i; }
      const change = ((lastPivotPrice - lows[i]) / lastPivotPrice) * 100;
      if (change >= deviation) {
        result[lastPivotIdx] = lastPivotPrice;
        trend = -1; lastPivotPrice = lows[i]; lastPivotIdx = i;
      }
    } else {
      if (lows[i] < lastPivotPrice) { lastPivotPrice = lows[i]; lastPivotIdx = i; }
      const change = ((highs[i] - lastPivotPrice) / lastPivotPrice) * 100;
      if (change >= deviation) {
        result[lastPivotIdx] = lastPivotPrice;
        trend = 1; lastPivotPrice = highs[i]; lastPivotIdx = i;
      }
    }
  }
  result[lastPivotIdx] = lastPivotPrice;
  // Interpolate between pivots
  let prevIdx = -1;
  for (let i = 0; i < result.length; i++) {
    if (!isNaN(result[i])) {
      if (prevIdx >= 0 && i - prevIdx > 1) {
        const startVal = result[prevIdx], endVal = result[i];
        for (let j = prevIdx + 1; j < i; j++) {
          result[j] = startVal + (endVal - startVal) * ((j - prevIdx) / (i - prevIdx));
        }
      }
      prevIdx = i;
    }
  }
  return result;
}

/** Williams Fractal - High/low fractal markers */
export function calculateFractals(highs: number[], lows: number[], period: number = 2): { upFractals: number[]; downFractals: number[] } {
  const up: number[] = new Array(highs.length).fill(NaN);
  const down: number[] = new Array(lows.length).fill(NaN);
  for (let i = period; i < highs.length - period; i++) {
    let isUp = true, isDown = true;
    for (let j = 1; j <= period; j++) {
      if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) isUp = false;
      if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) isDown = false;
    }
    if (isUp) up[i] = highs[i];
    if (isDown) down[i] = lows[i];
  }
  return { upFractals: up, downFractals: down };
}

/** Alligator - Bill Williams (3 smoothed MAs with displacement) */
export function calculateAlligator(closes: number[]): { jaw: number[]; teeth: number[]; lips: number[] } {
  const jawRaw = calculateSMMA(closes, 13);
  const teethRaw = calculateSMMA(closes, 8);
  const lipsRaw = calculateSMMA(closes, 5);
  // Displace: jaw by 8, teeth by 5, lips by 3
  const jaw: number[] = new Array(8).fill(NaN).concat(jawRaw.slice(0, jawRaw.length - 8));
  const teeth: number[] = new Array(5).fill(NaN).concat(teethRaw.slice(0, teethRaw.length - 5));
  const lips: number[] = new Array(3).fill(NaN).concat(lipsRaw.slice(0, lipsRaw.length - 3));
  return { jaw, teeth, lips };
}

/** Gator Oscillator - Histogram of Alligator differences */
export function calculateGator(closes: number[]): { upper: number[]; lower: number[] } {
  const { jaw, teeth, lips } = calculateAlligator(closes);
  return {
    upper: jaw.map((j, i) => isNaN(j) || isNaN(teeth[i]) ? NaN : Math.abs(j - teeth[i])),
    lower: teeth.map((t, i) => isNaN(t) || isNaN(lips[i]) ? NaN : -Math.abs(t - lips[i])),
  };
}

/** SMI - Stochastic Momentum Index */
export function calculateSMI(highs: number[], lows: number[], closes: number[], period: number = 13, smoothK: number = 25, smoothD: number = 2): { smi: number[]; signal: number[] } {
  const smiVals: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { smiVals.push(NaN); continue; }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    const midpoint = (hh + ll) / 2;
    const diff = closes[i] - midpoint;
    const range = hh - ll;
    smiVals.push(range === 0 ? 0 : (diff / (range / 2)) * 100);
  }
  const smoothed = calculateEMA(smiVals.filter(v => !isNaN(v)), smoothK);
  const smi: number[] = new Array(closes.length).fill(NaN);
  let idx = 0;
  for (let i = 0; i < smiVals.length; i++) { if (!isNaN(smiVals[i]) && idx < smoothed.length) smi[i] = smoothed[idx++]; }
  const validSmi = smi.filter(v => !isNaN(v));
  const sigEma = calculateEMA(validSmi, smoothD);
  const signal: number[] = new Array(closes.length).fill(NaN);
  idx = 0;
  for (let i = 0; i < smi.length; i++) { if (!isNaN(smi[i]) && idx < sigEma.length) signal[i] = sigEma[idx++]; }
  return { smi, signal };
}

// Aliases: ProChart.tsx imports these under different names
export const calculateKlingerOscillator = calculateKlinger;
export const calculateQStick = calculateQstick;
export const calculatePsychologicalLine = calculatePsychLine;
