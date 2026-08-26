import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _chart_ema(values, period):
    # Chart-convention EMA: NaN through the warm-up, SMA seed at bar period-1,
    # then the standard recursion. ewm() seeds from bar 0 and would diverge.
    n = len(values)
    out = np.full(n, np.nan)
    if n >= period:
        k = 2.0 / (period + 1)
        val = values[:period].mean()
        out[period - 1] = val
        for i in range(period, n):
            val = (values[i] - val) * k + val
            out[i] = val
    return out


@indicator("zlema", title="Zero-Lag EMA",
           params={"length": {"type": "int", "default": 21, "min": 1, "max": 500}})
def zlema(df, length=21):
    c = df["close"].values
    lag = (length - 1) // 2
    adjusted = c.copy()
    if lag > 0:
        # De-lag by projecting the price forward before smoothing.
        adjusted[lag:] = 2.0 * c[lag:] - c[:-lag]
    return pd.Series(_chart_ema(adjusted, length), index=df.index)
