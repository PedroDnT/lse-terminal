import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


@indicator("supertrend", title="SuperTrend",
           params={"length": {"type": "int", "default": 10, "min": 1, "max": 200},
                   "mult": {"type": "float", "default": 3.0, "min": 0.5, "max": 10}})
def supertrend(df, length=10, mult=3.0):
    h, l, c = df["high"].values, df["low"].values, df["close"].values
    prev_close = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"],
                    (df["high"] - prev_close).abs(),
                    (df["low"] - prev_close).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1.0 / length, adjust=False).mean().values
    hl2 = (h + l) / 2.0
    upper = hl2 + mult * atr
    lower = hl2 - mult * atr

    n = len(c)
    st = np.full(n, np.nan)
    f_upper, f_lower, trend = upper.copy(), lower.copy(), np.ones(n, dtype=int)
    # Band carryover + flip logic is inherently sequential; n is small (<=5000).
    for i in range(1, n):
        f_upper[i] = upper[i] if upper[i] < f_upper[i - 1] or c[i - 1] > f_upper[i - 1] else f_upper[i - 1]
        f_lower[i] = lower[i] if lower[i] > f_lower[i - 1] or c[i - 1] < f_lower[i - 1] else f_lower[i - 1]
        if trend[i - 1] == 1:
            trend[i] = -1 if c[i] < f_lower[i] else 1
        else:
            trend[i] = 1 if c[i] > f_upper[i] else -1
        st[i] = f_lower[i] if trend[i] == 1 else f_upper[i]
    return pd.Series(st, index=df.index)
