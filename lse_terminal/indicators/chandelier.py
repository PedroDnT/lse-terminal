import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _wilder_atr(high, low, close, period):
    # Chart-style ATR: first TR is high-low, NaN warm-up, SMA seed at
    # period-1, then Wilder recursion.
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


@indicator("chandelier", title="Chandelier Exit",
           params={"length": {"type": "int", "default": 22, "min": 1, "max": 200},
                   "mult": {"type": "float", "default": 3.0, "min": 0.5, "max": 10}})
def chandelier(df, length=22, mult=3.0):
    atr = pd.Series(_wilder_atr(df["high"].values, df["low"].values,
                                df["close"].values, length), index=df.index)
    hh = df["high"].rolling(length).max()
    ll = df["low"].rolling(length).min()
    return pd.DataFrame({"long": hh - mult * atr, "short": ll + mult * atr})
