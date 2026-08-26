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


@indicator("elder_ray", title="Elder Ray", overlay=False,
           params={"length": {"type": "int", "default": 13, "min": 1, "max": 200}},
           styles={"bull": {"kind": "histogram"}, "bear": {"kind": "histogram"}})
def elder_ray(df, length=13):
    ema = _chart_ema(df["close"].values, length)
    return pd.DataFrame({"bull": df["high"].values - ema,
                         "bear": df["low"].values - ema}, index=df.index)
