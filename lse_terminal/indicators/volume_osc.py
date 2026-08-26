import numpy as np
import pandas as pd

from lse_terminal.contracts import indicator


def _ema(values, period):
    # Chart-convention EMA: NaN warm-up, SMA seed at bar period-1, then recursive.
    out = np.full(len(values), np.nan)
    if len(values) >= period:
        e = values[:period].mean()
        out[period - 1] = e
        m = 2.0 / (period + 1)
        for i in range(period, len(values)):
            e = (values[i] - e) * m + e
            out[i] = e
    return out


@indicator("volume_osc", title="Volume Oscillator", overlay=False,
           params={"fast": {"type": "int", "default": 5, "min": 1, "max": 200},
                   "slow": {"type": "int", "default": 10, "min": 1, "max": 500}})
def volume_osc(df, fast=5, slow=10):
    vol = df["volume"].to_numpy(dtype=float)
    f = _ema(vol, fast)
    s = _ema(vol, slow)
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where(s == 0, np.nan, (f - s) / s * 100.0)
    return pd.Series(out, index=df.index)
