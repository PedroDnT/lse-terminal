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


@indicator("force_index", title="Force Index", overlay=False,
           params={"length": {"type": "int", "default": 13, "min": 1, "max": 200}})
def force_index(df, length=13):
    # copy=True: to_numpy can hand back a read-only view, and we mutate raw[0]
    raw = (df["close"].diff() * df["volume"].fillna(0.0)).to_numpy(dtype=float, copy=True)
    if len(raw):
        raw[0] = 0.0  # first bar has no price change; seeded 0 like the chart
    return pd.Series(_ema(raw, length), index=df.index)
