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


@indicator("mass_index", title="Mass Index", overlay=False,
           params={"length": {"type": "int", "default": 25, "min": 2, "max": 200}})
def mass_index(df, length=25):
    hl_range = (df["high"] - df["low"]).values
    ema1 = _chart_ema(hl_range, 9)
    # The chart zero-fills ema1's warm-up NaNs before the second EMA; the zero
    # contamination decays away long before the comparison window.
    ema2 = _chart_ema(np.nan_to_num(ema1, nan=0.0), 9)
    ratio = np.where((np.isnan(ema1)) | (np.isnan(ema2)) | (ema2 == 0),
                     np.nan, ema1 / ema2)
    # rolling sum with default min_periods yields NaN while any warm-up NaN is
    # in the window, matching the chart's validity check.
    return pd.Series(ratio, index=df.index).rolling(length).sum()
