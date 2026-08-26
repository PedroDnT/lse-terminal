import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _wilder_atr(high, low, close, period):
    # Chart-style ATR: first TR is high-low, NaN warm-up, SMA seed at
    # period-1, then Wilder recursion (pandas ewm seeds from the first TR,
    # which diverges early on).
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


@indicator("natr", title="Normalized ATR", overlay=False,
           params={"length": {"type": "int", "default": 14, "min": 1, "max": 200}})
def natr(df, length=14):
    atr = _wilder_atr(df["high"].values, df["low"].values,
                      df["close"].values, length)
    out = pd.Series(atr, index=df.index) / df["close"] * 100.0
    return out.mask(df["close"] == 0)
