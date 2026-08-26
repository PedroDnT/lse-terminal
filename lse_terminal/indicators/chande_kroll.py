import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("chande_kroll", title="Chande Kroll Stop",
           params={"p": {"type": "int", "default": 10, "min": 1, "max": 200},
                   "q": {"type": "int", "default": 9, "min": 1, "max": 200},
                   "x": {"type": "float", "default": 1.0, "min": 0.0, "max": 10.0}})
def chande_kroll(df, p=10, q=9, x=1.0):
    h, l, c = df["high"].values, df["low"].values, df["close"].values
    n = len(c)
    # Chart-convention ATR: TR[0] = high-low, SMA seed, Wilder recursion.
    tr = np.empty(n)
    if n:
        tr[0] = h[0] - l[0]
    for i in range(1, n):
        tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    atr = np.full(n, np.nan)
    if n >= p:
        val = tr[:p].mean()
        atr[p - 1] = val
        for i in range(p, n):
            val = (val * (p - 1) + tr[i]) / p
            atr[i] = val

    atr_s = pd.Series(atr, index=df.index)
    fhs = df["high"].rolling(p).max() - x * atr_s
    fls = df["low"].rolling(p).min() + x * atr_s
    # Second stage: extreme of the preliminary stops over q bars, NaNs skipped
    # (min_periods=1), but only defined once q bars exist and the current
    # preliminary stop itself is defined.
    long_stop = fhs.rolling(q, min_periods=1).max()
    short_stop = fls.rolling(q, min_periods=1).min()
    gate = fhs.isna() | (np.arange(n) < q - 1)
    return pd.DataFrame({"long": long_stop.mask(gate),
                         "short": short_stop.mask(gate)})
