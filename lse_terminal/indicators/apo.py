import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _ema_seeded(values, period):
    # Chart-parity EMA: NaN warm-up, SMA seed at bar period-1, then the
    # standard recursion. pandas ewm seeds from bar 0, which diverges early.
    n = len(values)
    out = np.full(n, np.nan)
    if n < period:
        return out
    k = 2.0 / (period + 1.0)
    e = values[:period].mean()
    out[period - 1] = e
    for i in range(period, n):
        e = (values[i] - e) * k + e
        out[i] = e
    return out


@indicator("apo", title="Absolute Price Oscillator", overlay=False,
           params={"fast": {"type": "int", "default": 12, "min": 1, "max": 200},
                   "slow": {"type": "int", "default": 26, "min": 2, "max": 500}})
def apo(df, fast=12, slow=26):
    c = df["close"].to_numpy(dtype=float)
    return pd.Series(_ema_seeded(c, fast) - _ema_seeded(c, slow), index=df.index)
