import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _ema_sma_seed(arr, period):
    # Chart-style EMA: NaN warm-up, seeded with the SMA of the first `period`
    # values (pandas ewm seeds from the first value, which diverges early on).
    n = len(arr)
    out = np.full(n, np.nan)
    if n < period:
        return out
    k = 2.0 / (period + 1)
    val = arr[:period].mean()
    out[period - 1] = val
    for i in range(period, n):
        val = (arr[i] - val) * k + val
        out[i] = val
    return out


def _wilder_atr(high, low, close, period):
    # Chart-style ATR: first TR is high-low, SMA seed, Wilder recursion.
    n = len(close)
    tr = np.empty(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(high[i] - low[i],
                    abs(high[i] - close[i - 1]),
                    abs(low[i] - close[i - 1]))
    atr = np.full(n, np.nan)
    if n < period:
        return atr
    val = tr[:period].mean()
    atr[period - 1] = val
    for i in range(period, n):
        val = (val * (period - 1) + tr[i]) / period
        atr[i] = val
    return atr


@indicator("squeeze", title="Squeeze Momentum", overlay=False,
           params={"bb_length": {"type": "int", "default": 20, "min": 2, "max": 500},
                   "bb_mult": {"type": "float", "default": 2.0, "min": 0.1, "max": 10},
                   "kc_length": {"type": "int", "default": 20, "min": 1, "max": 500},
                   "kc_mult": {"type": "float", "default": 1.5, "min": 0.1, "max": 10}},
           styles={"momentum": {"kind": "histogram"}})
def squeeze(df, bb_length=20, bb_mult=2.0, kc_length=20, kc_mult=1.5):
    close = df["close"]
    bb_mid = close.rolling(bb_length).mean()
    bb_sd = close.rolling(bb_length).std(ddof=0)
    bb_upper = bb_mid + bb_mult * bb_sd
    bb_lower = bb_mid - bb_mult * bb_sd

    kc_mid = pd.Series(_ema_sma_seed(close.values, kc_length), index=df.index)
    # The chart's Keltner call hardcodes a 10-bar ATR regardless of kc_length.
    atr = pd.Series(_wilder_atr(df["high"].values, df["low"].values,
                                close.values, 10), index=df.index)
    kc_upper = kc_mid + kc_mult * atr
    kc_lower = kc_mid - kc_mult * atr

    on = (bb_upper.notna() & kc_upper.notna()
          & (bb_upper < kc_upper) & (bb_lower > kc_lower))

    dc_mid = (df["high"].rolling(bb_length).max()
              + df["low"].rolling(bb_length).min()) / 2.0
    # Donchian and BB midlines share bb_length so the fillna is only the
    # chart's belt-and-braces fallback; momentum stays NaN where BB mid is.
    momentum = close - (dc_mid.fillna(bb_mid) + bb_mid) / 2.0

    return pd.DataFrame({"squeeze": on.astype(float), "momentum": momentum})
