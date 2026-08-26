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


@indicator("chaikin_vol", title="Chaikin Volatility", overlay=False,
           params={"ema_length": {"type": "int", "default": 10, "min": 1, "max": 200},
                   "roc_length": {"type": "int", "default": 10, "min": 1, "max": 200}})
def chaikin_vol(df, ema_length=10, roc_length=10):
    hl = (df["high"] - df["low"]).values
    ema = pd.Series(_ema_sma_seed(hl, ema_length), index=df.index)
    prev = ema.shift(roc_length)
    out = (ema - prev) / prev * 100.0
    return out.mask(prev == 0)
