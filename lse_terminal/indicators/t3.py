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


@indicator("t3", title="Tillson T3",
           params={"length": {"type": "int", "default": 5, "min": 1, "max": 200},
                   "v_factor": {"type": "float", "default": 0.7, "min": 0.0, "max": 1.0}})
def t3(df, length=5, v_factor=0.7):
    c = df["close"].values
    # The chart chains six EMAs, zero-filling each stage's warm-up NaNs before
    # feeding the next; the zero contamination decays geometrically and is gone
    # well before the comparison window, so we replicate it for parity.
    e1 = _chart_ema(c, length)
    e2 = _chart_ema(np.nan_to_num(e1, nan=0.0), length)
    e3 = _chart_ema(np.nan_to_num(e2, nan=0.0), length)
    e4 = _chart_ema(np.nan_to_num(e3, nan=0.0), length)
    e5 = _chart_ema(np.nan_to_num(e4, nan=0.0), length)
    e6 = _chart_ema(np.nan_to_num(e5, nan=0.0), length)
    v = v_factor
    c1 = -(v ** 3)
    c2 = 3 * v * v + 3 * v ** 3
    c3 = -6 * v * v - 3 * v - 3 * v ** 3
    c4 = 1 + 3 * v + v ** 3 + 3 * v * v
    out = c1 * e6 + c2 * e5 + c3 * e4 + c4 * e3
    out[np.isnan(e6)] = np.nan
    return pd.Series(out, index=df.index)
